'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {discoveryDirectory}=require('./discovery-path.cjs');
const {bridgeURL}=require('./connection.cjs');
const {fromJSON}=require('./query.cjs');
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
function privateStat(s,directory){return !s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile())&&(process.platform==='win32'||(s.uid===process.getuid()&&(s.mode&0o077)===0));}
async function discoverConnections({directory=discoveryDirectory(),probe=true}={}){
  let entries;try{const s=await fs.lstat(directory);if(!privateStat(s,true))return[];entries=await fs.readdir(directory);}catch{return[];}
  const found=[];
  // Read only BsonLite's private registry. Never scan projects or network ports.
  const names=entries.filter(x=>/^[a-f0-9]{32}\.json$/.test(x)).slice(0,128);
  for(let offset=0;offset<names.length;offset+=8){await Promise.allSettled(names.slice(offset,offset+8).map(async name=>{
    try{
      const file=path.join(directory,name),s=await fs.lstat(file);if(!privateStat(s,false)||s.size>16384)return;
      const record=JSON.parse(await fs.readFile(file,'utf8'));
      if(record.format!=='bsonlite-console/1'||record.id!==name.slice(0,-5)||typeof record.database!=='string'||!record.database||Buffer.byteLength(record.database)>63||typeof record.appName!=='string'||record.appName.length>120||!alive(record.pid))return;
      const updated=Date.parse(record.updatedAt);if(!Number.isFinite(updated)||Date.now()-updated>90000||updated>Date.now()+30000)return;
      const u=bridgeURL(record.uri);if(decodeURIComponent(u.pathname.slice(1))!==record.database)return;
      if(probe){const response=await fetch('http://127.0.0.1:'+u.port+'/info',{headers:{Authorization:'Bearer '+u.hash.slice(1)},redirect:'error',signal:AbortSignal.timeout(800)});if(!response.ok)return;const text=await response.text();if(text.length>8192)return;const info=fromJSON(text);if(info.protocol!==1||info.name!==record.database)return;}
      found.push({id:record.id,name:record.database,database:record.database,appName:record.appName,pid:record.pid,uri:record.uri,startedAt:record.startedAt});
    }catch{}
  }));}
  return found.sort((a,b)=>a.name.localeCompare(b.name)||a.appName.localeCompare(b.appName)||a.pid-b.pid);
}
module.exports={discoverConnections};
