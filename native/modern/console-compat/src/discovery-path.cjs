'use strict';
const path=require('node:path');
const os=require('node:os');
function discoveryDirectory({platform=process.platform,env=process.env,home=os.homedir()}={}){
  const p=platform==='win32'?path.win32:path.posix;
  if(env.BSONLITE_CONSOLE_HOME&&p.isAbsolute(env.BSONLITE_CONSOLE_HOME))return p.resolve(env.BSONLITE_CONSOLE_HOME);
  const base=platform==='win32'?p.join(env.LOCALAPPDATA&&p.isAbsolute(env.LOCALAPPDATA)?env.LOCALAPPDATA:p.join(home,'AppData','Local'),'BsonLite'):platform==='darwin'?p.join(home,'Library','Application Support','BsonLite'):p.join(env.XDG_DATA_HOME&&p.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:p.join(home,'.local','share'),'bsonlite');
  return p.join(base,'console','sessions');
}
module.exports={discoveryDirectory};
