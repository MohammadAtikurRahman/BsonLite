"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const consoleRepo = process.env.BSONLITE_CONSOLE_REPO;
const live = consoleRepo ? {} : { skip: "Set BSONLITE_CONSOLE_REPO to the pinned Console source with dependencies installed." };

test("existing Console and CLI round-trip BSON 6/7 across the modern SDK bridge", live, async t => {
  const modern = require("../dist-modern/BsonLite.cjs"), { BSON, ObjectId } = modern;
  const { Connection } = require(path.join(consoleRepo, "src/connection.cjs"));
  const { fromJSON } = require(path.join(consoleRepo, "src/query.cjs"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bsl-modern-console-"));
  const previous = process.env.BSONLITE_CONSOLE_HOME;
  process.env.BSONLITE_CONSOLE_HOME = directory;
  const records = []; let closed = false;
  const clone = doc => BSON.deserialize(BSON.serialize(doc), { promoteValues: false, promoteLongs: false, bsonRegExp: true });
  const database = {
    name: "modern", info: { engineVersion: "9.0.4", bsonliteVersion: modern.version },
    get closed() { return closed; }, async close() { closed = true; },
    collection() { return {
      async insertOne(doc) {
        // Serialization by the actual BSON 7 library rejects foreign-major
        // BSON objects if the bridge failed to translate its EJSON boundary.
        doc = clone(doc); if (!doc._id) doc._id = new ObjectId(); records.push(doc);
        return { acknowledged: true, insertedId: doc._id };
      },
      async findOne(filter) { BSON.serialize(filter); return records.length ? clone(records[0]) : null; },
      async countDocuments() { return records.length; }
    }; },
    listCollections() { return { toArray: async () => [{ name: "records", type: "collection" }] }; }
  };
  const core = { BSON, ObjectId, engineVersion: "9.0.4", version: modern.version, BsonLiteError: modern.BsonLiteError,
    connect: async () => database, open: async () => database, stop: () => database.close(), status: () => ({ connected: !closed }) };
  const sdk = require("../src/console-addon.cjs")(core), viewer = new Connection();
  t.after(async () => {
    await viewer.disconnect(); await sdk.stop();
    if (previous === undefined) delete process.env.BSONLITE_CONSOLE_HOME; else process.env.BSONLITE_CONSOLE_HOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const db = await sdk.connect(); assert.match(db.connectionURL, /^bsonlite:\/\/127\.0\.0\.1:/);
  const child = spawn(process.execPath, [path.join(consoleRepo, "bin/bsonlite.cjs"), "--write", "--eval",
    'db.records.insertOne({_id:ObjectId("000000000000000000000001"),n:NumberLong("9007199254740993"),amount:NumberDecimal("123.450"),data:BinData(0,"AP8q")})'],
    { env: { ...process.env, BSONLITE_URI: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  child.stdout.on("data", b => output += b); child.stderr.on("data", b => error += b);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, error); assert.equal(fromJSON(output).acknowledged, true);
  assert(records[0].n instanceof BSON.Long); assert(records[0]._id instanceof ObjectId);
  assert.equal(records[0].n.toString(), "9007199254740993");
  await viewer.connect({ uri: db.connectionURL });
  const result = await viewer.run('db.records.findOne({_id:ObjectId("000000000000000000000001")})');
  assert.equal(result.value.n.toString(), "9007199254740993");
  assert.equal(result.value.amount.toString(), "123.450");
  assert.equal(Buffer.from(result.value.data.buffer).toString("hex"), "00ff2a");
  await assert.rejects(viewer.run('db.records.insertOne({blocked:true})'), /read.only|write/i);
});
