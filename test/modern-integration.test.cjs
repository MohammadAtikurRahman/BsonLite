"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const binaryPath = process.env.BSONLITE_MODERN_BINARY;
const nativeManifest = process.env.BSONLITE_MODERN_MANIFEST;
const modulePath = process.env.BSONLITE_MODERN_MODULE || path.resolve(__dirname, "../dist-modern/BsonLite.cjs");
const enabled = process.platform === "win32" && binaryPath && nativeManifest && fs.existsSync(binaryPath);
const live = enabled ? {} : { skip: "Requires the actual rebuilt encrypted Windows 9.0.4 engine." };

test("modern encrypted engine preserves BSON, indexes, aggregation and records across restart", live, async () => {
  const BsonLite = require(modulePath);
  assert.equal(BsonLite.engineVersion, "9.0.4");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-modern-live-"));
  const options = { directory: path.join(root, "Database"), name: "modern", binaryPath, nativeManifest, silent: true };
  let db;
  try {
    db = await BsonLite.open(options);
    assert.equal(db.info.security.storageEncryption.verified, true);
    assert.equal(db.info.security.mutualTLS, true);
    const rows = db.collection("records"), id = new BsonLite.ObjectId();
    await rows.insertMany([{ _id: id, message: "BSL_MODERN_PRIVATE_SENTINEL_4096", value: BsonLite.BSON.Long.fromString("9007199254740993"), order: 1 },
      { order: 2, message: "second" }]);
    await rows.createIndex({ order: 1 }, { unique: true });
    const item = await rows.findOne({ _id: id }, { promoteLongs: false });
    assert.equal(item.value.toString(), "9007199254740993");
    const window = await rows.aggregate([{ $setWindowFields: { sortBy: { order: 1 }, output: { position: { $documentNumber: {} } } } }]).toArray();
    assert.deepEqual(window.map(x => x.position), [1, 2]);
    await db.close(); db = null;
    const files = fs.readdirSync(path.join(options.directory, "data")).filter(n => n.endsWith(".wt"));
    let observed = false;
    for (const file of files) {
      const data = fs.readFileSync(path.join(options.directory, "data", file));
      assert(!data.includes(Buffer.from("BSL_MODERN_PRIVATE_SENTINEL_4096")));
      if (data.includes(Buffer.from("BSLAE001"))) observed = true;
    }
    assert(observed, "Actual encrypted WiredTiger blocks must exist");
    db = await BsonLite.open(options);
    assert.equal(await db.collection("records").countDocuments({}), 2);
    assert.equal((await db.collection("records").findOne({ _id: id })).message, "BSL_MODERN_PRIVATE_SENTINEL_4096");
    await assert.rejects(db.collection("records").insertOne({ order: 1 }), e => e.code === 11000);
  } finally {
    if (db) await db.close();
    // Test records only. Keep a failed live store for diagnosis on CI failure.
    if (!db || db.closed) fs.rmSync(root, { recursive: true, force: true });
  }
});
