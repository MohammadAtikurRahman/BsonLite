"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const ENGINE_DIR = "assets/modern-win32-x64";
const SOURCE_DIR = "native/build/modern";
const TARGETS = {
  engine: { file: ENGINE_DIR + "/mongod.exe", parts: ENGINE_DIR + "/packed/", compression: "gzip", hash: "engineSha256" },
  source: { file: SOURCE_DIR + "/BsonLite-modern-engine-source.tar.gz", parts: SOURCE_DIR + "/packed/", compression: "none", hash: "sourceArchiveSha256" }
};
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function restoreNativeBuildAssets(root, profile) {
  if (profile.id !== "modern") return [];
  root = path.resolve(root);
  const missing = Object.keys(TARGETS).filter(id => !fs.existsSync(path.join(root, TARGETS[id].file)));
  if (!missing.length) return [];

  const snapshotPath = path.join(root, ENGINE_DIR, "build-assets.json");
  if (!fs.existsSync(snapshotPath)) {
    throw new Error("Native build inputs are missing. Pull the tracked build-assets snapshot before npm run build. See README.md.");
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ENGINE_DIR, "native-engine.json"), "utf8"));
  if (snapshot.version !== 1 || snapshot.engineVersion !== profile.version || manifest.engineVersion !== profile.version ||
      !Array.isArray(snapshot.artifacts) || snapshot.artifacts.length !== 2) {
    throw new Error("Tracked build inputs do not match the selected engine profile.");
  }
  const entries = new Map(snapshot.artifacts.map(entry => [entry.id, entry]));
  if (entries.size !== 2 || !entries.has("engine") || !entries.has("source")) {
    throw new Error("Tracked build input IDs are invalid.");
  }
  for (const [id, target] of Object.entries(TARGETS)) {
    const entry = entries.get(id);
    if (!validHash(entry.sha256) || entry.sha256 !== manifest[target.hash]) {
      throw new Error("Tracked " + id + " build input does not match native-engine.json.");
    }
  }

  const restored = [];
  for (const id of missing) {
    const target = TARGETS[id], entry = entries.get(id);
    if (entry.compression !== target.compression || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes <= 0 || entry.bytes > 512 * 1024 * 1024 ||
        !Number.isSafeInteger(entry.packedBytes) || entry.packedBytes <= 0 ||
        entry.packedBytes > 256 * 1024 * 1024 || !validHash(entry.packedSha256) ||
        !Array.isArray(entry.parts) || !entry.parts.length || entry.parts.length > 128) {
      throw new Error("Tracked " + id + " build input metadata is invalid.");
    }
    const seen = new Set();
    let total = 0;
    const chunks = entry.parts.map(part => {
      if (typeof part.path !== "string" || !part.path.startsWith(target.parts) ||
          !new RegExp("^" + id + "-[0-9]{4}\\.part$").test(part.path.slice(target.parts.length)) ||
          seen.has(part.path) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 ||
          part.bytes > 8 * 1024 * 1024 || !validHash(part.sha256)) {
        throw new Error("Tracked " + id + " build input part is invalid.");
      }
      seen.add(part.path);
      const file = path.join(root, part.path);
      if (!fs.existsSync(file)) throw new Error("Missing tracked build part: " + part.path + ". Run git pull before building.");
      const bytes = fs.readFileSync(file);
      if (bytes.length !== part.bytes || sha256(bytes) !== part.sha256) {
        throw new Error("Tracked build part checksum mismatch: " + part.path);
      }
      total += bytes.length;
      if (total > entry.packedBytes) throw new Error("Tracked build parts exceed the declared size.");
      return bytes;
    });
    const packed = Buffer.concat(chunks);
    if (packed.length !== entry.packedBytes || sha256(packed) !== entry.packedSha256) {
      throw new Error("Tracked " + id + " build input checksum mismatch.");
    }
    const bytes = target.compression === "gzip" ?
      zlib.gunzipSync(packed, { maxOutputLength: entry.bytes }) : packed;
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error("Restored " + id + " build input checksum mismatch.");
    }
    const destination = path.join(root, target.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = destination + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temporary, bytes, { flag: "wx" });
      if (fs.existsSync(destination)) {
        if (sha256(fs.readFileSync(destination)) !== entry.sha256) {
          throw new Error("An existing build input differs; it was not replaced: " + target.file);
        }
      } else {
        fs.renameSync(temporary, destination);
      }
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    restored.push(target.file);
  }
  return restored;
}

module.exports = { restoreNativeBuildAssets };

if (require.main === module) {
  const { ENGINE_VERSION } = require("../src/constants.cjs");
  const { profileFor } = require("../src/engine-profiles.cjs");
  try {
    const restored = restoreNativeBuildAssets(path.resolve(__dirname, ".."), profileFor(ENGINE_VERSION));
    console.log("Native build inputs ready (" + restored.length + " files restored).");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
