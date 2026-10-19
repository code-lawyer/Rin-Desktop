import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { WorkspaceStore, draftKey } from '../backend/workspace-store.mjs';
import { CodexCompanion } from '../backend/codex.mjs';
import { speechChunks } from '../renderer/speech-ui.js';
import { LocalSpeech } from '../backend/speech.mjs';
import { currentReply } from '../renderer/current-reply.mjs';
async function fixture(t) {
  const root = resolve(import.meta.dirname, '../../../work/runtime/workbench-unit-tests'); await mkdir(root,{recursive:true}); const dir = await mkdtemp(join(root,'case-')); if (!dir.startsWith(root+sep)) throw new Error('Unexpected fixture path');
  t.after(() => rm(dir,{recursive:true,force:true})); const store = new WorkspaceStore(dir); await store.load(); const second = join(dir,'second'); await mkdir(second); return {dir,second,store};
}
test('project removal never deletes files; drafts remain isolated across projects and threads after restart',async t => {
  const {dir,second,store} = await fixture(t); const a = await store.add(dir), b = await store.add(second);
  assert.equal((await store.add(second)).id,b.id);
  const targets = [{cwd:dir,threadId:null},{cwd:dir,threadId:'one'},{cwd:second,threadId:'one'}];
  await Promise.all(targets.map((target,i)=>store.saveDraft(target,`draft-${i}`)));
  const reloaded = new WorkspaceStore(dir); await reloaded.load(); targets.forEach((target,i)=>assert.equal(reloaded.draft(target),`draft-${i}`));
  await assert.rejects(store.remove(a.id,dir),/先切换/);
  await writeFile(join(second,'keep.txt'),'user file'); await store.remove(b.id,dir); assert.equal(await readFile(join(second,'keep.txt'),'utf8'),'user file');
});

test('legacy Codex drafts keep their keys while Dots drafts persist in a separate namespace', async t => {
  const { dir, store } = await fixture(t); await store.add(dir);
  const legacy = { cwd: dir, threadId: 'same' }, codex = { ...legacy, provider: 'codex' }, dots = { provider: 'dots', cwd: '', threadId: 'same' };
  await store.saveDraft(legacy, 'Existing Codex draft');
  assert.equal(draftKey(codex), draftKey(legacy));
  await store.saveDraft(dots, 'Dots draft'); await store.saveDraft(dots, '');
  assert.equal(store.draft(codex), 'Existing Codex draft');
  await store.saveDraft(dots, 'Separate Dots draft');
  const reloaded = new WorkspaceStore(dir); await reloaded.load();
  assert.equal(reloaded.draft(codex), 'Existing Codex draft'); assert.equal(reloaded.draft(dots), 'Separate Dots draft');
  await assert.rejects(store.saveDraft({ ...dots, provider: 'unknown' }, 'invalid'), /来源/);
});
test('corrupt workspace metadata is preserved and unsafe speech settings are rejected',async t => {
  const {dir,store} = await fixture(t); await assert.rejects(store.updateSettings({voice:103}),/声线/); await assert.rejects(store.updateSettings({speed:5}),/语速/);
  await writeFile(store.file,'not json'); const second = new WorkspaceStore(dir); await assert.rejects(second.load(),/原文件已保留/); assert.equal(await readFile(store.file,'utf8'),'not json');
});

test('speech residency defaults off, migrates safely and persists independently of automatic playback',async t => {
  const {dir,store}=await fixture(t);
  assert.equal(store.data.settings.ttsResident,false); assert.equal(store.data.settings.autoSpeak,false);
  await store.updateSettings({ttsResident:true,ttsEngine:'qwen',qwenVoice:'Vivian',autoSpeak:false});
  const reload=new WorkspaceStore(dir); await reload.load();
  assert.equal(reload.data.settings.ttsResident,true); assert.equal(reload.data.settings.autoSpeak,false); assert.equal(reload.data.settings.qwenVoice,'Vivian');
  await assert.rejects(reload.updateSettings({ttsEngine:'remote'}),/引擎/);
  await assert.rejects(reload.updateSettings({ttsResident:'true'}),/开关/);
  const legacy=JSON.parse(await readFile(store.file,'utf8')); delete legacy.settings.ttsResident; await writeFile(store.file,JSON.stringify(legacy));
  await reload.load(); assert.equal(reload.data.settings.ttsResident,false);
});
test('completion alerts migrate on and persist independently of speech model residency',async t => {
  const {dir,store}=await fixture(t);
  assert.equal(store.data.settings.completionSound,true);
  await store.updateSettings({completionSound:false});
  const reload=new WorkspaceStore(dir); await reload.load();
  assert.equal(reload.data.settings.completionSound,false); assert.equal(reload.data.settings.ttsResident,false);
  await assert.rejects(reload.updateSettings({completionSound:'true'}),/提示音开关/);
  const legacy=JSON.parse(await readFile(store.file,'utf8')); delete legacy.settings.completionSound; await writeFile(store.file,JSON.stringify(legacy));
  await reload.load(); assert.equal(reload.data.settings.completionSound,true);
});

test('background preparation defaults off, migrates off and persists independently of automatic playback',async t=>{
  const {dir,store}=await fixture(t);assert.equal(store.data.settings.prepareSpeech,false);
  await store.updateSettings({prepareSpeech:true,ttsResident:true,autoSpeak:false});
  const reload=new WorkspaceStore(dir);await reload.load();assert.equal(reload.data.settings.prepareSpeech,true);assert.equal(reload.data.settings.autoSpeak,false);
  await assert.rejects(reload.updateSettings({prepareSpeech:'true'}),/提前准备语音开关/);
  const legacy=JSON.parse(await readFile(store.file,'utf8'));delete legacy.settings.prepareSpeech;await writeFile(store.file,JSON.stringify(legacy));
  await reload.load();assert.equal(reload.data.settings.prepareSpeech,false);assert.equal(reload.data.settings.ttsResident,true);
});
test('existing shortcut and remote choices survive migration while send and read become configurable',async t => {
  const {dir,store}=await fixture(t);
  await writeFile(store.file,JSON.stringify({format:1,projects:[],drafts:{},settings:{remoteEnabled:true,shortcuts:{chat:'F13',record:''},remoteKeys:{record:'F14',stopSpeech:''}}}));
  await store.load(); assert.equal(store.data.settings.shortcuts.chat,'F13'); assert.equal(store.data.settings.shortcuts.record,'');
  assert.equal(store.data.settings.shortcuts.send,'Control+Alt+Enter'); assert.equal(store.data.settings.shortcuts.readReply,'Control+Alt+R');
  assert.equal(store.data.settings.remoteKeys.record,'F14'); assert.equal(store.data.settings.remoteKeys.stopSpeech,'');
  assert.equal(store.data.settings.remoteKeys.chat,''); assert.equal(store.data.settings.remoteKeys.send,''); assert.equal(store.data.settings.remoteKeys.readReply,'');
  await store.updateSettings({remoteKeys:{send:'F15',readReply:'F16'}}); const reload=new WorkspaceStore(dir); await reload.load();
  assert.equal(reload.data.settings.remoteKeys.send,'F15'); assert.equal(reload.data.settings.remoteKeys.readReply,'F16');
});
test('resuming validates project identity and restores the model, history and canonical thread id',async t => {
  const {dir,second} = await fixture(t), calls=[]; const c = new CodexCompanion({projectRoot:dir,storageDir:dir}); c.state.connection='ready'; c.state.status='idle'; c.state.threadId='old'; c.state.model='old-model';
  c.rpc={closed:false,request:async(method,params)=>{calls.push({method,params}); if(method==='thread/read') return {thread:{id:'saved',cwd:second}}; if(method==='thread/resume') return {thread:{id:'saved',cwd:second,name:'Saved',turns:[]},model:'saved-model',reasoningEffort:'medium'}; if(method==='thread/turns/list') return {data:[{id:'t1',status:'completed',items:[{id:'m1',type:'agentMessage',text:'remembered'}]}]}; return {};}};
  await assert.rejects(c.resumeConversation('saved',dir),/目录/); assert.equal(c.state.threadId,'old'); assert.equal(c.state.status,'idle'); assert.equal(calls.some(v=>v.method==='thread/resume'),false);
  await c.resumeConversation('saved',second); assert.equal(c.state.threadId,'saved'); assert.equal(c.state.cwd,second); assert.equal(c.state.model,'saved-model'); assert.equal(c.state.effort,'medium'); assert.equal(c.state.messages[0].text,'remembered');
  c.state.status='working'; await assert.rejects(c.resumeConversation('old',dir),/仍在执行/); assert.equal(c.state.threadId,'saved');
});
test('only final successful replies emit a completion alert and narration event, once',async t => {
  const {dir} = await fixture(t), c = new CodexCompanion({projectRoot:dir,storageDir:dir}), replies=[]; c.state.threadId='thread'; c.state.turnId='turn'; c.on('reply-completed',r=>replies.push(r));
  c.receiveItem({id:'comment',type:'agentMessage',phase:'commentary',text:'working'},'turn',true);
  c.receiveItem({id:'final',type:'agentMessage',phase:'final_answer',text:'done'},'turn',true);
  assert.equal(replies.length,0);
  const event={method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}}; c.onNotification(event); c.onNotification(event); assert.deepEqual(replies.map(r=>r.text),['done']);
  c.state.turnId='failed'; c.receiveItem({id:'f',type:'agentMessage',text:'partial'},'failed',false); c.onNotification({method:'turn/completed',params:{threadId:'thread',turn:{id:'failed',status:'failed'}}}); assert.equal(replies.length,1);
  c.state.turnId='stopped'; c.receiveItem({id:'s',type:'agentMessage',text:'partial'},'stopped',false); c.onNotification({method:'turn/completed',params:{threadId:'thread',turn:{id:'stopped',status:'interrupted'}}}); assert.equal(replies.length,1);
  c.state.turnId='comment-only'; c.receiveItem({id:'c',type:'agentMessage',phase:'commentary',text:'working'},'comment-only',true); c.onNotification({method:'turn/completed',params:{threadId:'thread',turn:{id:'comment-only',status:'completed'}}}); assert.equal(replies.length,1);
});
test('manual narration excludes interrupted, failed and commentary-only replies both live and after history restore', async t => {
  const { dir } = await fixture(t);
  for (const status of ['completed', 'interrupted', 'failed', 'inProgress']) for (const phase of ['final_answer', 'commentary', null]) {
    const c = new CodexCompanion({ projectRoot: dir, storageDir: dir }); c.state.threadId = 'thread'; c.state.turnId = 'turn';
    const item = { id: 'answer', type: 'agentMessage', phase, text: '可见文字' };
    c.receiveItem(item, 'turn', true);
    assert.equal(currentReply(c.state.messages).readable, false, 'An item completion is not a successful turn');
    if (status !== 'inProgress') c.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status } } });
    const expected = status === 'completed' && phase !== 'commentary';
    assert.equal(currentReply(c.state.messages).readable, expected);
    c.loadThread({ id: 'thread', turns: [{ id: 'turn', status, items: [item] }] });
    assert.equal(currentReply(c.state.messages).readable, expected, 'Reload must preserve the same narration eligibility');
    assert.equal(currentReply(c.state.messages).text, '可见文字', 'An incomplete reply remains readable on screen');
  }
});

test('speech text keeps prose while replacing code and splits long paragraphs into bounded chunks',()=>{
  const parts=speechChunks('先看[说明](https://example.com)。\n```js\nthrow 42;\n```\n'+'后续内容'.repeat(400)); assert.ok(parts.every(p=>Array.from(p).length<=180)); assert.ok(parts.join('').includes('先看说明')); assert.ok(!parts.join('').includes('throw 42')); assert.ok(parts.join('').endsWith('后续内容'.repeat(400)));
  const sentence='保留完整语气'.repeat(15)+'。'; assert.deepEqual(speechChunks(sentence),[sentence]);
  const long='一'.repeat(100)+'，'+'二'.repeat(100)+'。'; assert.deepEqual(speechChunks(long),['一'.repeat(100)+'，','二'.repeat(100)+'。']);
});
test('ASR rejects unbounded or invalid audio before launching a worker',()=>{
  const speech = new LocalSpeech('unused'); assert.throws(()=>speech.transcribe({sampleRate:16000,samples:new Float32Array(16000*62)}),/有效/); assert.throws(()=>speech.transcribe({sampleRate:16000,samples:new Float32Array(16000).fill(NaN)}),/有效/); assert.equal(speech.workers.size,0);
});
