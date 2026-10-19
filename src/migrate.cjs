"use strict";
const fs=require("node:fs"),path=require("node:path");
const {readMetadata}=require("./store.cjs");
const {atomicWrite}=require("./util.cjs");
const {nativePolicy}=require("./native-storage.cjs");
const {BsonLiteError}=require("./errors.cjs");
const {BSON}=require("mongodb");
function inside(parent,child){const r=path.relative(parent,child);return !r||(!r.startsWith(".."+path.sep)&&!path.isAbsolute(r));}
function indexForCreate(index){
  const {v,ns,key,storageEngine,...options}=index;
  const cleanKey={};
  for(const [field,value]of Object.entries(key)){
    if(field==="_fts")for(const name of Object.keys(index.weights||{}))cleanKey[name]="text";
    else if(field!=="_ftsx")cleanKey[field]=value;
  }
  return {key:cleanKey,...options};
}
async function migrate(input,open){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new BsonLiteError("BSONLITE_INVALID_OPTIONS","migrate() requires sourceDirectory and a new directory.");
  const allowed=new Set(["sourceDirectory","directory","binaryPath","nativeManifest","vaultPassword","storageEncryption","sourceStorageEncryption"]);
  for(const key of Object.keys(input))if(!allowed.has(key))throw new BsonLiteError("BSONLITE_INVALID_OPTIONS","Unknown migration option: "+key);
  if(typeof input.sourceDirectory!=="string"||typeof input.directory!=="string")throw new BsonLiteError("BSONLITE_INVALID_OPTIONS","Specify sourceDirectory and a new destination directory.");
  const sourceDirectory=path.resolve(input.sourceDirectory),directory=path.resolve(input.directory);
  if(inside(sourceDirectory,directory)||inside(directory,sourceDirectory)||fs.existsSync(directory))throw new BsonLiteError("BSONLITE_MIGRATION_DESTINATION","Migration needs a new directory outside the original database. Nothing was overwritten.");
  const metadata=readMetadata(sourceDirectory);
  if(!metadata||metadata.formatVersion===1||metadata.nativeEncryption)throw new BsonLiteError("BSONLITE_MIGRATION_SCOPE","Direct migration supports non-native BsonLite 0.4/0.5 stores. Export older legacy data first; native stores use encrypted backup/restore.");
  const policy=input.storageEncryption||"native";
  if(!nativePolicy(policy))throw new BsonLiteError("BSONLITE_INVALID_OPTIONS","Migration must target native encryption.");
  const common={name:metadata.databaseName,binaryPath:input.binaryPath,nativeManifest:input.nativeManifest,vaultPassword:input.vaultPassword,silent:true};
  let source,target;const copied=[];
  try{
    source=await open({...common,directory:sourceDirectory,storageEncryption:input.sourceStorageEncryption||(metadata.encryptionRequired?"required":"auto")});
    const collections=await source.listCollections().toArray();
    for(const item of collections)if(!["collection","view"].includes(item.type)||item.name.startsWith("system.")&&item.name!=="system.views")throw new BsonLiteError("BSONLITE_MIGRATION_SCOPE","Unsupported special collection: "+item.name+". The original data was preserved.");
    target=await open({...common,directory,storageEncryption:policy});
    const guard=path.join(directory,"migration.json");
    atomicWrite(guard,JSON.stringify({version:1,state:"in-progress",startedAt:new Date().toISOString()}));
    for(const item of collections.filter(x=>x.type==="collection"&&x.name!=="system.views")){
      const {storageEngine,...settings}=item.options||{};
      // Preserve validators, collation, capped settings and BSON document types.
      await target.createCollection(item.name,settings);
      const from=source.collection(item.name),to=target.collection(item.name);
      let batch=[],batchBytes=0,count=0;
      for await(const document of from.find({}, {promoteValues:false,promoteLongs:false,bsonRegExp:true}).batchSize(64)){
        const size=BSON.calculateObjectSize(document);
        if(batch.length&&(batchBytes+size>4*1024*1024||batch.length===64)){await to.insertMany(batch,{ordered:true});count+=batch.length;batch=[];batchBytes=0;}
        batch.push(document);batchBytes+=size;
      }
      if(batch.length){await to.insertMany(batch,{ordered:true});count+=batch.length;}
      const indexes=(await from.listIndexes().toArray()).filter(x=>x.name!=="_id_").map(indexForCreate);
      if(indexes.length)await to.createIndexes(indexes);
      if(await from.countDocuments({})!==count||await to.countDocuments({})!==count)throw new BsonLiteError("BSONLITE_MIGRATION_VERIFY","Collection counts did not match. The destination remains marked incomplete.");
      copied.push({name:item.name,documents:count,indexes:indexes.length});
    }
    let views=collections.filter(x=>x.type==="view");
    while(views.length){let progress=false;const pending=[];for(const view of views){try{await target.createCollection(view.name,view.options);progress=true;}catch(error){if(error.code===26)pending.push(view);else throw error;}}
      if(!progress)throw new BsonLiteError("BSONLITE_MIGRATION_SCOPE","Dependent views could not be recreated.");views=pending;}
    // The startup guard is bounded public metadata; keep collection names and
    // potentially very large per-collection reports in the returned result.
    atomicWrite(guard,JSON.stringify({version:1,state:"complete",completedAt:new Date().toISOString(),
      collectionCount:copied.length,documentCount:copied.reduce((total,item)=>total+item.documents,0),
      viewCount:collections.filter(item=>item.type==="view").length},null,2));
    return Object.freeze({directory,sourceDirectory,databaseName:metadata.databaseName,collections:copied,originalPreserved:true,security:target.info.security.storageEncryption});
  }finally{
    try{if(target)await target.close();}finally{if(source)await source.close();}
  }
}
module.exports={createMigrator:open=>input=>migrate(input,open),indexForCreate};
