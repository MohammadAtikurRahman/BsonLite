"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const oldBson = require("mongodb").BSON, modernBson = require("mongodb-modern").BSON;
const { createUpgrader } = require("../src/upgrade.cjs");

function memoryDatabase(bson, initial = {}, options = {}) {
  const collections = new Map(Object.entries(initial));
  const specs = new Map(); let closed = false;
  const clone = value => bson.deserialize(bson.serialize(value), { promoteValues: false, promoteLongs: false, bsonRegExp: true });
  function cursor(documents) {
    let values = documents.map(clone);
    return { sort() { values.sort((a, b) => String(a._id).localeCompare(String(b._id))); return this; }, batchSize() { return this; },
      async close() {}, async *[Symbol.asyncIterator]() { yield* values; } };
  }
  return {
    info: { security: { storageEncryption: { verified: true, coverage: "full" } } },
    collections, specs, get closed() { return closed; }, async close() { closed = true; },
    listCollections() { return { toArray: async () => [...collections.keys()].map(name => ({ name, type: "collection", options: options.collectionOptions || {} })) }; },
    async createCollection(name, settings) { collections.set(name, []); specs.set(name, { settings }); },
    collection(name) {
      return {
        find() { return cursor(collections.get(name)); },
        async insertMany(documents) {
          for (const document of documents) {
            const value = clone(document);
            if (options.corrupt) value.changed = true;
            collections.get(name).push(value);
          }
        },
        listIndexes() { return { toArray: async () => [{ name: "_id_", key: { _id: 1 }, v: 2 },
          { name: "code_1", key: { code: 1 }, unique: true, ns: "legacy.records", v: 2, storageEngine: { ignored: true } }] }; },
        async createIndexes(indexes) { specs.get(name).indexes = indexes; }
      };
    }
  };
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-upgrade-unit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "legacy"), directory = path.join(root, "modern");
  fs.mkdirSync(sourceDirectory);
  const metadata = { formatVersion: 3, engineVersion: "4.0.28", databaseName: "records", nativeEncryption: { coverage: "full" } };
  fs.writeFileSync(path.join(sourceDirectory, "bsonlite.json"), JSON.stringify(metadata));
  const original = [{ _id: new oldBson.ObjectId("000000000000000000000001"), code: "a",
    n: oldBson.Long.fromString("9007199254740993"), decimal: oldBson.Decimal128.fromString("123.450"),
    binary: new oldBson.Binary(Buffer.from([0, 255, 42]), 0), date: new Date("2026-10-24T00:00:00Z"),
    regex: new oldBson.BSONRegExp("^Atik", "i"), int: new oldBson.Int32(42) },
    { _id: new oldBson.ObjectId("000000000000000000000002"), code: "b" }];
  const source = memoryDatabase(oldBson, { records: original }, options);
  const destination = memoryDatabase(modernBson, {}, options);
  const sourceSDK = { engineVersion: "4.0.28", consoleVersion: "0.2.0", BSON: oldBson,
    async open(input) { assert.equal(input.console, false); return source; } };
  const upgrade = createUpgrader(async input => {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, "migration.json")));
    assert.equal(marker.state, "in-progress");
    assert.equal(marker.tokenHash, crypto.createHash("sha256").update(input.migrationToken).digest("hex"));
    assert.equal(JSON.stringify(marker).includes(input.migrationToken), false);
    return destination;
  }, { version: "9.0.4", bson: modernBson });
  return { root, sourceDirectory, directory, sourceSDK, source, destination, original, upgrade };
}

test("logical upgrade converts between BSON majors, verifies content and preserves the original", async t => {
  const f = fixture(t), before = f.original.map(doc => oldBson.serialize(doc).toString("hex"));
  const result = await f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: f.directory });
  assert.equal(result.originalPreserved, true); assert.equal(result.collections[0].documents, 2);
  assert.deepEqual(f.original.map(doc => oldBson.serialize(doc).toString("hex")), before);
  const copied = f.destination.collections.get("records")[0];
  assert(copied.n instanceof modernBson.Long); assert(copied.decimal instanceof modernBson.Decimal128);
  assert(copied._id instanceof modernBson.ObjectId); assert(copied.binary instanceof modernBson.Binary);
  assert(copied.regex instanceof modernBson.BSONRegExp);
  assert.equal(copied.n.toString(), "9007199254740993");
  assert.equal(copied.decimal.toString(), "123.450");
  assert.equal(f.destination.specs.get("records").indexes[0].unique, true);
  assert.equal(f.destination.specs.get("records").indexes[0].storageEngine, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, "migration.json"))).state, "complete");
  assert.equal(f.source.closed, true); assert.equal(f.destination.closed, true);
});

test("digest mismatch leaves a failed destination and preserves source records", async t => {
  const f = fixture(t, { corrupt: true });
  await assert.rejects(f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: f.directory }), e => e.code === "BSONLITE_UPGRADE_VERIFY");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, "migration.json"))).state, "failed");
  assert.equal(f.original[0].changed, undefined); assert.equal(f.source.closed, true); assert.equal(f.destination.closed, true);
});

test("existing destinations and overlapping source paths are refused before writes", async t => {
  const f = fixture(t);
  fs.mkdirSync(f.directory); fs.writeFileSync(path.join(f.directory, "keep"), "preserve");
  await assert.rejects(f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: f.directory }), e => e.code === "BSONLITE_UPGRADE_DESTINATION");
  assert.equal(fs.readFileSync(path.join(f.directory, "keep"), "utf8"), "preserve");
  await assert.rejects(f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: path.join(f.sourceDirectory, "nested") }), e => e.code === "BSONLITE_UPGRADE_DESTINATION");
});

test("ICU collation changes require explicit review before creating the new store", async t => {
  const f = fixture(t, { collectionOptions: { collation: { locale: "en", version: "57.1" } } });
  await assert.rejects(f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: f.directory }), e => e.code === "BSONLITE_UPGRADE_COLLATION");
  assert.equal(fs.existsSync(f.directory), false); assert.equal(f.source.closed, true);
});

test("BSON values inside validators are converted to the target BSON library", async t => {
  const f = fixture(t, { collectionOptions: { validator: { owner: { $eq: new oldBson.ObjectId("000000000000000000000003") } } } });
  await f.upgrade({ sourceSDK: f.sourceSDK, sourceDirectory: f.sourceDirectory, directory: f.directory });
  assert(f.destination.specs.get("records").settings.validator.owner.$eq instanceof modernBson.ObjectId);
});

test("the existing SDK cannot accidentally claim to perform a modern-engine upgrade", async () => {
  await assert.rejects(createUpgrader(() => {})({}), e => e.code === "BSONLITE_UPGRADE_TARGET");
});
