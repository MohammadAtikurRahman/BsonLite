"use strict";
const { recover } = require("../src/recovery.cjs");
try {
  if (process.argv[3] !== "--confirm-stopped") throw new Error("Close all apps using this database. Then: npm run unlock -- ./Database --confirm-stopped");
  const result = recover(process.argv[2] ? { directory: process.argv[2] } : {});
  console.log("Removed " + result.removedLocks + " stale lock(s). Data was preserved; no process was killed.");
} catch (error) { console.error(error.code || "BSONLITE_RECOVERY_REQUIRED", error.message); process.exitCode = 1; }
