import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createRunDirectory } from './run-output.mjs';
import { electronEnvironment } from '../project/start.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run qa:remote-focus -- [--baseline]\nChecks remote focus in isolated Electron windows. --baseline: reproduce missing focus styles. --help: help only, no files or processes.');
  process.exit(0);
}
const root=resolve(import.meta.dirname,'../..'),output=await createRunDirectory('remote-focus');
const args=[join(import.meta.dirname,'interface-fixture.cjs'),output,'--focus'];
if(process.argv.includes('--baseline'))args.push('--baseline-focus');
const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),args,{env:electronEnvironment(),windowsHide:true,stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
console.log(JSON.stringify({output,code,accounts:false,hardware:false}));if(code!==0)process.exitCode=1;
