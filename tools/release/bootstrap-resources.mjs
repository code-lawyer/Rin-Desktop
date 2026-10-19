import { readFile, mkdir, rename, stat, symlink, access, unlink, readdir, cp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
if(process.platform!=='win32')throw new Error('Runtime resources are for Windows x64. Unit tests do not need these resources.');
const manifest=JSON.parse(await readFile(join(root,'tools/release/resource-manifest.json'),'utf8'));
const cache=join(root,'work/resource-downloads',manifest.version), target=join(root,'work/release-resources',manifest.version);
await mkdir(cache,{recursive:true});await mkdir(target,{recursive:true});
async function valid(file,entry){try{if((await stat(file)).size!==entry.bytes)return false;const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')===entry.sha256;}catch{return false;}}
for(const entry of manifest.files){
  if(!/^[a-zA-Z0-9._-]+$/.test(entry.file)||!entry.url.startsWith(`https://github.com/${manifest.repository}/releases/download/`))throw new Error('Invalid locked resource');
  const file=join(cache,entry.file);if(await valid(file,entry))continue;
  console.log(`Downloading ${entry.file}`);
  execFileSync('curl.exe',['-fL','--retry','3','--output',file+'.partial',entry.url],{windowsHide:true,stdio:'inherit'});
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
// New character assets are tracked in source. Fill missing legacy assets
// individually instead of skipping the entire, now pre-existing assets folder.
const assets=join(root,'prototypes/live2d-codex/assets');await mkdir(assets,{recursive:true});
for(const entry of await readdir(join(target,'resources/app/assets'),{withFileTypes:true})) {
  const source=join(target,'resources/app/assets',entry.name),dest=join(assets,entry.name);
  try {await access(dest);continue;} catch(error) {if(error.code!=='ENOENT')throw error;}
  if(entry.isDirectory())await symlink(source,dest,'junction');else await cp(source,dest);
}
console.log(`Resources ready. Set VIBE_RESOURCE_APP=${join(target,'resources/app')} before packaging.`);
