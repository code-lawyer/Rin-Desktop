import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCompanion, claudeAuthentication } from '../backend/claude-agent.mjs';
import { AcpCompanion } from '../backend/acp-agent.mjs';
import { CodexCompanion } from '../backend/codex.mjs';
import { JsonLineDecoder } from '../backend/json-line-decoder.mjs';
import { formAnswer } from '../backend/agent-questions.mjs';
import catalog from '../backend/agent-catalog.cjs';
import { parseCustomAgents } from '../backend/custom-agents.mjs';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import { SubmissionGuard, submissionBaseline } from '../backend/submission-guard.mjs';
import { agentConnectionHelp } from '../renderer/agent-connection-help.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
async function waitFor(predicate) { for (let n=0;n<100;n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Fixture event not observed'); }
async function directory(t) { const root = await mkdtemp(join(tmpdir(),'rin-protocol-')); t.after(() => rm(root,{recursive:true,force:true})); return root; }

for (const failure of ['thread', 'project']) test(`Codex ${failure} recovery failure stays actionable after transport connects`, async t => {
  const root = await directory(t), agent = new CodexCompanion({ projectRoot: root, storageDir: root }), calls = [];
  const messages = [{ role: 'user', text: '原来的问题' }, { role: 'assistant', text: '原来的回答', complete: true }];
  Object.assign(agent.state, { threadId: 'saved-thread', messages: structuredClone(messages), loginHelp: '不应出现在恢复错误中的认证提示' });
  if (failure === 'project') agent.projectError = '原项目目录不可用，请选择原目录。';
  agent.rpc = { close: async () => {}, request: async method => {
    calls.push(method);
    if (method === 'model/list') return { data: [] };
    if (method === 'thread/resume') throw new Error('Thread not found');
    assert.fail('Unexpected RPC: ' + method);
  } };
  t.after(() => agent.close());
  await agent.finishConnection();
  const state = agent.snapshot();
  assert.equal(state.connection, 'ready'); assert.equal(state.status, 'error');
  assert.equal(agentConnectionHelp(state), state.error, 'usable transport must not hide the session recovery error or append login advice');
  assert.equal(state.threadId, 'saved-thread'); assert.deepEqual(state.messages, messages);
  await assert.rejects(agent.send('不要发送'), /恢复连接或开始新对话/);
  assert.deepEqual(calls, failure === 'project' ? ['model/list'] : ['model/list', 'thread/resume']);
});
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
function acpPeer(cwd, initialization = {}, restore = {}) {
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:null}), calls=[], requests=new Map();
  let nextId=1000, promptRequest, restoreRequest;
  const send=message=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
  const session={sessionId:'session',models:{currentModelId:'fixture',availableModels:[{modelId:'fixture',name:'Fixture'}]}};
  const finishRestore = () => {
    assert.ok(restoreRequest);
    if (restore.error) send({id:restoreRequest.id,error:restore.error});
    else {
      if (restoreRequest.method === 'session/load') for (const message of restore.messages ?? []) {
        send({method:'session/update',params:{sessionId:'session',update:{sessionUpdate:message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',content:{type:'text',text:message.text}}}});
      }
      // Restore responses need not repeat the session ID. Keep model handling
      // covered on both paths through the real SDK response decoder.
      send({id:restoreRequest.id,result:{models:session.models}});
    }
    restoreRequest=null;
  };
  const decoder=new JsonLineDecoder(message=>{
    if(!message.method){const pending=requests.get(message.id);requests.delete(message.id);if(message.error)pending?.reject(new Error(message.error.message));else pending?.resolve(message.result);return;}
    calls.push(message);
    if(message.method==='session/prompt'){promptRequest=message;return;}
    if(message.method==='session/cancel'){if(promptRequest){send({id:promptRequest.id,result:{stopReason:'cancelled'}});promptRequest=null;}return;}
    if(message.id===undefined)return;
    if(['session/load','session/resume'].includes(message.method)){restoreRequest=message;restore.onRequest?.(message);if(!restore.pending)finishRestore();return;}
    const result=message.method==='initialize'?{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{list:{}}},authMethods:[{id:'cached_token',name:'Cached'}],agentInfo:{name:'fixture',version:'bridge-1'},...initialization}:
      message.method==='session/new'?session:
      message.method==='session/list'?{sessions:[{sessionId:'session',cwd,title:'Fixture',updatedAt:'2026-10-21T00:00:00Z'}]}:{};
    send({id:message.id,result});
  });
  child.stdin.on('data',chunk=>decoder.push(chunk));
  return {child,calls,finishRestore,request(method,params){const id=nextId++, pending=deferred();requests.set(id,pending);send({id,method,params});return pending.promise;},
    update(update,sessionId='session'){send({method:'session/update',params:{sessionId,update}});},
    finish(stopReason='end_turn'){assert.ok(promptRequest);send({id:promptRequest.id,result:{stopReason}});promptRequest=null;},
    drop(){child.stdout.end();child.emit('exit',1);},stop(){child.stdout.end();child.stdin.end();child.stderr.end();} };
}
async function acp(t,provider,{initialization,authMethodId,restore}={}){
  const root=await directory(t),peers=[],agents=[];
  const launch=catalog.isCustomAgentId(provider)?parseCustomAgents({format:1,agents:[{id:provider,name:'Fixture custom agent',protocol:'acp',command:process.execPath,args:['bridge with spaces.mjs','--stdio'],...(authMethodId?{authMethodId}:{})}]} )[0]:undefined;
  if(launch)catalog.setCustomAgents([launch]);
  const create=()=>{
    const agent=new AcpCompanion({provider,projectRoot:root,storageDir:root,launch,spawnAgent:(_binary,args,cwd)=>{const peer=acpPeer(cwd,initialization,restore);peer.args=args;peers.push(peer);return peer.child;}});
    if(!launch)agent.prepareNative=async()=>{agent.binary='unused';agent.state.version='2.0.0';};
    agents.push(agent);return agent;
  };
  const agent=create();
  t.after(async()=>{for(const agent of agents)await agent.close();for(const peer of peers)peer.stop();if(launch)catalog.setCustomAgents([]);});
  if(launch)await agent.connect();
  else {agent.binary='unused';agent.state.version='2.0.0';await agent.openNative();Object.assign(agent.state,{connection:'ready',status:'idle'});}
  return {agent,root,peers,get peer(){return peers.at(-1);},get latestAgent(){return agents.at(-1);},async restart(){await agents.at(-1).close();const next=create();await next.connect();return next;}};
}
const permission={sessionId:'session',toolCall:{toolCallId:'tool',title:'Fixture write',kind:'edit',status:'pending',rawInput:{path:'fixture.txt'}},options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'},{optionId:'always',name:'Always',kind:'allow_always'}]};

for(const provider of ['grok','opencode','custom-fixture']) {
  test(`${provider} wire contract: initialize, create, stream, model, list, resume and isolated history`,async t=>{
    const f=await acp(t,provider),{agent,peer}=f;
    assert.deepEqual(peer.calls[0].params.clientCapabilities.fs,{readTextFile:false,writeTextFile:false});assert.equal(peer.calls[0].params.clientCapabilities.terminal,false);
    if(provider==='grok'){assert.ok(peer.args.includes('--no-leader'));assert.ok(peer.calls.some(c=>c.method==='authenticate'));assert.equal(agent.sessionMeta().yoloMode,false);}
    else if(provider==='custom-fixture'){assert.deepEqual(peer.args,['bridge with spaces.mjs','--stdio']);assert.equal(agent.state.version,'bridge-1');assert.equal(agent.state.connection,'ready');assert.equal(peer.calls.some(c=>c.method==='authenticate'),false);}
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
    await agent.interrupt();await agent.disposeNative();
    if(provider==='custom-fixture')assert.throws(()=>agent.extension(ep,'x.ai/ask_user_question',{questions:[]}),/私有扩展/);
    else {assert.deepEqual(agent.extension(ep,'x.ai/ask_user_question',{questions:[]}),{outcome:'cancelled'});assert.equal(agent.extension(ep,'x.ai/hooks/run',{}).decision,'deny');}
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

test('custom ACP authenticates only a configured advertised method and refuses protocol mismatch',async t=>{
  const allowed=await acp(t,'custom-auth',{authMethodId:'cached_token'});
  assert.equal(allowed.agent.state.connection,'ready');
  assert.deepEqual(allowed.peer.calls.find(call=>call.method==='authenticate').params,{methodId:'cached_token'});
  const absent=await acp(t,'custom-missing-auth',{authMethodId:'not-advertised'});
  assert.equal(absent.agent.state.connection,'error');assert.match(absent.agent.state.error,/authMethodId/);
  assert.equal(absent.peer.calls.some(call=>['authenticate','session/new'].includes(call.method)),false);
  const mismatch=await acp(t,'custom-version',{initialization:{protocolVersion:2}});
  assert.equal(mismatch.agent.state.connection,'error');assert.match(mismatch.agent.state.error,/协议版本/);
  assert.equal(mismatch.agent.endpoints.size,0);
});

test('custom ACP without history capabilities shows local cache, refuses resume and never calls session/load',async t=>{
  const {agent,peers,root,peer}=await acp(t,'custom-transient',{initialization:{agentCapabilities:{}}});
  assert.equal(agent.state.canResume,false);
  await agent.send('fixture');await waitFor(()=>peer.calls.some(call=>call.method==='session/prompt'));
  peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'local answer'}});peer.finish();await agent.run;
  const listing=await agent.listThreads(root);assert.equal(listing.data.length,1);
  const count=peers.length,history=await agent.history('session');
  assert.equal(history.localOnly,true);assert.equal(peers.length,count);assert.equal(history.turns.at(-1).items.at(-1).text,'local answer');
  await assert.rejects(agent.readSubmissionHistory({cwd:root,threadId:'session'}),/不支持/);
  await assert.rejects(agent.resumeConversation('session',root),/不支持/);
  assert.equal(peers.flatMap(p=>p.calls).some(call=>call.method==='session/load'),false);
  await agent.newConversation(root);assert.equal(agent.state.connection,'ready');
});

const resumeCapabilities = {sessionCapabilities:{list:{},resume:{}}};
const cachedConversation = () => ['completed','interrupted','failed','unknown'].flatMap((turnStatus,n)=>[
  {id:`user-${n}`,turnId:`turn-${n}`,role:'user',text:`保存的请求 ${n}\n第二行`,complete:true,turnStatus},
  {id:`answer-${n}`,turnId:`turn-${n}`,role:'assistant',text:`保存的回复 ${n}`,complete:true,phase:'final_answer',turnStatus},
]);

for(const provider of ['grok','opencode','custom-restore']) for(const [kind,capabilities,method] of [
  ['load only',{loadSession:true},'session/load'],
  ['resume only',resumeCapabilities,'session/resume'],
  ['load and resume',{loadSession:true,...resumeCapabilities},'session/load'],
]) test(`${provider}: ${kind} preserves saved history and outcomes across two restarts`,async t=>{
  const messages=cachedConversation(), f=await acp(t,provider,{initialization:{agentCapabilities:capabilities},restore:{messages}});
  f.agent.state.messages=structuredClone(messages);await f.agent.persist();
  for(let n=0;n<2;n++){
    const agent=await f.restart();
    assert.equal(agent.state.connection,'ready',agent.state.error);assert.equal(agent.state.threadId,'session');
    assert.equal(agent.state.canResume,true);assert.equal(agent.state.restored,true);assert.equal(agent.state.model,'fixture');
    assert.equal(agent.state.historyLocalOnly,method==='session/resume');assert.deepEqual(agent.state.messages,messages);
    assert.deepEqual(JSON.parse(await readFile(join(agent.storageDir,'index.json'),'utf8')).sessions.session.messages,messages);
    const restoration=f.peer.calls.find(call=>call.method===method);
    assert.deepEqual(restoration.params,{sessionId:'session',cwd:f.root,mcpServers:[],_meta:agent.sessionMeta()});
    if(provider==='grok'){
      assert.ok(f.peer.calls.some(call=>call.method==='authenticate'));
      assert.ok(f.peer.calls.some(call=>call.method==='_x.ai/yolo_mode_changed' && call.params.yolo_mode===false));
    }
  }
  const methods=f.peers.flatMap(peer=>peer.calls.map(call=>call.method));
  assert.equal(methods.filter(value=>value==='session/new').length,1);
  assert.equal(methods.filter(value=>value===method).length,2);
  assert.equal(methods.includes(method==='session/load'?'session/resume':'session/load'),false);
  assert.equal(methods.includes('session/prompt'),false);
});

test('resume-only empty history stays usable and history viewing does not restore another connection',async t=>{
  const f=await acp(t,'custom-empty-resume',{initialization:{agentCapabilities:resumeCapabilities}}), agent=await f.restart();
  assert.equal(agent.state.connection,'ready',agent.state.error);assert.deepEqual(agent.state.messages,[]);
  const count=f.peers.length, history=await agent.history('session');
  assert.equal(history.localOnly,true);assert.deepEqual(history.turns,[]);assert.equal(f.peers.length,count);
  await agent.send('new synthetic request');await waitFor(()=>f.peer.calls.some(call=>call.method==='session/prompt'));
  const duringTurn=await agent.history('session');assert.equal(duringTurn.localOnly,true);assert.equal(f.peers.length,count);
  f.peer.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'new synthetic answer'}});f.peer.finish();await agent.run;
  assert.equal(agent.state.messages.at(-1).text,'new synthetic answer');assert.equal(agent.state.messages.at(-1).turnStatus,'completed');
});

for(const [name,capabilities,error,connection] of [
  ['unsupported',{},null,'error'],
  ['null resume',{sessionCapabilities:{resume:null}},null,'error'],
  ['missing session',resumeCapabilities,{code:-32002,message:'Session not found'},'error'],
  ['authentication',resumeCapabilities,{code:-32000,message:'Authentication required'},'authentication'],
  ['load failure with resume available',{loadSession:true,...resumeCapabilities},{code:-32002,message:'Session not found'},'error'],
]) test(`ACP restore ${name} preserves stored ID and cache without creating or retrying a session`,async t=>{
  const f=await acp(t,'custom-restore-failure',{initialization:{agentCapabilities:capabilities},restore:{error}}), messages=cachedConversation();
  f.agent.state.messages=structuredClone(messages);await f.agent.persist();
  const files=['index.json','session.json'], before=await Promise.all(files.map(name=>readFile(join(f.agent.storageDir,name))));
  const agent=await f.restart();
  assert.equal(agent.state.connection,connection);assert.equal(agent.state.threadId,'session');assert.equal(agent.state.restored,false);
  assert.deepEqual(agent.state.messages,messages);assert.equal(agent.endpoints.size,0);
  assert.deepEqual(await Promise.all(files.map(name=>readFile(join(agent.storageDir,name)))),before);
  const methods=f.peer.calls.map(call=>call.method);
  assert.deepEqual(methods,error?['initialize',capabilities.loadSession?'session/load':'session/resume']:['initialize']);
  assert.match(agent.state.error,error?new RegExp(error.message):/不支持恢复已有会话/);
});

for(const failure of ['disconnect','timeout','close']) test(`pending ACP resume ${failure} cannot erase cache or revive the closed connection`,async t=>{
  const started=deferred(), f=await acp(t,'custom-pending-resume',{initialization:{agentCapabilities:resumeCapabilities},restore:{pending:true,onRequest:()=>started.resolve()}}), messages=cachedConversation();
  f.agent.state.messages=structuredClone(messages);await f.agent.persist();
  const before=await readFile(join(f.agent.storageDir,'index.json'));
  if(failure==='timeout')t.mock.timers.enable({apis:['setTimeout']});
  const opening=f.restart();await Promise.race([started.promise,opening.then(()=>assert.fail('Restore completed without the pending protocol request'))]);
  const agent=f.latestAgent, peer=f.peer;
  if(failure==='disconnect')peer.drop();
  else if(failure==='timeout'){
    t.mock.timers.tick(45000);await opening;
    assert.equal(agent.state.connection,'error');assert.match(agent.state.error,/超时/);
    peer.finishRestore();await new Promise(resolve=>setImmediate(resolve));
    t.mock.timers.reset();
  }else{await agent.close();peer.finishRestore();}
  await opening;
  assert.deepEqual(agent.state.messages,messages);assert.equal(agent.endpoints.size,0);
  assert.deepEqual(await readFile(join(agent.storageDir,'index.json')),before);
  if(failure==='disconnect')assert.equal(agent.state.connection,'error');
  assert.equal(f.peers.flatMap(peer=>peer.calls).some(call=>call.method==='session/prompt'),false);
});

test('resume cache is never delivery evidence and uncertain submissions keep their draft without resending',async t=>{
  const f=await acp(t,'custom-resume-receipt',{initialization:{agentCapabilities:resumeCapabilities}});
  const message={id:'cached-user',role:'user',text:'do this once',complete:true,turnStatus:'unknown'};
  f.agent.state.messages=[message];await f.agent.persist();
  const store=new WorkspaceStore(f.root);await store.load();await store.add(f.root);
  const target={provider:f.agent.provider,cwd:f.root,threadId:'session'};
  await store.saveDraft(target,message.text);
  await store.transaction(data=>{data.submissions={[target.provider]:{id:'unconfirmed',status:'unknown',text:message.text,target,originalTarget:target,userMessageId:message.id,baseline:submissionBaseline([])}};});
  const agent=await f.restart();assert.equal(agent.state.connection,'ready',agent.state.error);
  const guard=new SubmissionGuard(store), active=agent.active;
  const result=await guard.reconcile(agent,target.provider,'unconfirmed');
  assert.equal(result.status,'unknown');assert.equal(store.draft(target),message.text);assert.equal(agent.active,active);assert.equal(agent.endpoints.size,1);
  assert.deepEqual(agent.state.messages,[message]);
  await assert.rejects(guard.send(agent,target.provider,message.text),/核查/);
  const methods=f.peers.flatMap(peer=>peer.calls.map(call=>call.method));
  assert.equal(methods.filter(method=>method==='session/resume').length,1);assert.equal(methods.includes('session/prompt'),false);assert.equal(methods.includes('session/load'),false);
});

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
