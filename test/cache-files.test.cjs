"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { publishCacheFile } = require("../src/cache-files.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-cache-publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "native-engine.json");
}

test("identical published cache metadata does not need replacement", async t => {
  const file = fixture(t); fs.writeFileSync(file, "expected");
  t.mock.method(fs, "renameSync", () => { throw new Error("An identical file must not be rewritten"); });
  await publishCacheFile(file, "expected");
  assert.equal(fs.readFileSync(file, "utf8"), "expected");
});

test("a Windows rename race accepts only the other writer's identical completed file", async t => {
  const file = fixture(t);
  t.mock.method(fs, "renameSync", (temporary, destination) => {
    fs.writeFileSync(destination, fs.readFileSync(temporary));
    throw Object.assign(new Error("Another app published the destination"), { code: "EPERM" });
  });
  await publishCacheFile(file, "expected");
  assert.equal(fs.readFileSync(file, "utf8"), "expected");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["native-engine.json"]);
});

test("temporary sharing violations retry but a different blocked file is never accepted", async t => {
  const file = fixture(t), rename = fs.renameSync; let attempts = 0;
  t.mock.method(fs, "renameSync", (...args) => {
    if (++attempts < 3) throw Object.assign(new Error("Sharing violation"), { code: "EBUSY" });
    return rename(...args);
  });
  await publishCacheFile(file, "expected"); assert.equal(attempts, 3);
  fs.writeFileSync(file, "mismatch");
  t.mock.method(fs, "renameSync", () => { throw Object.assign(new Error("Still blocked"), { code: "EACCES" }); });
  await assert.rejects(publishCacheFile(file, "expected"), error => error.code === "EACCES");
  assert.equal(fs.readFileSync(file, "utf8"), "mismatch");
});
