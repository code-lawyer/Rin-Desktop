import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCompanion, claudeAuthentication } from '../backend/claude-agent.mjs';
import { AcpCompanion } from '../backend/acp-agent.mjs';
import { CodexCompanion } from '../backend/codex.mjs';
import { JsonLineDecoder } from '../backend/json-line-decoder.mjs';
import { formAnswer } from '../backend/agent-questions.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
async function waitFor(predicate) { for (let n=0;n<100;n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Fixture event not observed'); }
async function directory(t) { const root = await mkdtemp(join(tmpdir(),'rin-protocol-')); t.after(() => rm(root,{recursive:true,force:true})); return root; }
function channel() {
  const queue=[], waiting=[]; let closed=false;
  return { push(value) { const next=waiting.shift(); if(next)next({value,done:false});else queue.push(value); }, end(){closed=true;for(const next of waiting.splice(0))next({done:true});},
    [Symbol.asyncIterator](){return this;}, next(){return queue.length?Promise.resolve({value:queue.shift(),done:false}):closed?Promise.resolve({done:true}):new Promise(resolve=>waiting.push(resolve));} };
}
async function claude(t, account = { apiKeySource: 'ANTHROPIC_API_KEY' }) {
  const root=await directory(t), agent=new ClaudeCompanion({projectRoot:root,storageDir:root}), calls=[];
  let options, prompt, stream;
  agent.sdk={ query(value){ options=value.options;prompt=value.prompt; const owned=channel();stream=owned; return Object.assign(owned,{accountInfo:async()=>account,supportedModels:async()=>[{value:'fixture-model',displayName:'Fixture',supportedEffortLevels:['low']}],setModel:async model=>calls.push(['model',model]),interrupt:async()=>owned.push({type:'result',subtype:'success',stop_reason:'interrupted'}),close:()=>owned.end()});},
    getSessionMessages:async()=>[{uuid:'old-user',type:'user',message:{content:'old request'}},{uuid:'old-reply',type:'assistant',message:{content:'old answer'}}],
    listSessions:async()=>[{sessionId:'saved',cwd:root,summary:'Saved',lastModified:1}],renameSession:async(...args)=>calls.push(['rename',...args]) };
  t.after(()=>agent.close());
  agent.binary='unused'; await agent.openNative(); Object.assign(agent.state,{connection:'ready',status:'idle'});
  return {agent,get stream(){return stream;},calls,root,get options(){return options;},nextInput:()=>prompt.next()};
}

test('Claude SDK requires resolved API authentication and does not offer subscription OAuth', async t => {
  for (const account of [{}, {tokenSource:'oauth'}, {tokenSource:'oauth',apiKeySource:'none'}, {apiProvider:'firstParty',tokenSource:'oauth',apiKeySource:'oauth'}, {apiKeySource:'unknown'}, {apiKeySource:'unexpected'}, {apiProvider:'future'}]) {
    assert.throws(() => claudeAuthentication(account), error => error.code === -32000 && /API/.test(error.message));
  }
  await assert.rejects(claude(t, {tokenSource:'oauth',subscriptionType:'max'}), /不提供订阅/);
  for (const apiKeySource of ['ANTHROPIC_API_KEY','apiKeyHelper','/login managed key']) assert.match(claudeAuthentication({apiKeySource,apiProvider:'firstParty'}), /API 凭据/);
  for (const apiProvider of ['bedrock','vertex','foundry','anthropicAws','anthropicGoogleCloud','mantle','gateway']) assert.match(claudeAuthentication({apiProvider}), /云平台/);
});

test('Claude native contract: safe defaults, model selection, streamed final text, create and resume', async t=>{
  const f=await claude(t), {agent,stream}=f;
  assert.equal(f.options.permissionMode,'default'); assert.deepEqual(f.options.settingSources,[]); assert.equal(f.options.strictMcpConfig,true);
  await agent.chooseModel('fixture-model'); assert.equal(agent.state.model,'fixture-model');
  const receipts=[];agent.on('submission',value=>receipts.push(value));
  await agent.send('fixture request',{id:'attempt'}); const input=(await f.nextInput()).value;
  assert.equal(input.message.content,'fixture request'); assert.ok(input.uuid);
  stream.push({type:'system',subtype:'init',session_id:'created',model:'fixture-model'});
  stream.push({type:'stream_event',session_id:'created',event:{type:'message_start',message:{id:'a'}}});
  stream.push({type:'stream_event',session_id:'created',event:{type:'content_block_delta',delta:{type:'text_delta',text:'part'}}});
  stream.push({type:'assistant',session_id:'created',uuid:'a',message:{id:'a',content:[{type:'text',text:'complete answer'}]}});
  stream.push({type:'result',session_id:'created',subtype:'success',result:'complete answer'});
  await agent.run; assert.equal(agent.state.messages.at(-1).text,'complete answer'); assert.equal(agent.state.messages.at(-1).turnStatus,'completed');
  assert.equal(receipts.filter(v=>v.status==='confirmed').length,1);
  const before=agent.snapshot(); agent.receive({type:'result',session_id:'foreign',subtype:'success'}); agent.receive({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'late'}}}); assert.deepEqual(agent.snapshot(),before);
  await agent.listThreads(f.root); await agent.resumeConversation('saved',f.root); assert.equal(agent.state.threadId,'saved'); assert.equal(agent.state.messages.at(-1).text,'old answer');
  await agent.newConversation(f.root); assert.equal(agent.state.threadId,null);
});

for(const decision of ['accept','decline']) test(`Claude permission ${decision} retains exact tool input and expires`,async t=>{
  const f=await claude(t), input={command:'fixture command'};
  await f.agent.send('fixture');await f.nextInput();
  const answer=f.options.canUseTool('Bash',input,{signal:new AbortController().signal});
  const id=f.agent.state.approvals[0].id; await assert.rejects(f.agent.respond(id,{decision:'always'}),/允许或拒绝/);
  await f.agent.respond(id,{decision}); const result=await answer;
  assert.equal(result.behavior,decision==='accept'?'allow':'deny'); if(decision==='accept')assert.deepEqual(result.updatedInput,input);
  assert.equal(f.agent.pending.size,0); await assert.rejects(f.agent.respond(id,{decision:'accept'}),/已结束/);
});

test('Claude questions preserve option answers; abort and obsolete transport callbacks cannot grant permissions',async t=>{
  const f=await claude(t), controller=new AbortController();
  await f.agent.send('fixture');await f.nextInput();
  const answer=f.options.canUseTool('AskUserQuestion',{questions:[{question:'Choose',multiSelect:true,options:[{label:'A'},{label:'B'}]}]},{signal:controller.signal});
  const id=f.agent.state.approvals[0].id;
  await assert.rejects(f.agent.respond(id,{answers:{}}),/每个问题/);
  await f.agent.respond(id,{answers:{0:['A','B']}}); assert.deepEqual((await answer).updatedInput.answers,{Choose:'A, B'});
  const abort=f.options.canUseTool('Write',{file_path:'fixture.txt'},{signal:controller.signal}); controller.abort(); assert.equal((await abort).behavior,'deny'); assert.equal(f.agent.pending.size,0);
  const obsolete=f.options; await f.agent.interrupt(); await f.agent.newConversation(f.root);
  assert.equal((await obsolete.canUseTool('Bash',{command:'late'},{signal:new AbortController().signal})).behavior,'deny');
});

test('Claude stop during a tool question cancels it and late results cannot revive the turn',async t=>{
  const f=await claude(t); await f.agent.send('fixture'); await f.nextInput();
  const question=f.options.canUseTool('AskUserQuestion',{questions:[{question:'Pending?'}]},{signal:new AbortController().signal});
  await f.agent.interrupt(); assert.equal((await question).behavior,'deny'); assert.equal(f.agent.pending.size,0); assert.equal(f.agent.state.status,'idle');
  const before=f.agent.snapshot(); f.agent.receive({type:'result',session_id:'late-session',subtype:'success'}); assert.deepEqual(f.agent.snapshot(),before);
});

test('Claude idle callbacks are denied and unexpected EOF fails its pending turn',async t=>{
  const f=await claude(t);
  assert.equal((await f.options.canUseTool('Bash',{command:'outside turn'},{signal:new AbortController().signal})).behavior,'deny');
  await f.agent.send('fixture');await f.nextInput();const run=f.agent.run;f.stream.end();await run;
  assert.equal(f.agent.state.connection,'error');assert.equal(f.agent.state.messages.at(-1).turnStatus,'failed');assert.equal(f.agent.pending.size,0);
});

// A synthetic stdio peer exercises the installed ACP SDK's JSON-RPC framing,
// validation and callbacks. No child process, account or network is used.
function acpPeer(cwd) {
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:null}), calls=[], requests=new Map();
  let nextId=1000, promptRequest;
  const send=message=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const session={sessionId:'session',models:{currentModelId:'fixture',availableModels:[{modelId:'fixture',name:'Fixture'}]}};
  const decoder=new JsonLineDecoder(message=>{
    if(!message.method){const pending=requests.get(message.id);requests.delete(message.id);if(message.error)pending?.reject(new Error(message.error.message));else pending?.resolve(message.result);return;}
    calls.push(message);
    if(message.method==='session/prompt'){promptRequest=message;return;}
    if(message.method==='session/cancel'){if(promptRequest){send({id:promptRequest.id,result:{stopReason:'cancelled'}});promptRequest=null;}return;}
    if(message.id===undefined)return;
    const result=message.method==='initialize'?{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{list:{}}},authMethods:[{id:'cached_token',name:'Cached'}]}:
      ['session/new','session/load'].includes(message.method)?session:
      message.method==='session/list'?{sessions:[{sessionId:'session',cwd,title:'Fixture',updatedAt:'2026-10-21T00:00:00Z'}]}:{};
    send({id:message.id,result});
  });
  child.stdin.on('data',chunk=>decoder.push(chunk));
  return {child,calls,request(method,params){const id=nextId++, pending=deferred();requests.set(id,pending);send({id,method,params});return pending.promise;},
    update(update,sessionId='session'){send({method:'session/update',params:{sessionId,update}});},
    finish(stopReason='end_turn'){assert.ok(promptRequest);send({id:promptRequest.id,result:{stopReason}});promptRequest=null;},
    drop(){child.stdout.end();child.emit('exit',1);},stop(){child.stdout.end();child.stdin.end();child.stderr.end();} };
}
async function acp(t,provider){
  const root=await directory(t),peers=[];
  const agent=new AcpCompanion({provider,projectRoot:root,storageDir:root,spawnAgent:(_binary,args,cwd)=>{const peer=acpPeer(cwd);peer.args=args;peers.push(peer);return peer.child;}});
  agent.binary='unused';agent.state.version='2.0.0';await agent.openNative();Object.assign(agent.state,{connection:'ready',status:'idle'});
  t.after(async()=>{await agent.close();for(const peer of peers)peer.stop();});
  return {agent,root,peers,get peer(){return peers.at(-1);}};
}
const permission={sessionId:'session',toolCall:{toolCallId:'tool',title:'Fixture write',kind:'edit',status:'pending',rawInput:{path:'fixture.txt'}},options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'},{optionId:'always',name:'Always',kind:'allow_always'}]};

for(const provider of ['grok','opencode']) {
  test(`${provider} wire contract: initialize, create, stream, model, list, resume and isolated history`,async t=>{
    const f=await acp(t,provider),{agent,peer}=f;
    assert.deepEqual(peer.calls[0].params.clientCapabilities.fs,{readTextFile:false,writeTextFile:false});assert.equal(peer.calls[0].params.clientCapabilities.terminal,false);
    if(provider==='grok'){assert.ok(peer.args.includes('--no-leader'));assert.ok(peer.calls.some(c=>c.method==='authenticate'));assert.equal(agent.sessionMeta().yoloMode,false);}
    else assert.deepEqual(peer.args,['acp']);
    await agent.chooseModel('fixture');await agent.send('fixture request');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
    peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'one '}});
    peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ignored'}},'foreign');
    peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'child'},_meta:{'opencode/child-session':true}});
    peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'two'}});peer.finish();await agent.run;
    assert.equal(agent.state.messages.at(-1).text,'one two');assert.equal(agent.state.messages.at(-1).turnStatus,'completed');
    const before=agent.snapshot();peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'late'}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(agent.snapshot(),before);
    const list=await agent.listThreads(f.root);assert.equal(list.data[0].id,'session');await agent.resumeConversation('session',f.root);assert.equal(agent.state.restored,true);
    const active=agent.active;await agent.readSubmissionHistory({cwd:f.root,threadId:'session'});assert.equal(agent.active,active);assert.equal(agent.endpoints.size,1);
  });
  for(const decision of ['accept','decline'])test(`${provider} wire permission ${decision} chooses once, never always`,async t=>{
    const {agent,peer}=await acp(t,provider);await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));const result=peer.request('session/request_permission',permission);await waitFor(()=>agent.pending.size===1);
    const id=agent.state.approvals[0].id;await agent.respond(id,{decision});assert.deepEqual((await result).outcome,{outcome:'selected',optionId:decision==='accept'?'once':'no'});await assert.rejects(agent.respond(id,{decision}),/已结束/);
  });
  test(`${provider} refuses unavailable one-time grants and cancels tools on stop`,async t=>{
    const {agent,peer}=await acp(t,provider);await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
    const result=peer.request('session/request_permission',{...permission,options:[permission.options[2]]});await waitFor(()=>agent.pending.size===1);
    assert.equal(agent.state.approvals[0].allowDisabled,true);await assert.rejects(agent.respond(agent.state.approvals[0].id,{decision:'accept'}),/单次/);
    await agent.interrupt();assert.deepEqual((await result).outcome,{outcome:'cancelled'});assert.equal(agent.pending.size,0);assert.equal(agent.state.status,'idle');
  });
  test(`${provider} form questions validate types and stale endpoints refuse interactions`,async t=>{
    const {agent,peer}=await acp(t,provider), ep=agent.active;
    await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
    const pending=peer.request('elicitation/create',{sessionId:'session',mode:'form',message:'Fixture',requestedSchema:{type:'object',properties:{count:{type:'integer',minimum:1,maximum:3},enabled:{type:'boolean'}},required:['count','enabled']}});
    await waitFor(()=>agent.pending.size===1);
    const id=agent.state.approvals[0].id;await assert.rejects(agent.respond(id,{answers:{count:'9',enabled:'true'}}),/数值/);
    await agent.respond(id,{answers:{count:'2',enabled:'false'}});assert.deepEqual(await pending,{action:'accept',content:{count:2,enabled:false}});
    await agent.interrupt();await agent.disposeNative();assert.deepEqual(agent.extension(ep,'x.ai/ask_user_question',{questions:[]}),{outcome:'cancelled'});
    assert.equal(agent.extension(ep,'x.ai/hooks/run',{}).decision,'deny');
  });
  test(`${provider} process exit rejects an outstanding prompt and produces no successful completion`,async t=>{
    const {agent,peer}=await acp(t,provider), replies=[];agent.on('reply-completed',r=>replies.push(r));await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
    const run=agent.run;peer.drop();await run;assert.equal(agent.state.connection,'error');assert.equal(agent.state.messages.at(-1).turnStatus,'failed');assert.equal(replies.length,0);
  });
  test(`${provider} idle and foreign-session permission requests are cancelled`,async t=>{
    const {agent,peer}=await acp(t,provider);
    assert.deepEqual((await peer.request('session/request_permission',permission)).outcome,{outcome:'cancelled'});
    await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
    assert.deepEqual((await peer.request('session/request_permission',{...permission,sessionId:'other'})).outcome,{outcome:'cancelled'});
    assert.equal(agent.pending.size,0);
  });
}

test('Grok native question extension and permission bypass hook preserve user control',async t=>{
  const {agent,peer}=await acp(t,'grok');
  await agent.send('fixture');await waitFor(()=>peer.calls.some(c=>c.method==='session/prompt'));
  const result=peer.request('_x.ai/ask_user_question',{questions:[{question:'Pick',options:[{label:'A'}]}]});await waitFor(()=>agent.pending.size===1);await agent.respond(agent.state.approvals[0].id,{answers:{0:'A'}});assert.deepEqual(await result,{outcome:'accepted',answers:{Pick:['A']}});
  assert.equal((await peer.request('_x.ai/hooks/run',{permissionMode:'bypassPermissions'})).decision,'deny');
});

test('Codex late completed-turn deltas and approvals cannot corrupt the next turn',async t=>{
  const root=await directory(t),agent=new CodexCompanion({projectRoot:root,storageDir:root});agent.state.threadId='session';agent.state.turnId='old';agent.rpc={reject(){},reply(){}};
  agent.receiveItem({id:'a',type:'agentMessage',text:'final'},'old',true);agent.onNotification({method:'turn/completed',params:{threadId:'session',turn:{id:'old',status:'completed'}}});
  const before=agent.snapshot();agent.onNotification({method:'item/agentMessage/delta',params:{threadId:'session',turnId:'old',itemId:'a',delta:'late'}});assert.deepEqual(agent.snapshot(),before);
});

test('forms reject unsupported, out-of-range and unlisted values without granting an answer',()=>{
  assert.throws(()=>formAnswer({properties:{n:{type:'integer',maximum:2}}},{answers:{n:'2.5'}}),/数值/);
  assert.throws(()=>formAnswer({properties:{s:{type:'string',enum:['a']}}},{answers:{s:'b'}}),/选项/);
  assert.throws(()=>formAnswer({properties:{a:{type:'array',items:{enum:['a']}}}},{answers:{a:['b']}}),/选项/);
  assert.throws(()=>formAnswer({properties:{o:{type:'object'}}},{answers:{o:{}}}),/不支持/);
});
