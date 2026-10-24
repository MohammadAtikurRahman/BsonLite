"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { MongoClient } = require("mongodb");
const { ENGINE_VERSION } = require("./constants.cjs");
const { startupArguments } = require("./engine-profiles.cjs");
const { acquireLock } = require("./lock.cjs");
const { resolveEngine } = require("./engine.cjs");
const { protectDirectory } = require("./permissions.cjs");
const { checkLegacyLocation, openStore, storagePolicy } = require("./store.cjs");
const { verifyStorage } = require("./storage.cjs");
const { createTLS } = require("./tls.cjs");
const { delay } = require("./util.cjs");
const { BsonLiteError, serialize } = require("./errors.cjs");
const { nativePolicy,resolveNative,engineConfig,keyFrame,verifyNative,createEncryptedLog } = require("./native-storage.cjs");

function send(message) {
  if (process.connected) {
    try { process.send(message, function () {}); } catch (_) {}
  }
}
function startupDiagnostic(error, auth) {
  let detail = String(error && (error.message || error.code) || "Unknown connection error");
  for (const secret of [auth && auth.password, auth && auth.dataKey]) {
    if (typeof secret === "string" && secret) detail = detail.split(secret).join("[redacted]");
  }
  return detail.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 512);
}
function createLegacyLog(file) {
  const limit = 10 * 1024 * 1024;
  const fd = fs.openSync(file, "a", 0o600);
  let size = fs.fstatSync(fd).size, closed = false;
  return {
    write(bytes) {
      if (closed || size >= limit) return;
      size += fs.writeSync(fd, bytes.subarray(0, Math.min(bytes.length, limit - size)));
    },
    close() { if (!closed) { closed = true; fs.closeSync(fd); } }
  };
}
function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function (error) { if (error) reject(error); else resolve(port); });
    });
  });
}
function clientFor(port, auth, tls, timeout) {
  const settings = {
    directConnection: true, retryWrites: false, appName: "BsonLiteSupervisor",
    serverSelectionTimeoutMS: timeout || 750, connectTimeoutMS: 750,
    socketTimeoutMS: 3000, maxPoolSize: 2, ...tls.clientOptions
  };
  if (auth) {
    settings.authSource = "admin";
    settings.authMechanism = "SCRAM-SHA-256";
    settings.auth = { username: auth.username, password: auth.password };
  }
  return new MongoClient("mongodb://127.0.0.1:" + port, settings);
}
async function bootstrapUser(port, auth, tls) {
  const client = clientFor(port, null, tls, 1000);
  try {
    await client.connect();
    await client.db("admin").command({
      createUser: auth.username, pwd: auth.password,
      mechanisms: ["SCRAM-SHA-256"],
      roles: [{ role: "root", db: "admin" }]
    });
  } catch (error) {
    throw new BsonLiteError("BSONLITE_AUTH_FAILED",
      "Cannot authenticate or create the BsonLite user. Existing data may use other credentials. " +
      "Restore an encrypted backup with matching credentials; data has not been reset.", error);
  } finally { await client.close(); }
}
async function applicationCredentials(client, name) {
  // Stable username, freshly rotated password; old application passwords expire on restart.
  // The supervisor's admin credentials never leave this process over IPC.
  const auth = {
    username: "bsonlite_app_" + crypto.createHash("sha256").update(name).digest("hex").slice(0, 24),
    password: crypto.randomBytes(32).toString("hex")
  };
  const admin = client.db("admin");
  const existing = await admin.command({ usersInfo: { user: auth.username, db: "admin" } });
  const command = existing.users.length ? { updateUser: auth.username } : { createUser: auth.username };
  await admin.command(Object.assign(command, {
    pwd: auth.password, mechanisms: ["SCRAM-SHA-256"],
    roles: [{ role: "readWrite", db: name }]
  }));
  return auth;
}
function run() {
  if (!process.send) throw new Error("The supervisor must be started by BsonLite.open().");
  let options, lock, managedLock, engine, engineExit, client, initialization, stopping, tls, processLog;
  let closing = false;
  let initialized = false;
  let failed = false;

  function checkClosing() {
    if (closing) throw new BsonLiteError("BSONLITE_CANCELLED", "Database startup was cancelled.");
  }
  async function stopEngine() {
    if (!engine || engine.exitCode !== null || engine.signalCode !== null) {
      if (client) { await client.close(); client = null; }
      return;
    }
    if (client) {
      try { await client.db("admin").command({ shutdown: 1, timeoutSecs: 5 }); } catch (_) {
        // mongod normally closes the connection as it shuts down.
      }
      await client.close();
      client = null;
    }
    let timer;
    const ended = await Promise.race([
      engineExit.then(function () { return true; }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(false); }, options.shutdownTimeoutMS); })
    ]).finally(function () { clearTimeout(timer); });
    if (!ended) {
      // Only our own ChildProcess can be terminated; never an arbitrary PID/port.
      engine.kill("SIGTERM");
      let forceTimer;
      const stopped = await Promise.race([
        engineExit.then(function () { return true; }),
        new Promise(function (resolve) { forceTimer = setTimeout(function () { resolve(false); }, 3000); })
      ]).finally(function () { clearTimeout(forceTimer); });
      if (!stopped) {
        throw new BsonLiteError("BSONLITE_SHUTDOWN_FAILED", "MongoDB did not stop. The directory lock has been retained.");
      }
    }
  }
  function requestStop() {
    if (stopping) return stopping;
    closing = true;
    stopping = (async function () {
      if (initialization) { try { await initialization; } catch (_) {} }
      await stopEngine();
      if(processLog){processLog.close();processLog=null;}
      if (tls) { tls.cleanup(); tls = null; }
      if (managedLock) { managedLock.release(); managedLock = null; }
      if (lock) { lock.release(); lock = null; }
      send({ type: "closed" });
    })().catch(function (error) {
      failed = true;
      send({ type: "error", error: serialize(error) });
    }).finally(function () {
      process.exitCode = failed ? 1 : 0;
      if (process.connected) process.disconnect();
    });
    return stopping;
  }
  async function connectReady(port, auth, logPath, deadline) {
    let attemptedBootstrap = false;
    let lastConnectionError;
    while (Date.now() < deadline) {
      checkClosing();
      if (engine.exitCode !== null || engine.signalCode !== null) {
        throw new BsonLiteError("BSONLITE_ENGINE_EXIT",
          "MongoDB exited during startup (code " + engine.exitCode + "). Private diagnostic log: " + logPath);
      }
      const candidate = clientFor(port, auth, tls);
      try {
        await candidate.connect();
        await candidate.db("admin").command({ ping: 1 });
        return candidate;
      } catch (error) {
        lastConnectionError = error;
        await candidate.close();
        if (error.code === 18) {
          if (attemptedBootstrap) {
            throw new BsonLiteError("BSONLITE_AUTH_FAILED", "The stored BsonLite credentials were rejected.", error);
          }
          attemptedBootstrap = true;
          await bootstrapUser(port, auth, tls);
        } else {
          await delay(150);
        }
      }
    }
    const detail = lastConnectionError ? " Last connection error: " + startupDiagnostic(lastConnectionError, auth) : "";
    throw new BsonLiteError("BSONLITE_START_TIMEOUT", "MongoDB did not become ready." + detail + " Private diagnostic log: " + logPath);
  }
  async function initialize(config) {
    options = config;
    send({ type: "preparing-storage" });
    checkLegacyLocation(options);
    checkClosing();
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(options.directory).isSymbolicLink()) throw new BsonLiteError("BSONLITE_UNSAFE_PATH", "Database cannot be a symbolic link.");
    options.directory = fs.realpathSync(options.directory);
    lock = acquireLock(options.directory);
    const migrationFile=path.join(options.directory,"migration.json");
    if(fs.existsSync(migrationFile)){
      let migration;try{if(fs.lstatSync(migrationFile).isSymbolicLink()||fs.statSync(migrationFile).size>1024*1024)throw new Error();migration=JSON.parse(fs.readFileSync(migrationFile,"utf8"));}catch(_){throw new BsonLiteError("BSONLITE_MIGRATION_INCOMPLETE","Invalid migration marker; data was not reset.");}
      if(migration.state!=="complete") {
        const token = options.migrationToken;
        const authorized = migration.version === 2 && migration.state === "in-progress" &&
          typeof token === "string" && /^[a-f0-9]{64}$/.test(token) &&
          typeof migration.tokenHash === "string" && /^[a-f0-9]{64}$/.test(migration.tokenHash) &&
          crypto.timingSafeEqual(Buffer.from(migration.tokenHash, "hex"), crypto.createHash("sha256").update(token).digest());
        if (!authorized) throw new BsonLiteError("BSONLITE_MIGRATION_INCOMPLETE","This destination contains an incomplete migration. Continue using the preserved original database; do not treat this copy as complete.");
      }
    }
    await protectDirectory(options.directory);
    options = { ...options, storageEncryption: storagePolicy(options) };
    const useNative=nativePolicy(options.storageEncryption);
    let encryption = useNative ? null : await verifyStorage(options.directory, options.storageEncryption);
    const binary = await resolveEngine(options);
    const native=await resolveNative(binary,options);
    const store = await openStore(options);
    managedLock = acquireLock(store.locations.root);
    const auth = store.auth;
    // The store lock proves no owned engine is running; remove only old TLS sessions.
    fs.rmSync(store.locations.sessions, { recursive: true, force: true });
    tls = await createTLS(store.locations.sessions);
    checkClosing();
    const logPath = path.join(options.directory, "logs", useNative?"bsonlite.log.enc":"bsonlite.log");
    if (!useNative && fs.existsSync(logPath) && fs.statSync(logPath).size >= 10 * 1024 * 1024) {
      const previous = path.join(options.directory, "logs", "bsonlite.previous.log");
      fs.rmSync(previous, { force: true });
      fs.renameSync(logPath, previous);
    }
    processLog=useNative?createEncryptedLog(logPath,auth):createLegacyLog(logPath);
    const deadline = Date.now() + options.startupTimeoutMS;
    send({ type: "starting-engine" });
    let port;
    const nativeConfig=useNative?engineConfig(native,store.metadata.nativeEncryption):null;
    for (let attempt = 0; attempt < 3; attempt++) {
      port = await freePort();
      checkClosing();
      const argumentsForEngine = startupArguments({ ...options, port }, tls, ENGINE_VERSION);
      if(useNative)argumentsForEngine.push("--wiredTigerEngineConfigString",nativeConfig);
      const engineEnv = { ...process.env };
      delete engineEnv.BSONLITE_VAULT_PASSWORD;
      delete engineEnv.BSONLITE_BACKUP_PASSWORD;
      engine = spawn(binary, argumentsForEngine,
        { windowsHide: true, env: engineEnv, stdio: ["pipe","pipe","pipe"] });
      engine.stdout.on("data",bytes=>processLog&&processLog.write(bytes,1));
      engine.stderr.on("data",bytes=>processLog&&processLog.write(bytes,2));
      engine.stdin.on("error",()=>{});
      if(useNative){
        const frame=keyFrame(auth);engine.stdin.end(frame,()=>frame.fill(0));
      }else engine.stdin.end();
      engineExit = new Promise(function (resolve) {
        engine.once("error", function () { resolve(); });
        engine.once("exit", function () { resolve(); });
      });
      let spawnError;
      engine.once("error", function (error) { spawnError = error; });
      lock.update({ enginePid: engine.pid || null, port: port });
      managedLock.update({ enginePid: engine.pid || null, port, directory: options.directory });
      try {
        client = await connectReady(port, auth, logPath, deadline);
        break;
      } catch (error) {
        if (spawnError) throw spawnError;
        if (engine.exitCode === 48 && attempt < 2 && !closing) {
          await engineExit;
          continue;
        }
        throw error;
      }
    }
    checkClosing();
    const appAuth = await applicationCredentials(client, options.name);
    // Recheck inheritance after MongoDB has created the actual WiredTiger files.
    if(useNative)encryption=await verifyNative(client,options.directory,native,store.metadata.nativeEncryption,nativeConfig);
    else if (encryption.verified || encryption.required) {
      encryption = await verifyStorage(options.directory, options.storageEncryption);
      if (!encryption.verified) {
        throw new BsonLiteError("BSONLITE_STORAGE_ENCRYPTION", "Previously verified storage encryption could not be reverified after file creation. Startup was stopped without changing the stored policy.");
      }
    }
    initialized = true;
    engine.once("exit", function (code, signal) {
      if (!closing) {
        failed = true;
        send({ type: "error", error: serialize(new BsonLiteError("BSONLITE_ENGINE_EXIT",
          "MongoDB stopped unexpectedly (code " + code + ", signal " + signal + ").")) });
        void requestStop();
      }
    });
    send({ type: "ready", port: port, enginePid: engine.pid,
      supervisorPid: process.pid, directory: options.directory, auth: appAuth,
      tls: tls.clientOptions,
      security: { tls: true, mutualTLS: true, minimumTLSVersion: "TLSv1.2", certificateExpiresAt: tls.expiresAt,
        credentialProtection: store.protector, storageEncryption: encryption } });
  }
  process.on("message", function (message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "shutdown") { void requestStop(); return; }
    if (message.type === "init" && !initialization && !closing) {
      initialization = initialize(message.options);
      void initialization.catch(function (error) {
        if (!closing) {
          failed = true;
          send({ type: "error", error: serialize(error) });
        }
        void requestStop();
      });
    }
  });
  process.once("disconnect", function () { void requestStop(); });
  process.once("SIGINT", function () { void requestStop(); });
  process.once("SIGTERM", function () { void requestStop(); });
  process.once("uncaughtException", function (error) {
    failed = true; send({ type: "error", error: serialize(error) }); void requestStop();
  });
  process.once("unhandledRejection", function (error) {
    failed = true; send({ type: "error", error: serialize(error) }); void requestStop();
  });
}
module.exports = { run, startupDiagnostic };
