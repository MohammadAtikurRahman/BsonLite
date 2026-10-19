"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const native=require("../src/native-storage.cjs"),{metadataFor,storagePolicy,readMetadata}=require("../src/store.cjs");
const auth=()=>({username:"bsonlite_admin",password:crypto.randomBytes(32).toString("hex"),dataKey:crypto.randomBytes(32).toString("hex"),dataKeyId:crypto.randomBytes(16).toString("hex")});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"bsonlite-native-unit-"));
const probe=process.env.BSONLITE_NATIVE_PROBE||path.resolve(__dirname,"../native/build",process.platform+"-"+process.arch,process.platform==="win32"?"crypto_probe.exe":"crypto_probe");
const compiled=fs.existsSync(probe)?{}:{skip:"Build the native crypto probe first."};
test("native key handoff is a bounded binary frame with no command-line secret",()=>{
  const value=auth(),frame=native.keyFrame(value);assert.equal(frame.length,56);assert.equal(frame.subarray(0,8).toString(),"BSLKEY01");assert.equal(frame.subarray(8,24).toString("hex"),value.dataKeyId);assert.equal(frame.subarray(24).toString("hex"),value.dataKey);
  assert.throws(()=>native.keyFrame({...value,dataKey:"broken"}),error=>error.code==="BSONLITE_DATA_KEY_MISSING");
  assert.throws(()=>native.keyFrame({...value,dataKey:[value.dataKey]}),error=>error.code==="BSONLITE_DATA_KEY_MISSING");
  assert.equal(Boolean(native.validNative({version:1,cipher:native.CIPHER,keyId:[value.dataKeyId],coverage:"full"})),false);
});
test("database data keys survive protected-vault roundtrip without plaintext key files",async()=>{
  const root=temp(),file=path.join(root,"vault.json"),value=auth(),id="a".repeat(32),options=process.platform==="win32"?{}:{vaultPassword:"native-vault-test-passphrase"};
  try{await require("../src/vault.cjs").saveVault(file,id,value,options);const saved=fs.readFileSync(file,"utf8");assert.equal(saved.includes(value.dataKey),false);assert.equal(saved.includes(value.password),false);assert.deepEqual((await require("../src/vault.cjs").loadVault(file,id,options)).auth,value);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("native encryption metadata prevents plaintext downgrade and prototype promotion",()=>{
  const root=temp(),value=auth(),file=path.join(root,"bsonlite.json");
  try{const metadata={...metadataFor("a".repeat(32),"myapp",false),nativeEncryption:{version:1,cipher:native.CIPHER,keyId:value.dataKeyId,coverage:"full"}};fs.writeFileSync(file,JSON.stringify(metadata));assert.equal(storagePolicy({directory:root,storageEncryption:"auto"}),"native");assert.throws(()=>storagePolicy({directory:root,storageEncryption:"none"}),error=>error.code==="BSONLITE_SECURITY_DOWNGRADE");metadata.nativeEncryption.coverage="wiredtiger-prototype";fs.writeFileSync(file,JSON.stringify(metadata));assert.throws(()=>storagePolicy({directory:root,storageEncryption:"native"}),error=>error.code==="BSONLITE_NATIVE_PROTOTYPE");metadata.nativeEncryption.keyId="bad";fs.writeFileSync(file,JSON.stringify(metadata));assert.throws(()=>readMetadata(root),error=>error.code==="BSONLITE_METADATA");}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("old plaintext stores require explicit migration instead of changing metadata",()=>{
  const root=temp(),file=path.join(root,"bsonlite.json");try{const original=JSON.stringify({...metadataFor("b".repeat(32),"oldapp",false),formatVersion:2});fs.writeFileSync(file,original);assert.throws(()=>storagePolicy({directory:root,storageEncryption:"native"}),error=>error.code==="BSONLITE_NATIVE_MIGRATION_REQUIRED");assert.equal(fs.readFileSync(file,"utf8"),original);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("process logs are encrypted, authenticate records and reject a wrong key",()=>{
  const root=temp(),file=path.join(root,"log.enc"),value=auth();try{const log=native.createEncryptedLog(file,value);log.write(Buffer.from("PRIVATE_NATIVE_LOG_SENTINEL"));log.write(Buffer.from("stderr-record"),2);log.close();const bytes=fs.readFileSync(file);assert.equal(bytes.includes(Buffer.from("PRIVATE_NATIVE_LOG_SENTINEL")),false);assert.equal(bytes.includes(Buffer.from(value.dataKey)),false);assert.equal(native.decryptLog(file,value),"PRIVATE_NATIVE_LOG_SENTINELstderr-record");assert.throws(()=>native.decryptLog(file,{...value,dataKey:"f".repeat(64)}));bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);assert.throws(()=>native.decryptLog(file,value));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("native manifest is required and cannot be replaced with an invented capability",async()=>{
  const root=temp(),binary=path.join(root,"mongod");try{fs.writeFileSync(binary,"not an engine");await assert.rejects(native.resolveNative(binary,{storageEncryption:"native"}),error=>error.code==="BSONLITE_NATIVE_BUILD_REQUIRED");const file=path.join(root,"native-engine.json");fs.writeFileSync(file,JSON.stringify({version:1,cipher:native.CIPHER,platform:process.platform,arch:process.arch,engineVersion:"4.0.28",engineSha256:"0".repeat(64),mode:"builtin",temporaryFiles:true,libsodiumVersion:"1.0.22"}));await assert.rejects(native.resolveNative(binary,{storageEncryption:"native"}),error=>error.code==="BSONLITE_NATIVE_ENGINE_INVALID");}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("compiled libsodium cipher passes roundtrip, nonce, wrong-key, domain and tamper self-tests",compiled,()=>{const result=spawnSync(probe,[],{encoding:"utf8",timeout:15000});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).selfTest,true);});
test("self-test transport rejects unrelated executables and unknown protocols",async()=>{
  const root=temp(),file=path.join(root,"native-engine.json");
  try{
    const manifest={version:1,cipher:native.CIPHER,platform:process.platform,arch:process.arch,engineVersion:"4.0.28",
      engineSha256:crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex"),libsodiumVersion:"1.0.22",
      mode:"builtin",temporaryFiles:true,engineManagedDumps:false,upstreamCommit:"af1a9dc12adcfa83cc19571cb3faba26eeddac92",
      patchSha256:"a".repeat(64),staticCRuntime:true,tlsProvider:"Windows SChannel",windowsCodePage:"UTF-8",minimumWindowsBuild:18362,
      selfTestProtocol:"win32-exit-code-v1"};
    fs.writeFileSync(file,JSON.stringify(manifest));
    await assert.rejects(native.resolveNative(process.execPath,{storageEncryption:"native",nativeManifest:file}),
      error=>error.code===(process.platform==="win32"?"BSONLITE_NATIVE_SELF_TEST":"BSONLITE_NATIVE_ENGINE_INVALID"));
    manifest.selfTestProtocol="unrecognized-protocol";fs.writeFileSync(file,JSON.stringify(manifest));
    await assert.rejects(native.resolveNative(process.execPath,{storageEncryption:"native",nativeManifest:file}),error=>error.code==="BSONLITE_NATIVE_ENGINE_INVALID");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
const windowsEngine=path.resolve(__dirname,"../assets/native-win32-x64/mongod.exe");
test("the actual compiled Windows engine passes its pinned exit-code self-test",{
  skip:process.platform!=="win32"||!fs.existsSync(windowsEngine)
},async()=>{
  const result=spawnSync(windowsEngine,["--bsonlite-native-self-test"],{encoding:"utf8",timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,"");
  const descriptor=await native.resolveNative(windowsEngine,{storageEncryption:"native"});assert.equal(descriptor.coverage,"full");
});
test("compiled native key reader accepts exactly one protected-key frame",compiled,()=>{const result=spawnSync(probe,["--key-frame-test"],{input:native.keyFrame(auth()),encoding:"utf8",timeout:15000});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).keyFrameAccepted,true);});
test("compiled native key reader rejects truncated, extra and invalid input",compiled,()=>{const frame=native.keyFrame(auth());const invalid=Buffer.from(frame);invalid[0]^=1;for(const input of [frame.subarray(0,40),Buffer.concat([frame,Buffer.from([1])]),invalid]){const result=spawnSync(probe,["--key-frame-test"],{input,encoding:"utf8",timeout:15000});assert.equal(result.status,2,result.stderr);assert.equal(result.stdout,"");}});
