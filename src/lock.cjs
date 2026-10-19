"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWrite, readJson } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");

function acquireLock(directory) {
  const lockPath = path.join(directory, "instance.lock");
  if (fs.existsSync(path.join(directory, "runtime", "instance.lock"))) {
    throw new BsonLiteError("BSONLITE_DATABASE_IN_USE", "A legacy database lock exists. Stop the old app and verify the recorded processes before removing that lock.");
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try { owner = readJson(path.join(lockPath, "owner.json")); } catch (_) {}
    throw new BsonLiteError("BSONLITE_DATABASE_IN_USE",
      "This Database directory is locked" + (owner ? " by supervisor PID " + owner.supervisorPid : "") +
      ". Close the other app first. For a stale lock, see npm run unlock -- <Database-directory>.");
  }
  const owner = {
    token: crypto.randomUUID(),
    supervisorPid: process.pid,
    parentPid: process.ppid,
    enginePid: null,
    createdAt: new Date().toISOString()
  };
  try {
    atomicWrite(path.join(lockPath, "owner.json"), JSON.stringify(owner, null, 2));
  } catch (error) {
    fs.rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }
  return {
    update: function (extra) {
      Object.assign(owner, extra);
      atomicWrite(path.join(lockPath, "owner.json"), JSON.stringify(owner, null, 2));
    },
    release: function () {
      try {
        if (readJson(path.join(lockPath, "owner.json")).token === owner.token) {
          fs.rmSync(lockPath, { recursive: true });
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
}
module.exports = { acquireLock };
