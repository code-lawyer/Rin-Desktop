import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createRunDirectory } from './run-output.mjs';
import { electronEnvironment } from '../project/start.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h') || !process.argv.includes('--run')) {
  console.log('Usage: npm run qa:still-scene -- --run\nCheck five fixed-scene preview frames and invariant furniture regions. Default: help only, no files or processes.');
} else {
  const root=resolve(import.meta.dirname,'../..'),output=await createRunDirectory('still-scene');
  const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),[join(import.meta.dirname,'still-scene-fixture.cjs'),output],{env:electronEnvironment(),windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  console.log(JSON.stringify({output,code,accounts:false,hardware:false}));if(code!==0)process.exitCode=1;
}
