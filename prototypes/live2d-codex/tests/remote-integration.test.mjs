import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RemoteController } from '../backend/remote-controller.mjs';
import { RemoteAudio, capabilities } from '../backend/remote-audio.mjs';
import { RemoteKeys, remoteSettings } from '../backend/remote-config.mjs';
import input from '../backend/remote-input.cjs';
import { createDraftSession } from '../renderer/draft-session.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const target={provider:'codex',cwd:'project',threadId:'a'};
const caps=[11,1,0,2,0,0,120,0,0];
class Transport extends EventEmitter {
  calls=[];
  async start() {}
  async close() {this.closed=true;}
  async request(command,args={}) {
    this.calls.push({command,...args});
    if(command==='scan')return [{id:'test-remote',name:'RC003',paired:true}];
    if(command==='connect')this.generation=args.generation;
    if(command==='write' && Buffer.from(args.data,'base64')[0]===10) this.event('control',caps);
  }
  event(type,data) {this.emit('event',{generation:this.generation,type,...(Array.isArray(data)?{data:Buffer.from(data).toString('base64')}:data)});}
}
async function setup(t,overrides={}) {
  const native=new Transport(), deliveries=[],ends=[],actions=[],saved=[];
  const controller=new RemoteController({createTransport:()=>native,settings:{},save:async value=>saved.push(value),begin:()=>target,transcribe:async()=>({text:'识别文字'}),deliver:async(...args)=>deliveries.push(args),end:id=>ends.push(id),action:async value=>actions.push(value),...overrides});
  t.after(()=>controller.close());await controller.scan();await controller.connect('test-remote');
  return {native,controller,deliveries,ends,actions,saved};
}
async function record(native) {native.event('control',[8]);await tick();native.event('control',[4,0,2,7]);for(let i=0;i<16;i++)native.event('audio',Array(120).fill(0x11));}

test('RC003 capabilities and IMA ADPCM enforce codec, size, synchronization and duration',()=>{
  assert.equal(capabilities(Buffer.from(caps)).sampleRate,16000);
  assert.equal(capabilities(Buffer.from([11,1,0,0,2,0,120,0,0])).codec,2);
  assert.throws(()=>capabilities(Buffer.from([11,1,0,1,0,0,120,0,0])));
  const audio=new RemoteAudio(120);audio.feed(Buffer.from([0x70]));
  assert.equal(audio.samples[0],11/32768);assert.equal(audio.samples[1],13/32768);
  assert.throws(()=>audio.sync(0,89));assert.throws(()=>audio.feed(Buffer.alloc(121)));assert.throws(()=>audio.finish());
  audio.length=audio.samples.length;assert.throws(()=>audio.feed(Buffer.from([0])));
});
test('physical key edges deduplicate repeats, reject unknown buttons and clear on disconnect',()=>{
  const keys=new RemoteKeys();assert.equal(keys.accept('Return','down'),'confirm');assert.equal(keys.accept('Return','down'),undefined);
  keys.accept('Return','up');assert.equal(keys.accept('Return','down'),'confirm');keys.clear();assert.equal(keys.accept('Return','down'),'confirm');assert.equal(keys.accept('A','down'),undefined);
  assert.throws(()=>remoteSettings({buttons:{voice:'send'}}));assert.throws(()=>remoteSettings({buttons:{confirm:'approve'}}));
});
test('application discovery, selection and saved button functions use one device owner',async t=>{
  const {controller,native,actions,saved}=await setup(t);
  assert.equal(controller.state.phase,'connected');assert.equal(saved.at(-1).device.id,'test-remote');
  await controller.configure({buttons:{home:'readReply'}});
  native.event('key',{key:'Home',edge:'down'});native.event('key',{key:'Home',edge:'down'});await tick();assert.deepEqual(actions,['readReply']);
  native.emit('event',{type:'key',generation:native.generation-1,key:'Home',edge:'down'});assert.equal(actions.length,1);
  await assert.rejects(controller.connect('not-discovered'),/搜索/);
  await controller.disconnect({forget:true});assert.equal(controller.config.device,null);assert.equal(native.closed,true);
});
test('media volume keys share device ownership, respect saved mappings and deduplicate repeats',async t=>{
  const {controller,native,actions}=await setup(t);
  assert.equal(controller.config.buttons.volumeUp,'volumeUp');
  native.event('key',{key:'VolumeDown',edge:'down'});native.event('key',{key:'VolumeDown',edge:'down'});
  native.emit('event',{type:'key',generation:native.generation-1,key:'VolumeUp',edge:'down'});
  await tick();assert.deepEqual(actions,['volumeDown']);
  native.event('key',{key:'VolumeDown',edge:'up'});native.event('key',{key:'VolumeDown',edge:'down'});await tick();assert.deepEqual(actions,['volumeDown','volumeDown']);
  await controller.configure({buttons:{volumeUp:'none',home:'clearDraft'}});
  native.event('key',{key:'VolumeUp',edge:'down'});native.event('key',{key:'Home',edge:'down'});await tick();assert.equal(actions.at(-1),'clearDraft');
});
test('remote microphone decodes into local ASR and delivers once to the captured draft target',async t=>{
  let samples;
  const {controller,native,deliveries,ends}=await setup(t,{transcribe:async data=>{samples=data;return {text:'语音草稿'};}});
  const diagnostics=[];controller.on('diagnostic',value=>diagnostics.push(value));
  await record(native);native.event('control',[8]); // duplicate microphone-open request
  await controller.finish();assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].slice(0,2),[target,'语音草稿']);
  assert.equal(samples.sampleRate,16000);assert.equal(samples.samples.length,3840);assert.equal(ends.length,1);
  assert.equal(native.calls.filter(c=>c.command==='write' && Buffer.from(c.data,'base64')[0]===12).length,1);
  native.event('control',[0]);await tick();assert.equal(deliveries.length,1);assert.equal(controller.state.audio,'idle');
  assert.equal(controller.state.capture.stage,'complete');assert.equal(controller.state.capture.frames,16);
  assert.equal(controller.state.capture.durationMs,240);assert.equal(diagnostics.at(-1).stage,'complete');
  assert.equal(JSON.stringify(diagnostics).includes('语音草稿'),false);
});

test('a physical voice press starts dictation even before a BLE microphone request arrives',async t=>{
  const {controller,native,deliveries}=await setup(t);
  native.event('key',{key:'F5',edge:'down'});
  await tick();
  const opens=()=>native.calls.filter(call=>call.command==='write' && Buffer.from(call.data,'base64')[0]===12).length;
  assert.equal(opens(),1,'the connected remote voice key must open its microphone');
  native.event('key',{key:'F5',edge:'down'});
  native.event('control',[8]);
  await tick();
  assert.equal(opens(),1,'HID repeats and BLE requests belong to the same physical capture');
  native.event('control',[4,0,2,7]);
  for(let i=0;i<16;i++)native.event('audio',Array(120).fill(0x11));
  native.event('key',{key:'F5',edge:'up'});
  native.event('control',[0]);
  await new Promise(resolve=>setTimeout(resolve,130));
  assert.equal(deliveries.length,1);
  assert.equal(controller.state.audio,'idle');
});

test('stream start alone is not reported as receiving microphone audio',async t=>{
  const {controller,native}=await setup(t);
  native.event('control',[8]);await tick();
  native.event('control',[4,0,2,7]);
  assert.equal(controller.state.audio,'starting','a stream acknowledgement does not prove any sound arrived');
  assert.equal(controller.state.capture.stage,'waiting-audio');
  native.event('audio',Array(120).fill(0x11));
  assert.equal(controller.state.audio,'listening');
  assert.equal(controller.state.capture.frames,1);
  assert.equal(controller.state.capture.durationMs,15);
  assert.ok(controller.state.capture.peak>0);
});

test('an empty microphone stream reports failure without claiming ASR started',async t=>{
  let recognized=0;const {controller,native}=await setup(t,{transcribe:async()=>{recognized++;return {text:'unexpected'};}});
  const stages=[];controller.on('diagnostic',value=>stages.push(value.stage));
  native.event('control',[8]);await tick();native.event('control',[4,0,2,7]);
  await controller.finish();
  assert.equal(recognized,0);assert.equal(stages.includes('recognizing'),false);
  assert.equal(controller.state.capture.stage,'failed');assert.equal(controller.state.capture.frames,0);
});

test('disabled or cancelled voice capture cannot be reopened by key repeats and late BLE requests',async t=>{
  const {controller,native}=await setup(t);
  await controller.configure({buttons:{voice:'none'}});
  native.event('key',{key:'F5',edge:'down'});native.event('control',[8]);await tick();
  assert.equal(controller.session,null);
  native.event('key',{key:'F5',edge:'up'});
  await controller.configure({buttons:{voice:'dictate'}});
  native.event('key',{key:'F5',edge:'down'});await tick();
  assert.ok(controller.session);
  await controller.cancel('本次听写已取消');
  native.event('key',{key:'F5',edge:'down'});native.event('control',[8]);await tick();
  assert.equal(controller.session,null);
  native.event('key',{key:'F5',edge:'up'});native.event('key',{key:'F5',edge:'down'});await tick();
  assert.ok(controller.session);
});
test('disconnect while recognizing drops the old result and frees capture ownership',async t=>{
  let finish;const {controller,native,deliveries,ends}=await setup(t,{transcribe:()=>new Promise(resolve=>finish=resolve)});
  await record(native);const recognition=controller.finish();await tick();await controller.disconnect();
  finish({text:'late'});await recognition;assert.equal(deliveries.length,0);assert.equal(ends.length,1);assert.equal(controller.state.audio,'idle');
});
test('failed capture guard never opens the microphone; disabled voice does not record',async t=>{
  const {controller,native,ends}=await setup(t,{begin:()=>{throw new Error('已在电脑听写');}});
  native.event('control',[8]);await tick();assert.match(controller.state.notice,/电脑听写/);assert.equal(controller.session,null);
  assert.equal(native.calls.some(c=>c.command==='write' && Buffer.from(c.data,'base64')[0]===12),false);
  await controller.configure({buttons:{voice:'none'}});const count=ends.length;native.event('control',[8]);await tick();assert.equal(ends.length,count);
});
test('short, malformed and disconnected streams never reach ASR or a different target',async t=>{
  let recognized=0;const {controller,native,deliveries}=await setup(t,{transcribe:async()=>{recognized++;return {text:'bad'};}});
  native.event('control',[8]);await tick();native.event('control',[4,0,2,1]);native.event('audio',[0]);await controller.finish();
  assert.equal(recognized,0);assert.match(controller.state.notice,/足够/);
  await record(native);native.event('control',[10,0]);await tick();assert.equal(controller.session,null);assert.equal(deliveries.length,0);
});
test('release from key and audio protocol finishes one capture; suspend cancels and rejects stale packets',async t=>{
  const {controller,native,deliveries}=await setup(t);await record(native);
  native.event('key',{key:'F5',edge:'up'});native.event('control',[0]);await new Promise(resolve=>setTimeout(resolve,130));assert.equal(deliveries.length,1);
  await record(native);controller.suspend();await tick();assert.equal(controller.state.audio,'idle');
  native.event('control',[8]);await tick();assert.equal(controller.session,null);assert.equal(deliveries.length,1);
});
test('external dictation preserves unsaved typing and does not append twice after a draft reload',async()=>{
  let text='',disk='old',ids=[];const drafts=createDraftSession({getText:()=>text,setText:value=>text=value,error:assert.fail,request:async(_target,value)=>{if(value!==undefined)disk=value;return {ok:true,value:{text:disk,dictationIds:ids}};}});
  drafts.restore(target);await tick();text='old plus typing';drafts.edited();disk='old voice';
  await drafts.appendExternal({target,text:'voice',id:'one'});assert.equal(text,'old plus typing voice');assert.equal(disk,text);
  await drafts.appendExternal({target,text:'voice',id:'one'});assert.equal(text,'old plus typing voice');
  const other={...target,threadId:'b'};drafts.restore(other);await tick();const before=text;
  await drafts.appendExternal({target,text:'wrong',id:'wrong'});assert.equal(text,before);
  disk='saved voice';ids=['two'];drafts.restore(target);await tick();await drafts.appendExternal({target,text:'voice',id:'two'});assert.equal(text,'saved voice');
});
test('same-content typing is not mistaken for an already applied dictation',async()=>{
  let text='',disk='你好';const drafts=createDraftSession({getText:()=>text,setText:value=>text=value,error:assert.fail,request:async(_target,value)=>{if(value!==undefined)disk=value;return {ok:true,value:disk};}});
  drafts.restore(target);await tick();text='你好 世界';drafts.edited();disk='你好 世界';
  await drafts.appendExternal({target,text:'世界',id:'unique'});assert.equal(text,'你好 世界 世界');assert.equal(disk,text);
});
test('native source FIFO distinguishes devices within one timestamp and never reuses a different edge or scan code',()=>{
  const sources=new input.InputSources(),key={time:9,scan:28,up:false,extended:false};
  sources.add({...key,selected:true});sources.add({...key,selected:false});
  assert.equal(sources.take({...key,up:true}),undefined);assert.equal(sources.take({...key,scan:30}),undefined);
  assert.equal(sources.take(key).selected,true);assert.equal(sources.take(key).selected,false);assert.equal(sources.take(key),undefined);
  sources.add({...key,selected:true});sources.clear();assert.equal(sources.take(key),undefined);
});
test('native gate passes an ordinary IME message unchanged, blocks remote and unresolved keys, and preserves WM_QUIT',async()=>{
  const errors=[],quit=[],gate=new input.RemoteInput({onError:error=>errors.push(error)});
  gate.koffi={decode:value=>({...value}),encode:(dest,_type,value)=>Object.assign(dest,value)};
  gate.api={virtual:()=>13,peek:()=>false,source:()=>false,dispatch:assert.fail,quit:code=>quit.push(code)};
  const event={time:42,scan:28,extended:false,up:false},message={message:0x100,wParam:0xe5,lParam:28<<16,time:42};
  gate.sources.add({...event,selected:false});const ordinary={...message};gate.message(ordinary);assert.deepEqual(ordinary,message);
  gate.sources.add({...event,selected:true});const remote={...message};gate.message(remote);assert.equal(remote.message,0);
  gate.sources.add({...event,selected:true});gate.api.source=buffer=>{buffer.writeUInt32LE(2,4);return true;};
  const injected={...message};gate.message(injected);assert.deepEqual(injected,message);assert.equal(gate.sources.count,1);
  gate.api.source=()=>false;gate.message({...message});assert.equal(gate.sources.count,0);
  const unknown={...message};gate.message(unknown);assert.equal(unknown.message,0);await tick();assert.equal(errors.length,1);
  gate.api.peek=message=>{Object.assign(message,{message:0x12,wParam:7});return true;};
  gate.message({...message});assert.deepEqual(quit,[7]);await tick();
});
test('repeated stop restores the previous raw registration once and cannot replace an unremoved hook',()=>{
  const gate=new input.RemoteInput(),restored=[];gate.enabled=true;gate.handle=1;gate.ownsRegistration=true;gate.previous={page:1,usage:6,flags:0,target:2};
  gate.api={register:value=>{restored.push(value);return true;},uninstall:()=>false};gate.koffi={sizeof:()=>16,unregister:assert.fail};
  gate.stop();gate.stop();assert.deepEqual(restored,[{page:1,usage:6,flags:0,target:2}]);assert.throws(()=>gate.start(),/尚未释放/);
});
test('disconnect during a pending microphone close invalidates a new connection before it can create a transport',async t=>{
  const {controller,native}=await setup(t);await record(native);
  const request=native.request.bind(native);let release;
  native.request=(command,args)=>command==='write' && Buffer.from(args.data,'base64')[0]===13?new Promise(resolve=>release=resolve):request(command,args);
  const connecting=controller.connect('test-remote');await tick();const disconnected=controller.disconnect();await tick();release();
  await Promise.all([connecting,disconnected]);assert.equal(controller.state.phase,'disconnected');assert.equal(controller.native,null);assert.equal(controller.desired,false);
  assert.equal(native.calls.filter(call=>call.command==='connect').length,1);
});
test('connected device search cannot occupy the transport while a new microphone capture is starting',async t=>{
  const {controller,native}=await setup(t);await assert.rejects(controller.scan(),/先断开/);
  await record(native);assert.equal(controller.state.audio,'listening');assert.equal(native.calls.filter(call=>call.command==='scan').length,1);
});
