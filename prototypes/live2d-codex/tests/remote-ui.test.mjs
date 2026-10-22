import test from 'node:test';
import assert from 'node:assert/strict';
import { installRemoteSettings, installRemoteNavigation } from '../renderer/remote-ui.mjs';
import { remoteSettings } from '../backend/remote-config.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('manual connection can be cancelled from settings and its late response cannot restore connected UI',async t=>{
  const old=globalThis.document;t.after(()=>globalThis.document=old);
  const nodes=new Map();
  const element=()=>({dataset:{},classList:{toggle(){}},setAttribute(){},append(){},replaceChildren(){},closest(){return this;}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  globalThis.document={getElementById:get,createElement:element,activeElement:null};
  let state={phase:'disconnected',audio:'idle',config:remoteSettings({device:{id:'one',name:'RC003'}}),devices:[]},onRemote,finish;
  const calls=[];
  const api={onRemote:fn=>onRemote=fn,remote:async command=>{
    calls.push(command);
    if(command==='connect'){onRemote({...state,phase:'connecting'});return new Promise(resolve=>finish=resolve);}
    if(command==='disconnect'){onRemote(state);return {ok:true,value:state};}
    return {ok:true,value:state};
  }};
  installRemoteSettings(api);await tick();get('rc003-reconnect').onclick();await tick();
  assert.equal(get('rc003-disconnect').hidden,false);assert.equal(get('rc003-disconnect').disabled,false);
  get('rc003-disconnect').onclick();await tick();finish({ok:true,value:{...state,phase:'connected'}});await tick();
  assert.equal(get('rc003-status').textContent,'未连接');assert.deepEqual(calls,['snapshot','connect','disconnect']);
  assert.match(get('remote-microphone-status').textContent,/未连接/);
  onRemote({...state,phase:'connected'});
  assert.match(get('remote-microphone-status').textContent,/遥控器麦克风已连接/);
  onRemote({...state,phase:'connected',audio:'starting',capture:{stage:'waiting-audio',frames:0}});
  assert.match(get('remote-microphone-status').textContent,/等待声音/);
  onRemote({...state,phase:'connected',audio:'listening',capture:{stage:'receiving',frames:100,durationMs:1500}});
  assert.match(get('remote-microphone-status').textContent,/已收到 1.5 秒声音/);
  onRemote({...state,phase:'connected',capture:{stage:'failed',frames:100,durationMs:1500},notice:'本地识别失败，请重试。'});
  assert.match(get('remote-microphone-status').textContent,/本地识别失败/);
});

test('remote approval requires two confirmations on the same focused action',t=>{
  const old=globalThis.document;t.after(()=>globalThis.document=old);
  let receive,focus,clicked=0;const notices=[];
  const approve={disabled:false,tagName:'BUTTON',closest:selector=>selector==='#approval'?{}:null,getClientRects:()=>[{}],matches:()=>true,click:()=>clicked++};
  globalThis.document={querySelectorAll:()=>[approve],activeElement:approve,addEventListener:(_event,fn)=>focus=fn};
  installRemoteNavigation({onRemoteAction:fn=>receive=fn},{notice:value=>notices.push(value)});
  receive('confirm');assert.equal(clicked,0);focus();receive('confirm');assert.equal(clicked,0);receive('confirm');assert.equal(clicked,1);assert.equal(notices.length,2);
});
