"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

function storagePaths(context) {
  const settings = context || {};
  const platform = settings.platform || process.platform;
  const env = settings.env || process.env;
  const home = settings.home || os.homedir();
  const paths = platform === "win32" ? path.win32 : path.posix;
  let root = settings.project || process.cwd();
  if (!settings.project) { try { root = fs.realpathSync(root); } catch (_) {} }
  root = paths.resolve(root);
  const identity = platform === "win32" ? root.toLowerCase() : root;
  const key = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32);
  let base;
  if (env.BSONLITE_DATA_HOME && paths.isAbsolute(env.BSONLITE_DATA_HOME)) {
    base = env.BSONLITE_DATA_HOME;
  } else if (platform === "win32") {
    base = paths.join(env.LOCALAPPDATA && paths.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA :
      paths.join(home, "AppData", "Local"), "BsonLite");
  } else if (platform === "darwin") {
    base = paths.join(home, "Library", "Application Support", "BsonLite");
  } else {
    base = paths.join(env.XDG_DATA_HOME && paths.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME :
      paths.join(home, ".local", "share"), "bsonlite");
  }
  return {
    directory: paths.join(root, "Database"),
    managedRoot: paths.resolve(base),
    legacyDirectory: paths.resolve(base, "projects", key)
  };
}
function storePaths(storeId) {
  if (!/^[a-f0-9]{32}$/.test(storeId)) throw new Error("Invalid store identity.");
  const root = path.join(storagePaths().managedRoot, "stores", storeId);
  return { root, vault: path.join(root, "vault.json"), sessions: path.join(root, "sessions") };
}
module.exports = { storagePaths, storePaths };
