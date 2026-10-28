import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectMotionAssets, copyMotionAssets } from '../tools/release/motion-assets.mjs';
import { MOTION_IDS } from '../prototypes/live2d-codex/renderer/motion-catalog.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rin-motion-assets-')); t.after(() => rm(root,{recursive:true,force:true}));
  const source = join(root,'source'), destination = join(root,'package/assets/motion/female');
  await mkdir(source);
  const manifest = {format:1,clips:MOTION_IDS.map(id=>({id,file:id+'.mp4',duration:3,fps:24})),posters:{work:'work.png',user:'user.png'},integrity:{}};
  const names=manifest.clips.map(clip=>clip.file).concat(Object.values(manifest.posters));
  for(const name of names) {
    const content=Buffer.from('synthetic bytes: '+name); await writeFile(join(source,name),content);
    manifest.integrity[name]={bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
  }
  const save=()=>writeFile(join(source,'manifest.json'),JSON.stringify(manifest)); await save();
  return {source,destination,manifest,names,save};
}

test('runtime packaging copies only four clips and two posters, never raw production records', async t => {
  const h=await fixture(t);
  await writeFile(join(h.source,'account-response.json'),'must remain private');
  await writeFile(join(h.source,'master.mp4'),'do not bundle source');
  h.manifest.privateNotes='must not be copied'; h.manifest.clips[0].draftId='private'; await h.save();
  const shipped=await copyMotionAssets(h.source,h.destination);
  assert.deepEqual((await readdir(h.destination)).sort(),[...h.names,'manifest.json'].sort());
  assert.equal(shipped.privateNotes,undefined);assert.equal(shipped.clips[0].draftId,undefined);
  assert.deepEqual((await inspectMotionAssets(h.destination)).manifest,shipped);
  for(const file of h.names) assert.deepEqual(await readFile(join(h.source,file)),await readFile(join(h.destination,file)));
});

test('missing or modified media prevents package creation before output is written', async t => {
  const h=await fixture(t); await writeFile(join(h.source,'user-work.mp4'),'changed bytes');
  await assert.rejects(copyMotionAssets(h.source,h.destination),/校验不一致/); await assert.rejects(access(h.destination),{code:'ENOENT'});
  await rm(join(h.source,'manifest.json')); await assert.rejects(copyMotionAssets(h.source,h.destination),/尚未准备/); await assert.rejects(access(h.destination),{code:'ENOENT'});
});

test('runtime file aliasing, extra hash entries and malformed hashes are rejected', async t => {
  const h=await fixture(t), original=structuredClone(h.manifest);
  h.manifest.clips[1].file=h.manifest.clips[0].file; await h.save(); await assert.rejects(inspectMotionAssets(h.source),/独立文件/);
  h.manifest.clips=original.clips; h.manifest.integrity['account.json']=original.integrity['work-loop.mp4']; await h.save();
  await assert.rejects(inspectMotionAssets(h.source),/仅接受六个/);
  h.manifest.integrity=structuredClone(original.integrity);h.manifest.integrity['work-loop.mp4'].sha256='invalid';await h.save();
  await assert.rejects(inspectMotionAssets(h.source),/哈希记录无效/);
});

test('a second packaging attempt never overwrites a previous runtime bundle', async t => {
  const h=await fixture(t);await copyMotionAssets(h.source,h.destination);
  const before=await readFile(join(h.destination,'manifest.json'),'utf8');
  await assert.rejects(copyMotionAssets(h.source,h.destination),/already exists/);
  assert.equal(await readFile(join(h.destination,'manifest.json'),'utf8'),before);
});
