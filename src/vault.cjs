"use strict";
const fs = require("node:fs");
const { windowsJSON } = require("./windows.cjs");
const { seal, unseal, validatePassword } = require("./cryptography.cjs");
const { atomicWrite, readJson } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");

const dpapiScript = `
Add-Type -AssemblyName System.Security
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$bytes = [Convert]::FromBase64String($data.bytes)
$entropy = [Text.Encoding]::UTF8.GetBytes($data.context)
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
if ($data.action -eq 'protect') { $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope) }
elseif ($data.action -eq 'unprotect') { $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope) }
else { throw 'Invalid vault operation' }
@{ bytes=[Convert]::ToBase64String($result) } | ConvertTo-Json -Compress
`;
function context(storeId) { return "BsonLite/vault/v2/" + storeId; }
function validAuth(auth) { return auth && auth.username === "bsonlite_admin" && typeof auth.password === "string" && /^[a-f0-9]{64}$/.test(auth.password) &&
  ((auth.dataKey===undefined&&auth.dataKeyId===undefined)||require("./native-storage.cjs").validDataKey(auth)); }
function requireProtector(options) {
  if (process.platform !== "win32") validatePassword(options.vaultPassword);
}
async function encode(auth, storeId, options) {
  const plaintext = Buffer.from(JSON.stringify(auth));
  try {
    if (process.platform === "win32") {
      const result = await windowsJSON(dpapiScript, { action: "protect", bytes: plaintext.toString("base64"), context: context(storeId) }, "BSONLITE_VAULT_LOCKED");
      if (!result || typeof result.bytes !== "string" || !result.bytes) throw new BsonLiteError("BSONLITE_VAULT_INVALID", "DPAPI did not return a protected credential.");
      return { version: 2, storeId, protector: "windows-dpapi-current-user", ciphertext: result.bytes };
    }
    return { version: 2, storeId, protector: "passphrase", box: await seal(plaintext, options.vaultPassword, context(storeId)) };
  } finally { plaintext.fill(0); }
}
async function decode(vault, storeId, options) {
  if (!vault || vault.version !== 2 || vault.storeId !== storeId) throw new BsonLiteError("BSONLITE_VAULT_INVALID", "The vault does not match this database.");
  let bytes;
  if (vault.protector === "windows-dpapi-current-user" && process.platform === "win32") {
    const result = await windowsJSON(dpapiScript, { action: "unprotect", bytes: vault.ciphertext, context: context(storeId) }, "BSONLITE_VAULT_LOCKED");
    bytes = Buffer.from(result.bytes || "", "base64");
  } else if (vault.protector === "passphrase") {
    bytes = await unseal(vault.box, options.vaultPassword, context(storeId));
  } else throw new BsonLiteError("BSONLITE_VAULT_LOCKED", "This database belongs to a different OS/account. Restore a password-encrypted BsonLite backup to create a vault for this account.");
  try {
    const auth = JSON.parse(bytes.toString("utf8"));
    if (!validAuth(auth)) throw new Error("Invalid root credential");
    return auth;
  } catch (_) { throw new BsonLiteError("BSONLITE_VAULT_INVALID", "The decrypted vault has invalid credentials. Restore a matching backup."); }
  finally { bytes.fill(0); }
}
async function saveVault(file, storeId, auth, options) {
  if (!validAuth(auth)) throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Invalid administrator credential.");
  if (fs.existsSync(file)) throw new BsonLiteError("BSONLITE_VAULT_EXISTS", "An encrypted vault already exists; it was not replaced.");
  const vault = await encode(auth, storeId, options);
  const verified = await decode(vault, storeId, options);
  if (verified.password !== auth.password || verified.dataKey!==auth.dataKey || verified.dataKeyId!==auth.dataKeyId) throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Credential/key encryption verification failed.");
  atomicWrite(file, JSON.stringify(vault, null, 2));
  return vault.protector;
}
async function loadVault(file, storeId, options) {
  if (!fs.existsSync(file)) throw new BsonLiteError("BSONLITE_VAULT_MISSING", "The OS-protected credential vault is missing. Do not reset Database. Restore an encrypted backup made with its matching credentials.");
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 128 * 1024) throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Unsafe credential vault.");
  let vault;
  try { vault = readJson(file); } catch (_) { throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Cannot read the credential vault. Existing data was not reset."); }
  return { auth: await decode(vault, storeId, options), protector: vault.protector };
}
module.exports = { requireProtector, saveVault, loadVault, validAuth };
