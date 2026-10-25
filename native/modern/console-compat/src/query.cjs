'use strict';
const acorn = require('acorn');
const { BSON, ObjectId } = require('mongodb');
const { EJSON } = BSON;
const READ = new Set(['find','findOne','countDocuments','estimatedDocumentCount','distinct','aggregate','indexes']);
const WRITE = new Set(['insertOne','insertMany','updateOne','updateMany','replaceOne','deleteOne','deleteMany','findOneAndUpdate','findOneAndReplace','findOneAndDelete','bulkWrite','createIndex','dropIndex','drop']);
const MODIFIERS = new Set(['sort','limit','skip','project','toArray']);
const SAFE_COMMANDS = new Set(['ping','dbStats','collStats','count','distinct','listCollections','listIndexes','buildInfo','explain']);
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
function fail(message) { throw new Error(message); }
function literal(n, depth=0) {
  if (depth>40) fail('Query is too deeply nested.');
  if (n.type==='Literal') { if(n.regex) return new RegExp(n.regex.pattern,n.regex.flags); if(n.bigint) fail('Use NumberLong("123") for 64-bit integers.'); return n.value; }
  if (n.type==='UnaryExpression' && ['-','+'].includes(n.operator)) { const value=literal(n.argument,depth+1); if(typeof value!=='number') fail('Expected a number.'); return n.operator==='-' ? -value : value; }
  if (n.type==='ArrayExpression') return n.elements.map(x=>x ? literal(x,depth+1) : fail('Array holes are not supported.'));
  if (n.type==='ObjectExpression') { const out={}; for(const p of n.properties){if(p.type!=='Property'||p.computed||p.method||p.shorthand||p.kind!=='init') fail('Use plain query objects.'); const key=p.key.name ?? p.key.value; if(FORBIDDEN.has(String(key))) fail('Unsafe object key.'); Object.defineProperty(out,key,{value:literal(p.value,depth+1),enumerable:true,writable:true,configurable:true});} return out; }
  if (['CallExpression','NewExpression'].includes(n.type) && n.callee.type==='Identifier') {
    const a=n.arguments.map(x=>literal(x,depth+1));
    const factories={ObjectId:(v)=>v===undefined?new ObjectId():new ObjectId(v),ISODate:(v)=>new Date(v===undefined?Date.now():v),Date:(v)=>new Date(v===undefined?Date.now():v),NumberLong:(v)=>BSON.Long.fromString(String(v)),NumberInt:(v)=>new BSON.Int32(Number(v)),NumberDecimal:(v)=>BSON.Decimal128.fromString(String(v)),UUID:(v)=>v===undefined?new BSON.UUID():new BSON.UUID(v),BinData:(type,v)=>BSON.Binary.createFromBase64(v,type)};
    if(Object.hasOwn(factories,n.callee.name)) return factories[n.callee.name](...a);
  }
  fail('Only database expressions, literal values and BSON constructors are supported.');
}
function property(n) { if(n.type!=='MemberExpression'||n.optional) fail('Expected a database operation.'); const key=n.computed?literal(n.property):n.property.name; if(typeof key!=='string'||FORBIDDEN.has(key)) fail('Invalid property.'); return key; }
function parseQuery(input,database) {
  if(typeof input!=='string'||input.length>1024*1024) fail('Query must be text under 1 MB.');
  const text=input.trim().replace(/;\s*$/,'');
  if(/^show\s+dbs$/i.test(text)) return {type:'databases'};
  if(/^show\s+collections$/i.test(text)) return {type:'collections',database};
  const use=/^use\s+([^\s;]+)$/.exec(text); if(use) return {type:'use',database:use[1]};
  if(text==='help') return {type:'help'};
  const ast=acorn.parse(text,{ecmaVersion:2022});
  if(ast.body.length!==1||ast.body[0].type!=='ExpressionStatement') fail('Run one database expression at a time.');
  let n=ast.body[0].expression, calls=[];
  while(n.type==='CallExpression') { if(n.optional) fail('Optional calls are not supported.'); const name=property(n.callee); calls.unshift({name,args:n.arguments.map(x=>literal(x))}); n=n.callee.object; }
  let collection;
  if(n.type==='MemberExpression') { collection=property(n); n=n.object; }
  if(n.type!=='Identifier'||n.name!=='db') fail('Start with db.collectionName or db.getCollection("name").');
  if(calls[0]?.name==='getSiblingDB') database=calls.shift().args[0];
  if(calls[0]?.name==='getCollection') { if(collection) fail('Invalid collection expression.'); collection=calls.shift().args[0]; }
  if(!calls.length) fail('Choose an operation, for example db.users.find({}).limit(50).');
  const operation=calls.shift();
  if(!collection) {
    if(calls.length) fail('Database operations cannot be chained.');
    if(operation.name==='getCollectionNames') return {type:'collectionNames',database};
    if(operation.name==='getCollectionInfos') return {type:'collections',database};
    if(operation.name==='createCollection') return {type:'createCollection',database,args:operation.args};
    if(operation.name==='runCommand') return {type:'command',database,args:operation.args};
    fail('Use show collections, db.createCollection("name") or db.runCommand({...}).');
  }
  return {type:'query',database,collection,method:operation.name,args:operation.args,modifiers:calls};
}
function validatePlan(plan,{readOnly=true,allowCommands=true}={}) {
  if(!plan||typeof plan!=='object'||!['databases','collections','collectionNames','use','help','createCollection','command','query'].includes(plan.type)) fail('Invalid operation.');
  if(!['databases','help'].includes(plan.type)&&(typeof plan.database!=='string'||!plan.database||/[\0/\\.$" ]/.test(plan.database)||Buffer.byteLength(plan.database)>63)) fail('Choose a valid database name.');
  let writes=false;
  function inspect(v,depth=0) { if(depth>45) fail('Query is too deeply nested.'); if(!v||typeof v!=='object'||v._bsontype||v instanceof Date||v instanceof RegExp)return; for(const [k,x] of Object.entries(v)){ if(FORBIDDEN.has(k)||['$where','$function','$accumulator'].includes(k)) fail('Server-side JavaScript and unsafe keys are disabled.'); if(k==='$out'||k==='$merge') writes=true; inspect(x,depth+1); } }
  if(plan.type==='query') {
    if(typeof plan.collection!=='string'||!plan.collection||plan.collection.includes('\0')||plan.collection.length>240) fail('Invalid collection name.');
    if(!READ.has(plan.method)&&!WRITE.has(plan.method)) fail('Unsupported operation: '+plan.method);
    writes=WRITE.has(plan.method);
    if(!Array.isArray(plan.args)||plan.args.length>3) fail('Invalid operation arguments.');
    if(!Array.isArray(plan.modifiers)||plan.modifiers.length>8) fail('Invalid cursor options.');
    for(const m of plan.modifiers) { if(!MODIFIERS.has(m.name)||!Array.isArray(m.args)) fail('Unsupported cursor modifier.'); if(!['find','aggregate'].includes(plan.method)) fail('Cursor modifiers require find or aggregate.'); if(m.name==='toArray'&&m.args.length) fail('toArray does not take arguments.'); if(['limit','skip'].includes(m.name)&&(!Number.isSafeInteger(m.args[0])||m.args[0]<0||m.args[0]>(m.name==='limit'?1000:1000000))) fail('Limit must be 0–1000; skip must be 0–1000000.'); }
    // Never permit server-side JavaScript. It is not needed for standard queries.
    inspect(plan.args);
    inspect(plan.modifiers);
    if(plan.args[2]?.upsert) writes=true;
  }
  if(plan.type==='createCollection') { writes=true; if(!Array.isArray(plan.args)||typeof plan.args[0]!=='string'||!plan.args[0]||plan.args[0].includes('\0')||plan.args.length>2) fail('Specify a collection name.'); }
  if(plan.type==='command') { if(!allowCommands) fail('This connection does not expose database commands. Use a collection operation.'); const c=plan.args?.[0]; if(!c||typeof c!=='object'||!SAFE_COMMANDS.has(Object.keys(c)[0])||Object.keys(c).some(k=>FORBIDDEN.has(k))) fail('Only documented read database commands are supported.'); if(Object.keys(c)[0]==='explain') { const command=c.explain; if(!command||!['find','count','distinct'].includes(Object.keys(command)[0])) fail('Explain supports read find/count/distinct commands only.'); } }
  inspect(plan.args);
  if(readOnly&&writes) fail('Read-only connection. Enable writes in Connection options first.');
  return {writes};
}
function json(value,space=2) { return EJSON.stringify(value,null,space,{relaxed:false}); }
function fromJSON(text) {
  const value=EJSON.parse(text,{relaxed:false});
  function normalize(v){if(v?._bsontype==='Int32'||v?._bsontype==='Double')return v.valueOf();if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==='object'&&!v._bsontype&&!(v instanceof Date)&&!(v instanceof RegExp)){for(const key of Object.keys(v)){if(FORBIDDEN.has(key))fail('Unsafe object key.');v[key]=normalize(v[key]);}}return v;}
  return normalize(value);
}
module.exports={parseQuery,validatePlan,json,fromJSON,READ,WRITE,HELP:'show dbs\nuse myapp\nshow collections\ndb.users.find({}).sort({createdAt:-1}).limit(50)\ndb.users.findOne({_id:ObjectId("...")})\ndb.users.insertOne({name:"Atik"})\ndb.users.updateOne({name:"Atik"},{$set:{active:true}})\ndb.users.deleteOne({_id:ObjectId("...")})\ndb.users.aggregate([{$match:{active:true}},{$limit:50}])\ndb.users.createIndex({email:1},{unique:true})\n\nOne expression per run. Results are capped at 1000 documents. This is a database console, not a Node.js/JavaScript shell.'};
