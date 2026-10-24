"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const embedded = require("./payload.cjs");
const { atomicWrite, sha256 } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");
const { ENGINE_VERSION } = require("./constants.cjs");
const { profileFor } = require("./engine-profiles.cjs");
const { storagePaths } = require("./paths.cjs");
const { protectDirectory } = require("./permissions.cjs");
const { prepareManagedRoot } = require("./managed.cjs");
const execFileAsync = promisify(execFile);

async function resolveEngine(options) {
  let binaryPath = options.binaryPath;
  if (!binaryPath) {
    if (!embedded || embedded.sourcePreview) {
      throw new BsonLiteError("BSONLITE_ENGINE_NOT_EMBEDDED",
        "This source preview does not contain the rebuilt encrypted engine. Build and validate it using the native Windows workflow. Developer tests can supply binaryPath and nativeManifest. See START_HERE_BN.md; existing data was not reset.");
    }
    if (embedded.platform !== process.platform || embedded.arch !== process.arch) {
      throw new BsonLiteError("BSONLITE_UNSUPPORTED_PLATFORM",
        "This file contains MongoDB for " + embedded.platform + "/" + embedded.arch +
        ". Your runtime is " + process.platform + "/" + process.arch + ".");
    }
    if (embedded.version !== ENGINE_VERSION) {
      throw new BsonLiteError("BSONLITE_ENGINE_VERSION", "The embedded engine does not match this SDK's pinned profile.");
    }
    if (process.platform === "win32" && Number(require("node:os").release().split(".")[2]) < profileFor(ENGINE_VERSION).minimumWindowsBuild) {
      throw new BsonLiteError("BSONLITE_UNSUPPORTED_WINDOWS",
        "This engine requires Windows build " + profileFor(ENGINE_VERSION).minimumWindowsBuild + " or later. Check the engine profile's supported Windows editions.");
    }
    const folder = path.join(await prepareManagedRoot(), "engines",
      "mongodb-" + embedded.version + "-" + embedded.platform + "-" + embedded.arch + "-" + embedded.sha256.slice(0, 12));
    await protectDirectory(folder, []);
    binaryPath = path.join(folder, embedded.platform === "win32" ? "mongod.exe" : "mongod");
    let valid = false;
    try { valid = sha256(fs.readFileSync(binaryPath)) === embedded.sha256; } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!valid) {
      const bytes = zlib.gunzipSync(Buffer.from(embedded.gzipBase64, "base64"));
      if (sha256(bytes) !== embedded.sha256) {
        throw new BsonLiteError("BSONLITE_ENGINE_CHECKSUM", "The embedded MongoDB engine is damaged.");
      }
      try { atomicWrite(binaryPath, bytes, 0o755); }
      catch (error) {
        // Another app may publish and execute this same cache entry while we
        // extract it. Windows then refuses replacing the running executable.
        let published = false;
        if (["EPERM", "EACCES", "EEXIST", "EBUSY"].includes(error.code)) {
          try { published = sha256(fs.readFileSync(binaryPath)) === embedded.sha256; } catch (_) {}
        }
        if (!published) throw error;
      }
    }
    if (process.platform !== "win32") fs.chmodSync(binaryPath, 0o700);
    const licenseFolder = path.join(folder, "licenses");
    fs.mkdirSync(licenseFolder, { recursive: true, mode: 0o700 });
    for (const entry of embedded.licenses) {
      atomicWrite(path.join(licenseFolder, path.basename(entry.name)), entry.text);
    }
    if(embedded.nativeManifest)atomicWrite(path.join(folder,"native-engine.json"),JSON.stringify(embedded.nativeManifest,null,2));
  }
  try {
    const result = await execFileAsync(binaryPath, ["--version"], {
      windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024
    });
    const match = result.stdout.match(/db version v([0-9]+\.[0-9]+\.[0-9]+)/);
    if (!match || match[1] !== ENGINE_VERSION) {
      throw new BsonLiteError("BSONLITE_ENGINE_VERSION",
        "Expected mongod " + ENGINE_VERSION + "; found " + (match ? match[1] : "an unrecognized version") + ".");
    }
  } catch (error) {
    if (error instanceof BsonLiteError) throw error;
    throw new BsonLiteError("BSONLITE_ENGINE_EXECUTION",
      "Cannot run the MongoDB engine. Check the OS/CPU and required system libraries. " + error.message, error);
  }
  return binaryPath;
}
module.exports = { resolveEngine };
