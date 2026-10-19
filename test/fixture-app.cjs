"use strict";
const path = require("node:path");
const BsonLite = require(process.env.BSONLITE_TEST_MODULE || path.resolve(__dirname, "../src/index.cjs"));

(async function () {
  const options = { name: "crashtest", directory: process.argv[2], storageEncryption: "none", ...(process.platform === "win32" ? {} : {vaultPassword:"integration-only-vault-passphrase"}) };
  if (process.env.BSONLITE_TEST_BINARY) options.binaryPath = process.env.BSONLITE_TEST_BINARY;
  const db = await BsonLite.open(options);
  await db.collection("messages").insertOne({ value: "saved-before-parent-crash" });
  process.send({ type: "ready", info: db.info });
  setInterval(function () {}, 1000);
})().catch(function (error) {
  if (process.send) process.send({ type: "error", message: error.message });
  process.exitCode = 1;
});
