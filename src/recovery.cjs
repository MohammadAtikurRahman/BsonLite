"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { readJson, isAlive } = require("./util.cjs");
const { readMetadata } = require("./store.cjs");
const { storePaths, storagePaths } = require("./paths.cjs");
const { rejectLinks } = require("./storage.cjs");
const { BsonLiteError } = require("./errors.cjs");

function recover(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "directory")) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "recover() accepts only {directory}. Close all applications using it before recovery.");
  }
  const directory = input.directory === undefined ? storagePaths().directory : input.directory;
  if (typeof directory !== "string" || !directory.trim()) throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "directory must be a path string.");
  const root = path.resolve(directory);
  if (!fs.existsSync(root)) return Object.freeze({ removedLocks: 0 });
  rejectLinks(root);
  const metadata = readMetadata(root);
  const locks = [path.join(root, "instance.lock"), path.join(root, "runtime", "instance.lock")];
  if (metadata && metadata.formatVersion >= 2) locks.push(path.join(storePaths(metadata.storeId).root, "instance.lock"));
  const nativeLock = path.join(root, "data", "mongod.lock");
  if (fs.existsSync(nativeLock) && isAlive(Number(fs.readFileSync(nativeLock, "utf8").trim()))) {
    throw new BsonLiteError("BSONLITE_DATABASE_IN_USE", "The recorded MongoDB PID is alive. No process was killed and no lock was removed.");
  }
  const stale = [];
  for (const lock of locks) {
    if (!fs.existsSync(lock)) continue;
    rejectLinks(lock);
    let owner; try { owner = readJson(path.join(lock, "owner.json")); } catch (_) {
      throw new BsonLiteError("BSONLITE_RECOVERY_REQUIRED", "A lock has no readable owner record. Inspect it manually; no lock was removed.");
    }
    if (!owner || typeof owner.token !== "string" || !owner.token || !Number.isSafeInteger(owner.supervisorPid) || owner.supervisorPid < 1 ||
      !(owner.enginePid === null || (Number.isSafeInteger(owner.enginePid) && owner.enginePid > 0))) {
      throw new BsonLiteError("BSONLITE_RECOVERY_REQUIRED", "Invalid lock ownership record. No lock was removed.");
    }
    if (isAlive(owner.supervisorPid) || isAlive(owner.enginePid)) throw new BsonLiteError("BSONLITE_DATABASE_IN_USE", "A recorded supervisor or engine PID is still alive. No lock was removed.");
    const age = Date.now() - Date.parse(owner.createdAt);
    if (!Number.isFinite(age) || age < 60000) throw new BsonLiteError("BSONLITE_RECOVERY_REQUIRED", "Wait at least 60 seconds after startup/crash and close all apps before stale-lock recovery.");
    stale.push({ lock, token: owner.token });
  }
  for (const item of stale) {
    const owner = readJson(path.join(item.lock, "owner.json"));
    if (owner.token !== item.token || isAlive(owner.supervisorPid) || isAlive(owner.enginePid)) throw new BsonLiteError("BSONLITE_DATABASE_IN_USE", "Lock ownership changed during recovery.");
    fs.rmSync(item.lock, { recursive: true });
  }
  return Object.freeze({ removedLocks: stale.length });
}
module.exports = { recover };
