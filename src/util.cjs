"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { BsonLiteError } = require("./errors.cjs");
const { storagePaths } = require("./paths.cjs");

function numberOption(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isFinite(result) || result < min || result > max || (name !== "cacheSizeGB" && !Number.isInteger(result))) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", name + " must be between " + min + " and " + max + ".");
  }
  return result;
}
function normalizeOptions(options) {
  if (options === undefined) options = {};
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "open() expects an options object.");
  }
  const allowed = new Set(["name", "directory", "binaryPath", "silent", "startupTimeoutMS", "shutdownTimeoutMS",
    "maxPoolSize", "cacheSizeGB", "storageEncryption", "vaultPassword", "nativeManifest"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "Unknown option: " + key + ". Security options cannot be silently ignored.");
  }
  const defaults = storagePaths();
  const privateRelative = path.relative(process.cwd(), defaults.managedRoot);
  if (!privateRelative || (!privateRelative.startsWith(".." + path.sep) && !path.isAbsolute(privateRelative))) {
    throw new BsonLiteError("BSONLITE_PRIVATE_LOCATION", "The managed engine and vault directory must be outside the application project. Remove an in-project BSONLITE_DATA_HOME override.");
  }
  let directory = options.directory === undefined ? defaults.directory : options.directory;
  if (directory instanceof URL) directory = fileURLToPath(directory);
  if (typeof directory !== "string" || !directory.trim()) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "directory must be a non-empty path or file URL.");
  }
  directory = path.resolve(directory);
  let name = options.name;
  if (name === undefined) {
    name = "bsonlite";
    const file = path.join(directory, "bsonlite.json");
    if (fs.existsSync(file)) {
      if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 65536) {
        throw new BsonLiteError("BSONLITE_METADATA", "Unsafe database metadata. Existing data was not reset.");
      }
      let metadata;
      try { metadata = readJson(file); } catch (_) {
        throw new BsonLiteError("BSONLITE_METADATA", "Database metadata is unreadable. Restore matching metadata; do not reset data.");
      }
      if (metadata && [2,3].includes(metadata.formatVersion)) name = metadata.databaseName;
    }
  }
  if (typeof name !== "string" || !name || Buffer.byteLength(name) > 63 ||
      /[\/\\."$*<>:|?\s\x00-\x1f\x7f]/.test(name) || ["admin", "local", "config"].includes(name)) {
    throw new BsonLiteError("BSONLITE_INVALID_NAME", "Use a database name of 1-63 bytes without spaces or reserved characters.");
  }
  let binaryPath = options.binaryPath;
  if (binaryPath !== undefined) {
    if (typeof binaryPath !== "string" || !binaryPath.trim()) {
      throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "binaryPath must be a non-empty path.");
    }
    binaryPath = path.resolve(binaryPath);
  }
  if (options.silent !== undefined && typeof options.silent !== "boolean") {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "silent must be true or false.");
  }
  const storageEncryption = options.storageEncryption === undefined ? "native" : options.storageEncryption;
  if (!["native", "native-prototype", "auto", "required", "none"].includes(storageEncryption)) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "storageEncryption must be 'native', 'native-prototype', 'auto', 'required' or 'none'.");
  }
  if(options.nativeManifest!==undefined&&(typeof options.nativeManifest!=="string"||!options.nativeManifest.trim()))throw new BsonLiteError("BSONLITE_INVALID_OPTIONS","nativeManifest must be a non-empty developer manifest path.");
  const vaultPassword = options.vaultPassword === undefined ? process.env.BSONLITE_VAULT_PASSWORD : options.vaultPassword;
  if (process.platform === "win32" && vaultPassword !== undefined) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "Windows uses account-bound DPAPI automatically. vaultPassword is for non-Windows source development; backup/restore uses the separate password option.");
  }
  if (vaultPassword !== undefined && (typeof vaultPassword !== "string" || vaultPassword.length < 16 || Buffer.byteLength(vaultPassword) > 1024)) {
    throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "vaultPassword must contain 16-1024 UTF-8 bytes and at least 16 characters.");
  }
  return {
    name: name,
    directory: path.resolve(directory),
    binaryPath: binaryPath,
    nativeManifest: options.nativeManifest===undefined?undefined:path.resolve(options.nativeManifest),
    silent: options.silent === true,
    storageEncryption, vaultPassword,
    startupTimeoutMS: numberOption(options.startupTimeoutMS, 30000, 2000, 180000, "startupTimeoutMS"),
    shutdownTimeoutMS: numberOption(options.shutdownTimeoutMS, 15000, 2000, 60000, "shutdownTimeoutMS"),
    maxPoolSize: numberOption(options.maxPoolSize, 10, 1, 1000, "maxPoolSize"),
    cacheSizeGB: numberOption(options.cacheSizeGB, 0.25, 0.25, 64, "cacheSizeGB")
  };
}
function atomicWrite(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", mode || 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function tailLog(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    try {
      const length = Math.min(size, 6000);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch (_) { return ""; }
}
module.exports = { normalizeOptions, atomicWrite, readJson, sha256, isAlive, delay, tailLog };
