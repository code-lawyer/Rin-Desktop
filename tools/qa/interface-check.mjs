// Real renderer/layout checks with a synthetic preload. No Agent or hardware.
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const output=join(root,'work/qa/interface-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),[join(import.meta.dirname,'interface-fixture.cjs'),output],{env,windowsHide:true,stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
if(code!==0)throw new Error('Renderer verification failed: '+code);
console.log(JSON.stringify({output,accounts:false,hardware:false}));
