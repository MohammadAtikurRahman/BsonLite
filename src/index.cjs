"use strict";
const { fork } = require("node:child_process");
const { inspect } = require("node:util");
const { MongoClient, ObjectId, BSON } = require("mongodb");
const { normalizeOptions } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");
const { createSharedAPI } = require("./shared.cjs");
const { VERSION, ENGINE_VERSION, DRIVER_VERSION, SUPERVISOR_FLAG } = require("./constants.cjs");

function stopSupervisor(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(function (resolve, reject) {
    let lastError;
    function cleanup() { clearTimeout(timer); child.off("exit", onExit); child.off("message", onMessage); }
    function onMessage(message) {
      if (message && message.type === "error") lastError = message.error;
    }
    function onExit(code) {
      cleanup();
      if (lastError) reject(new BsonLiteError(lastError.code, lastError.message));
      else if (code !== 0) reject(new BsonLiteError("BSONLITE_SHUTDOWN_FAILED", "Supervisor exited with code " + code + "."));
      else resolve();
    }
    const timer = setTimeout(function () {
      cleanup();
      reject(new BsonLiteError("BSONLITE_SHUTDOWN_TIMEOUT",
        "Database shutdown is still in progress. Check Database/logs and the instance lock."));
    }, timeout);
    child.on("exit", onExit);
    child.on("message", onMessage);
    if (child.connected) child.send({ type: "shutdown" }, function () {});
    else child.kill("SIGTERM");
  });
}
function startSupervisor(options) {
  const env = Object.assign({}, process.env);
  delete env.BSONLITE_VAULT_PASSWORD;
  delete env.BSONLITE_BACKUP_PASSWORD;
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  const child = fork(__filename, [SUPERVISOR_FLAG], {
    execArgv: [], windowsHide: true, env: env,
    // Let Windows IPC-disconnect cleanup finish instead of having libuv's
    // parent job terminate the supervisor before it can close our engine.
    detached: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let diagnostics = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", function (bytes) { diagnostics = (diagnostics + bytes.toString()).slice(-6000); });
  }
  const ready = new Promise(function (resolve, reject) {
    function cleanup() {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
    }
    function onError(error) { cleanup(); reject(error); }
    function onExit(code, signal) {
      cleanup();
      reject(new BsonLiteError("BSONLITE_SUPERVISOR_EXIT",
        "Database supervisor exited before ready (code " + code + ", signal " + signal + "). " + diagnostics));
    }
    function onMessage(message) {
      if (!message) return;
      if (message.type === "preparing-storage" || message.type === "starting-engine") {
        clearTimeout(timer);
        timer = setTimeout(function () {
          cleanup();
          reject(new BsonLiteError("BSONLITE_START_TIMEOUT", "BsonLite storage preparation or startup timed out."));
        }, message.type === "preparing-storage" ? 600000 : options.startupTimeoutMS + 12000);
        return;
      }
      if (message.type === "ready") { cleanup(); resolve(message); }
      if (message.type === "error") {
        cleanup(); reject(new BsonLiteError(message.error.code, message.error.message));
      }
    }
    let timer = setTimeout(function () {
      cleanup();
      reject(new BsonLiteError("BSONLITE_START_TIMEOUT", "BsonLite startup timed out. " + diagnostics));
    }, options.startupTimeoutMS + 12000);
    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
    child.send({ type: "init", options: options }, function (error) { if (error) onError(error); });
  });
  return { child: child, ready: ready };
}
class Database {
  #client;
  #database;
  #supervisor;
  #options;
  #closed = false;
  #closing = null;
  #onExit;
  constructor(client, supervisor, info, options) {
    this.#client = client;
    this.#database = client.db(options.name);
    this.#supervisor = supervisor;
    this.#options = options;
    this.name = options.name;
    this.directory = info.directory;
    this.info = Object.freeze({
      bsonliteVersion: VERSION, engineVersion: ENGINE_VERSION, driverVersion: DRIVER_VERSION,
      host: "127.0.0.1", port: info.port, enginePid: info.enginePid, supervisorPid: info.supervisorPid,
      authentication: "SCRAM-SHA-256", applicationRole: "readWrite",
      defaultWriteConcern: Object.freeze({ w: 1, j: true }),
      security: Object.freeze({ ...info.security, storageEncryption: Object.freeze(info.security.storageEncryption) })
    });
    this.#onExit = () => {
      this.#closed = true;
      void this.#client.close().catch(function () {});
    };
    supervisor.once("exit", this.#onExit);
    Object.freeze(this);
  }
  get closed() { return this.#closed || Boolean(this.#closing); }
  toJSON() { return { name: this.name, closed: this.closed, info: this.info }; }
  [inspect.custom]() { return this.toJSON(); }
  collection(name, options) {
    if (this.closed) throw new BsonLiteError("BSONLITE_CLOSED", "This database is closed.");
    return this.#database.collection(name, options);
  }
  listCollections(filter,options){
    if(this.closed)throw new BsonLiteError("BSONLITE_CLOSED","This database is closed.");
    return this.#database.listCollections(filter||{},options||{});
  }
  createCollection(name,options){
    if(this.closed)throw new BsonLiteError("BSONLITE_CLOSED","This database is closed.");
    return this.#database.createCollection(name,options);
  }
  async ping() {
    if (this.closed) throw new BsonLiteError("BSONLITE_CLOSED", "This database is closed.");
    return this.#database.command({ ping: 1 });
  }
  close() {
    if (this.#closing) return this.#closing;
    this.#closing = (async () => {
      try { await this.#client.close(); }
      finally {
        try {
          await stopSupervisor(this.#supervisor, this.#options.shutdownTimeoutMS + 12000);
        } finally {
          this.#closed = true;
          this.#supervisor.off("exit", this.#onExit);
        }
      }
    })();
    return this.#closing;
  }
}
async function open(input) {
  const options = normalizeOptions(input);
  return openNormalized(options);
}
async function openNormalized(options) {
  const task = startSupervisor(options);
  let client;
  try {
    const info = await task.ready;
    client = new MongoClient("mongodb://127.0.0.1:" + info.port, {
      authSource: "admin", auth: info.auth, directConnection: true,
      authMechanism: "SCRAM-SHA-256",
      ...info.tls,
      writeConcern: { w: 1, j: true },
      retryWrites: false, appName: "BsonLite", maxPoolSize: options.maxPoolSize,
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000
    });
    await client.connect();
    await client.db(options.name).command({ ping: 1 });
    return new Database(client, task.child, info, options);
  } catch (error) {
    if (client) { try { await client.close(); } catch (_) {} }
    try { await stopSupervisor(task.child, options.shutdownTimeoutMS + 12000); } catch (_) {}
    if (error instanceof BsonLiteError) throw error;
    throw new BsonLiteError("BSONLITE_OPEN_FAILED", error.message, error);
  }
}
module.exports = Object.freeze({
  ...createSharedAPI(openNormalized),
  backup: require("./backup.cjs").backup,
  restore: require("./backup.cjs").restore,
  recover: require("./recovery.cjs").recover,
  migrate: require("./migrate.cjs").createMigrator(open),
  upgrade: require("./upgrade.cjs").createUpgrader(openNormalized),
  open: open, ObjectId: ObjectId, BSON: BSON, BsonLiteError: BsonLiteError,
  version: VERSION, engineVersion: ENGINE_VERSION, driverVersion: DRIVER_VERSION
});
if (require.main === module && process.argv[2] === SUPERVISOR_FLAG) {
  require("./supervisor.cjs").run();
}

// Automatic local Console support is initialized only in the owning app.
if (!(require.main === module && process.argv[2] === SUPERVISOR_FLAG)) {
  module.exports = require("./console-addon.cjs")(module.exports);
}
