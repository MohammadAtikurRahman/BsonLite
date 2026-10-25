"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {spawn,spawnSync}=require("node:child_process");
// Exercise Unicode in vault/TLS/engine paths as well as the project data path.
const managed=fs.mkdtempSync(path.join(os.tmpdir(),"bsonlite-managed-পরীক্ষা-"));process.env.BSONLITE_DATA_HOME=managed;
const B=require(process.env.BSONLITE_TEST_MODULE||"../src/index.cjs");
const modern=B.engineVersion==="9.0.4";
const embeddedArtifact=Boolean(process.env.BSONLITE_TEST_MODULE)&&(!modern||process.env.BSONLITE_MODERN_EMBEDDED==="1");
const {Long,Int32,Double,BSONRegExp}=B.BSON;
const binary=process.env.BSONLITE_NATIVE_BINARY,manifest=process.env.BSONLITE_NATIVE_MANIFEST;
const enabled=Boolean(binary&&manifest),kind=enabled?JSON.parse(fs.readFileSync(manifest,"utf8")).mode:null;
const prototype=kind==="extension-prototype",live=enabled?{}:{skip:"Set BSONLITE_NATIVE_BINARY and BSONLITE_NATIVE_MANIFEST."};
const policy=prototype?"native-prototype":"native",vaultPassword=process.platform==="win32"?undefined:"native-integration-vault-passphrase";
const options=directory=>({directory,name:"nativeapp",binaryPath:binary,nativeManifest:manifest,vaultPassword,storageEncryption:policy,silent:true});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"BsonLite Native পরীক্ষা "));
const metadata=directory=>JSON.parse(fs.readFileSync(path.join(directory,"bsonlite.json")));
function findMarker(file,marker){const fd=fs.openSync(file,"r");try{const buffer=Buffer.alloc(65536);let tail=Buffer.alloc(0),offset=0;while(offset<fs.fstatSync(fd).size){const n=fs.readSync(fd,buffer,0,buffer.length,offset);if(!n)break;const bytes=Buffer.concat([tail,buffer.subarray(0,n)]);if(bytes.includes(marker))return true;tail=bytes.subarray(Math.max(0,bytes.length-marker.length));offset+=n;}return false;}finally{fs.closeSync(fd);}}
function clean(root){fs.rmSync(root,{recursive:true,force:true});}
async function startupFixtureDiagnostic(directory){
 // Only this suite's synthetic fixture is read, before its normal cleanup.
 try{
  const m=metadata(directory);if(!/^[a-f0-9]{32}$/.test(m.storeId))throw Error();
  const file=path.join(directory,"logs/bsonlite.log.enc"),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>12*1024*1024)throw Error();
  const {auth}=await require("../src/vault.cjs").loadVault(path.join(managed,"stores",m.storeId,"vault.json"),m.storeId,options(directory));
  let text=require("../src/native-storage.cjs").decryptLog(file,auth);
  for(const value of Object.values(auth))if(typeof value==="string"&&value.length>8)text=text.split(value).join("[redacted]");
  if(text.length>8192)text=text.slice(0,4096)+"\n[... bounded fixture log ...]\n"+text.slice(-4096);
  console.error("[synthetic native fixture diagnostic]",text);
 }catch(_){console.error("[synthetic native fixture diagnostic] Unavailable; protected credentials and ciphertext were not printed.");}
}
test.after(()=>clean(managed));

test("real MongoDB queries, indexes and BSON values work with encrypted WiredTiger blocks",live,async()=>{
 const root=temp(),directory=path.join(root,"Database");let db;
 try{db=await B.open(options(directory));const id=new B.ObjectId(),date=new Date("2026-10-18T12:00:00Z");
  await db.collection("items").createIndex({n:1},{unique:true});await db.collection("items").createIndex({title:"text"});
  await db.collection("items").insertMany([{_id:id,n:1,title:"portable database",created:date,canary:"NATIVE_SECRET_SENTINEL_842416"},{n:2,title:"offline encrypted database"}]);
  assert.equal((await db.collection("items").find({n:{$gte:1}}).sort({n:-1}).toArray())[0].n,2);
  assert.equal(await db.collection("items").countDocuments({$text:{$search:"offline"}}),1);
  assert.equal((await db.collection("items").aggregate([{$group:{_id:null,total:{$sum:"$n"}}}]).toArray())[0].total,3);
  await assert.rejects(db.collection("items").insertOne({n:1}),e=>e.code===11000);
  const info=db.info.security.storageEncryption;assert.equal(info.method,"wiredtiger-native");assert.equal(info.verified,!prototype);assert.equal(info.temporaryFiles,!prototype);if(!prototype)assert.equal(info.engineManagedDumps,false);
  assert.equal(JSON.stringify(db).includes("dataKey"),false);await db.close();db=null;
  const files=fs.readdirSync(path.join(directory,"data")).filter(n=>n.endsWith(".wt"));assert.ok(files.some(n=>findMarker(path.join(directory,"data",n),Buffer.from("BSLAE001"))));
  for(const name of files)assert.equal(findMarker(path.join(directory,"data",name),Buffer.from("NATIVE_SECRET_SENTINEL_842416")),false);
  const logs=fs.readdirSync(path.join(directory,"logs"));assert.ok(logs.some(n=>n.endsWith(".enc")));assert.equal(logs.some(n=>n.endsWith(".log")),false);
  assert.ok(fs.readdirSync(path.join(directory,"data/journal")).filter(n=>n.startsWith("WiredTigerLog.")).some(n=>findMarker(path.join(directory,"data/journal",n),Buffer.from("BSLAE001"))));
  db=await B.open(options(directory));const saved=await db.collection("items").findOne({_id:id});assert.equal(saved.canary,"NATIVE_SECRET_SENTINEL_842416");assert.ok(saved.created instanceof Date);assert.equal(saved.created.getTime(),date.getTime());
 }catch(error){await startupFixtureDiagnostic(directory);throw error;}finally{if(db)await db.close();clean(root);}
});

test("native backup/restore preserves the data key and rewraps it for a new store identity",live,async()=>{
 const root=temp(),directory=path.join(root,"Original"),destination=path.join(root,"Restored"),file=path.join(root,"encrypted.bslbackup"),password="native-backup-portable-test-passphrase";let db;
 try{db=await B.open(options(directory));await db.collection("items").insertOne({value:123});await db.close();db=null;
  await B.backup({directory,file,password,vaultPassword});await assert.rejects(B.restore({directory:destination,file,password,vaultPassword,storageEncryption:"none"}),e=>e.code==="BSONLITE_SECURITY_DOWNGRADE");assert.equal(fs.existsSync(destination),false);
  await assert.rejects(B.restore({directory:destination,file,password:password+"wrong",vaultPassword,storageEncryption:policy}),e=>e.code==="BSONLITE_BACKUP_AUTH_FAILED");
  const restored=await B.restore({directory:destination,file,password,vaultPassword,storageEncryption:policy});assert.equal(restored.storageEncryption.verified,false);
  assert.notEqual(metadata(directory).storeId,metadata(destination).storeId);assert.equal(metadata(directory).nativeEncryption.keyId,metadata(destination).nativeEncryption.keyId);
  db=await B.open(options(destination));assert.equal((await db.collection("items").findOne()).value,123);
 }finally{if(db)await db.close();clean(root);}
});

test("a wrong protected data key fails authentication without resetting existing data",live,async()=>{
 const root=temp(),directory=path.join(root,"Database");let db,original,file;
 try{db=await B.open(options(directory));await db.collection("items").insertOne({value:"preserved"});await db.close();db=null;const m=metadata(directory);file=path.join(managed,"stores",m.storeId,"vault.json");original=fs.readFileSync(file);
  const {auth}=await require("../src/vault.cjs").loadVault(file,m.storeId,options(directory));fs.unlinkSync(file);await require("../src/vault.cjs").saveVault(file,m.storeId,{...auth,dataKey:crypto.randomBytes(32).toString("hex")},options(directory));
  await assert.rejects(B.open(options(directory)),e=>["BSONLITE_ENGINE_EXIT","BSONLITE_START_TIMEOUT"].includes(e.code));assert.equal(fs.existsSync(path.join(directory,"data/WiredTiger.wt")),true);
  fs.writeFileSync(file,original);db=await B.open(options(directory));assert.equal((await db.collection("items").findOne()).value,"preserved");
 }finally{if(file&&original)fs.writeFileSync(file,original);if(db)await db.close();clean(root);}
});

test("migration preserves documents, numeric BSON types, text indexes and views",modern?{skip:"Cross-engine migration is exercised by the separate modern upgrade fixture."}:live,async()=>{
 const root=temp(),directory=path.join(root,"Old"),destination=path.join(root,"Encrypted");let db,stage="open legacy source";
 try{db=await B.open({...options(directory),storageEncryption:"auto"});await db.createCollection("items",{validator:{n:{$type:"int"}}});await db.collection("items").createIndex({title:"text"},{weights:{title:2},name:"title_text"});await db.collection("items").createIndex({n:1},{unique:true});
  const id=new B.ObjectId();await db.collection("items").insertOne({_id:id,n:new Int32(7),floating:new Double(7),big:Long.fromString("9223372036854775806"),title:"portable offline",rx:new BSONRegExp("Atik","i")});await db.createCollection("item_view",{viewOn:"items",pipeline:[{$match:{n:{$gte:1}}}]});await db.close();db=null;
  stage="migrate seeded source";const old=metadata(directory);old.formatVersion=2;fs.writeFileSync(path.join(directory,"bsonlite.json"),JSON.stringify(old));
  await assert.rejects(B.open(options(directory)),e=>e.code==="BSONLITE_NATIVE_MIGRATION_REQUIRED");
  const result=await B.migrate({sourceDirectory:directory,directory:destination,binaryPath:binary,nativeManifest:manifest,vaultPassword,storageEncryption:policy});assert.equal(result.originalPreserved,true);
  const guardBytes=fs.readFileSync(path.join(destination,"migration.json"));const guard=JSON.parse(guardBytes);assert.equal(guard.state,"complete");assert.equal(guard.collectionCount,1);assert.equal(guard.documentCount,1);assert.equal(guard.viewCount,1);assert.ok(guardBytes.length<512);assert.equal(guardBytes.includes(Buffer.from("item_view")),false);
  stage="verify native destination";db=await B.open(options(destination));const saved=await db.collection("items").findOne({_id:id},{promoteValues:false,promoteLongs:false,bsonRegExp:true});assert.equal(saved.n._bsontype,"Int32");assert.equal(saved.floating._bsontype,"Double");assert.equal(saved.big.toString(),"9223372036854775806");assert.equal(saved.rx._bsontype,"BSONRegExp");assert.equal(await db.collection("items").countDocuments({$text:{$search:"offline"}}),1);assert.equal(await db.collection("item_view").countDocuments(),1);await db.close();db=null;
  stage="reopen preserved source";db=await B.open({...options(directory),storageEncryption:"auto"});assert.equal(await db.collection("items").countDocuments(),1);
 }catch(error){
  // Only this synthetic fixture's legacy diagnostic log is printed on failure.
  // Its protected credentials are removed before any bounded text is emitted.
  console.error("[migration fixture]",stage,error.code);
  const file=path.join(directory,"logs/bsonlite.log");
  if(fs.existsSync(file)){
   let tail=fs.readFileSync(file,"utf8");
   try{const m=metadata(directory);const {auth}=await require("../src/vault.cjs").loadVault(path.join(managed,"stores",m.storeId,"vault.json"),m.storeId,options(directory));for(const value of [auth.password,auth.dataKey])if(value)tail=tail.split(value).join("[redacted]");}catch(_){tail="Fixture log withheld: protected credentials could not be loaded for redaction.";}
   if(tail.length>8192)tail=tail.slice(0,4096)+"\n[... bounded fixture log ...]\n"+tail.slice(-4096);
   console.error("[migration fixture legacy log]",tail);
  }
  throw error;
 }finally{if(db)await db.close();clean(root);}
});

test("an interrupted migration marker prevents use of a partial destination",live,async()=>{
 const root=temp(),directory=path.join(root,"Database");let db;try{db=await B.open(options(directory));await db.close();db=null;fs.writeFileSync(path.join(directory,"migration.json"),JSON.stringify({version:1,state:"in-progress"}));await assert.rejects(B.open(options(directory)),e=>e.code==="BSONLITE_MIGRATION_INCOMPLETE");assert.equal(fs.existsSync(path.join(directory,"instance.lock")),false);}finally{if(db)await db.close();clean(root);}
});

test("full native mode refuses the stock engine or a partial prototype before creating data",live,async()=>{
 const root=temp(),directory=path.join(root,"Database");try{if(prototype)await assert.rejects(B.open({...options(directory),storageEncryption:"native"}),e=>e.code==="BSONLITE_NATIVE_BUILD_REQUIRED");else{const o=options(directory);delete o.storageEncryption;const db=await B.open(o);try{assert.equal(db.info.security.storageEncryption.verified,true);}finally{await db.close();}}}finally{clean(root);}
});

test("rebuilt engine encrypts actual aggregation spill files",enabled&&!prototype?{timeout:240000}:{skip:"Requires the rebuilt engine; Linux extension has no temporary-file hooks."},async()=>{
 const root=temp(),directory=path.join(root,"Database");let db,cursor;
 try{db=await B.open(options(directory));for(let i=0;i<24;i++){const batch=[];for(let j=0;j<64;j++)batch.push({n:crypto.randomInt(1000000000),pad:"NATIVE_SPILL_SENTINEL_842416"+crypto.randomBytes(110000).toString("base64")});await db.collection("spill").insertMany(batch);}
  cursor=db.collection("spill").aggregate([{$sort:{n:1}}],{allowDiskUse:true,batchSize:1});assert.ok(await cursor.next());
  const folder=path.join(directory,"data/_tmp");
  function spillFiles(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?spillFiles(file):entry.isFile()&&!entry.name.startsWith("WiredTiger")&&fs.statSync(file).size>65536?[file]:[];});}
  const files=modern?spillFiles(folder):fs.readdirSync(folder).map(n=>path.join(folder,n)).filter(p=>fs.statSync(p).isFile());
  assert.ok(files.length>0,"The workload must actually spill, otherwise encryption was not exercised");
  for(const file of files){assert.ok(findMarker(file,Buffer.from("BSLAE001")),"Temporary spill must contain authenticated ciphertext");assert.equal(findMarker(file,Buffer.from("NATIVE_SPILL_SENTINEL_842416")),false,"Spilled records must not be plaintext");}
 }finally{if(cursor)await cursor.close();if(db)await db.close();clean(root);}
});

test("rebuilt engine prevents per-collection plaintext encryption overrides",enabled&&!prototype?{}:{skip:"Requires the rebuilt MongoDB configuration suffix enforcement."},async()=>{
 const root=temp(),directory=path.join(root,"Database");let db;try{db=await B.open(options(directory));let created=false;try{await db.createCollection("attempt",{storageEngine:{wiredTiger:{configString:"encryption=(name=none)"}}});created=true;}catch(error){
   // Driver 7 wraps write-command IllegalOperation (20) in a retryable-write
   // message even with retryWrites:false. Inspect its preserved server error;
   // a client/network failure must never count as an encryption rejection.
   const rejected=error.originalError||error;
   if(typeof rejected.code!=="number")await startupFixtureDiagnostic(directory);
   assert.equal(rejected.name,"MongoServerError");
   assert.equal(typeof rejected.code,"number","The override must be rejected by the server, not fail unexpectedly: "+error.name+": "+String(error.message).slice(0,1000));
   if(rejected!==error)assert.equal(rejected.code,20);
   assert.equal((await db.ping()).ok,1,"Rejected encryption overrides must leave the engine usable");
   assert.equal((await db.listCollections({name:"attempt"}).toArray()).length,0,"A rejected override must not leave a partial collection");
  }
  if(created){await db.collection("attempt").insertOne({value:"FORCED_ENCRYPTION_SENTINEL"});await db.close();db=null;const files=fs.readdirSync(path.join(directory,"data")).filter(n=>n.startsWith("collection-")&&n.endsWith(".wt"));for(const name of files){const file=path.join(directory,"data",name);assert.equal(findMarker(file,Buffer.from("FORCED_ENCRYPTION_SENTINEL")),false);if(fs.statSync(file).size>4096)assert.ok(findMarker(file,Buffer.from("BSLAE001")));}}
 }finally{if(db)await db.close();clean(root);}
});

test("final Windows single-file artifact starts without developer binary paths or npm packages",enabled&&!prototype&&embeddedArtifact?{timeout:90000}:{skip:"Requires the final embedded Windows artifact."},()=>{
 const root=temp();try{fs.copyFileSync(process.env.BSONLITE_TEST_MODULE,path.join(root,"BsonLite.cjs"));fs.writeFileSync(path.join(root,"app.cjs"),"const B=require('./BsonLite.cjs');(async()=>{const db=await B.connect();try{if(!db.info.security.storageEncryption.verified)throw Error('Native encryption not verified');await B.collection('items').insertOne({n:1});if(await B.collection('items').countDocuments()!==1)throw Error('Missing data');console.log('NATIVE_SINGLE_FILE_OK');}finally{await B.disconnect();}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1;});");const result=spawnSync(process.execPath,["app.cjs"],{cwd:root,env:{...process.env,BSONLITE_DATA_HOME:managed},encoding:"utf8",timeout:85000});assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/NATIVE_SINGLE_FILE_OK/);assert.equal(fs.existsSync(path.join(root,"node_modules")),false);}finally{clean(root);}
});

test("two standalone consumers safely share a fresh embedded engine cache",enabled&&!prototype&&embeddedArtifact?{timeout:120000}:{skip:"Requires the final embedded Windows artifact."},async()=>{
 const root=temp(),cache=fs.mkdtempSync(path.join(os.tmpdir(),"BsonLite shared private cache পরীক্ষা "));
 try{
  fs.copyFileSync(process.env.BSONLITE_TEST_MODULE,path.join(root,"BsonLite.cjs"));
  fs.writeFileSync(path.join(root,"parallel.cjs"),"const B=require('./BsonLite.cjs');const path=require('node:path');(async()=>{const label=process.argv[2];const db=await B.connect({directory:path.resolve(label),silent:true});try{await db.collection('items').insertOne({label});const records=await db.collection('items').find().toArray();if(records.length!==1||records[0].label!==label)throw Error('Consumer data was mixed');console.log('PARALLEL_NATIVE_OK');}finally{await B.disconnect();}})().catch(e=>{console.error(e.code,e.message);process.exitCode=1;});");
  const run=label=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,["parallel.cjs",label],{cwd:root,env:{...process.env,BSONLITE_DATA_HOME:cache},stdio:["ignore","pipe","pipe"],windowsHide:true});let output="";
   const timer=setTimeout(()=>{child.kill("SIGKILL");},100000);
   child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",s=>{output+=s;});child.stderr.on("data",s=>{output+=s;});
   child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("close",code=>{clearTimeout(timer);resolve({code,output});});
  });
  const results=await Promise.allSettled([run("First"),run("Second")]);for(const result of results){assert.equal(result.status,"fulfilled",result.reason?.message);assert.equal(result.value.code,0,result.value.output);assert.match(result.value.output,/PARALLEL_NATIVE_OK/);}
  assert.equal(fs.readdirSync(path.join(cache,"engines")).filter(n=>n.startsWith("mongodb-")).length,1);
 }finally{clean(root);clean(cache);}
});
