"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { BsonLiteError } = require("./errors.cjs");
const exec = promisify(execFile);
const CIPHER = "xchacha20-poly1305";
const ENCRYPTOR = "bsonlite_xchacha20_v1";
const DATA_MAGIC = Buffer.from("BSLAE001");
const LOG_MAGIC = Buffer.from("BSLLOG01");
const nativePolicy = policy => policy === "native" || policy === "native-prototype";
function validNative(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.version === 1 && value.cipher === CIPHER &&
    typeof value.keyId === "string" && /^[a-f0-9]{32}$/.test(value.keyId) && ["full", "wiredtiger-prototype"].includes(value.coverage);
}
function validDataKey(auth) {
  return auth && typeof auth.dataKey === "string" && typeof auth.dataKeyId === "string" && /^[a-f0-9]{64}$/.test(auth.dataKey) && /^[a-f0-9]{32}$/.test(auth.dataKeyId);
}
function keyFrame(auth) {
  if (!validDataKey(auth)) throw new BsonLiteError("BSONLITE_DATA_KEY_MISSING", "The matching protected database encryption key is missing. Restore a matching encrypted backup; data was not reset.");
  return Buffer.concat([Buffer.from("BSLKEY01"), Buffer.from(auth.dataKeyId,"hex"), Buffer.from(auth.dataKey,"hex")]);
}
function readBoundedJSON(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error("Unsafe manifest");
  return JSON.parse(fs.readFileSync(file,"utf8"));
}
function digest(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
async function resolveNative(binary, options) {
  if (!nativePolicy(options.storageEncryption)) return null;
  const manifestPath = options.nativeManifest || path.join(path.dirname(binary),"native-engine.json");
  let manifest;
  try { manifest = readBoundedJSON(manifestPath); } catch (_) {
    throw new BsonLiteError("BSONLITE_NATIVE_BUILD_REQUIRED", "This preview requires the BsonLite encrypted engine. Build it using the Windows native workflow. The original MongoDB engine cannot provide native encryption; no plaintext database was started.");
  }
  if (!manifest || manifest.version !== 1 || manifest.cipher !== CIPHER || manifest.platform !== process.platform ||
      manifest.arch !== process.arch || manifest.engineVersion !== "4.0.28" || !/^[a-f0-9]{64}$/.test(manifest.engineSha256) ||
      digest(binary) !== manifest.engineSha256 || manifest.libsodiumVersion !== "1.0.22") {
    throw new BsonLiteError("BSONLITE_NATIVE_ENGINE_INVALID", "The encrypted-engine manifest does not match this engine, OS, architecture or cipher version.");
  }
  let probe = binary, argumentsForProbe = ["--bsonlite-native-self-test"], extension;
  if (manifest.mode === "extension-prototype" && options.storageEncryption === "native-prototype" && process.platform === "linux") {
    function asset(name, expected) {
      if (typeof name !== "string" || path.basename(name) !== name || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Unsafe asset");
      const file = path.join(path.dirname(manifestPath),name);
      if (fs.lstatSync(file).isSymbolicLink() || digest(file) !== expected) throw new Error("Asset checksum mismatch");
      return file;
    }
    try { extension=asset(manifest.extension,manifest.extensionSha256); probe=asset(manifest.probe,manifest.probeSha256); } catch (_) {
      throw new BsonLiteError("BSONLITE_NATIVE_ENGINE_INVALID", "A prototype encryption component failed its checksum.");
    }
    argumentsForProbe = [];
  } else if (manifest.mode !== "builtin" || manifest.temporaryFiles !== true || manifest.engineManagedDumps !== false) {
    throw new BsonLiteError("BSONLITE_NATIVE_BUILD_REQUIRED", "Full native encryption requires the rebuilt engine with encrypted temporary files and disabled engine memory dumps. A Linux extension prototype cannot be substituted.");
  }
  const protocol=manifest.selfTestProtocol||"json-v1";
  if(!["json-v1","win32-exit-code-v1"].includes(protocol) ||
    (protocol==="win32-exit-code-v1" && (process.platform!=="win32" || manifest.mode!=="builtin" ||
      manifest.upstreamCommit!=="af1a9dc12adcfa83cc19571cb3faba26eeddac92" || !/^[a-f0-9]{64}$/.test(manifest.patchSha256) ||
      manifest.staticCRuntime!==true || manifest.tlsProvider!=="Windows SChannel" ||
      manifest.windowsCodePage!=="UTF-8" || manifest.minimumWindowsBuild!==18362))) {
    throw new BsonLiteError("BSONLITE_NATIVE_ENGINE_INVALID", "The native self-test protocol does not match the pinned engine profile.");
  }
  let result;
  try {
    const output=(await exec(probe,argumentsForProbe,{windowsHide:true,timeout:15000,maxBuffer:65536})).stdout.trim();
    // execFile rejects nonzero status. The pinned Windows quickExit path
    // deliberately bypasses CRT flushing after the real cipher test returns.
    if(protocol==="win32-exit-code-v1") {
      if(output)throw new Error("Unexpected output for the pinned Windows self-test protocol");
    } else result=JSON.parse(output);
  }
  catch (_) { throw new BsonLiteError("BSONLITE_NATIVE_SELF_TEST", "The native encryption self-test did not pass. No plaintext fallback was started."); }
  if (protocol==="json-v1" && (!result || result.bsonliteNativeEncryption !== 1 || result.cipher !== CIPHER || result.selfTest !== true ||
      (!extension && (result.temporaryFiles !== true || result.libsodium !== "1.0.22")))) {
    throw new BsonLiteError("BSONLITE_NATIVE_SELF_TEST", "The native engine returned incompatible encryption capabilities.");
  }
  return Object.freeze({ extension, coverage:extension ? "wiredtiger-prototype" : "full" });
}
function engineConfig(native, metadata) {
  if (!validNative(metadata)) throw new BsonLiteError("BSONLITE_METADATA", "Invalid native encryption metadata.");
  let config="encryption=(name=" + ENCRYPTOR + ",keyid=" + metadata.keyId + ")";
  if (native.extension) {
    if (/["\\\x00-\x1f]/.test(native.extension)) throw new BsonLiteError("BSONLITE_UNSAFE_PATH", "Unsupported extension path.");
    config += ',extensions=["' + native.extension + '"]';
  }
  return config;
}
async function verifyNative(client, directory, native, metadata, config) {
  const command=await client.db("admin").command({getCmdLineOpts:1});
  const actual=command.parsed?.storage?.wiredTiger?.engineConfig?.configString;
  if (actual !== config) throw new BsonLiteError("BSONLITE_NATIVE_VERIFY", "MongoDB did not report the expected encrypted storage configuration.");
  // A fresh store can have only empty table headers until its first checkpoint.
  await client.db("admin").command({fsync:1});
  const files=[path.join(directory,"data","WiredTiger.wt"),...fs.readdirSync(path.join(directory,"data")).filter(n=>/^collection-.*\.wt$/.test(n)).slice(0,8).map(n=>path.join(directory,"data",n))];
  let observed=false;
  for(const file of files) {
    if (!fs.existsSync(file)) continue;
    const fd=fs.openSync(file,"r");
    try { const bytes=Buffer.alloc(Math.min(fs.fstatSync(fd).size,2*1024*1024));fs.readSync(fd,bytes,0,bytes.length,0);if(bytes.includes(DATA_MAGIC))observed=true; }
    finally {fs.closeSync(fd);}
  }
  if (!observed) throw new BsonLiteError("BSONLITE_NATIVE_VERIFY", "Encrypted WiredTiger blocks were not observed. Startup stopped without accepting plaintext storage.");
  const full=native.coverage === "full";
  return Object.freeze({policy:full?"native":"native-prototype",required:true,verified:full,
    method:"wiredtiger-native",algorithm:CIPHER,coverage:native.coverage,
    wiredTigerBlocksObserved:true,temporaryFiles:full,processLogs:"aes-256-gcm",
    ...(full?{engineManagedDumps:false}:{}),
    ...(full?{}:{reason:"prototype-does-not-protect-mongodb-temporary-files"})});
}
function createEncryptedLog(file, auth) {
  if(!validDataKey(auth))throw new BsonLiteError("BSONLITE_DATA_KEY_MISSING","Missing log encryption key.");
  if(fs.existsSync(file)){fs.rmSync(file+".previous",{force:true});fs.renameSync(file,file+".previous");}
  const salt=crypto.randomBytes(32),header=Buffer.concat([LOG_MAGIC,salt,Buffer.from(auth.dataKeyId,"hex")]);
  const raw=Buffer.from(auth.dataKey,"hex");
  const key=Buffer.from(crypto.hkdfSync("sha256",raw,salt,Buffer.from("BsonLite/log/v1"),32));raw.fill(0);
  const fd=fs.openSync(file,"wx",0o600);fs.writeSync(fd,header);
  let sequence=0,closed=false,total=header.length;
  return {
    write(bytes,source=1){
      if(closed)return;
      // Logs are bounded; database durability never relies on this diagnostic stream.
      if(total>10*1024*1024||sequence>=0xffffffff)return;
      for(let offset=0;offset<bytes.length;offset+=65536){
        const block=bytes.subarray(offset,offset+65536),iv=Buffer.alloc(12);iv.writeUInt32BE(sequence++,8);
        const clear=Buffer.concat([Buffer.from([source]),block]),size=Buffer.alloc(4);size.writeUInt32BE(clear.length);
        const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.concat([header,iv,size]));
        const encrypted=Buffer.concat([size,cipher.update(clear),cipher.final(),cipher.getAuthTag()]);
        clear.fill(0);fs.writeSync(fd,encrypted);total+=encrypted.length;
      }
    },
    close(){if(!closed){closed=true;try{fs.closeSync(fd);}finally{key.fill(0);}}}
  };
}
function decryptLog(file,auth){
  if(!validDataKey(auth))throw new BsonLiteError("BSONLITE_DATA_KEY_MISSING","Missing log key.");
  const data=fs.readFileSync(file);if(data.length<56||!data.subarray(0,8).equals(LOG_MAGIC)||data.subarray(40,56).toString("hex")!==auth.dataKeyId)throw new Error("Invalid encrypted log");
  const raw=Buffer.from(auth.dataKey,"hex"),key=Buffer.from(crypto.hkdfSync("sha256",raw,data.subarray(8,40),Buffer.from("BsonLite/log/v1"),32));raw.fill(0);
  const chunks=[];let pos=56,sequence=0;
  try{while(pos<data.length){if(pos+4>data.length)throw new Error("Truncated log record");const size=data.readUInt32BE(pos);if(size<1||size>65537||pos+4+size+16>data.length)throw new Error("Invalid log record");
    const iv=Buffer.alloc(12);iv.writeUInt32BE(sequence++,8);const d=crypto.createDecipheriv("aes-256-gcm",key,iv);d.setAAD(Buffer.concat([data.subarray(0,56),iv,data.subarray(pos,pos+4)]));d.setAuthTag(data.subarray(pos+4+size,pos+4+size+16));chunks.push(Buffer.concat([d.update(data.subarray(pos+4,pos+4+size)),d.final()]).subarray(1));pos+=4+size+16;}
    return Buffer.concat(chunks).toString("utf8");
  }finally{key.fill(0);}
}
module.exports={CIPHER,nativePolicy,validNative,validDataKey,keyFrame,resolveNative,engineConfig,verifyNative,createEncryptedLog,decryptLog};
