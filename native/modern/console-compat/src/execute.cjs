'use strict';
const { validatePlan } = require('./query.cjs');
const { BSON } = require('mongodb');
const TIMEOUT=10000, MAX=1000;
async function executePlan(getDb,plan,policy={}) {
  validatePlan(plan,policy);
  const db=getDb(plan.database);
  if(plan.type==='collections'||plan.type==='collectionNames') { const value=await db.listCollections({}, {nameOnly:true,maxTimeMS:TIMEOUT}).toArray(); return {value:plan.type==='collectionNames'?value.map(x=>x.name):value,truncated:false}; }
  if(plan.type==='createCollection') { await db.createCollection(plan.args[0],{...(plan.args[1]||{}),maxTimeMS:TIMEOUT}); return {value:{created:plan.args[0]},truncated:false}; }
  if(plan.type==='command') return {value:await db.command({...plan.args[0],maxTimeMS:TIMEOUT}),truncated:false};
  if(plan.type!=='query') throw new Error('This operation is handled by the connection.');
  const c=db.collection(plan.collection),a=plan.args;
  if(plan.method==='find'||plan.method==='aggregate') {
    let cursor=plan.method==='find'?c.find(a[0]||{}, {...(a[1]||{}),maxTimeMS:TIMEOUT}):c.aggregate(a[0]||[],{...(a[1]||{}),maxTimeMS:TIMEOUT});
    let limit=50;
    for(const m of plan.modifiers){if(m.name==='limit')limit=m.args[0]||MAX;else if(m.name!=='toArray')cursor=cursor[m.name](...m.args);}
    const bound=Math.min(limit,MAX); const data=[];let bytes=0;
    // Iterate with a client-side cap as a second bound (also for pipelines).
    cursor=cursor.limit(bound+1);
    try { for await(const doc of cursor){bytes+=BSON.calculateObjectSize(doc);if(bytes>8*1024*1024)throw new Error('Result exceeds 8 MB. Use a smaller limit or a projection.');data.push(doc);if(data.length>bound)break;} } finally { await cursor.close(); }
    return {value:data.slice(0,bound),truncated:data.length>bound};
  }
  let value;
  switch(plan.method) {
    case 'indexes': value=await c.indexes({maxTimeMS:TIMEOUT});break;
    case 'findOne': value=await c.findOne(a[0]||{},{...(a[1]||{}),maxTimeMS:TIMEOUT});break;
    case 'countDocuments': value=await c.countDocuments(a[0]||{},{...(a[1]||{}),maxTimeMS:TIMEOUT});break;
    case 'estimatedDocumentCount': value=await c.estimatedDocumentCount({...a[0],maxTimeMS:TIMEOUT});break;
    case 'distinct': value=await c.distinct(a[0],a[1]||{},{...a[2],maxTimeMS:TIMEOUT});break;
    case 'drop': value=await c.drop({maxTimeMS:TIMEOUT});break;
    case 'insertOne': case 'insertMany': case 'bulkWrite': case 'dropIndex': case 'createIndex': case 'deleteOne': case 'deleteMany': case 'findOneAndDelete': value=await c[plan.method](a[0],{...a[1],maxTimeMS:TIMEOUT});break;
    default: value=await c[plan.method](a[0],a[1],{...a[2],maxTimeMS:TIMEOUT});
  }
  return {value,truncated:false};
}
module.exports={executePlan,TIMEOUT,MAX};
