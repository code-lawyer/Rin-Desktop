import test from 'node:test';
import assert from 'node:assert/strict';
import { installSpeech } from '../renderer/speech-ui.js';

test('a short multi-sentence reply is generated as one utterance before playback', async t => {
  const old = {document:globalThis.document,window:globalThis.window,AudioContext:globalThis.AudioContext};
  t.after(() => { for (const [key,value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key]=value; });
  const nodes = new Map(), requests = [], played = [];
  globalThis.document = {getElementById:id => { if (!nodes.has(id)) nodes.set(id,{hidden:true,setAttribute(){}}); return nodes.get(id); },addEventListener(){}};
  globalThis.window = {addEventListener(){}};
  globalThis.AudioContext = class {destination={};async resume(){} createBuffer(){return {copyToChannel(){}};} createBufferSource(){return {connect(){},start(){played.push(true);queueMicrotask(()=>this.onended?.());},stop(){this.onended?.();}};}};
  const text = '事情已经处理好了。先确认当前项目和对话，再发送下一条任务。听到提示音以后，按下朗读键，就能继续听回复。';
  const api = {workspace:async()=>({ok:true,value:{settings:{ttsResident:true},speech:{phase:'ready'}}}),onWorkspace(){},onSpeech(){},stopSpeech:async()=>({ok:true}),
    synthesize:async text=>{requests.push(text);return {ok:true,value:{samples:[0,0],sampleRate:24000}};}};
  const control = installSpeech({api,state:()=>({status:'idle',threadId:'one',messages:[{role:'assistant',text,complete:true}]}),insert(){},error:assert.fail,measure(){}});
  await new Promise(resolve=>setImmediate(resolve)); await control.readReply();
  assert.deepEqual(requests,[text], 'Every sentence must share one generation context');
  assert.equal(played.length,1);
});

test('automatic narration prepares a whole reply, deduplicates completion events and cancels playback without a self-stop echo', async t => {
  const old = { document: globalThis.document, window: globalThis.window, AudioContext: globalThis.AudioContext };
  t.after(() => { for (const [key,value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key]=value; });
  const nodes=new Map(), handlers={}, stops=[], errors=[], played=[];
  const get=id=>{if(!nodes.has(id)) nodes.set(id,{hidden:true,textContent:'',setAttribute(){}});return nodes.get(id);};
  globalThis.document={getElementById:get,addEventListener(){}};
  globalThis.window={addEventListener(){}};
  globalThis.AudioContext=class {
    destination={}; async resume() {}
    createBuffer(){return {copyToChannel(){}};}
    createBufferSource(){return {connect(){},start(){played.push(Date.now());this.timer=setTimeout(()=>this.onended?.(),12);},stop(){clearTimeout(this.timer);this.onended?.();}};}
  };
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const api={
    stopSpeech:async(notify=true)=>{stops.push(notify);if(notify)setTimeout(()=>handlers.stop?.(),0);},
    synthesize:async()=>{await delay(8);return {ok:true,value:{samples:[0,0,0,0],sampleRate:24000}};},
    onSpeech:(name,callback)=>{handlers[name]=callback;},onWorkspace(){},
    workspace:async()=>({ok:true,value:{settings:{autoSpeak:true,ttsResident:true},speech:{phase:'ready'}}})
  };
  const state = {threadId:'t',messages:[{role:'assistant',id:'one',text:'测试连续播报。'.repeat(6),complete:true}]};
  installSpeech({api,state:()=>state,insert(){},error:e=>errors.push(e),measure(){}});
  await delay(0);
  const wait=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await delay(5);}assert.fail('Narration did not reach the expected state');};
  handlers.reply({threadId:'t',turnId:'one',text:'测试连续播报。'.repeat(6)});
  await wait(()=>played.length===1 && get('stop-speech').hidden);
  const completed=played.length;
  handlers.reply({threadId:'t',turnId:'one',text:'测试连续播报。'.repeat(6)});
  await delay(25); assert.equal(played.length,completed,'Duplicate completion events stay silent');
  state.messages[0].id='two';
  handlers.reply({threadId:'t',turnId:'two',text:'测试连续播报。'.repeat(6)});
  await wait(()=>played.length>completed);
  handlers.stop(); const cancelledAt=played.length; await delay(50);
  assert.equal(played.length,cancelledAt,'A prefetched segment must not play after cancellation');
  assert.equal(get('stop-speech').hidden,true); assert.deepEqual(errors,[]); assert.ok(stops.every(v=>v===false));
});

test('resident manual mode stays silent until the current reply is requested, and stale settings cannot re-enable it', async t => {
  const old={document:globalThis.document,window:globalThis.window,AudioContext:globalThis.AudioContext};
  t.after(()=>{for(const [key,value] of Object.entries(old)) value===undefined?delete globalThis[key]:globalThis[key]=value;});
  const nodes=new Map(),handlers={},requested=[],windows=[]; let workspaceHandler;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',setAttribute(){}});return nodes.get(id);};
  globalThis.document={getElementById:get,addEventListener(){}};globalThis.window={addEventListener(){}};
  globalThis.AudioContext=class {destination={};async resume(){} createBuffer(){return {copyToChannel(){}};} createBufferSource(){return {connect(){},start(){queueMicrotask(()=>this.onended?.());},stop(){this.onended?.();}};}};
  const delay=()=>new Promise(r=>setImmediate(r));
  const initial={version:1,settings:{ttsResident:true,autoSpeak:false,ttsEngine:'qwen'},speech:{phase:'ready'}};
  const api={workspace:async()=>({ok:true,value:initial}),onWorkspace:f=>{workspaceHandler=f;},onSpeech:(name,f)=>handlers[name]=f,
    stopSpeech:async()=>({ok:true}),synthesize:async text=>{requested.push(text);return {ok:true,value:{samples:[0,0],sampleRate:24000}};},windowAction:action=>windows.push(action)};
  const state={threadId:'one',status:'idle',messages:[{role:'assistant',text:'这一条回复。',complete:true}]};
  const control=installSpeech({api,state:()=>state,insert(){},error:e=>assert.fail(e),measure(){}}); await delay();
  handlers.reply({threadId:'one',text:'这一条回复。'});await delay();assert.deepEqual(requested,[]);
  assert.equal(get('replay-reply').textContent,'朗读此条');
  workspaceHandler({...initial,speech:{phase:'loading'}});
  assert.equal(get('replay-reply').disabled,false,'An explicitly loading model can queue one read request');
  await control.readReply();assert.deepEqual(requested,['这一条回复。'],'Manual read refreshes an authoritative ready snapshot before the delayed push');
  state.status='working';control.refresh();assert.equal(get('replay-reply').disabled,true);
  workspaceHandler({version:3,settings:{...initial.settings,ttsResident:false},speech:{phase:'unloaded'}});
  workspaceHandler({...initial,version:2});
  assert.equal(get('replay-reply').textContent,'语音设置');await get('replay-reply').onclick();assert.deepEqual(windows,['speech-settings']);
  handlers.reply({threadId:'one',text:'不能自动加载。',preview:true});await delay();assert.equal(requested.length,1);
});

test('manual read action waits for a complete idle reply, ignores re-entry and works with auto narration disabled', async t => {
  const old={document:globalThis.document,window:globalThis.window,AudioContext:globalThis.AudioContext};
  t.after(()=>{for(const [key,value] of Object.entries(old)) value===undefined?delete globalThis[key]:globalThis[key]=value;});
  const nodes=new Map(),handlers={},requested=[],windows=[],errors=[]; let completeAudio;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',setAttribute(){}});return nodes.get(id);};
  globalThis.document={getElementById:get,addEventListener(){}};globalThis.window={addEventListener(){}};
  globalThis.AudioContext=class {destination={};async resume(){} createBuffer(){return {copyToChannel(){}};} createBufferSource(){return {connect(){},start(){completeAudio=()=>this.onended?.();},stop(){this.onended?.();}};}};
  const delay=()=>new Promise(r=>setImmediate(r));
  const api={workspace:async()=>({ok:true,value:{settings:{ttsResident:true,autoSpeak:false},speech:{phase:'ready'}}}),onWorkspace(){},onSpeech:(name,f)=>handlers[name]=f,
    stopSpeech:async()=>({ok:true}),synthesize:async text=>{requested.push(text);return {ok:true,value:{samples:[0,0],sampleRate:24000}};},windowAction:action=>windows.push(action)};
  const state={threadId:'one',status:'working',messages:[{role:'assistant',text:'完整回复。',complete:false}]};
  const control=installSpeech({api,state:()=>state,insert(){},error:e=>errors.push(e),measure(){}}); await delay();
  await control.readReply(); assert.equal(requested.length,0);
  state.messages[0].complete=true; await control.readReply(); assert.equal(requested.length,0);
  state.status='idle'; state.messages[0].turnStatus='interrupted'; await control.readReply(); assert.equal(requested.length,0);
  state.messages[0].turnStatus='completed'; state.messages[0].phase='commentary'; await control.readReply(); assert.equal(requested.length,0);
  state.messages[0].phase='final_answer';
  state.status='idle'; const first=control.readReply(); await delay();
  await control.readReply(); await get('replay-reply').onclick(); assert.deepEqual(requested,['完整回复。']);
  assert.equal(get('replay-reply').disabled,true); completeAudio(); await first;
  assert.equal(get('replay-reply').disabled,false); assert.equal(errors.length,4);
  const replay=control.readReply(); await delay(); handlers.stop(); await replay;
  assert.deepEqual(requested,['完整回复。'],'Repeated playback must reuse the exact cached audio'); assert.equal(get('stop-speech').hidden,true);
});

test('dictation opens the microphone without waiting for ongoing native TTS synthesis to drain', async t => {
  const old = { document: globalThis.document, window: globalThis.window };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator; });
  const nodes = new Map(); let requested = false, cancelled = false;
  const get = id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', setAttribute() {} }); return nodes.get(id); };
  globalThis.document = { getElementById: get, addEventListener() {} }; globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    requested = true; throw Object.assign(new Error('Test microphone blocked'), { name: 'NotAllowedError' });
  } } } });
  const api = { workspace: async () => ({ ok: true, value: { settings: {}, speech: {} } }), onWorkspace() {}, onSpeech() {},
    stopSpeech: () => { cancelled = true; return new Promise(() => {}); }, capture: async target => { if (target) api.stopSpeech(); return { ok: true }; } };
  const control = installSpeech({ api, state: () => ({ cwd: 'project', threadId: 'thread' }), insert() {}, error() {}, measure() {} });
  let timeout;
  try { await Promise.race([control.toggleCapture(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Capture waited for synthesis')), 500); })]); }
  finally { clearTimeout(timeout); }
  assert.equal(cancelled, true); assert.equal(requested, true); assert.equal(control.isCapturing(), false);
});

const tick = () => new Promise(resolve=>setImmediate(resolve));
const gate = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function preparationHarness(t, text='第一句。第二句。', extra={}) {
  const old={document:globalThis.document,window:globalThis.window,AudioContext:globalThis.AudioContext};
  t.after(()=>{for(const [key,value] of Object.entries(old)) value===undefined?delete globalThis[key]:globalThis[key]=value;});
  const nodes=new Map(),handlers={},requests=[],played=[],errors=[];let workspaceListener;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,setAttribute(){}});return nodes.get(id);};
  globalThis.document={getElementById:get,addEventListener(){}};globalThis.window={addEventListener(){}};
  globalThis.AudioContext=class {destination={};async resume(){} createBuffer(_n,length){return {length,copyToChannel(){}};} createBufferSource(){return {connect(){},disconnect(){},start(){played.push(this.buffer.length);queueMicrotask(()=>this.onended?.());},stop(){this.onended?.();}};}};
  let workspace={version:1,settings:{ttsResident:true,ttsEngine:'qwen',qwenVoice:'Serena',prepareSpeech:true,autoSpeak:false,...extra},speech:{phase:'ready'}};
  const state={cwd:'project',threadId:'one',status:'idle',messages:[{role:'assistant',id:'reply',turnId:'turn',text,complete:true,turnStatus:'completed'}]};
  const api={workspace:async()=>({ok:true,value:workspace}),onWorkspace:f=>workspaceListener=f,onSpeech:(name,f)=>handlers[name]=f,
    stopSpeech:async()=>({ok:true}),synthesize:(text,profile)=>{const pending=gate();requests.push({text,profile,resolve:value=>pending.resolve({ok:true,value:value??{samples:[0,0],sampleRate:24000}})});return pending.promise;},windowAction(){}};
  const control=installSpeech({api,state:()=>state,insert(){},error:e=>errors.push(e),measure(){}});
  const update=patch=>{workspace={...workspace,...patch,version:workspace.version+1};workspaceListener(workspace);};
  const complete=()=>handlers.reply({threadId:'one',turnId:'turn',text});
  return {get,api,control,state,requests,played,errors,update,complete,handlers,settings:workspace.settings};
}

test('early completion event waits for the final state snapshot before background preparation',async t=>{
  const h=preparationHarness(t);await tick();
  h.state.status='working';h.state.messages[0].complete=false;h.state.messages[0].turnStatus='inProgress';
  h.complete();await tick();assert.equal(h.requests.length,0);
  h.state.status='idle';h.state.messages[0].complete=true;h.state.messages[0].turnStatus='completed';h.control.refresh();await tick();
  assert.equal(h.requests.length,1);h.requests[0].resolve();await tick();assert.deepEqual(h.played,[]);
});

test('background preparation accepts one read hotkey and starts one buffer only after every segment',async t=>{
  const h=preparationHarness(t,'长回复的自然段。'.repeat(30));await tick();h.complete();await tick();assert.equal(h.requests.length,1);
  h.update({speech:{phase:'generating'}});assert.equal(h.get('replay-reply').disabled,false);
  const reading=h.control.readReply();await tick();await h.control.readReply();assert.deepEqual(h.played,[]);
  for(let i=0;i<2;i++){assert.equal(h.requests.length,i+1);h.requests[i].resolve();await tick();if(i===0)assert.deepEqual(h.played,[]);}
  await reading;assert.deepEqual(h.played,[4]);assert.deepEqual(h.errors,[]);
  h.update({speech:{phase:'ready'}});await h.control.readReply();assert.deepEqual(h.played,[4,4]);assert.equal(h.requests.length,2);
});

test('cancel, conversation switch and new task suppress late audio and queued playback',async t=>{
  const h=preparationHarness(t);await tick();
  for(const kind of ['stop','switch','task']){
    h.state.threadId='one';h.state.status='idle';const reading=h.control.readReply();await tick();
    const request=h.requests.at(-1);assert.ok(request);
    if(kind==='stop')h.handlers.stop();
    if(kind==='switch'){h.state.threadId='two';h.control.refresh();}
    if(kind==='task'){h.state.status='working';h.control.refresh();}
    request.resolve();await reading;assert.deepEqual(h.played,[]);assert.equal(h.get('stop-speech').hidden,true);
  }
  assert.deepEqual(h.errors,[]);
});

test('changing voice cancels preparation and cache cannot survive unload or a new profile',async t=>{
  const h=preparationHarness(t);await tick();
  const first=h.control.readReply();await tick();h.update({settings:{...h.settings,qwenVoice:'Vivian'}});h.requests[0].resolve();await first;assert.deepEqual(h.played,[]);
  const next=h.control.readReply();await tick();assert.notEqual(h.requests[0].profile,h.requests[1].profile);h.requests[1].resolve();await next;
  h.update({settings:{...h.settings,qwenVoice:'Vivian',ttsResident:false},speech:{phase:'unloaded'}});
  h.update({settings:{...h.settings,qwenVoice:'Vivian'},speech:{phase:'ready'}});
  const again=h.control.readReply();await tick();assert.equal(h.requests.length,3);h.requests[2].resolve();await again;
  assert.deepEqual(h.played,[2,2]);assert.deepEqual(h.errors,[]);
});

test('stopping a pending completion during model loading does not restart on readiness',async t=>{
  const h=preparationHarness(t);await tick();h.update({speech:{phase:'loading'}});h.complete();h.handlers.stop();
  h.update({speech:{phase:'ready'}});await tick();assert.equal(h.requests.length,0);
});

test('read hotkey survives background preparation starting inside the workspace refresh',async t=>{
  const h=preparationHarness(t);await tick();h.update({speech:{phase:'loading'}});h.complete();
  h.api.workspace=async()=>({ok:true,value:{version:99,settings:h.settings,speech:{phase:'ready'}}});
  const reading=h.control.readReply();await tick();assert.equal(h.requests.length,1);
  h.requests[0].resolve();await reading;assert.deepEqual(h.played,[2]);
});

test('one read request can wait for an explicitly loading model and stop clears that request',async t=>{
  const h=preparationHarness(t);await tick();h.update({speech:{phase:'loading'}});
  const cancelled=h.control.readReply();await tick();assert.equal(h.requests.length,0);h.handlers.stop();await cancelled;
  h.update({speech:{phase:'ready'}});await tick();assert.deepEqual(h.played,[]);assert.equal(h.requests.length,0);
  h.update({speech:{phase:'loading'}});const reading=h.control.readReply();await tick();h.update({speech:{phase:'ready'}});await tick();
  assert.equal(h.requests.length,1);h.requests[0].resolve();await reading;assert.deepEqual(h.played,[2]);
});

test('turning background preparation off cancels work without clearing a manual playback request',async t=>{
  const h=preparationHarness(t);await tick();h.complete();await tick();
  h.update({settings:{...h.settings,prepareSpeech:false}});h.requests[0].resolve();await tick();assert.deepEqual(h.played,[]);
  const reading=h.control.readReply();await tick();
  h.update({settings:{...h.settings,prepareSpeech:true}});h.update({settings:{...h.settings,prepareSpeech:false}});
  h.requests[1].resolve();await reading;assert.deepEqual(h.played,[2]);
});
