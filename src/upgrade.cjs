"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { BSON } = require("mongodb");
const { ENGINE_VERSION } = require("./constants.cjs");
const { normalizeOptions, atomicWrite } = require("./util.cjs");
const { indexForCreate } = require("./migrate.cjs");
const { BsonLiteError } = require("./errors.cjs");

function overlaps(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function createUpgrader(openNormalized, target = { version: ENGINE_VERSION, bson: BSON }) {
  return async function upgrade(input) {
    const fail = (code, message) => { throw new BsonLiteError(code, message); };
    if (target.version !== "9.0.4") fail("BSONLITE_UPGRADE_TARGET", "Use the modern SDK to upgrade a previous engine into a new store.");
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("BSONLITE_INVALID_OPTIONS", "upgrade() requires sourceSDK, sourceDirectory and a new directory.");
    const allowed = new Set(["sourceSDK", "sourceDirectory", "directory", "sourceOptions", "binaryPath", "nativeManifest", "vaultPassword", "allowCollationUpgrade"]);
    for (const key of Object.keys(input)) if (!allowed.has(key)) fail("BSONLITE_INVALID_OPTIONS", "Unknown upgrade option: " + key);
    const previous = input.sourceSDK;
    if (!previous || previous.engineVersion !== "4.0.28" || typeof previous.open !== "function" || !previous.BSON?.serialize)
      fail("BSONLITE_UPGRADE_SOURCE", "Supply the previous 4.0.28 SDK, with its matching engine and protected vault.");
    if (typeof input.sourceDirectory !== "string" || typeof input.directory !== "string") fail("BSONLITE_INVALID_OPTIONS", "Specify sourceDirectory and a new destination directory.");
    if (input.allowCollationUpgrade !== undefined && typeof input.allowCollationUpgrade !== "boolean") fail("BSONLITE_INVALID_OPTIONS", "allowCollationUpgrade must be a boolean.");
    const sourceOptions = input.sourceOptions || {};
    if (typeof sourceOptions !== "object" || Array.isArray(sourceOptions)) fail("BSONLITE_INVALID_OPTIONS", "sourceOptions must be an object.");
    for (const name of Object.keys(sourceOptions)) if (!["binaryPath", "nativeManifest", "vaultPassword"].includes(name)) fail("BSONLITE_INVALID_OPTIONS", "Unsupported source option: " + name);
    const sourcePath = path.resolve(input.sourceDirectory), desired = path.resolve(input.directory);
    if (fs.lstatSync(sourcePath).isSymbolicLink()) fail("BSONLITE_UNSAFE_PATH", "The source directory must not be a symbolic link.");
    const sourceDirectory = fs.realpathSync(sourcePath);
    const directory = path.join(fs.realpathSync(path.dirname(desired)), path.basename(desired));
    if (fs.existsSync(directory) || overlaps(sourceDirectory, directory) || overlaps(directory, sourceDirectory))
      fail("BSONLITE_UPGRADE_DESTINATION", "Upgrade needs a new directory outside the original store; no existing destination is overwritten.");
    const metaFile = path.join(sourceDirectory, "bsonlite.json");
    if (fs.lstatSync(metaFile).isSymbolicLink() || fs.statSync(metaFile).size > 65536) fail("BSONLITE_METADATA", "Unsafe source metadata.");
    const metadata = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (metadata.engineVersion !== "4.0.28" || metadata.formatVersion !== 3 || metadata.nativeEncryption?.coverage !== "full")
      fail("BSONLITE_UPGRADE_SOURCE", "This upgrade supports native encrypted 4.0.28 stores; use the previous SDK to migrate older formats first.");
    const destinationOptions = normalizeOptions({ name: metadata.databaseName, directory, storageEncryption: "native", silent: true,
      ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}), ...(input.nativeManifest ? { nativeManifest: input.nativeManifest } : {}),
      ...(input.vaultPassword ? { vaultPassword: input.vaultPassword } : {}) });
    const warnings = [], copied = [];
    const cleanOptions = (settings = {}) => {
      // Validators, partial indexes and view pipelines can contain BSON values
      // too. Convert their library identity while retaining ordinary numeric
      // option fields as JavaScript numbers for driver-side option validation.
      settings = target.bson.deserialize(previous.BSON.serialize(settings), { promoteLongs: false, bsonRegExp: true });
      const { storageEngine, ...result } = settings;
      if (result.collation && result.collation.locale !== "simple") {
        if (!input.allowCollationUpgrade) fail("BSONLITE_UPGRADE_COLLATION", "Non-simple collation needs review across ICU versions. Explicitly enable allowCollationUpgrade after testing your comparison/uniqueness rules.");
        const { version, ...collation } = result.collation;
        result.collation = collation;
        if (!warnings.includes("collation-icu-version-changed")) warnings.push("collation-icu-version-changed");
      }
      return result;
    };
    const digestCollection = async (collection, bson) => {
      const digest = crypto.createHash("sha256"); let count = 0;
      const cursor = collection.find({}, { promoteValues: false, promoteLongs: false, bsonRegExp: true }).sort({ _id: 1 }).batchSize(64);
      try {
        for await (const document of cursor) {
          const bytes = bson.serialize(document), size = Buffer.alloc(4);
          size.writeUInt32BE(bytes.length); digest.update(size); digest.update(bytes); count++;
        }
      } finally { await cursor.close(); }
      return { documents: count, sha256: digest.digest("hex") };
    };
    let source, destination, reserved = false, completed = false;
    const marker = path.join(directory, "migration.json"), token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const writeMarker = value => atomicWrite(marker, JSON.stringify({ version: 2, sourceEngine: "4.0.28", targetEngine: target.version, ...value }, null, 2));
    try {
      source = await previous.open({ ...sourceOptions, directory: sourceDirectory, name: metadata.databaseName,
        storageEncryption: "native", silent: true, ...(previous.consoleVersion ? { console: false } : {}) });
      const collections = await source.listCollections().toArray();
      for (const item of collections) {
        if (!["collection", "view"].includes(item.type) || item.name.startsWith("system.") && item.name !== "system.views")
          fail("BSONLITE_UPGRADE_SCOPE", "Unsupported system/special collection: " + item.name);
        cleanOptions(item.options);
        if (item.options?.autoIndexId === false) fail("BSONLITE_UPGRADE_SCOPE", "Collections without an _id index require manual migration.");
      }
      fs.mkdirSync(directory, { mode: 0o700 }); reserved = true;
      // Reserve the incomplete marker before any engine file or document can
      // exist. Only this in-memory token allows the initial destination open.
      writeMarker({ state: "in-progress", tokenHash });
      destination = await openNormalized({ ...destinationOptions, migrationToken: token });
      for (const item of collections.filter(c => c.type === "collection" && c.name !== "system.views")) {
        await destination.createCollection(item.name, cleanOptions(item.options));
        const from = source.collection(item.name), to = destination.collection(item.name);
        let batch = [], size = 0, count = 0;
        const cursor = from.find({}, { promoteValues: false, promoteLongs: false, bsonRegExp: true }).batchSize(64);
        try {
          for await (const document of cursor) {
            // Convert through BSON bytes, never JSON and never objects from a
            // different major BSON library. Int64/Decimal/Binary stay typed.
            const bytes = previous.BSON.serialize(document);
            const converted = target.bson.deserialize(bytes, { promoteValues: false, promoteLongs: false, bsonRegExp: true });
            if (batch.length && (size + bytes.length > 4 * 1024 * 1024 || batch.length >= 64)) {
              await to.insertMany(batch, { ordered: true }); count += batch.length; batch = []; size = 0;
            }
            batch.push(converted); size += bytes.length;
          }
          if (batch.length) { await to.insertMany(batch, { ordered: true }); count += batch.length; }
        } finally { await cursor.close(); }
        const indexes = (await from.listIndexes().toArray()).filter(i => i.name !== "_id_").map(indexForCreate).map(cleanOptions);
        if (indexes.length) await to.createIndexes(indexes);
        const before = await digestCollection(from, previous.BSON), after = await digestCollection(to, target.bson);
        if (before.documents !== count || after.documents !== count || before.sha256 !== after.sha256)
          fail("BSONLITE_UPGRADE_VERIFY", "BSON document digest/count mismatch; destination remains incomplete.");
        copied.push({ name: item.name, documents: count, indexes: indexes.length, sha256: after.sha256 });
      }
      for (const view of collections.filter(c => c.type === "view")) await destination.createCollection(view.name, cleanOptions(view.options));
      const security = destination.info.security.storageEncryption;
      if (security.verified !== true || security.coverage !== "full") fail("BSONLITE_UPGRADE_VERIFY", "The destination's native encryption was not verified.");
      await destination.close(); destination = null;
      writeMarker({ state: "complete", completedAt: new Date().toISOString(), collectionCount: copied.length,
        documentCount: copied.reduce((total, item) => total + item.documents, 0), warnings });
      completed = true;
      return Object.freeze({ directory, sourceDirectory, sourceEngine: "4.0.28", targetEngine: target.version,
        collections: copied, warnings, originalPreserved: true });
    } catch (error) {
      if (reserved && !completed) {
        try { writeMarker({ state: "failed", originalPreserved: true }); } catch (_) {}
      }
      throw error;
    } finally {
      try { if (destination) await destination.close(); } finally { if (source) await source.close(); }
    }
  };
}

module.exports = { createUpgrader };
