"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { BsonLiteError } = require("./errors.cjs");
const scryptAsync = promisify(crypto.scrypt);
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1 });
function validatePassword(password) {
  if (typeof password !== "string" || password.length < 16 || Buffer.byteLength(password) > 1024) {
    throw new BsonLiteError("BSONLITE_PASSWORD_REQUIRED", "Use a unique passphrase of at least 16 characters (maximum 1024 UTF-8 bytes). Keep it outside source code and version control.");
  }
}
async function deriveKey(password, salt) {
  validatePassword(password);
  return scryptAsync(password, salt, 32, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
}
async function seal(data, password, context) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await deriveKey(password, salt);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return { algorithm: "aes-256-gcm", kdf: "scrypt", ...SCRYPT,
      salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  } finally { key.fill(0); }
}
async function unseal(box, password, context) {
  if (!box || box.algorithm !== "aes-256-gcm" || box.kdf !== "scrypt" || box.N !== SCRYPT.N || box.r !== SCRYPT.r || box.p !== SCRYPT.p) {
    throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Unsupported encrypted credential format.");
  }
  const salt = Buffer.from(box.salt || "", "base64"), iv = Buffer.from(box.iv || "", "base64"), tag = Buffer.from(box.tag || "", "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || typeof box.ciphertext !== "string" || box.ciphertext.length > 65536) {
    throw new BsonLiteError("BSONLITE_VAULT_INVALID", "Invalid encrypted credential lengths.");
  }
  const key = await deriveKey(password, salt);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, "base64")), decipher.final()]);
  } catch (_) { throw new BsonLiteError("BSONLITE_VAULT_LOCKED", "The vault password is wrong or the encrypted vault has been changed. Existing data was not reset."); }
  finally { key.fill(0); }
}
module.exports = { SCRYPT, validatePassword, deriveKey, seal, unseal };
