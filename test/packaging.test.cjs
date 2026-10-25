"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const distribution = path.resolve(__dirname, "../dist/BsonLite.cjs");
const expected = require("../src/engine-profiles.cjs").profileFor(process.env.BSONLITE_TEST_ENGINE_VERSION || "9.0.4");

test("preview never embeds the old plaintext engine; final builds pin the native encrypted engine", function () {
  const code = fs.readFileSync(distribution, "utf8");
  const match = code.match(/"?gzipBase64"?\s*:\s*"([A-Za-z0-9+/=]+)"/);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../dist/build-info.json")));
  assert.equal(manifest.engineVersion, expected.version);
  assert.equal(manifest.driverVersion, expected.driverVersion);
  if(manifest.distributionMode==="source-preview"){assert.equal(manifest.nativeReady,false);assert.equal(manifest.engineBytes,0);assert.equal(match,null);return;}
  assert.ok(match, "embedded gzip payload must exist");
  const extracted = zlib.gunzipSync(Buffer.from(match[1], "base64"));
  assert.deepEqual(extracted, fs.readFileSync(path.resolve(__dirname, "../assets/"+(expected.id==="modern"?"modern-win32-x64":"native-win32-x64")+"/mongod.exe")));
  assert.equal(crypto.createHash("sha256").update(extracted).digest("hex"), manifest.engineSha256);
});
test("require and import work in an empty project without npm install or import side effects", function () {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite consumer "));
  try {
    fs.copyFileSync(distribution, path.join(directory, "BsonLite.cjs"));
    const assertion = "if(BsonLite.engineVersion!=="+JSON.stringify(expected.version)+"||BsonLite.driverVersion!=="+JSON.stringify(expected.driverVersion)+")throw Error('Wrong versions');" +
      "if(!new BsonLite.ObjectId().toHexString())throw Error('BSON unavailable');" +
      "const BSON=BsonLite.BSON;const saved=BSON.deserialize(BSON.serialize({big:BSON.Long.fromString('9223372036854775806'),amount:BSON.Decimal128.fromString('10.25')}),{promoteLongs:false});" +
      "if(saved.big.toString()!=='9223372036854775806'||saved.amount.toString()!=='10.25')throw Error('BSON precision lost');console.log('PACKAGED_OK');";
    fs.writeFileSync(path.join(directory, "app.cjs"), "const BsonLite=require('./BsonLite.cjs');" + assertion);
    fs.writeFileSync(path.join(directory, "app.mjs"), "import BsonLite from './BsonLite.cjs';" + assertion);
    for (const file of ["app.cjs", "app.mjs"]) {
      const result = spawnSync(process.execPath, [file], { cwd: directory, encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /PACKAGED_OK/);
    }
    assert.equal(fs.existsSync(path.join(directory, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(directory, "Database")), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("unsupported OS fails through the bundled supervisor with a clear error and releases the lock", {
  skip: process.platform === "win32" && process.arch === "x64"
}, function () {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite platform "));
  const managed = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite managed "));
  try {
    fs.copyFileSync(distribution, path.join(directory, "BsonLite.cjs"));
    fs.writeFileSync(path.join(directory, "app.cjs"),
      "const BsonLite=require('./BsonLite.cjs');" +
      "BsonLite.open().then(function(db){return db.close().then(function(){process.exitCode=1;});})" +
      ".catch(function(e){if(!['BSONLITE_UNSUPPORTED_PLATFORM','BSONLITE_ENGINE_NOT_EMBEDDED'].includes(e.code))throw e;console.log('PLATFORM_REJECTED');});");
    const result = spawnSync(process.execPath, ["app.cjs"], { cwd: directory, env: { ...process.env, BSONLITE_DATA_HOME: managed }, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PLATFORM_REJECTED/);
    assert.equal(fs.existsSync(path.join(directory, "Database", "instance.lock")), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(managed, { recursive: true, force: true }); }
});
