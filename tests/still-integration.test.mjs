import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AmbientBarrier } from '../prototypes/live2d-codex/backend/ambient-barrier.cjs';
import { stillPose, idleDuration, createIdleCycle, stillActivity, IDLE_POSES } from '../prototypes/live2d-codex/renderer/still-policy.mjs';
import settings from '../prototypes/live2d-codex/backend/still-settings.cjs';
import { WorkspaceStore } from '../prototypes/live2d-codex/backend/workspace-store.mjs';

test('a microphone waits for the wallpaper acknowledgement; stale and forged acknowledgements do not release it', async () => {
  const published=[], gate=new AmbientBarrier({publish:r=>published.push(r)});
  let opened=false;
  const ready=gate.wait().then(()=>{opened=true;});
  await Promise.resolve(); assert.equal(opened,false);
  gate.acknowledge(0); gate.acknowledge(200); await Promise.resolve(); assert.equal(opened,false);
  gate.acknowledge(published[0]); await ready; assert.equal(opened,true);
  let next=false; const pending=gate.wait().then(()=>{next=true;});
  gate.acknowledge(published[0]); await Promise.resolve(); assert.equal(next,false);
  gate.acknowledge(published[1]); await pending; assert.equal(next,true); gate.close();
});
test('a failed or unresponsive audio owner fails closed, and a later request can retry', async () => {
  let revision; const gate=new AmbientBarrier({publish:r=>{revision=r;},timeout:10});
  await assert.rejects(gate.wait(),/静音/);
  const retry=gate.wait(); gate.acknowledge(revision); await retry;
  const closing=gate.wait(); const rejected=assert.rejects(closing,/关闭/); gate.close(); await rejected;
});
test('latest applied audio revision releases coalesced requests without accepting a future revision', async () => {
  const gate=new AmbientBarrier({publish:()=>{}}); const first=gate.wait(),second=gate.wait();
  gate.acknowledge(2); await Promise.all([first,second]); assert.equal(gate.pending.size,0);
});
test('automatic poses preserve task attention and manual auditions; male never loads a nonexistent female pose', () => {
  const idle={connection:'ready',status:'idle'}, female={character:'female',stills:{stillPose:'auto'}};
  assert.equal(stillPose(idle,female,'window'),'window');
  for(const property of ['capturing','speaking','chatVisible']) assert.equal(stillPose(idle,{...female,[property]:true},'cup'),'attention');
  assert.equal(stillPose({status:'waiting'},female),'attention');
  assert.equal(stillPose({status:'working'},{...female,chatVisible:true}),'work');
  assert.equal(stillPose({status:'working'},{...female,capturing:true}),'attention');
  assert.equal(stillPose(idle,{...female,chatVisible:true}),'attention');
  assert.equal(stillPose({status:'error',connection:'error'},female,'window'),'window');
  for(const pose of settings.POSES) assert.equal(stillPose(idle,{...female,stills:{stillPose:pose}}),pose);
  for(const pose of settings.POSES) assert.ok(['work','attention'].includes(stillPose(idle,{character:'male',stills:{stillPose:pose}})));
  for(const pose of IDLE_POSES) assert.ok(idleDuration(pose,()=>0)>=40000);
  assert.ok(idleDuration('work',()=>0)>idleDuration('cup',()=>1));
});

test('quiet rounds cover every resting pose with work between, without repeating across round boundaries', () => {
  for(const sample of [0,.5,.999]) {
    const next=createIdleCycle(()=>sample);let previous;
    for(let round=0;round<5;round++) {
      const poses=[];
      for(let i=0;i<3;i++) { const pose=next('work'); assert.notEqual(pose,previous); poses.push(pose); assert.equal(next(pose),'work'); previous=pose; }
      assert.deepEqual(poses.sort(),['cup','thinking','window']);
    }
  }
});

test('retired saved poses return to auto and connection errors do not freeze the quiet cycle', () => {
  for(const pose of ['reading','rest','smile']) {
    const setting=settings.stillSettings({stillPose:pose,rainVolume:.05});
    assert.equal(setting.stillPose,'auto'); assert.equal(setting.rainVolume,.05);
    assert.throws(()=>settings.validateStillPatch({stillPose:pose}));
  }
  const base={character:'female',stills:{stillPose:'auto'}};
  assert.equal(stillActivity({status:'error',connection:'error'},base),'auto');
  assert.equal(stillActivity({}, {...base,paused:true}),'paused');
  assert.equal(stillActivity({},base,true),'hidden');
  for(const key of ['capturing','speaking']) assert.equal(stillActivity({}, {...base,[key]:true}),key);
  assert.equal(stillActivity({}, {...base,stills:{stillPose:'cup'}}),'manual');
  assert.equal(stillActivity({status:'working'},base),'task');
  assert.equal(stillActivity({status:'waiting'},base),'waiting');
  assert.equal(stillActivity({}, {...base,chatVisible:true}),'chat');
});
test('pose and ambient settings persist independently of character voices, narration volume, drafts and projects', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rin-stills-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new WorkspaceStore(dir); await store.load();
  await store.updateSettings({character:'female',qwenVoice:'Vivian',voice:48,playbackVolume:.7});
  await store.add(dir);
  const target={provider:'codex',cwd:dir,threadId:'test'}; await store.saveDraft(target,'keep my draft');
  for(const pose of settings.POSES) await store.updateSettings({stillPose:pose,ambienceEnabled:true,rainVolume:.09,keyVolume:.04});
  const reloaded=new WorkspaceStore(dir); await reloaded.load();
  assert.equal(reloaded.data.settings.qwenVoice,'Vivian'); assert.equal(reloaded.data.settings.voice,48);
  assert.equal(reloaded.data.settings.playbackVolume,.7); assert.equal(reloaded.data.settings.stillPose,'attention');
  assert.deepEqual(reloaded.data.drafts,store.data.drafts);
  const before=reloaded.snapshot(); await assert.rejects(reloaded.updateSettings({stillPose:'unknown',rainVolume:.3})); assert.deepEqual(reloaded.snapshot(),before);
  for(const patch of [{rainVolume:-1},{keyVolume:NaN},{ambienceEnabled:'true'}]) await assert.rejects(reloaded.updateSettings(patch));
});
