"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { inspect } = require("node:util");
const { fork, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { MongoClient } = require("mongodb");
const modulePath = process.env.BSONLITE_TEST_MODULE || path.resolve(__dirname, "../src/index.cjs");
const BsonLite = require(modulePath);
const binary = process.env.BSONLITE_TEST_BINARY;
const enabled = Boolean(binary || process.env.BSONLITE_TEST_MODULE);
const live = enabled ? {} : { skip: "Set BSONLITE_TEST_BINARY to a real mongod 4.0.28, or BSONLITE_TEST_MODULE to a built artifact." };

function options(directory, name) {
  const result = { directory: directory, name: name || "integration", startupTimeoutMS: 30000, storageEncryption: "none", ...(process.platform === "win32" ? {} : {vaultPassword: "integration-only-vault-passphrase"}) };
  if (binary) result.binaryPath = binary;
  return result;
}
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "bsonlite-live-")); }
async function eventually(check, timeout) {
  const deadline = Date.now() + (timeout || 25000);
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(function (resolve) { setTimeout(resolve, 150); });
  }
  assert.fail("Condition did not become true before timeout.");
}

test("real CRUD, BSON values, indexes, close and persistence after reopen", live, async function () {
  const directory = temp();
  let db;
  try {
    db = await BsonLite.open(options(directory));
    assert.equal(db.info.engineVersion, "4.0.28");
    const users = db.collection("users");
    assert.equal(users.writeConcern.w, 1);
    assert.equal(users.writeConcern.j, true);
    await users.createIndex({ email: 1 }, { unique: true });
    const inserted = await users.insertOne({ email: "one@example.com", count: 1, createdAt: new Date("2026-01-01") });
    assert.ok(inserted.insertedId instanceof BsonLite.ObjectId);
    await users.updateOne({ _id: inserted.insertedId }, { $inc: { count: 1 } });
    await users.insertOne({ email: "delete@example.com" });
    await users.deleteOne({ email: "delete@example.com" });
    assert.equal(await users.countDocuments(), 1);
    await assert.rejects(users.insertOne({ email: "one@example.com" }), function (error) { return error.code === 11000; });
    await db.close();
    await db.close();
    assert.throws(function () { db.collection("users"); }, function (error) { return error.code === "BSONLITE_CLOSED"; });
    db = await BsonLite.open(options(directory));
    const saved = await db.collection("users").findOne({ _id: inserted.insertedId });
    assert.equal(saved.count, 2);
    assert.ok(saved.createdAt instanceof Date);
    assert.equal((await db.ping()).ok, 1);
  } finally {
    if (db) await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("same directory cannot be opened twice, and the first instance stays healthy", live, async function () {
  const directory = temp();
  const first = await BsonLite.open(options(directory));
  try {
    await assert.rejects(BsonLite.open(options(directory)), function (error) {
      return error.code === "BSONLITE_DATABASE_IN_USE";
    });
    assert.equal((await first.ping()).ok, 1);
  } finally { await first.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test("different Database directories run in parallel without sharing a port or data", live, async function () {
  const root = temp();
  let a, b;
  try {
    a = await BsonLite.open(options(path.join(root, "a")));
    b = await BsonLite.open(options(path.join(root, "b")));
    assert.notEqual(a.info.port, b.info.port);
    await a.collection("items").insertOne({ source: "a" });
    assert.equal(await b.collection("items").countDocuments(), 0);
  } finally {
    if (a) await a.close();
    if (b) await b.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("MongoDB rejects plaintext and missing-certificate local clients", live, async function () {
  const directory = temp(); const db = await BsonLite.open(options(directory));
  const real = db.collection("users").client.options;
  try {
    for (const settings of [{}, {tls:true,tlsCAFile:real.tlsCAFile}]) {
      const client = new MongoClient("mongodb://127.0.0.1:"+db.info.port, {directConnection:true,serverSelectionTimeoutMS:1200,connectTimeoutMS:750,...settings});
      try { await assert.rejects(client.connect()); } finally { await client.close(); }
    }
    const noAuth = new MongoClient("mongodb://127.0.0.1:"+db.info.port, {directConnection:true,serverSelectionTimeoutMS:2000,tls:true,tlsCAFile:real.tlsCAFile,tlsCertificateKeyFile:real.tlsCertificateKeyFile});
    try {
      await noAuth.connect();
      await assert.rejects(noAuth.db("integration").collection("users").findOne({}), error=>error.code===13);
    } finally {await noAuth.close();}
    assert.equal((await db.ping()).ok,1);
    assert.equal(db.info.security.mutualTLS,true);
    assert.equal(db.info.security.storageEncryption.verified,false);
  } finally {await db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test("shared start is concurrent-safe, logs only status, reuses the connection and stops explicitly", live, async function () {
  const directory = temp();
  const output = [];
  const original = console.info;
  console.info = message => output.push(message);
  try {
    const starting = BsonLite.start(options(directory));
    const again = BsonLite.start();
    assert.equal(starting, again);
    assert.equal(BsonLite.status().state, "starting");
    const db = await starting;
    assert.equal(await again, db);
    assert.equal(await BsonLite.start("integration"), db);
    assert.equal(BsonLite.status().state, "running");
    assert.equal(BsonLite.status().port, db.info.port);
    await BsonLite.collection("users").insertOne({ privateValue: "never-print-this-document" });
    assert.equal((await BsonLite.ping()).ok, 1);
    assert.equal(output.length, 1);
    assert.match(output[0], /^\[BsonLite\] Connected \| integration \| 127\.0\.0\.1:\d+ \| TLS \| Live files: encryption NOT verified$/);
    assert.ok(!output.join("").includes("never-print-this-document"));
    await assert.rejects(BsonLite.start("different"), error => error.code === "BSONLITE_CONFIG_CONFLICT");
    assert.equal((await db.ping()).ok, 1);
    await BsonLite.stop();
    await BsonLite.stop();
    assert.equal(BsonLite.status().connected, false);
    assert.throws(() => BsonLite.collection("users"), error => error.code === "BSONLITE_NOT_STARTED");
    await BsonLite.start(Object.assign(options(directory), { silent: true }));
    assert.equal(output.length, 1);
    assert.equal(await BsonLite.collection("users").countDocuments(), 1);
  } finally {
    console.info = original;
    await BsonLite.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("application credentials have no admin rights, stay out of public output and rotate on restart", live, async function () {
  const directory = temp();
  let db, stale;
  try {
    db = await BsonLite.open(options(directory));
    const application = db.collection("users").client;
    const credentials = application.options.credentials;
    const oldAuth = { username: credentials.username, password: credentials.password };
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "bsonlite.json"), "utf8"));
    const vaultFile = require("../src/paths.cjs").storePaths(metadata.storeId).vault;
    const { auth: root } = await require("../src/vault.cjs").loadVault(vaultFile, metadata.storeId, options(directory));
    assert.ok(!fs.readFileSync(vaultFile, "utf8").includes(root.password));
    assert.equal(fs.existsSync(path.join(directory, "runtime", "auth.json")), false);
    assert.notEqual(credentials.username, root.username);
    assert.notEqual(credentials.password, root.password);
    for (const publicOutput of [inspect(db), JSON.stringify(db), JSON.stringify(db.info)]) {
      assert.ok(!publicOutput.includes(root.password));
      assert.ok(!publicOutput.includes(oldAuth.password));
    }
    await assert.rejects(application.db("unrelated").collection("users").insertOne({ value: 1 }),
      error => error.code === 13);
    await assert.rejects(application.db("admin").command({ usersInfo: 1 }), error => error.code === 13);
    await assert.rejects(application.db("admin").command({ createUser: "forbidden", pwd: "unused", roles: [] }),
      error => error.code === 13);
    await db.close();
    db = await BsonLite.open(options(directory));
    assert.notEqual(db.collection("users").client.options.credentials.password, oldAuth.password);
    stale = new MongoClient("mongodb://127.0.0.1:" + db.info.port, {
      authSource: "admin", auth: oldAuth, authMechanism: "SCRAM-SHA-256",
      directConnection: true, serverSelectionTimeoutMS: 2000, tls: true,
      tlsCAFile: db.collection("users").client.options.tlsCAFile,
      tlsCertificateKeyFile: db.collection("users").client.options.tlsCertificateKeyFile
    });
    await assert.rejects(stale.connect(), error => error.code === 18);
    assert.equal((await db.ping()).ok, 1);
  } finally {
    if (stale) await stale.close();
    if (db) await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("killing the parent app cleans up the engine and allows safe persistence on reopen", live, async function () {
  const directory = temp();
  const child = fork(path.join(__dirname, "fixture-app.cjs"), [directory], {
    execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: Object.assign({}, process.env, { BSONLITE_TEST_MODULE: modulePath })
  });
  let db;
  try {
    const info = await new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error("Fixture timed out.")); }, 45000);
      child.on("message", function (message) {
        if (message.type === "ready") { clearTimeout(timer); resolve(message.info); }
        if (message.type === "error") { clearTimeout(timer); reject(new Error(message.message)); }
      });
      child.once("error", function (error) { clearTimeout(timer); reject(error); });
    });
    const exited = new Promise(function (resolve) { child.once("exit", resolve); });
    child.kill("SIGKILL");
    await exited;
    await eventually(function () { return !fs.existsSync(path.join(directory, "instance.lock")); });
    await eventually(function () {
      return new Promise(function (resolve) {
        const socket = net.connect(info.port, "127.0.0.1");
        socket.once("connect", function () { socket.destroy(); resolve(false); });
        socket.once("error", function () { resolve(true); });
      });
    });
    db = await BsonLite.open(options(directory, "crashtest"));
    assert.equal((await db.collection("messages").findOne({})).value, "saved-before-parent-crash");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (db) await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("built artifact runs in an empty consumer folder without node_modules, with import and require",
  process.env.BSONLITE_TEST_MODULE ? live : { skip: "Set BSONLITE_TEST_MODULE to a built artifact." }, async function () {
  const directory = temp();
  const managedRoot = temp();
  try {
    fs.copyFileSync(modulePath, path.join(directory, "BsonLite.cjs"));
    const config = { name: "consumer", storageEncryption:"auto", ...(process.platform === "win32" ? {} : {vaultPassword: "integration-only-vault-passphrase"}) };
    if (binary) config.binaryPath = binary;
    const body = "await BsonLite.connect(" + JSON.stringify(config) + ");\n" +
      "try { await updateMessage(); console.log('RESULT:' + (await BsonLite.collection('messages').findOne({key:1})).value); }\n" +
      "finally { await BsonLite.stop(); }\n";
    fs.writeFileSync(path.join(directory, "service.cjs"),
      "const BsonLite=require('./BsonLite.cjs');module.exports=()=>BsonLite.collection('messages').updateOne({key:1}, {$set:{value:'standalone'}}, {upsert:true});\n");
    fs.writeFileSync(path.join(directory, "app.mjs"), "import BsonLite from './BsonLite.cjs';\nimport updateMessage from './service.cjs';\n" + body);
    fs.writeFileSync(path.join(directory, "app.cjs"),
      "const BsonLite = require('./BsonLite.cjs');\nconst updateMessage=require('./service.cjs');\n(async function(){\n" + body +
      "})().catch(function(e){console.error(e);process.exitCode=1;});\n");
    for (const name of ["app.mjs", "app.cjs"]) {
      const result = spawnSync(process.execPath, [name], {
        cwd: directory, env: { ...process.env, BSONLITE_DATA_HOME: managedRoot }, encoding: "utf8", timeout: 60000
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /RESULT:standalone/);
    }
    assert.equal(fs.existsSync(path.join(directory, "Database", "data", "WiredTiger")), true);
    assert.deepEqual(fs.readdirSync(directory).sort(), ["BsonLite.cjs", "Database", "app.cjs", "app.mjs", "service.cjs"]);
    assert.equal(fs.existsSync(path.join(directory, "Database", "runtime")), false);
    const stores = fs.readdirSync(path.join(managedRoot, "stores"));
    assert.equal(stores.length, 1);
    assert.ok(fs.existsSync(path.join(managedRoot, "stores", stores[0], "vault.json")));
    assert.ok(!fs.existsSync(path.join(directory, "node_modules")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(managedRoot, { recursive: true, force: true });
  }
});
test("incorrect CA, client certificate and hostname are rejected", live, async () => {
  const root = temp(); let db, wrong;
  try {
    db = await BsonLite.open(options(path.join(root,"Database")));
    const real = db.collection("users").client.options;
    wrong = await require("../src/tls.cjs").createTLS(path.join(root,"other-certificates"));
    for (const extra of [{tlsCAFile:wrong.caFile,tlsCertificateKeyFile:real.tlsCertificateKeyFile}, {tlsCAFile:real.tlsCAFile,tlsCertificateKeyFile:wrong.clientFile}]) {
      const client = new MongoClient("mongodb://127.0.0.1:"+db.info.port,{directConnection:true,tls:true,serverSelectionTimeoutMS:1200,connectTimeoutMS:750,...extra});
      try {await assert.rejects(client.connect());} finally {await client.close();}
    }
    await assert.rejects(new Promise((resolve,reject)=>{
      const socket=require("node:tls").connect({host:"127.0.0.1",port:db.info.port,servername:"wrong.invalid",ca:fs.readFileSync(real.tlsCAFile),cert:fs.readFileSync(real.tlsCertificateKeyFile),key:fs.readFileSync(real.tlsCertificateKeyFile),minVersion:"TLSv1.2"},()=>{socket.destroy();resolve();});
      socket.once("error",reject);socket.setTimeout(2500,()=>{socket.destroy();reject(Error("TLS timeout"));});
    }),error=>error.code==="ERR_TLS_CERT_ALTNAME_INVALID");
    assert.equal((await db.ping()).ok,1);
  } finally {if(db)await db.close();if(wrong)wrong.cleanup();fs.rmSync(root,{recursive:true,force:true});}
});
test("encrypted backup preserves BSON/indexes and rejects active stores, wrong passwords, tampering and overwrite", live, async () => {
  const root=temp(); let db;
  const directory=path.join(root,"Database"),file=path.join(root,"private.bslbackup"),restored=path.join(root,"Restored");
  const password="integration-backup-only-passphrase",vaultPassword=options(directory).vaultPassword;
  try {
    db=await BsonLite.open(options(directory));
    const id=new BsonLite.ObjectId();await db.collection("private").createIndex({key:1},{unique:true});
    await db.collection("private").insertOne({_id:id,key:1,canary:"PRIVATE-BACKUP-CANARY-should-never-appear",createdAt:new Date("2026-01-01")});
    await assert.rejects(BsonLite.backup({directory,file,password,vaultPassword}),error=>error.code==="BSONLITE_DATABASE_IN_USE");
    assert.equal(fs.existsSync(file),false); await db.close(); db=null;
    const result=await BsonLite.backup({directory,file,password,vaultPassword});assert.equal(result.encrypted,true);
    const bytes=fs.readFileSync(file);assert.equal(bytes.includes(Buffer.from("PRIVATE-BACKUP-CANARY-should-never-appear")),false);
    const restoreOptions={directory:restored,file,password,vaultPassword,storageEncryption:"auto"};
    await assert.rejects(BsonLite.restore({...restoreOptions,password:password+"wrong"}),error=>error.code==="BSONLITE_BACKUP_AUTH_FAILED");assert.equal(fs.existsSync(restored),false);
    const corrupted=Buffer.from(bytes);corrupted[Math.floor(corrupted.length/2)]^=1;const changed=path.join(root,"changed.bslbackup");fs.writeFileSync(changed,corrupted);
    await assert.rejects(BsonLite.restore({...restoreOptions,file:changed}),error=>error.code==="BSONLITE_BACKUP_AUTH_FAILED");assert.equal(fs.existsSync(restored),false);
    await assert.rejects(BsonLite.backup({directory,file,password,vaultPassword}),error=>error.code==="BSONLITE_BACKUP_EXISTS");assert.deepEqual(fs.readFileSync(file),bytes);
    const restoredInfo=await BsonLite.restore(restoreOptions);assert.equal(restoredInfo.databaseName,"integration");assert.equal(restoredInfo.storageEncryption.policy,"auto");
    await assert.rejects(BsonLite.restore(restoreOptions),error=>error.code==="BSONLITE_RESTORE_EXISTS");
    db=await BsonLite.open(options(restored));const document=await db.collection("private").findOne({_id:id});assert.ok(document.createdAt instanceof Date);assert.equal(document.key,1);
    await assert.rejects(db.collection("private").insertOne({key:1}),error=>error.code===11000);
    const originalMetadata=JSON.parse(fs.readFileSync(path.join(directory,"bsonlite.json"))),newMetadata=JSON.parse(fs.readFileSync(path.join(restored,"bsonlite.json")));
    assert.notEqual(originalMetadata.storeId,newMetadata.storeId);
  } finally {if(db)await db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("legacy data upgrades through encrypted export/restore without copying the old engine or deleting originals", live, async () => {
  const root=temp(),directory=path.join(root,"Legacy"),restored=path.join(root,"Database"),file=path.join(root,"legacy.bslbackup");let db;
  try {
    db=await BsonLite.open(options(directory,"myapp"));await db.collection("users").insertOne({name:"Atik"});await db.close();db=null;
    const metadata=JSON.parse(fs.readFileSync(path.join(directory,"bsonlite.json")));
    const vaultFile=require("../src/paths.cjs").storePaths(metadata.storeId).vault;
    const {auth}=await require("../src/vault.cjs").loadVault(vaultFile,metadata.storeId,options(directory));
    fs.mkdirSync(path.join(directory,"runtime"));fs.writeFileSync(path.join(directory,"runtime","auth.json"),JSON.stringify(auth));
    fs.writeFileSync(path.join(directory,"runtime","mongod.exe"),"LEGACY-ENGINE-CANARY");
    fs.writeFileSync(path.join(directory,"bsonlite.json"),JSON.stringify({formatVersion:1,engineVersion:"4.0.28"}));
    await assert.rejects(BsonLite.open(options(directory,"myapp")),error=>error.code==="BSONLITE_MIGRATION_REQUIRED");
    const password="legacy-migration-backup-passphrase";
    await BsonLite.backup({directory,name:"myapp",file,password});
    await BsonLite.restore({directory:restored,file,password,storageEncryption:"none",vaultPassword:options(directory).vaultPassword});
    assert.equal(fs.readFileSync(path.join(directory,"runtime","mongod.exe"),"utf8"),"LEGACY-ENGINE-CANARY");
    assert.equal(fs.existsSync(path.join(restored,"runtime")),false);assert.equal(fs.existsSync(path.join(restored,"licenses")),false);
    db=await BsonLite.open(options(restored,"myapp"));assert.equal((await db.collection("users").findOne({})).name,"Atik");
  } finally {if(db)await db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("copied database identities cannot delete certificates or run beside the original", live, async () => {
  const root=temp(),directory=path.join(root,"Original"),copy=path.join(root,"Copy");let first,second;
  try {
    first=await BsonLite.open(options(directory));await first.close();first=null;fs.cpSync(directory,copy,{recursive:true});
    first=await BsonLite.open(options(directory));
    await assert.rejects(BsonLite.open(options(copy)),error=>error.code==="BSONLITE_DATABASE_IN_USE");
    assert.equal((await first.ping()).ok,1);
    await first.close();first=null;second=await BsonLite.open(options(copy));assert.equal((await second.ping()).ok,1);
  } finally {if(first)await first.close();if(second)await second.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("wrong vault password, name change and required encryption never reset an existing store", live, async () => {
  const root=temp();let db;
  try {
    db=await BsonLite.open(options(root));await db.collection("records").insertOne({value:"preserved"});await db.close();db=null;
    const before=fs.readFileSync(path.join(root,"bsonlite.json"),"utf8");
    if(process.platform!=="win32") {
      await assert.rejects(BsonLite.open({...options(root),vaultPassword:"incorrect-vault-password-value"}),error=>error.code==="BSONLITE_VAULT_LOCKED");
      await assert.rejects(BsonLite.open({...options(root),storageEncryption:"required"}),error=>error.code==="BSONLITE_STORAGE_ENCRYPTION");
    }
    await assert.rejects(BsonLite.open(options(root,"another")),error=>error.code==="BSONLITE_NAME_MISMATCH");
    assert.equal(fs.readFileSync(path.join(root,"bsonlite.json"),"utf8"),before);
    db=await BsonLite.open(options(root));assert.equal((await db.collection("records").findOne({})).value,"preserved");
  } finally {if(db)await db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("authenticated malicious archives cannot escape the restore directory", live, async () => {
  const root=temp(),destination=path.join(root,"Restored"),file=path.join(root,"malicious.bslbackup");
  try {
    const crypto=require("node:crypto"),zlib=require("node:zlib"),password="malicious-fixture-test-password",salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
    const header=Buffer.from(JSON.stringify({version:1,algorithm:"aes-256-gcm",compression:"gzip",kdf:"scrypt",N:32768,r:8,p:1,salt:salt.toString("base64"),iv:iv.toString("base64"),engineVersion:"4.0.28",platform:process.platform,arch:process.arch}));
    const size=Buffer.alloc(4);size.writeUInt32BE(header.length);const prefix=Buffer.concat([Buffer.from("BSLTBK01"),size,header]);
    const manifest=Buffer.from(JSON.stringify({version:1,engineVersion:"4.0.28",databaseName:"integration",auth:{username:"bsonlite_admin",password:"a".repeat(64)},total:1,files:[{path:"data/../../escape",size:1,sha256:"b".repeat(64)}]}));
    const msize=Buffer.alloc(4);msize.writeUInt32BE(manifest.length);
    const key=await require("../src/cryptography.cjs").deriveKey(password,salt),cipher=crypto.createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(prefix);
    fs.writeFileSync(file,Buffer.concat([prefix,cipher.update(zlib.gzipSync(Buffer.concat([msize,manifest,Buffer.from("x")]))),cipher.final(),cipher.getAuthTag()]));key.fill(0);
    await assert.rejects(BsonLite.restore({directory:destination,file,password,storageEncryption:"none",vaultPassword:options(root).vaultPassword}),error=>error.code==="BSONLITE_BACKUP_INVALID");
    assert.equal(fs.existsSync(destination),false);assert.equal(fs.existsSync(path.join(root,"escape")),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("starter starts the HTTP health server and closes it with the database", process.env.BSONLITE_TEST_MODULE ? live : {skip:"Set BSONLITE_TEST_MODULE to the built artifact."}, async () => {
  const root=temp(),managed=temp();let child;
  try {
    fs.copyFileSync(modulePath,path.join(root,"BsonLite.cjs"));fs.copyFileSync(path.resolve(__dirname,"../dist/index.js"),path.join(root,"index.js"));
    const config={storageEncryption:"auto",...(binary?{binaryPath:binary}:{}),...(process.platform==="win32"?{}:{vaultPassword:"starter-test-vault-passphrase"})};
    // Exercise the unmodified starter with explicit Linux/CI development settings.
    fs.writeFileSync(path.join(root,"bootstrap.cjs"),"const B=require('./BsonLite.cjs');const id=require.resolve('./BsonLite.cjs');require.cache[id].exports={...B,connect(input){return B.connect({..."+JSON.stringify(config)+",...(typeof input==='string'?{name:input}:input)});}};require('./index.js');");
    child=require("node:child_process").spawn(process.execPath,["bootstrap.cjs"],{cwd:root,env:{...process.env,PORT:"0",BSONLITE_DATA_HOME:managed},stdio:["ignore","pipe","pipe"]});
    let output="",errors="";child.stderr.on("data",chunk=>{errors+=chunk;});
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Starter timeout: "+errors+output)),60000);
      child.stdout.on("data",chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/health/);if(match){clearTimeout(timer);resolve(match[0]);}});
      child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("exit",code=>{clearTimeout(timer);reject(Error("Starter exited: "+code+" "+errors+output));});
    });
    const response=await fetch(url),health=await response.json();assert.equal(response.status,200);assert.equal(health.ok,true);assert.equal(health.database,"bsonlite");assert.equal(health.tls,true);assert.ok(health.databasePort>0);
    assert.equal((await fetch(url.replace('/health','/missing'))).status,404);
    const exited=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");
    if(process.platform==="win32") {
      // Windows TerminateProcess does not dispatch a POSIX SIGTERM handler.
      await exited;await eventually(()=>!fs.existsSync(path.join(root,"Database","instance.lock")));
    } else {assert.equal(await exited,0);assert.match(output,/\[BsonLite\] Stopped/);}
    assert.equal(fs.existsSync(path.join(root,"Database","instance.lock")),false);
  } finally {if(child&&child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");fs.rmSync(root,{recursive:true,force:true});fs.rmSync(managed,{recursive:true,force:true});}
});
test("explicit legacy auto mode discovers the persisted name and retains TLS", live, async () => {
  const directory=temp();let db;
  const config={...options(directory,"myapp"),storageEncryption:"auto"};
  try {
    db=await BsonLite.connect(config);await db.collection("users").insertOne({name:"Atik"});
    assert.equal(db.info.security.tls,true);assert.equal(db.info.security.storageEncryption.policy,"auto");
    await BsonLite.disconnect();
    const inferred={...config};delete inferred.name;
    db=await BsonLite.connect(inferred);assert.equal(db.name,"myapp");assert.equal(await BsonLite.collection("users").countDocuments(),1);
    assert.equal(await BsonLite.connect(),db);
    const metadata=JSON.parse(fs.readFileSync(path.join(directory,"bsonlite.json")));assert.equal(metadata.encryptionRequired,false);
  } finally {await BsonLite.disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
test("automatic restore preserves an authenticated required-encryption backup policy", live, async () => {
  const root=temp(),directory=path.join(root,"Original"),target=path.join(root,"Restored"),file=path.join(root,"strict.bslbackup");let db;
  const password="required-policy-backup-test-passphrase",vaultPassword=options(directory).vaultPassword;
  try {
    db=await BsonLite.open(options(directory));await db.collection("records").insertOne({value:"preserved"});await db.close();db=null;
    // Exercise policy preservation without claiming this test's live files were encrypted.
    const metaFile=path.join(directory,"bsonlite.json"),metadata=JSON.parse(fs.readFileSync(metaFile));metadata.encryptionRequired=true;fs.writeFileSync(metaFile,JSON.stringify(metadata));
    await BsonLite.backup({directory,file,password,vaultPassword});
    await assert.rejects(BsonLite.restore({directory:target,file,password,vaultPassword,storageEncryption:"none"}),error=>error.code==="BSONLITE_SECURITY_DOWNGRADE");
    assert.equal(fs.existsSync(target),false);
    if(process.platform!=="win32") {
      await assert.rejects(BsonLite.restore({directory:target,file,password,vaultPassword,storageEncryption:"auto"}),error=>error.code==="BSONLITE_STORAGE_ENCRYPTION");assert.equal(fs.existsSync(target),false);
    }
    assert.equal(fs.existsSync(path.join(directory,"data","WiredTiger")),true);
  } finally {if(db)await db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("automatic connection works in paths containing spaces and Unicode", process.env.BSONLITE_TEST_MODULE ? live : {skip:"Set BSONLITE_TEST_MODULE to the built artifact."}, async () => {
  const root=temp(),project=path.join(root,"Complete Project পরীক্ষা"),managed=path.join(root,"Private Cache পরীক্ষা");
  try {
    fs.mkdirSync(project);fs.copyFileSync(modulePath,path.join(project,"BsonLite.cjs"));
    const config={storageEncryption:"auto",...(binary?{binaryPath:binary}:{}),...(process.platform==="win32"?{}:{vaultPassword:"unicode-path-test-vault-passphrase"})};
    fs.writeFileSync(path.join(project,"app.cjs"),"const B=require('./BsonLite.cjs');(async()=>{await B.connect("+JSON.stringify(config)+");try{await B.collection('items').insertOne({value:1});if(await B.collection('items').countDocuments()!==1)throw Error('Missing record');console.log('UNICODE_PATH_OK');}finally{await B.disconnect();}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1;});");
    const result=spawnSync(process.execPath,["app.cjs"],{cwd:project,env:{...process.env,BSONLITE_DATA_HOME:managed},encoding:"utf8",timeout:60000});
    assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/UNICODE_PATH_OK/);assert.equal(fs.existsSync(path.join(project,"Database","data","WiredTiger")),true);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
