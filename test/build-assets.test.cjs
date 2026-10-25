"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { restoreNativeBuildAssets } = require("../scripts/restore-native-assets.cjs");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const profile = { id: "modern", version: "9.0.4" };
const engineTarget = "assets/modern-win32-x64/mongod.exe";
const sourceTarget = "native/build/modern/BsonLite-modern-engine-source.tar.gz";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-build-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payloads = { engine: Buffer.from("engine fixture; never executed"), source: Buffer.from("matching source archive fixture") };
  const artifacts = Object.entries(payloads).map(([id, bytes]) => {
    const packed = id === "engine" ? zlib.gzipSync(bytes) : bytes;
    const folder = id === "engine" ? "assets/modern-win32-x64/packed/" : "native/build/modern/packed/";
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    const parts = [];
    for (let start = 0; start < packed.length; start += 7) {
      const part = packed.subarray(start, start + 7);
      const name = folder + id + "-" + String(parts.length + 1).padStart(4, "0") + ".part";
      fs.writeFileSync(path.join(root, name), part);
      parts.push({ path: name, bytes: part.length, sha256: sha(part) });
    }
    return { id, compression: id === "engine" ? "gzip" : "none", bytes: bytes.length, packedBytes: packed.length, sha256: sha(bytes), packedSha256: sha(packed), parts };
  });
  const snapshot = { version: 1, engineVersion: "9.0.4", artifacts };
  const manifest = { engineVersion: "9.0.4", engineSha256: sha(payloads.engine), sourceArchiveSha256: sha(payloads.source) };
  const save = () => {
    fs.writeFileSync(path.join(root, "assets/modern-win32-x64/build-assets.json"), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(root, "assets/modern-win32-x64/native-engine.json"), JSON.stringify(manifest));
  };
  save();
  return { root, payloads, snapshot, manifest, save };
}

test("tracked native parts restore exact engine/source bytes and a second build leaves them alone", t => {
  const f = fixture(t);
  assert.deepEqual(restoreNativeBuildAssets(f.root, profile), [engineTarget, sourceTarget]);
  assert.deepEqual(fs.readFileSync(path.join(f.root, engineTarget)), f.payloads.engine);
  assert.deepEqual(fs.readFileSync(path.join(f.root, sourceTarget)), f.payloads.source);
  const before = fs.statSync(path.join(f.root, engineTarget)).mtimeMs;
  assert.deepEqual(restoreNativeBuildAssets(f.root, profile), []);
  assert.equal(fs.statSync(path.join(f.root, engineTarget)).mtimeMs, before);
});

test("a corrupt tracked part never publishes a reconstructed executable", t => {
  const f = fixture(t), part = f.snapshot.artifacts[0].parts[0];
  const bytes = fs.readFileSync(path.join(f.root, part.path));
  bytes[0] ^= 1;
  fs.writeFileSync(path.join(f.root, part.path), bytes);
  assert.throws(() => restoreNativeBuildAssets(f.root, profile), /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(f.root, engineTarget)), false);
});

test("a missing tracked part fails with its path and creates no executable", t => {
  const f = fixture(t), part = f.snapshot.artifacts[0].parts[0];
  fs.rmSync(path.join(f.root, part.path));
  assert.throws(() => restoreNativeBuildAssets(f.root, profile), /Missing tracked build part/);
  assert.equal(fs.existsSync(path.join(f.root, engineTarget)), false);
});

test("snapshot/native manifest mismatches are rejected before publishing build inputs", t => {
  const f = fixture(t);
  f.manifest.sourceArchiveSha256 = "0".repeat(64);
  f.save();
  assert.throws(() => restoreNativeBuildAssets(f.root, profile), /does not match native-engine/);
  assert.equal(fs.existsSync(path.join(f.root, engineTarget)), false);
  assert.equal(fs.existsSync(path.join(f.root, sourceTarget)), false);
});

test("tracked part paths cannot escape their fixed build asset directories", t => {
  const f = fixture(t);
  f.snapshot.artifacts[0].parts[0].path = "assets/modern-win32-x64/packed/../../outside.part";
  f.save();
  assert.throws(() => restoreNativeBuildAssets(f.root, profile), /part is invalid/);
  assert.equal(fs.existsSync(path.join(f.root, engineTarget)), false);
});

test("restoring a missing source archive preserves an existing engine and skips legacy builds", t => {
  const f = fixture(t), engine = path.join(f.root, engineTarget);
  fs.writeFileSync(engine, f.payloads.engine);
  const before = fs.statSync(engine).mtimeMs;
  assert.deepEqual(restoreNativeBuildAssets(f.root, { id: "legacy" }), []);
  assert.equal(fs.existsSync(path.join(f.root, sourceTarget)), false);
  assert.deepEqual(restoreNativeBuildAssets(f.root, profile), [sourceTarget]);
  assert.equal(fs.statSync(engine).mtimeMs, before);
  assert.deepEqual(fs.readFileSync(engine), f.payloads.engine);
});
