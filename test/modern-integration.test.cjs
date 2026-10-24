"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const binaryPath = process.env.BSONLITE_MODERN_BINARY;
const nativeManifest = process.env.BSONLITE_MODERN_MANIFEST;
const modulePath = process.env.BSONLITE_MODERN_MODULE || path.resolve(__dirname, "../dist-modern/BsonLite.cjs");
const enabled = process.platform === "win32" && binaryPath && nativeManifest && fs.existsSync(binaryPath);
const live = enabled ? {} : { skip: "Requires the actual rebuilt encrypted Windows 9.0.4 engine." };
const managed = enabled ? fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-modern-private-পরীক্ষা-")) : null;
const previousHome = process.env.BSONLITE_DATA_HOME;
const previousConsoleHome = process.env.BSONLITE_CONSOLE_HOME;
if (managed) process.env.BSONLITE_DATA_HOME = managed;
if (managed) process.env.BSONLITE_CONSOLE_HOME = path.join(managed, "console");
test.after(() => {
  if (previousHome === undefined) delete process.env.BSONLITE_DATA_HOME; else process.env.BSONLITE_DATA_HOME = previousHome;
  if (previousConsoleHome === undefined) delete process.env.BSONLITE_CONSOLE_HOME; else process.env.BSONLITE_CONSOLE_HOME = previousConsoleHome;
  if (managed) fs.rmSync(managed, { recursive: true, force: true });
});

test("existing terminal CLI auto-discovers and queries the actual modern encrypted SDK", live, async () => {
  const BsonLite = require(modulePath), consoleRepo = process.env.BSONLITE_CONSOLE_REPO;
  assert(consoleRepo && fs.existsSync(consoleRepo), "The pinned Console source is required");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-modern-cli-live-"));
  try {
    const db = await BsonLite.connect({ directory: path.join(root, "Database"), name: "modernconsole", binaryPath, nativeManifest, silent: true });
    assert.match(db.connectionURL, /^bsonlite:\/\/127\.0\.0\.1:/);
    const run = require("node:util").promisify(require("node:child_process").execFile);
    const result = await run(process.execPath, [path.join(consoleRepo, "bin/bsonlite.cjs"), "--write", "--eval",
      'db.records.insertOne({n:NumberLong("9007199254740993"),text:"MODERN_CLI_TYPED_RECORD"})'],
      { env: { ...process.env, BSONLITE_URI: "" }, timeout: 30000, windowsHide: true });
    assert.equal(require(path.join(consoleRepo, "src/query.cjs")).fromJSON(result.stdout).acknowledged, true);
    assert.equal((await db.collection("records").findOne({}, { promoteLongs: false })).n.toString(), "9007199254740993");
  } finally {
    await BsonLite.disconnect(); fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("actual previous encrypted SDK upgrades to 9.0 without changing BSON types or source records", live, async () => {
  const legacyPath = process.env.BSONLITE_LEGACY_MODULE;
  assert(legacyPath && fs.existsSync(legacyPath), "The integrity-pinned previous SDK fixture is required");
  const previous = require(legacyPath), BsonLite = require(modulePath);
  assert.equal(previous.engineVersion, "4.0.28");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-real-upgrade-"));
  const sourceDirectory = path.join(root, "Old"), directory = path.join(root, "Modern");
  let source, destination;
  const id = new previous.ObjectId();
  try {
    source = await previous.open({ directory: sourceDirectory, name: "upgraded", console: false, silent: true });
    await source.createCollection("items", { validator: { n: { $type: "long" } } });
    await source.collection("items").createIndex({ code: 1 }, { unique: true });
    await source.collection("items").insertOne({ _id: id, code: "a", n: previous.BSON.Long.fromString("9007199254740993"),
      decimal: previous.BSON.Decimal128.fromString("123.450"), bytes: new previous.BSON.Binary(Buffer.from([0, 255, 42])),
      floating: new previous.BSON.Double(7), integer: new previous.BSON.Int32(7), rx: new previous.BSON.BSONRegExp("^Atik", "i") });
    await source.createCollection("item_view", { viewOn: "items", pipeline: [{ $match: { code: "a" } }] });
    await source.close(); source = null;
    const result = await BsonLite.upgrade({ sourceSDK: previous, sourceDirectory, directory, binaryPath, nativeManifest });
    assert.equal(result.originalPreserved, true); assert.equal(result.collections[0].documents, 1);
    destination = await BsonLite.open({ directory, name: "upgraded", binaryPath, nativeManifest, console: false, silent: true });
    const doc = await destination.collection("items").findOne({ _id: new BsonLite.ObjectId(id.toHexString()) }, { promoteValues: false, promoteLongs: false, bsonRegExp: true });
    assert.equal(doc.n.toString(), "9007199254740993"); assert.equal(doc.decimal.toString(), "123.450");
    assert.equal(doc.floating._bsontype, "Double"); assert.equal(doc.integer._bsontype, "Int32");
    assert.equal(doc.rx._bsontype, "BSONRegExp"); assert.equal(Buffer.from(doc.bytes.buffer).toString("hex"), "00ff2a");
    assert.equal(await destination.collection("item_view").countDocuments({}), 1);
    await assert.rejects(destination.collection("items").insertOne({ code: "a", n: BsonLite.BSON.Long.fromString("1") }), e => e.code === 11000);
    await destination.close(); destination = null;
    source = await previous.open({ directory: sourceDirectory, name: "upgraded", console: false, silent: true });
    assert.equal((await source.collection("items").findOne({ _id: id }, { promoteLongs: false })).n.toString(), "9007199254740993");
  } finally {
    if (destination) await destination.close(); if (source) await source.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
