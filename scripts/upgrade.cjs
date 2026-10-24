#!/usr/bin/env node
"use strict";
const path = require("node:path");

async function main() {
  const args = process.argv.slice(2), options = {};
  const allowed = new Set(["--source-sdk", "--modern-sdk", "--source", "--directory", "--binary", "--native-manifest"]);
  if (!args.length || args.includes("--help")) {
    console.log("BsonLite cross-engine upgrade\n\nnode scripts/upgrade.cjs --source-sdk ./BsonLite-legacy.cjs --modern-sdk ./BsonLite-modern.cjs --source ./Database --directory ./Database9\n\nClose all apps using the original store first. The destination must not exist. Keep the original store, protected vault and an encrypted backup. Developer previews additionally need --binary and --native-manifest. A source preview without the matching tested engine cannot upgrade a database.");
    return;
  }
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!allowed.has(name) || options[name] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid or duplicate upgrade argument: " + name);
    options[name] = args[++i];
  }
  for (const name of ["--source-sdk", "--modern-sdk", "--source", "--directory"]) if (!options[name]) throw new Error("Missing " + name);
  const previous = require(path.resolve(options["--source-sdk"])), modern = require(path.resolve(options["--modern-sdk"]));
  if (modern.engineVersion !== "9.0.4" || typeof modern.upgrade !== "function") throw new Error("The destination module is not the modern BsonLite SDK.");
  const result = await modern.upgrade({ sourceSDK: previous, sourceDirectory: options["--source"], directory: options["--directory"],
    ...(options["--binary"] ? { binaryPath: options["--binary"] } : {}),
    ...(options["--native-manifest"] ? { nativeManifest: options["--native-manifest"] } : {}) });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.code || "BSONLITE_UPGRADE_ERROR", error.message); process.exitCode = 1; });
