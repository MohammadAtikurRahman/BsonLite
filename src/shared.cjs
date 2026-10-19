"use strict";
const { normalizeOptions } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");

function createSharedAPI(open) {
  let database, pending, stopping, config;
  let state = "stopped";

  function requireDatabase() {
    if (!database || database.closed || state !== "running") {
      throw new BsonLiteError("BSONLITE_NOT_STARTED",
        "Call await BsonLite.connect() in the application entry point before using collections.");
    }
    return database;
  }
  function normalize(input) {
    if (typeof input === "string") input = { name: input };
    if (input === undefined && config && (pending || (database && !database.closed))) return config;
    if (!input || typeof input !== "object" || Array.isArray(input)) return normalizeOptions(input);
    // Repeated start calls may omit settings already configured by the entry point.
    const base = config && (pending || (database && !database.closed)) ? config : {};
    return normalizeOptions(Object.assign({}, base, input));
  }
  function start(input) {
    if (stopping) return Promise.reject(new BsonLiteError("BSONLITE_STOPPING", "Wait for BsonLite.stop() before starting again."));
    let requested;
    try { requested = normalize(input); } catch (error) { return Promise.reject(error); }
    if (pending || (database && !database.closed)) {
      if (Object.keys(requested).some(key => key !== "silent" && requested[key] !== config[key])) {
        return Promise.reject(new BsonLiteError("BSONLITE_CONFIG_CONFLICT",
          "This application already started BsonLite with different settings. Use BsonLite.open() for an independent database."));
      }
      return pending || Promise.resolve(database);
    }
    config = requested;
    state = "starting";
    pending = open(config).then(function (db) {
      database = db;
      state = "running";
      if (!config.silent) console.info("[BsonLite] Connected | " + db.name + " | 127.0.0.1:" + db.info.port + " | TLS | Live files: " +
        (db.info.security.storageEncryption.method === "wiredtiger-native" ?
          (db.info.security.storageEncryption.verified ? "Native encryption verified" : "PROTOTYPE: WiredTiger encrypted; temporary files NOT protected") :
          (db.info.security.storageEncryption.verified ? "OS encryption verified" : "encryption NOT verified")));
      return db;
    }).catch(function (error) {
      state = "failed";
      throw error;
    }).finally(function () { pending = null; });
    return pending;
  }
  function stop() {
    if (stopping) return stopping;
    const waiting = pending;
    state = "stopping";
    stopping = (async function () {
      if (waiting) { try { await waiting; } catch (_) {} }
      if (database) await database.close();
    })().then(function () {
      database = null;
      config = null;
      state = "stopped";
    }).catch(function (error) {
      state = "failed";
      throw error;
    }).finally(function () { stopping = null; });
    return stopping;
  }
  function status() {
    const connected = Boolean(database && !database.closed && state === "running");
    const currentState = state === "running" && database.closed ? "stopped" : state;
    return Object.freeze({
      state: currentState, connected: connected,
      name: config ? config.name : null,
      host: "127.0.0.1", port: connected ? database.info.port : null,
      directory: config ? config.directory : null,
      authentication: "SCRAM-SHA-256",
      security: connected ? database.info.security : null
    });
  }
  return {
    connect: start, start: start, disconnect: stop, stop: stop, status: status,
    collection: function (name, options) { return requireDatabase().collection(name, options); },
    ping: function () { return requireDatabase().ping(); }
  };
}
module.exports = { createSharedAPI };
