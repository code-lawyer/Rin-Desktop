import { readFile, mkdir, rename, stat, symlink, access, unlink, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fillMissingAssets } from './resource-assets.mjs';
import { inspectMotionAssets } from './motion-assets.mjs';
const root=resolve(import.meta.dirname,'../..');
if(process.argv.includes('--help')){
  console.log('Usage: npm run resources -- [--installer=<local-setup.exe>]\nRestore locked runtime/artwork files. An explicit installer is hash-checked and used without downloading; existing assets are preserved.');
  process.exit(0);
}
const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!arg.startsWith('--installer=')||!arg.slice(12)))throw new Error('Use --installer=<local-setup.exe> or --help.');
const localInstaller=args.length?resolve(args[0].slice(12)):null;
if(process.platform!=='win32')throw new Error('Runtime resources are for Windows x64. Unit tests do not need these resources.');
const manifest=JSON.parse(await readFile(join(root,'tools/release/resource-manifest.json'),'utf8'));
const cache=join(root,'work/resource-downloads',manifest.version), target=join(root,'work/release-resources',manifest.version);
await mkdir(cache,{recursive:true});await mkdir(target,{recursive:true});
async function valid(file,entry){try{if((await stat(file)).size!==entry.bytes)return false;const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')===entry.sha256;}catch{return false;}}
for(const entry of manifest.files){
  if(!/^[a-zA-Z0-9._-]+$/.test(entry.file)||!entry.url.startsWith(`https://github.com/${manifest.repository}/releases/download/`))throw new Error('Invalid locked resource');
  if(localInstaller&&!await valid(localInstaller,entry))throw new Error('The local installer does not match the locked size and SHA-256.');
  const file=join(cache,entry.file);if(await valid(file,entry))continue;
  if(localInstaller)await copyFile(localInstaller,file+'.partial');
  else {
    console.log(`Downloading ${entry.file}`);
    execFileSync('curl.exe',['-fL','--retry','3','--output',file+'.partial',entry.url],{windowsHide:true,stdio:'inherit'});
  }
  if(!await valid(file+'.partial',entry))throw new Error(`Integrity check failed: ${entry.file}`);
  await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await rename(file+'.partial',file);
}
const installer=manifest.files.find(file=>file.file.endsWith('.exe'));
execFileSync(join(cache,installer.file),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/PORTABLE=1','/TASKS=',`/DIR=${target}`],{windowsHide:true,stdio:'inherit'});
for(const name of ['runtime','vendor']) {
  const dest=join(root,'prototypes/live2d-codex',name);
  try { await access(dest); } catch(error) { if(error.code!=='ENOENT')throw error; await symlink(join(target,'resources/app',name),dest,'junction'); }
}
const assets=join(root,'prototypes/live2d-codex/assets');
console.log(JSON.stringify(await fillMissingAssets(join(target,'resources/app/assets'),assets)));
await inspectMotionAssets(join(assets,'motion/female'));
console.log(`Resources ready. Set VIBE_RESOURCE_APP=${join(target,'resources/app')} before packaging.`);
