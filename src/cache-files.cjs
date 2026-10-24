"use strict";
const fs = require("node:fs");
const { atomicWrite, delay, sha256 } = require("./util.cjs");
const { BsonLiteError } = require("./errors.cjs");

// Multiple apps may publish identical metadata beside the same engine. On
// Windows, replacing a file another process briefly reads can fail with EPERM.
// Accept a completed identical publication, and never accept different bytes.
async function publishCacheFile(file, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const expected = sha256(bytes);
  function matches() {
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new BsonLiteError("BSONLITE_UNSAFE_PATH", "Engine cache metadata must be a regular file.");
    return stat.size === bytes.length && sha256(fs.readFileSync(file)) === expected;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      if (matches()) return;
      atomicWrite(file, bytes);
      return;
    } catch (error) {
      if (!["EPERM", "EACCES", "EEXIST", "EBUSY"].includes(error.code)) throw error;
      // A concurrent writer may have finished after our initial read. Its
      // result is usable only after checking the complete expected contents.
      try { if (matches()) return; } catch (checkError) {
        if (!["EPERM", "EACCES", "EEXIST", "EBUSY"].includes(checkError.code)) throw checkError;
      }
      if (attempt >= 3) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}
module.exports = { publishCacheFile };
