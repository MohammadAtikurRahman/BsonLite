"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { verifyStorage } = require("../src/storage.cjs");
const { seal, unseal } = require("../src/cryptography.cjs");
const { saveVault, loadVault } = require("../src/vault.cjs");
const { protectDirectory } = require("../src/permissions.cjs");
const { safePath, validateManifest } = require("../src/backup.cjs");
const { createTLS } = require("../src/tls.cjs");
const password = "unit-only-not-a-production-secret";

test("Windows helpers preserve Unicode paths and text in both directions", { skip: process.platform !== "win32" }, async () => {
  const { windowsJSON } = require("../src/windows.cjs");
  const value = "বাংলা পথ / 雪 / 😀";
  const result = await windowsJSON("$payload=[Console]::In.ReadToEnd()|ConvertFrom-Json\n@{value=$payload.value}|ConvertTo-Json -Compress", { value }, "BSONLITE_TEST_HELPER");
  assert.equal(result.value, value);
});

test("storage encryption fails closed unless actual encryption is verified", async () => {
  for (const result of [{ verified: false, method: "unverified" }, { verified: true, method: "ntfs" }, { verified: "true", method: "efs" }]) {
    await assert.rejects(verifyStorage("C:\\Database", "required", async () => result, "win32"), error => error.code === "BSONLITE_STORAGE_ENCRYPTION");
  }
  assert.equal((await verifyStorage("C:\\Database", "required", async () => ({ verified: true, method: "bitlocker" }), "win32")).verified, true);
  assert.equal((await verifyStorage("C:\\Database", "required", async () => ({ verified: true, method: "efs" }), "win32")).method, "efs");
  assert.equal((await verifyStorage("/test", "none")).verified, false);
  await assert.rejects(verifyStorage("/test", "required", undefined, "linux"), error => error.code === "BSONLITE_STORAGE_ENCRYPTION");
});
test("credential encryption authenticates ciphertext, password, context and KDF parameters", async () => {
  const value = Buffer.from("root-credential-canary");
  const a = await seal(value, password, "store-a"), b = await seal(value, password, "store-a");
  assert.notEqual(a.ciphertext, b.ciphertext); assert.notEqual(a.salt, b.salt);
  assert.deepEqual(await unseal(a, password, "store-a"), value);
  for (const [box, pass, context] of [[a, password + "wrong", "store-a"], [a, password, "store-b"], [{ ...a, tag: crypto.randomBytes(16).toString("base64") }, password, "store-a"]]) {
    await assert.rejects(unseal(box, pass, context), error => error.code === "BSONLITE_VAULT_LOCKED");
  }
  await assert.rejects(unseal({ ...a, N: 2 ** 30 }, password, "store-a"), error => error.code === "BSONLITE_VAULT_INVALID");
});
test("vault round trip uses DPAPI on Windows and authenticated encryption in source development", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-vault-"));
  const file = path.join(root, "vault.json"), storeId = crypto.randomBytes(16).toString("hex");
  const auth = { username: "bsonlite_admin", password: crypto.randomBytes(32).toString("hex") };
  const options = process.platform === "win32" ? {} : { vaultPassword: password };
  try {
    await protectDirectory(root, []);
    const protector = await saveVault(file, storeId, auth, options);
    assert.equal(protector, process.platform === "win32" ? "windows-dpapi-current-user" : "passphrase");
    assert.equal(fs.readFileSync(file, "utf8").includes(auth.password), false);
    assert.deepEqual((await loadVault(file, storeId, options)).auth, auth);
    await assert.rejects(loadVault(file, "f".repeat(32), options), error => error.code === "BSONLITE_VAULT_INVALID");
    await assert.rejects(saveVault(file, storeId, auth, options), error => error.code === "BSONLITE_VAULT_EXISTS");
    if (process.platform !== "win32") await assert.rejects(loadVault(file, storeId, { vaultPassword: password + "wrong" }), error => error.code === "BSONLITE_VAULT_LOCKED");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("archive paths exclude traversal, Windows devices, duplicates and oversized payloads", () => {
  for (const value of ["/data/x", "data/../secret", "data/./x", "data/a\\b", "data/C:/x", "data/con.txt", "data/x.", "data//x", "data/x:stream"]) assert.equal(safePath(value), false, value);
  assert.equal(safePath("data/journal/WiredTigerLog.0000000001"), true);
  const base = { version: 1, engineVersion: require("../src/constants.cjs").ENGINE_VERSION, databaseName: "test", auth: { username: "bsonlite_admin", password: "a".repeat(64) }, total: 1,
    files: [{ path: "data/WiredTiger", size: 1, sha256: "b".repeat(64) }] };
  validateManifest(base, 100);
  for (const manifest of [{ ...base, total: 101 }, { ...base, files: [...base.files, { ...base.files[0], path: "data/wiredtiger" }], total: 2 },
    { ...base, files: [{ ...base.files[0], path: "data/../escape" }] }]) assert.throws(() => validateManifest(manifest, 100), error => error.code === "BSONLITE_BACKUP_INVALID");
});
test("generated TLS identities have a private CA, verified IP SAN, distinct client identity and cleanup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-cert-")); let tls;
  try {
    await protectDirectory(root, []); tls = await createTLS(root);
    const ca = new crypto.X509Certificate(fs.readFileSync(tls.caFile));
    const server = new crypto.X509Certificate(fs.readFileSync(tls.serverFile));
    const client = new crypto.X509Certificate(fs.readFileSync(tls.clientFile));
    assert.equal(ca.ca, true); assert.equal(server.ca, false); assert.ok(server.verify(ca.publicKey)); assert.ok(client.verify(ca.publicKey));
    assert.equal(server.checkIP("127.0.0.1"), "127.0.0.1"); assert.equal(server.checkIP("127.0.0.2"), undefined);
    assert.equal(server.checkHost("localhost"), "localhost"); assert.notEqual(server.subject, client.subject);
    assert.ok(server.keyUsage.includes("1.3.6.1.5.5.7.3.1")); assert.ok(client.keyUsage.includes("1.3.6.1.5.5.7.3.2"));
    const directory = tls.directory; tls.cleanup(); tls = null; assert.equal(fs.existsSync(directory), false);
  } finally { if (tls) tls.cleanup(); fs.rmSync(root, { recursive: true, force: true }); }
});
test("auto policy starts without OS encryption setup while reporting actual protection", async () => {
  const {BsonLiteError}=require("../src/errors.cjs");
  for(const result of [{verified:false,method:"unverified"},null,{verified:"true",method:"efs"}]) {
    const status=await verifyStorage("C:\\Database","auto",async()=>result,"win32");
    assert.equal(status.policy,"auto");assert.equal(status.required,false);assert.equal(status.verified,false);assert.equal(status.method,"unverified");
  }
  const unavailable=async()=>{throw new BsonLiteError("BSONLITE_STORAGE_ENCRYPTION","Windows query denied");};
  assert.equal((await verifyStorage("C:\\Database","auto",unavailable,"win32")).verified,false);
  await assert.rejects(verifyStorage("C:\\Database","required",unavailable,"win32"),error=>error.code==="BSONLITE_STORAGE_ENCRYPTION");
  assert.equal((await verifyStorage("C:\\Database","auto",async()=>({verified:true,method:"bitlocker"}),"win32")).verified,true);
  assert.equal((await verifyStorage("/test","auto",async()=>{throw Error("Must not run a Windows helper");},"linux")).verified,false);
  await assert.rejects(verifyStorage("C:\\Database","auto",async()=>{throw Error("Programming error");},"win32"),/Programming error/);
});
