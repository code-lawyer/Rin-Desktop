import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { hasPresentedMotion } from '../tools/qa/motion-live-state.mjs';

test('paused startup with a prepared hidden 4K decoder is pending, not successful playback',()=>{
  const video={width:3840,height:2160,readyState:4,active:false,paused:true};
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'0'},videos:[video]}),false);
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'2'},videos:[video]}),false);
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'2',motionPhase:'paused'},videos:[{...video,active:true}]}),true);
});

test('retained active error frames do not prove healthy motion playback',()=>{
  const videos=[{width:3840,height:2160,readyState:4,active:true}];
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'4',motionPhase:'error'},videos}),false);
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'4',motionPhase:'loading'},videos}),false);
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'4',motionPhase:'loop'},videos}),true);
  assert.equal(hasPresentedMotion({host:{motionPlayCount:'4',motionPhase:'transition'},videos}),true);
});

for(const phase of ['discovery','handshake'])test(`live probe bounds a stalled fake local ${phase} endpoint`,async t=>{
  const sockets=new Set();
  const server=createServer((request,response)=>{
    if(phase==='discovery')return;
    response.setHeader('content-type','application/json');
    const port=server.address().port;
    response.end(JSON.stringify(['workbench.html','index.html?view=wallpaper'].map((path,i)=>({type:'page',url:'app://local/renderer/'+path,webSocketDebuggerUrl:`ws://127.0.0.1:${port}/page/${i}`}))));
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('upgrade',()=>{}); // Deliberately never complete the WebSocket handshake.
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{for(const socket of sockets)socket.destroy();server.close();});
  await assert.rejects(promisify(execFile)(process.execPath,[resolve('tools/qa/motion-live.mjs'),'--run',`--port=${server.address().port}`],{windowsHide:true,timeout:15000}),error=>{
    assert.notEqual(error.killed,true,'the probe must time out itself before the test kills it');
    assert.match(error.stderr,/timeout|timed out/i);return true;
  });
});
