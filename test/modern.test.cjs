"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { profiles, profileFor, startupArguments } = require("../src/engine-profiles.cjs");
const { spawnSync } = require("node:child_process");
const path = require("node:path"), fs = require("node:fs");
const os = require("node:os");

test("engine profiles retain the legacy release and reject unpinned versions", () => {
  assert.equal(profileFor("4.0.28").driverVersion, "6.16.0");
  assert.equal(profileFor("9.0.4").driverVersion, "7.7.0");
  assert(Object.isFrozen(profiles));
  assert.throws(() => profileFor("9.0.5"), /Unsupported/);
  assert.throws(() => profileFor("__proto__"), /Unsupported/);
});

test("modern startup preserves TLS and authentication without removed monitoring flags", () => {
  const options = { directory: "/private/Database", port: 29001, cacheSizeGB: 0.25 };
  const tls = { serverFile: "/private/server.pem", caFile: "/private/ca.pem" };
  const modern = startupArguments(options, tls, "9.0.4");
  assert.equal(modern[modern.indexOf("--tlsMode") + 1], "requireTLS");
  assert.equal(modern[modern.indexOf("--bind_ip") + 1], "127.0.0.1");
  assert(modern.includes("--auth"));
  assert(modern.includes("authenticationMechanisms=SCRAM-SHA-256"));
  assert(!modern.includes("--enableFreeMonitoring"));
  assert(!modern.includes("--sslMode"));
  const legacy = startupArguments(options, tls, "4.0.28");
  assert(legacy.includes("--sslMode")); assert(legacy.includes("--enableFreeMonitoring"));
});

test("modern source preview exposes the new driver, imports inertly and refuses an absent engine", async () => {
  const file = path.resolve(__dirname, "../dist-modern/BsonLite.cjs");
  if (!fs.existsSync(file)) {
    const result = spawnSync(process.execPath, ["scripts/build.cjs", "--engine-profile=modern", "--preview-source"], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const sdk = require(file);
  assert.equal(sdk.engineVersion, "9.0.4"); assert.equal(sdk.driverVersion, "7.7.0");
  assert.equal(sdk.version, "0.7.0-alpha.0");
  assert.equal(sdk.BSON.EJSON.stringify(new sdk.ObjectId("0123456789abcdef01234567")), '{"$oid":"0123456789abcdef01234567"}');
  const info = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../dist-modern/build-info.json")));
  assert.equal(info.experimental, true);
  assert.equal(info.nativeReady, false);
  await assert.rejects(require("../src/engine.cjs").resolveEngine({}), e => e.code === "BSONLITE_ENGINE_NOT_EMBEDDED");
});

test("modern SDK refuses plaintext and partial encryption before creating a store", async t => {
  const sdk = require(path.resolve(__dirname, "../dist-modern/BsonLite.cjs"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-modern-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [storageEncryption, code] of [["none", "BSONLITE_SECURITY_DOWNGRADE"], ["native-prototype", "BSONLITE_NATIVE_BUILD_REQUIRED"]]) {
    const directory = path.join(root, storageEncryption);
    await assert.rejects(sdk.open({ directory, storageEncryption }), error => error.code === code);
    assert.equal(fs.existsSync(directory), false);
  }
});
