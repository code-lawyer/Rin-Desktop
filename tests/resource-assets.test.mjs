import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillMissingAssets } from '../tools/release/resource-assets.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'rin-resource-assets-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source'),destination=join(root,'destination');
  await mkdir(source);await mkdir(destination);
  return{root,source,destination};
}
test('restore fills nested missing media while preserving checked-in and custom assets',async t=>{
  const {source,destination}=await fixture(t);
  for(const base of [source,destination])await mkdir(join(base,'motion/female'),{recursive:true});
  await writeFile(join(source,'motion/female/manifest.json'),'packaged');
  await writeFile(join(source,'motion/female/work-loop.mp4'),'media');
  await writeFile(join(destination,'motion/female/manifest.json'),'checkout');
  await writeFile(join(destination,'custom.png'),'custom');
  assert.deepEqual(await fillMissingAssets(source,destination),{copied:1,preserved:1,skippedLinks:0});
  assert.equal(await readFile(join(destination,'motion/female/work-loop.mp4'),'utf8'),'media');
  assert.equal(await readFile(join(destination,'motion/female/manifest.json'),'utf8'),'checkout');
  assert.equal(await readFile(join(destination,'custom.png'),'utf8'),'custom');
  assert.equal((await fillMissingAssets(source,destination)).copied,0);
});
test('restore never writes through a pre-existing directory junction',async t=>{
  const {root,source,destination}=await fixture(t),outside=join(root,'outside');
  await mkdir(outside);await mkdir(join(source,'linked'));
  await writeFile(join(source,'linked/new.png'),'not outside');
  await symlink(outside,join(destination,'linked'),process.platform==='win32'?'junction':'dir');
  assert.equal((await fillMissingAssets(source,destination)).skippedLinks,1);
  await assert.rejects(access(join(outside,'new.png')),{code:'ENOENT'});
});
test('restore rejects linked archive directories instead of copying unrelated content',async t=>{
  const {root,source,destination}=await fixture(t),outside=join(root,'outside');
  await mkdir(outside);await writeFile(join(outside,'private.txt'),'private');
  await symlink(outside,join(source,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(fillMissingAssets(source,destination),/ordinary files/);
  await assert.rejects(access(join(destination,'linked')),{code:'ENOENT'});
});
