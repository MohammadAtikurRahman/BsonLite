"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { acquireLock } = require("./lock.cjs");
const { readMetadata, metadataFor } = require("./store.cjs");
const { storePaths } = require("./paths.cjs");
const { loadVault, saveVault, requireProtector, validAuth } = require("./vault.cjs");
const { protectDirectory } = require("./permissions.cjs");
const { verifyStorage, rejectLinks } = require("./storage.cjs");
const { normalizeOptions, atomicWrite, readJson, isAlive } = require("./util.cjs");
const { SCRYPT, deriveKey, validatePassword } = require("./cryptography.cjs");
const { ENGINE_VERSION } = require("./constants.cjs");
const { BsonLiteError } = require("./errors.cjs");
const { prepareManagedRoot } = require("./managed.cjs");
const {nativePolicy,validNative,validDataKey}=require("./native-storage.cjs");

const MAGIC = Buffer.from("BSLTBK01");
const MAX_MANIFEST = 4 * 1024 * 1024;
const MAX_FILES = 10000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
function fail(message, code = "BSONLITE_BACKUP_INVALID") { return new BsonLiteError(code, message); }
function optionsFor(input, restore) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("An options object is required.", "BSONLITE_INVALID_OPTIONS");
  const allowed = new Set(["directory", "file", "password", "vaultPassword", "maxBytes", ...(restore ? ["storageEncryption"] : ["name"])]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw fail("Unknown backup/restore option: " + key, "BSONLITE_INVALID_OPTIONS");
  validatePassword(input.password);
  if (typeof input.file !== "string" || !input.file.trim()) throw fail("A backup file path is required.", "BSONLITE_INVALID_OPTIONS");
  const config = normalizeOptions({ directory: input.directory, vaultPassword: input.vaultPassword,
    ...(restore ? { storageEncryption: input.storageEncryption } : {}), ...(input.name ? { name: input.name } : {}) });
  const maxBytes = input.maxBytes === undefined ? DEFAULT_MAX_BYTES : input.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 ** 4) throw fail("maxBytes must be an integer from 1024 to 1 TiB.", "BSONLITE_INVALID_OPTIONS");
  return { ...config, file: path.resolve(input.file), password: input.password, maxBytes };
}
function safePath(name) {
  if (typeof name !== "string" || name.length > 2048 || !name.startsWith("data/")) return false;
  const segments = name.split("/");
  return segments.every(segment => /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== ".." &&
    !/[. ]$/.test(segment) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment));
}
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function publishExclusive(temporary, target) {
  try { await fsp.link(temporary, target); }
  catch (error) {
    if (error.code === "EEXIST") throw fail("The backup destination appeared during backup; it was preserved.", "BSONLITE_BACKUP_EXISTS");
    if (!["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EPERM"].includes(error.code)) throw error;
    // FAT/exFAT backup media do not support hard links. Still create exclusively;
    // an interrupted copy is detectable through mandatory archive authentication.
    const fd = await fsp.open(target, "wx", 0o600);
    let completed = false;
    try {
      await pipeline(fs.createReadStream(temporary), fs.createWriteStream(target, { fd: fd.fd, autoClose: false }));
      await fd.sync(); completed = true;
    } finally { await fd.close(); if (!completed) fs.rmSync(target, { force: true }); }
  }
}
async function listFiles(directory, maxBytes) {
  const files = []; let total = 0;
  async function walk(root, relative) {
    for (const entry of fs.readdirSync(root).sort()) {
      const file = path.join(root, entry), name = relative + "/" + entry;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || !safePath(name)) throw fail("Database contains an unsafe file path.");
      if (stat.isDirectory()) await walk(file, name);
      else {
        total += stat.size;
        if (!Number.isSafeInteger(total) || total > maxBytes || files.length >= MAX_FILES) throw fail("Database exceeds the configured backup size/file limit.");
        files.push({ path: name, size: stat.size, sha256: await hashFile(file) });
      }
    }
  }
  await walk(path.join(directory, "data"), "data");
  if (!files.some(file => file.path === "data/WiredTiger")) throw fail("This is not an initialized WiredTiger database.");
  return { files, total };
}
async function backup(input) {
  const options = optionsFor(input, false);
  if (!fs.existsSync(options.directory)) throw fail("Database directory does not exist.");
  rejectLinks(options.directory);
  const relative = path.relative(options.directory, options.file);
  if (!relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw fail("Save the backup outside Database.");
  if (fs.existsSync(options.file)) throw fail("The backup destination already exists; it was not overwritten.", "BSONLITE_BACKUP_EXISTS");
  const lock = acquireLock(options.directory);
  let temporary, key, managedLock;
  try {
    const engineLock = path.join(options.directory, "data", "mongod.lock");
    if (fs.existsSync(engineLock) && isAlive(Number(fs.readFileSync(engineLock, "utf8").trim()))) throw fail("A MongoDB process may still be using these files. Stop it before backing up.", "BSONLITE_DATABASE_IN_USE");
    const metadata = readMetadata(options.directory);
    if (!metadata) throw fail("The database metadata is missing.");
    let auth, name;
    if (metadata.formatVersion === 1) {
      if (!input.name) throw fail("Specify name:'myapp' (your original database name) when exporting a legacy database.");
      name = options.name;
      const credential = path.join(options.directory, "runtime", "auth.json");
      if (!fs.existsSync(credential) || fs.statSync(credential).size > 65536) throw fail("The original legacy credentials are required; data was not reset.");
      try { auth = readJson(credential); } catch (_) { throw fail("The legacy credential file is unreadable. Restore matching credentials; data was not reset."); }
    } else {
      name = metadata.databaseName;
      managedLock = acquireLock(storePaths(metadata.storeId).root);
      auth = (await loadVault(storePaths(metadata.storeId).vault, metadata.storeId, options)).auth;
    }
    if (!validAuth(auth)) throw fail("The database credentials are invalid.");
    const { files, total } = await listFiles(options.directory, options.maxBytes);
    const encryptionRequired = metadata.encryptionRequired === true;
    const nativeEncryption=metadata.nativeEncryption;
    if(nativeEncryption&&(!validNative(nativeEncryption)||!validDataKey(auth)||auth.dataKeyId!==nativeEncryption.keyId))throw fail("The native data key and metadata do not match.");
    const manifest = Buffer.from(JSON.stringify({ version: 1, engineVersion: ENGINE_VERSION, databaseName: name, encryptionRequired, ...(nativeEncryption?{nativeEncryption}:{}), auth, total, files }));
    if (manifest.length > MAX_MANIFEST) throw fail("The backup file manifest is too large.");
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const header = Buffer.from(JSON.stringify({ version: 1, algorithm: "aes-256-gcm", compression: "gzip", kdf: "scrypt", ...SCRYPT,
      salt: salt.toString("base64"), iv: iv.toString("base64"), engineVersion: ENGINE_VERSION, platform: process.platform, arch: process.arch, encryptionRequired,...(nativeEncryption?{nativeEncryption}:{}) }));
    const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
    const prefix = Buffer.concat([MAGIC, length, header]);
    key = await deriveKey(options.password, salt);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(prefix);
    await fsp.mkdir(path.dirname(options.file), { recursive: true, mode: 0o700 });
    temporary = options.file + ".partial-" + crypto.randomBytes(16).toString("hex");
    const fd = await fsp.open(temporary, "wx", 0o600);
    try {
      await fd.writeFile(prefix);
      async function* contents() {
        const size = Buffer.alloc(4); size.writeUInt32BE(manifest.length); yield size; yield manifest;
        for (const entry of files) {
          const file = path.join(options.directory, ...entry.path.split("/"));
          let count = 0; const hash = crypto.createHash("sha256");
          for await (const bytes of fs.createReadStream(file)) { count += bytes.length; hash.update(bytes); yield bytes; }
          if (count !== entry.size || hash.digest("hex") !== entry.sha256) throw fail("Database files changed during backup. No backup was committed.");
        }
      }
      // The stream writes encrypted bytes only. No temporary plaintext archive exists.
      const output = fs.createWriteStream(temporary, { fd: fd.fd, start: prefix.length, autoClose: false });
      await pipeline(Readable.from(contents()), zlib.createGzip({ level: 6 }), cipher, output);
      await fd.write(cipher.getAuthTag(), 0, 16, fs.fstatSync(fd.fd).size);
      await fd.sync();
    } finally { await fd.close(); manifest.fill(0); }
    // Hard-link promotion is exclusive: a destination appearing mid-backup is preserved.
    await publishExclusive(temporary, options.file); await fsp.unlink(temporary); temporary = null;
    return Object.freeze({ file: options.file, encrypted: true, algorithm: "AES-256-GCM", databaseName: name, files: files.length, sourceBytes: total });
  } finally {
    if (key) key.fill(0);
    if (temporary) fs.rmSync(temporary, { force: true });
    if (managedLock) managedLock.release();
    lock.release();
  }
}
async function readArchive(file) {
  const fd = await fsp.open(file, "r");
  try {
    const stat = await fd.stat();
    const base = Buffer.alloc(12);
    if ((await fd.read(base, 0, 12, 0)).bytesRead !== 12 || !base.subarray(0, 8).equals(MAGIC)) throw fail("Not a BsonLite encrypted backup.");
    const size = base.readUInt32BE(8);
    if (size < 2 || size > 4096 || stat.size < 12 + size + 16) throw fail("Invalid backup header length.");
    if (!stat.isFile()) throw fail("Backup must be a regular file.");
    const body = Buffer.alloc(size);
    if ((await fd.read(body, 0, size, 12)).bytesRead !== size) throw fail("Truncated backup header.");
    let header; try { header = JSON.parse(body.toString("utf8")); } catch (_) { throw fail("Invalid backup header."); }
    if (!header || header.version !== 1 || header.algorithm !== "aes-256-gcm" || header.compression !== "gzip" || header.kdf !== "scrypt" ||
      header.N !== SCRYPT.N || header.r !== SCRYPT.r || header.p !== SCRYPT.p || header.engineVersion !== ENGINE_VERSION ||
      header.platform !== process.platform || header.arch !== process.arch || typeof header.salt !== "string" || typeof header.iv !== "string") {
      throw fail("Unsupported backup format, engine, OS or CPU architecture. Physical backups restore to the same platform and engine only.");
    }
    if (header.encryptionRequired !== undefined && typeof header.encryptionRequired !== "boolean") throw fail("Invalid backup encryption policy.");
    if(header.nativeEncryption!==undefined&&!validNative(header.nativeEncryption))throw fail("Invalid native encryption backup header.");
    const salt = Buffer.from(header.salt, "base64"), iv = Buffer.from(header.iv, "base64");
    if (salt.length !== 16 || iv.length !== 12) throw fail("Invalid backup encryption parameters.");
    const tag = Buffer.alloc(16);
    if ((await fd.read(tag, 0, 16, stat.size - 16)).bytesRead !== 16) throw fail("Truncated backup authentication tag.");
    return { prefix: Buffer.concat([base, body]), salt, iv, tag, start: 12 + size, end: stat.size - 17, size: stat.size,
      encryptionRequired: header.encryptionRequired !== false, policySpecified: typeof header.encryptionRequired === "boolean",nativeEncryption:header.nativeEncryption };
  } finally { await fd.close(); }
}
function decryptStream(archive, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, archive.iv);
  decipher.setAAD(archive.prefix); decipher.setAuthTag(archive.tag);
  return decipher;
}
class Reader {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.buffer = Buffer.alloc(0); this.ended = false; }
  async next() {
    const next = await this.iterator.next(); this.ended = next.done;
    this.buffer = next.done ? Buffer.alloc(0) : next.value;
  }
  async read(size) {
    const output = Buffer.alloc(size); let written = 0;
    while (written < size) {
      if (!this.buffer.length) { if (this.ended) throw fail("Truncated backup contents."); await this.next(); if (this.ended) continue; }
      const length = Math.min(size - written, this.buffer.length);
      this.buffer.copy(output, written, 0, length); written += length; this.buffer = this.buffer.subarray(length);
    }
    return output;
  }
}
function validateManifest(manifest, maxBytes) {
  if (!manifest || manifest.version !== 1 || manifest.engineVersion !== ENGINE_VERSION || typeof manifest.databaseName !== "string" || !validAuth(manifest.auth) ||
    !Array.isArray(manifest.files) || manifest.files.length > MAX_FILES || !manifest.files.length ||
    !Number.isSafeInteger(manifest.total) || manifest.total < 0 || manifest.total > maxBytes) throw fail("Invalid or oversized backup manifest.");
  if (manifest.encryptionRequired !== undefined && typeof manifest.encryptionRequired !== "boolean") throw fail("Invalid manifest encryption policy.");
  if(manifest.nativeEncryption!==undefined&&(!validNative(manifest.nativeEncryption)||!validDataKey(manifest.auth)||manifest.auth.dataKeyId!==manifest.nativeEncryption.keyId))throw fail("Invalid native data key in backup manifest.");
  normalizeOptions({ name: manifest.databaseName });
  const seen = new Set(); let total = 0;
  for (const entry of manifest.files) {
    if (!entry || !safePath(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw fail("Invalid backup file entry.");
    const lower = entry.path.toLowerCase();
    if (seen.has(lower)) throw fail("Duplicate backup file entry."); seen.add(lower);
    total += entry.size; if (!Number.isSafeInteger(total) || total > maxBytes) throw fail("Backup exceeds the restore size limit.");
  }
  if (total !== manifest.total || !seen.has("data/wiredtiger")) throw fail("Incomplete backup file manifest.");
}
async function restore(input) {
  const options = optionsFor(input, true);
  requireProtector(options);
  if (fs.existsSync(options.directory)) throw fail("Restore requires a new, nonexistent Database directory. Existing data was not overwritten.", "BSONLITE_RESTORE_EXISTS");
  if (!fs.lstatSync(options.file).isFile() || fs.lstatSync(options.file).isSymbolicLink()) throw fail("Backup must be a regular file, not a symbolic link.");
  const archive = await readArchive(options.file);
  const key = await deriveKey(options.password, archive.salt);
  let lock, created = false, locations, committed = false;
  try {
    // Authenticate the complete ciphertext BEFORE creating any destination or plaintext files.
    try {
      await pipeline(fs.createReadStream(options.file, { start: archive.start, end: archive.end }), decryptStream(archive, key),
        new Writable({ write(_bytes, _encoding, callback) { callback(); } }));
    } catch (_) { throw fail("Backup authentication failed: wrong password or changed/truncated backup. No destination was created.", "BSONLITE_BACKUP_AUTH_FAILED"); }
    if (archive.encryptionRequired && archive.policySpecified && options.storageEncryption === "none") {
      throw fail("This backup requires verified live encryption. Its stored policy was preserved.", "BSONLITE_SECURITY_DOWNGRADE");
    }
    if(archive.nativeEncryption&&options.storageEncryption==="none")throw fail("A native encrypted backup cannot be downgraded.","BSONLITE_SECURITY_DOWNGRADE");
    if(!archive.nativeEncryption&&nativePolicy(options.storageEncryption))throw fail("This physical backup contains the earlier storage format. Restore it with the earlier policy, then use BsonLite.migrate() into a new native database.","BSONLITE_NATIVE_MIGRATION_REQUIRED");
    if(archive.nativeEncryption?.coverage==="wiredtiger-prototype"&&options.storageEncryption!=="native-prototype")throw fail("This is a limited Linux prototype backup. Explicit native-prototype mode is required.","BSONLITE_NATIVE_PROTOTYPE");
    const policy = archive.nativeEncryption?(archive.nativeEncryption.coverage==="full"?"native":"native-prototype"):
      (archive.encryptionRequired && options.storageEncryption === "auto" ? "required" : options.storageEncryption);
    await fsp.mkdir(path.dirname(options.directory), { recursive: true, mode: 0o700 });
    await fsp.mkdir(options.directory, { mode: 0o700 }); created = true;
    lock = acquireLock(options.directory);
    await protectDirectory(options.directory);
    let encryption = archive.nativeEncryption?Object.freeze({policy,required:true,verified:false,method:"wiredtiger-native",algorithm:archive.nativeEncryption.cipher,reason:"restored-files-require-engine-verification-on-open"}):await verifyStorage(options.directory, policy);
    const source = fs.createReadStream(options.file, { start: archive.start, end: archive.end });
    const decipher = decryptStream(archive, key), unpacked = zlib.createGunzip();
    // pipeline propagates source/decipher/decompressor errors to the parser.
    const flowing = pipeline(source, decipher, unpacked);
    flowing.catch(() => {});
    try {
      const reader = new Reader(unpacked);
      const size = (await reader.read(4)).readUInt32BE();
      if (size < 2 || size > MAX_MANIFEST) throw fail("Invalid backup manifest length.");
      const bytes = await reader.read(size); let manifest;
      try { manifest = JSON.parse(bytes.toString("utf8")); } catch (_) { throw fail("The decrypted backup manifest is invalid."); } finally { bytes.fill(0); }
      validateManifest(manifest, options.maxBytes);
      if (archive.policySpecified && manifest.encryptionRequired !== archive.encryptionRequired) throw fail("The archive and manifest encryption policies do not match.");
      if(JSON.stringify(manifest.nativeEncryption)!==JSON.stringify(archive.nativeEncryption))throw fail("The archive and manifest native encryption settings do not match.");
      for (const entry of manifest.files) {
        const target = path.join(options.directory, ...entry.path.split("/"));
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const fd = await fsp.open(target, "wx", 0o600); const hash = crypto.createHash("sha256");
        try {
          let remaining = entry.size;
          while (remaining) {
            const chunk = await reader.read(Math.min(65536, remaining)); hash.update(chunk); await fd.writeFile(chunk); remaining -= chunk.length;
          }
          if (hash.digest("hex") !== entry.sha256) throw fail("A restored file failed its checksum.");
          await fd.sync();
        } finally { await fd.close(); }
      }
      if (reader.buffer.length) throw fail("Unexpected trailing archive contents.");
      await reader.next(); if (!reader.ended) throw fail("Unexpected trailing archive contents.");
      await flowing;
      // Recheck the actual restored files before saving credentials or publishing metadata.
      if (!archive.nativeEncryption&&(encryption.verified || encryption.required)) {
        encryption = await verifyStorage(options.directory, policy);
        if (!encryption.verified) throw fail("Restored-file encryption could not be reverified.", "BSONLITE_STORAGE_ENCRYPTION");
      }
      const storeId = crypto.randomBytes(16).toString("hex"); locations = storePaths(storeId);
      await prepareManagedRoot();
      await protectDirectory(locations.root, ["sessions"]);
      await saveVault(locations.vault, storeId, manifest.auth, options);
      atomicWrite(path.join(options.directory, "bsonlite.json"), JSON.stringify({...metadataFor(storeId, manifest.databaseName, policy === "required"),...(manifest.nativeEncryption?{nativeEncryption:manifest.nativeEncryption}:{})}, null, 2));
      lock.release(); lock = null; committed = true;
      return Object.freeze({ directory: options.directory, databaseName: manifest.databaseName, files: manifest.files.length, storageEncryption: encryption });
    } catch (error) { unpacked.destroy(error); await flowing.catch(() => {}); throw error; }
  } finally {
    key.fill(0);
    if (lock) lock.release();
    if (!committed && created) fs.rmSync(options.directory, { recursive: true, force: true });
    if (!committed && locations) fs.rmSync(locations.root, { recursive: true, force: true });
  }
}
module.exports = { backup, restore, safePath, validateManifest };
