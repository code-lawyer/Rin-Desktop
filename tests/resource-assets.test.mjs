import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillMissingAssets, sourceAvatarAsset } from '../tools/release/resource-assets.mjs';
import { validateResourceLock } from '../tools/release/bootstrap-resources.mjs';

test('an explicit resource lock pins one installer to its release and exact byte digest', async () => {
  const lock = JSON.parse(await readFile(new URL('../tools/release/resource-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateResourceLock(lock), { version: lock.version, entry: lock.files[0] });
  for (const change of [
    value => { value.version = '../outside'; },
    value => { value.files = []; },
    value => { value.files[0].file = 'different.exe'; },
    value => { value.files[0].url = value.files[0].url.replace(value.version, '0.1.0'); },
    value => { value.files[0].sha256 = 'abcd'; },
    value => { value.files[0].bytes = 0; },
    value => { value.repository = 'example/other-project'; },
  ]) {
    const invalid = structuredClone(lock);
    change(invalid);
    assert.throws(() => validateResourceLock(invalid), /Invalid (?:resource lock|locked installer)/);
  }
});

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

test('restoring an old installer excludes retired male artwork and retains both current styles',async t=>{
  const {source,destination}=await fixture(t);
  const retired=['rainy-window-male/texture.png','stills/male/work.png','character-previews/male.png'];
  const current=['stills/female-v2-4k/work.png','motion/female/work-loop.mp4'];
  for(const name of [...retired,...current]) {
    await mkdir(join(source,name,'..'),{recursive:true});await writeFile(join(source,name),'fixture');
  }
  await fillMissingAssets(source,destination);
  for(const name of retired)await assert.rejects(access(join(destination,name)),{code:'ENOENT'});
  for(const name of current)assert.equal(await readFile(join(destination,name),'utf8'),'fixture');
});

test('source-only Live2D and authoring preview files stay excluded from packaged releases', () => {
  for (const excluded of [
    'resources/app/assets/rainy-window-v2-4k',
    'resources/app/assets/rainy-window-v2-4k/model3.json',
    'resources/app/vendor/live2dcubismcore.min.js',
    'resources/app/renderer/action-rig.mjs',
    'resources/app/renderer/still-preview.html',
    'resources/app/renderer/video-wallpaper.js',
    'resources/app/backend/video-catalog.mjs',
  ]) {
    assert.equal(sourceAvatarAsset(excluded), true, excluded);
  }
  for (const retained of [
    'resources/app/assets/scene/rin-poses/scene.png',
    'resources/app/renderer/app.js',
    'resources/app/renderer/pcm-worklet.js',
    'resources/app/backend/codex.mjs',
  ]) {
    assert.equal(sourceAvatarAsset(retained), false, retained);
  }
});
