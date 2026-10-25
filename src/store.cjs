"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomicWrite, readJson } = require("./util.cjs");
const { storagePaths, storePaths } = require("./paths.cjs");
const { protectDirectory } = require("./permissions.cjs");
const { loadVault, saveVault, requireProtector } = require("./vault.cjs");
const { ENGINE_VERSION, FORMAT_VERSION, VERSION } = require("./constants.cjs");
const { BsonLiteError } = require("./errors.cjs");
const { prepareManagedRoot } = require("./managed.cjs");
const { nativePolicy, validNative, validDataKey, CIPHER } = require("./native-storage.cjs");

function metadataFor(storeId, name, encryptionRequired = true) {
  return { formatVersion: FORMAT_VERSION, bsonliteVersion: VERSION, engineVersion: ENGINE_VERSION,
    storageEngine: "wiredTiger", storeId, databaseName: name, encryptionRequired,
    auth: true, applicationRole: "readWrite" };
}
function readMetadata(directory) {
  const file = path.join(directory, "bsonlite.json");
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 65536) throw new BsonLiteError("BSONLITE_METADATA", "Unsafe database metadata.");
  let metadata;
  try { metadata = readJson(file); } catch (_) { throw new BsonLiteError("BSONLITE_METADATA", "Database/bsonlite.json is unreadable. Restore matching metadata; do not reset data."); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new BsonLiteError("BSONLITE_METADATA", "Invalid database metadata. Existing data was not reset.");
  if (![1, 2, FORMAT_VERSION].includes(metadata.formatVersion) || metadata.engineVersion !== ENGINE_VERSION) {
    throw new BsonLiteError("BSONLITE_DATA_VERSION", "This database requires a different BsonLite/engine version. Data was not reset.");
  }
  if (metadata.formatVersion >= 2 && (!/^[a-f0-9]{32}$/.test(metadata.storeId) || typeof metadata.databaseName !== "string")) {
    throw new BsonLiteError("BSONLITE_METADATA", "The database identity is invalid. Restore matching metadata.");
  }
  if(metadata.nativeEncryption!==undefined&&(!validNative(metadata.nativeEncryption)||metadata.formatVersion!==3))throw new BsonLiteError("BSONLITE_METADATA","Invalid native encryption metadata; data was not reset.");
  return metadata;
}
function checkLegacyLocation(options) {
  const defaults = storagePaths();
  if (options.directory !== defaults.directory || fs.existsSync(path.join(options.directory, "bsonlite.json"))) return;
  if (fs.existsSync(path.join(defaults.legacyDirectory, "bsonlite.json"))) {
    throw new BsonLiteError("BSONLITE_LEGACY_LOCATION", "An earlier database exists at " + defaults.legacyDirectory + ". Export it with BsonLite.backup({directory: oldPath, file, password}) while stopped, then restore to ./Database. A new empty database was not substituted.");
  }
}
function storagePolicy(options) {
  const metadata = readMetadata(options.directory);
  if(metadata&&metadata.nativeEncryption){
    if(options.storageEncryption==="none")throw new BsonLiteError("BSONLITE_SECURITY_DOWNGRADE","Native encryption cannot be disabled for this database.");
    const policy=metadata.nativeEncryption.coverage==="full"?"native":"native-prototype";
    if(policy==="native-prototype"&&options.storageEncryption!==policy)throw new BsonLiteError("BSONLITE_NATIVE_PROTOTYPE","This database was made by the limited Linux prototype. Use the explicit prototype mode until a full engine is validated.");
    return policy;
  }
  if(metadata&&nativePolicy(options.storageEncryption))throw new BsonLiteError("BSONLITE_NATIVE_MIGRATION_REQUIRED","Existing data uses the earlier storage format. Use BsonLite.migrate() into a new directory; the original was not overwritten.");
  if (metadata && metadata.encryptionRequired === true) {
    if (options.storageEncryption === "none") throw new BsonLiteError("BSONLITE_SECURITY_DOWNGRADE", "This database requires verified live encryption. Its policy was preserved; plaintext access was not substituted.");
    return "required";
  }
  return options.storageEncryption;
}
async function openStore(options) {
  requireProtector(options);
  await prepareManagedRoot();
  let metadata = readMetadata(options.directory);
  if (metadata && metadata.formatVersion === 1) {
    throw new BsonLiteError("BSONLITE_MIGRATION_REQUIRED", "This is a version 0.1-0.3 database. Make an encrypted BsonLite.backup while it is stopped, then restore to a new directory. The original is preserved. See START_HERE.md.");
  }
  if (metadata && metadata.databaseName !== options.name) {
    throw new BsonLiteError("BSONLITE_NAME_MISMATCH", "This Database directory belongs to database '" + metadata.databaseName + "'. Start with that name; changing a name would appear to hide its records.");
  }
  if (metadata && metadata.encryptionRequired === true && options.storageEncryption !== "required") {
    throw new BsonLiteError("BSONLITE_SECURITY_DOWNGRADE", "This database requires verified live encryption. A development opt-out cannot reopen it.");
  }
  if (!metadata) {
    const data = path.join(options.directory, "data");
    if (fs.existsSync(data) && fs.readdirSync(data).length) throw new BsonLiteError("BSONLITE_METADATA_MISSING", "Existing data has no matching bsonlite.json. Nothing was reset. Restore its metadata and encrypted credentials.");
    metadata = metadataFor(crypto.randomBytes(16).toString("hex"), options.name, options.storageEncryption === "required");
    if(nativePolicy(options.storageEncryption))metadata.nativeEncryption={version:1,cipher:CIPHER,keyId:crypto.randomBytes(16).toString("hex"),coverage:options.storageEncryption==="native"?"full":"wiredtiger-prototype"};
  }
  const locations = storePaths(metadata.storeId);
  const project = fs.realpathSync(process.cwd());
  const relative = path.relative(project, locations.root);
  if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
    throw new BsonLiteError("BSONLITE_PRIVATE_LOCATION", "The managed engine/credential location must be outside the application project. Remove an in-project BSONLITE_DATA_HOME override.");
  }
  await protectDirectory(locations.root, ["sessions"]);
  let loaded;
  if (!fs.existsSync(path.join(options.directory, "bsonlite.json"))) {
    const auth = { username: "bsonlite_admin", password: crypto.randomBytes(32).toString("hex") };
    if(metadata.nativeEncryption){auth.dataKey=crypto.randomBytes(32).toString("hex");auth.dataKeyId=metadata.nativeEncryption.keyId;}
    await saveVault(locations.vault, metadata.storeId, auth, options);
    // Identity is committed before any engine files; a failed start can reopen safely.
    atomicWrite(path.join(options.directory, "bsonlite.json"), JSON.stringify(metadata, null, 2));
  }
  loaded = await loadVault(locations.vault, metadata.storeId, options);
  if(metadata.nativeEncryption&&(!validDataKey(loaded.auth)||loaded.auth.dataKeyId!==metadata.nativeEncryption.keyId))throw new BsonLiteError("BSONLITE_DATA_KEY_MISSING","The protected data key does not match this database. Restore a matching backup; data was not reset.");
  return { ...loaded, metadata, locations };
}
module.exports = { readMetadata, metadataFor, checkLegacyLocation, openStore, storagePolicy };
