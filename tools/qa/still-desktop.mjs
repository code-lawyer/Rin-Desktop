import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run qa:stills -- [--pose-recovery]\nChecks the static wallpaper in isolated Electron windows. --pose-recovery: verify status recovery after one failed pose and a different successful pose. --help: help only, no files or processes.');
  process.exit(0);
}
const root=resolve(import.meta.dirname,'../..'),output=join(root,'work/qa/still-desktop-'+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const args=[join(import.meta.dirname,'still-fixture.cjs'),output];
if(process.argv.includes('--pose-recovery'))args.push('--pose-recovery');
const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),args,{env,windowsHide:true,stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
if(code!==0)throw new Error('Static wallpaper integration verification failed: '+code);
console.log(JSON.stringify({output,accounts:false,hardware:false}));
