#!/usr/bin/env node
'use strict';
const readline=require('node:readline/promises');
const {Connection,safeError}=require('../src/connection.cjs');
const {HELP}=require('../src/query.cjs');
const {discoverConnections}=require('../src/discovery.cjs');
async function main(){
  const args=process.argv.slice(2),connection=new Connection();
  const flags=new Set(['--uri','--database','--ca','--cert','--eval','--write','--help','-h','--version']);
  const values={};
  for(let i=0;i<args.length;i++){const key=args[i];if(!flags.has(key))throw new Error('Unknown option: '+key);if(['--write','--help','-h','--version'].includes(key))values[key]=true;else{if(i+1>=args.length||args[i+1].startsWith('--'))throw new Error('Missing value for '+key);values[key]=args[++i];}}
  if(values['--version']){console.log(require('../package.json').version);return;}
  if(values['--help']||values['-h']){console.log('BsonLite Console\n\n  bsonlite --uri "CONNECTION_URL"\n  bsonlite --uri "CONNECTION_URL" --write --eval "db.users.find({})"\n  bsonlite --ca ca.pem --cert client.pem\n\nOptions: --database NAME, --ca PATH, --cert PATH, --write, --eval QUERY\nBSONLITE_URI environment variable also accepted. Default: read-only.\nNo flags: automatically find running BsonLite databases, or prompt for a direct URL.\n\n'+HELP);return;}
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  let uri=values['--uri']||process.env.BSONLITE_URI;
  if(!uri){const local=await discoverConnections();if(local.length===1){uri=local[0].uri;if(!values['--eval'])console.log('Found running BsonLite database: '+local[0].name);}else if(local.length>1){console.log('Running BsonLite databases:');local.forEach((x,i)=>console.log(`  ${i+1}. ${x.name} (${x.appName})`));const answer=await rl.question('Choose database [1], or paste a connection URL: ');const index=answer.trim()?Number(answer)-1:0;uri=Number.isInteger(index)&&local[index]?local[index].uri:answer;}else{console.log('No running BsonLite app found. Start your app with the updated SDK, or enter a server URL.');uri=await rl.question('Connection URL: ');}}
  try{
    const info=await connection.connect({uri,database:values['--database'],tlsCAFile:values['--ca'],tlsCertificateKeyFile:values['--cert'],readOnly:!values['--write']});
    if(values['--eval']){console.log((await connection.run(values['--eval'])).text);return;}
    console.log(`\nBsonLite Console · ${info.database} · ${info.readOnly?'read-only':'writes enabled'}\nType help for examples, exit to disconnect.\n`);
    while(true){let input;try{input=await rl.question(connection.database+'> ');}catch{break;}if(['exit','quit','.exit'].includes(input.trim()))break;if(!input.trim())continue;try{const result=await connection.run(input);console.log(result.text);console.log(`${result.milliseconds} ms${result.truncated?' · result capped':''}\n`);}catch(e){console.error(safeError(e));}}
  }finally{await connection.disconnect();rl.close();}
}
main().catch(e=>{console.error(safeError(e));process.exitCode=1;});
