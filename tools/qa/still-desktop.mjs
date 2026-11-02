import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRunDirectory } from './run-output.mjs';
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run qa:stills -- [--pose-recovery | --character-switch] [--output=work/qa/new-run]\nChecks the static wallpaper in isolated Electron windows. --pose-recovery: verify status recovery after one failed pose and a different successful pose. --character-switch: anime/realistic poster failure/retry, cancellation, voices and a fresh-process restore. No accounts or devices. --help: help only, no files or processes.');
  process.exit(0);
}
const flags=process.argv.slice(2), outputs=flags.filter(arg=>arg.startsWith('--output='));
if(flags.some(arg=>!['--pose-recovery','--character-switch'].includes(arg)&&!arg.startsWith('--output=')) || outputs.length>1 || outputs.some(arg=>!arg.slice(9)) || (flags.includes('--pose-recovery')&&flags.includes('--character-switch'))) throw new Error('Use one verification mode and at most one nonempty --output directory.');
const root=resolve(import.meta.dirname,'../..'),output=await createRunDirectory('still-desktop',outputs[0]?.slice(9));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const args=[join(import.meta.dirname,'still-fixture.cjs'),output];
for(const mode of ['--pose-recovery','--character-switch'])if(flags.includes(mode))args.push(mode);
async function run(args) {
  const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),args,{env,windowsHide:true,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error('Static wallpaper integration verification failed: '+code);
}
await run(args);
if(flags.includes('--character-switch')) {
  await run([args[0],output,'--character-restore']);
  const first=JSON.parse(await readFile(join(output,'character-switch.json'),'utf8'));
  const second=JSON.parse(await readFile(join(output,'character-restore.json'),'utf8'));
  await writeFile(join(output,'result.json'),JSON.stringify({checks:[...first.checks,...second.checks],requests:first.requests,errors:[...first.errors,...second.errors],freshProcessRestore:true,accounts:false,hardware:false},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({output,accounts:false,hardware:false}));
