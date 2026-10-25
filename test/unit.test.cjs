"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const BsonLite = require("../src/index.cjs");
const { normalizeOptions } = require("../src/util.cjs");
const { storagePaths } = require("../src/paths.cjs");
const { acquireLock } = require("../src/lock.cjs");
const { protectDirectory, protectWindowsDirectory } = require("../src/permissions.cjs");
const { serialize } = require("../src/errors.cjs");
const { readMetadata, metadataFor, checkLegacyLocation } = require("../src/store.cjs");
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-unit-"));

test("the default core imports inertly with engine 9.0.4 and driver 7.7.0", () => {
  for (const name of ["connect", "disconnect", "start", "open", "stop", "collection", "status", "backup", "restore", "recover"]) assert.equal(typeof BsonLite[name], "function");
  assert.equal(BsonLite.status().connected, false);
  assert.equal(BsonLite.version, require("../package.json").version);
  assert.equal(BsonLite.engineVersion, "9.0.4");
  assert.equal(BsonLite.driverVersion, "7.7.0");
  assert.equal(require("mongodb/package.json").version, "7.7.0");
  assert.equal(BsonLite.BSON, require("mongodb").BSON);
  assert.equal(new BsonLite.ObjectId().toHexString().length, 24);
});
test("invalid names and unknown security options fail before process startup", async () => {
  for (const name of ["", "admin", "local", "config", "a.b", "a b", "a/b", "a".repeat(64)]) {
    await assert.rejects(BsonLite.open({ name }), error => error.code === "BSONLITE_INVALID_NAME");
  }
  for (const options of [{ tls: false }, { encrypt: true }, { storageEncryption: "aes" }, { silent: "yes" }, { vaultPassword: "short" }]) {
    assert.throws(() => normalizeOptions(options), error => error.code === "BSONLITE_INVALID_OPTIONS");
  }
  assert.throws(() => BsonLite.collection("users"), error => error.code === "BSONLITE_NOT_STARTED");
});
test("data defaults to project/Database and native encryption is mandatory by default", () => {
  const options = normalizeOptions();
  assert.equal(options.directory, path.join(fs.realpathSync(process.cwd()), "Database"));
  assert.equal(options.storageEncryption, "native");
  assert.equal(options.name, "bsonlite");
  assert.throws(() => normalizeOptions({ startupTimeoutMS: 1 }), error => error.code === "BSONLITE_INVALID_OPTIONS");
});
test("Windows data remains in project; engine/vault locations use LocalAppData", () => {
  const context = { platform: "win32", home: "C:\\Users\\Atik", env: { LOCALAPPDATA: "C:\\Users\\Atik\\AppData\\Local" }, project: "F:\\Complete Project\\BsonLite" };
  const first = storagePaths(context);
  assert.equal(first.directory, "F:\\Complete Project\\BsonLite\\Database");
  assert.equal(first.managedRoot, "C:\\Users\\Atik\\AppData\\Local\\BsonLite");
  assert.ok(first.legacyDirectory.startsWith(first.managedRoot + "\\projects\\"));
  assert.equal(storagePaths({ ...context, project: context.project.toLowerCase() }).legacyDirectory, first.legacyDirectory);
});
test("macOS/Linux use OS app data for engine/vault and ignore relative XDG paths", () => {
  const base = { home: "/users/atik", env: {}, project: "/projects/app" };
  assert.equal(storagePaths({ ...base, platform: "darwin" }).managedRoot, "/users/atik/Library/Application Support/BsonLite");
  assert.equal(storagePaths({ ...base, platform: "linux", env: { XDG_DATA_HOME: "/private/data" } }).managedRoot, "/private/data/bsonlite");
  assert.equal(storagePaths({ ...base, platform: "linux", env: { XDG_DATA_HOME: "relative" } }).managedRoot, "/users/atik/.local/share/bsonlite");
});
test("Windows ACL helper uses fixed code and verified success", async () => {
  const directory = "F:\\Complete Project\\BsonLite\\Database";
  await protectWindowsDirectory(directory, async (executable, args, settings) => {
    assert.equal(settings.env.BSONLITE_PRIVATE_DIRECTORY, directory);
    assert.ok(!settings.shell);
    assert.ok(!args.includes("-ExecutionPolicy"));
    assert.ok(!Buffer.from(args.at(-1), "base64").toString("utf16le").includes(directory));
    return { stdout: "BSONLITE_ACL_OK\r\n" };
  });
  await assert.rejects(protectWindowsDirectory(directory, async () => ({ stdout: "" })), error => error.code === "BSONLITE_PERMISSIONS");
});
test("Windows native ACL errors remain useful without dumping command code", async () => {
  const detail = { operation: "write-access-rules", target: "F:\\Database", reason: "Access is denied." };
  await assert.rejects(protectWindowsDirectory(detail.target, async () => {
    throw Object.assign(new Error("SECRET_ENCODED_COMMAND"), { stdout: "BSONLITE_ACL_ERROR:" + Buffer.from(JSON.stringify(detail)).toString("base64") });
  }), error => {
    assert.equal(serialize(error).code, "BSONLITE_PERMISSIONS");
    assert.match(error.message, /Access is denied/);
    assert.match(error.message, /write-access-rules/);
    assert.ok(!error.message.includes("SECRET_ENCODED_COMMAND")); return true;
  });
});
test("protected storage restricts preexisting descendants", async () => {
  const directory = temp();
  try {
    fs.mkdirSync(path.join(directory, "data"));
    const file = path.join(directory, "data", "record"); fs.writeFileSync(file, "original data", { mode: 0o644 });
    await protectDirectory(directory);
    assert.equal(fs.readFileSync(file, "utf8"), "original data");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("startup diagnostics preserve the reason while redacting secrets and bounding terminal output", () => {
  const { startupDiagnostic } = require("../src/supervisor.cjs");
  const auth = { password: "PRIVATE_PASSWORD_SENTINEL", dataKey: "f".repeat(64) };
  const result = startupDiagnostic(new Error("TLS certificate failure " + auth.password + " " + auth.dataKey + "\n\x1b[31m" + "x".repeat(2048)), auth);
  assert.match(result, /TLS certificate failure/);
  assert.equal(result.includes(auth.password), false); assert.equal(result.includes(auth.dataKey), false);
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(result), false); assert.ok(result.length <= 512);
});
test("directory locks reject concurrent access and release only their token", () => {
  const directory = temp();
  try {
    const lock = acquireLock(directory);
    assert.throws(() => acquireLock(directory), error => error.code === "BSONLITE_DATABASE_IN_USE");
    const file = path.join(directory, "instance.lock", "owner.json");
    const owner = JSON.parse(fs.readFileSync(file)); fs.writeFileSync(file, JSON.stringify({ ...owner, token: "changed" }));
    lock.release(); assert.equal(fs.existsSync(file), true);
    fs.writeFileSync(file, JSON.stringify(owner)); lock.release(); assert.equal(fs.existsSync(file), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("recovery refuses a living owner and removes a proven stale lock without touching records", () => {
  const directory = temp();
  try {
    fs.mkdirSync(path.join(directory, "data")); fs.writeFileSync(path.join(directory, "data", "records"), "preserved");
    const lock = acquireLock(directory);
    assert.throws(() => BsonLite.recover({ directory }), error => error.code === "BSONLITE_DATABASE_IN_USE");
    const deadPid = spawnSync(process.execPath, ["-e", "" ]).pid;
    const file = path.join(directory, "instance.lock", "owner.json");
    const owner = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...owner, supervisorPid: deadPid, createdAt: new Date(Date.now()-120000).toISOString() }));
    assert.equal(BsonLite.recover({ directory }).removedLocks, 1);
    assert.equal(fs.readFileSync(path.join(directory, "data", "records"), "utf8"), "preserved");
    lock.release();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("native-store recovery checks both locks before preserving records and the protected vault", () => {
  const root = temp(), directory = path.join(root, "Database");
  const previous = process.env.BSONLITE_DATA_HOME;
  process.env.BSONLITE_DATA_HOME = path.join(root, "private");
  try {
    fs.mkdirSync(path.join(directory, "data"), { recursive: true });
    const record = path.join(directory, "data", "records"); fs.writeFileSync(record, "preserved");
    const metadata = { ...metadataFor("d".repeat(32), "nativeapp", false),
      nativeEncryption: { version: 1, cipher: "xchacha20-poly1305", keyId: "e".repeat(32), coverage: "full" } };
    fs.writeFileSync(path.join(directory, "bsonlite.json"), JSON.stringify(metadata));
    const locations = require("../src/paths.cjs").storePaths(metadata.storeId);
    const projectLock = acquireLock(directory), managedLock = acquireLock(locations.root);
    fs.writeFileSync(locations.vault, "protected vault fixture");
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    function makeStale(lockDirectory) {
      const file = path.join(lockDirectory, "instance.lock", "owner.json");
      const owner = JSON.parse(fs.readFileSync(file));
      fs.writeFileSync(file, JSON.stringify({ ...owner, supervisorPid: deadPid,
        createdAt: new Date(Date.now() - 120000).toISOString() }));
    }
    makeStale(directory);
    assert.throws(() => BsonLite.recover({ directory }), error => error.code === "BSONLITE_DATABASE_IN_USE");
    assert.equal(fs.existsSync(path.join(directory, "instance.lock", "owner.json")), true);
    makeStale(locations.root);
    assert.equal(BsonLite.recover({ directory }).removedLocks, 2);
    assert.equal(fs.readFileSync(record, "utf8"), "preserved");
    assert.equal(fs.readFileSync(locations.vault, "utf8"), "protected vault fixture");
    assert.deepEqual(readMetadata(directory), metadata);
    projectLock.release(); managedLock.release();
  } finally {
    if (previous === undefined) delete process.env.BSONLITE_DATA_HOME;
    else process.env.BSONLITE_DATA_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("missing metadata is distinct from incompatible or damaged metadata", () => {
  const directory = temp();
  try {
    assert.equal(readMetadata(directory), null);
    const file = path.join(directory, "bsonlite.json");
    fs.writeFileSync(file, "{"); assert.throws(() => readMetadata(directory), error => error.code === "BSONLITE_METADATA");
    fs.writeFileSync(file, JSON.stringify({ formatVersion: 2, engineVersion: "8.0.0" }));
    assert.throws(() => readMetadata(directory), error => error.code === "BSONLITE_DATA_VERSION");
    fs.writeFileSync(file, JSON.stringify(metadataFor("a".repeat(32), "myapp")));
    assert.equal(readMetadata(directory).databaseName, "myapp");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("an old AppData store is detected without creating a replacement empty Database", () => {
  const root=temp(),project=path.join(root,"project"),managed=path.join(root,"managed");fs.mkdirSync(project);
  try {
    const script="const fs=require('node:fs'),path=require('node:path');const {storagePaths}=require("+JSON.stringify(path.resolve(__dirname,"../src/paths.cjs"))+");const {normalizeOptions}=require("+JSON.stringify(path.resolve(__dirname,"../src/util.cjs"))+");const {checkLegacyLocation}=require("+JSON.stringify(path.resolve(__dirname,"../src/store.cjs"))+");const locations=storagePaths();fs.mkdirSync(locations.legacyDirectory,{recursive:true});fs.writeFileSync(path.join(locations.legacyDirectory,'bsonlite.json'),'{}');try{checkLegacyLocation(normalizeOptions());throw Error('Legacy store ignored');}catch(e){if(e.code!=='BSONLITE_LEGACY_LOCATION')throw e;console.log('LEGACY_DETECTED');}";
    const result=spawnSync(process.execPath,["-e",script],{cwd:project,env:{...process.env,BSONLITE_DATA_HOME:managed},encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/LEGACY_DETECTED/);assert.equal(fs.existsSync(path.join(project,"Database")),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("a store requiring encryption refuses an explicit plaintext downgrade", async () => {
  const directory=temp();
  try {
    fs.writeFileSync(path.join(directory,"bsonlite.json"),JSON.stringify(metadataFor("a".repeat(32),"myapp",true)));
    await assert.rejects(BsonLite.open({name:"myapp",directory,storageEncryption:"none"}),error=>error.code==="BSONLITE_SECURITY_DOWNGRADE");
    assert.equal(readMetadata(directory).encryptionRequired,true);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test("connection defaults infer an existing store name instead of opening an apparently empty database", () => {
  const directory=temp();
  try {
    assert.equal(normalizeOptions({directory}).name,"bsonlite");
    fs.writeFileSync(path.join(directory,"bsonlite.json"),JSON.stringify(metadataFor("a".repeat(32),"myapp",false)));
    assert.equal(normalizeOptions({directory}).name,"myapp");
    assert.equal(normalizeOptions({directory,name:"explicit"}).name,"explicit");
    fs.writeFileSync(path.join(directory,"bsonlite.json"),"{");
    assert.throws(()=>normalizeOptions({directory}),error=>error.code==="BSONLITE_METADATA");
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test("automatic mode uses native encryption and refuses a non-native store", () => {
  const directory=temp(),{storagePolicy}=require("../src/store.cjs");
  try {
    const options=normalizeOptions({directory,storageEncryption:"auto"});assert.equal(storagePolicy(options),"native");
    fs.writeFileSync(path.join(directory,"bsonlite.json"),JSON.stringify(metadataFor("a".repeat(32),"myapp",true)));
    assert.throws(()=>storagePolicy(options),error=>error.code==="BSONLITE_NATIVE_MIGRATION_REQUIRED");
    assert.throws(()=>normalizeOptions({...options,storageEncryption:"none"}),error=>error.code==="BSONLITE_SECURITY_DOWNGRADE");
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test("the default 9.0 core refuses old 4.0 files without changing data or metadata", async () => {
  const directory=temp();
  try {
    const file=path.join(directory,"bsonlite.json");
    const original=JSON.stringify({...metadataFor("a".repeat(32),"oldapp"),engineVersion:"4.0.28"});
    fs.writeFileSync(file,original);fs.mkdirSync(path.join(directory,"data"));
    fs.writeFileSync(path.join(directory,"data","preserved"),"old-records");
    await assert.rejects(BsonLite.open({directory}),error=>error.code==="BSONLITE_DATA_VERSION");
    assert.equal(fs.readFileSync(file,"utf8"),original);
    assert.equal(fs.readFileSync(path.join(directory,"data","preserved"),"utf8"),"old-records");
    assert.equal(fs.existsSync(path.join(directory,"instance.lock")),false);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
