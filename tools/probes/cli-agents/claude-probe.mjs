import { appDependency, outputRoot, requireLiveRun } from './paths.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
requireLiveRun('node tools/probes/cli-agents/claude-probe.mjs --run');
const { query, listSessions, getSessionMessages } = await appDependency('@anthropic-ai/claude-agent-sdk');

const root = outputRoot;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const cwd = resolve(root, 'fixtures', `Claude 中文 path ${runId}`);
const evidenceFile = resolve(root, 'evidence', `claude-${runId}.json`);
const binary = process.env.PROBE_CLAUDE_BINARY || 'claude.exe';
const nonce = `RIN-${randomUUID()}`;
const report = { runId, engine: 'claude-code', sdk: '0.3.240', cwd, isolation: { filesystemSettings: [], tools: ['Read','Write','Edit','Bash','AskUserQuestion'], externalMcp: false, guard: 'PreToolUse path/command allowlist; no OS sandbox claim' }, tests: [], events: [], processes: [] };
let active, client, stage = 'setup', policy = 'deny', pendingHold, readerError, ownedToolPid;
const sleepCommand = `node -e "require('fs').writeFileSync('slow-started.txt',String(process.pid));setTimeout(()=>require('fs').writeFileSync('slow-finished.txt','finished'),60000)"`;
const safeError = e => String(e?.message || e).replace(/(?:sk-ant-|xai-)[\w-]+/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0,2000);
const pause = ms => new Promise(r => setTimeout(r, ms));
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const save = () => writeFile(evidenceFile, JSON.stringify(report, null, 2) + '\n');
function log(type, data = {}) { const event = { at: new Date().toISOString(), stage, type, ...data }; report.events.push(event); console.log(JSON.stringify(event)); }
function check(name, pass, details = {}) { const item = { name, pass, status:pass===null?'blocked':pass?'pass':'fail', ...details }; report.tests.push(item); console.log(JSON.stringify({ test: item })); return pass; }
async function timed(promise, ms, label) { let timer; try { return await Promise.race([promise, new Promise((_,reject) => {timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]); } finally { clearTimeout(timer); } }
function channel() { let queued=[], waiters=[], closed=false; return { push(value) { if(closed)throw new Error('Input closed'); const waiter=waiters.shift(); if(waiter)waiter({value,done:false});else queued.push(value); }, close(){closed=true; for(const w of waiters.splice(0))w({done:true});}, [Symbol.asyncIterator](){return this;}, next(){if(queued.length)return Promise.resolve({value:queued.shift(),done:false});if(closed)return Promise.resolve({done:true});return new Promise(r=>waiters.push(r));} }; }
function inside(file) { if(typeof file!=='string')return false; const rel=relative(cwd,resolve(cwd,file));return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel); }
function permitted(tool, input) { if(tool==='AskUserQuestion')return true;if(['Read','Write','Edit'].includes(tool))return inside(input.file_path);if(tool==='Bash')return input.command===sleepCommand&&input.run_in_background!==true;return false; }

async function open(resume) {
  const input = channel(); let pid;
  const q = query({prompt:input,options:{
    cwd,pathToClaudeCodeExecutable:binary,settingSources:[],strictMcpConfig:true,mcpServers:{},
    tools:report.isolation.tools,permissionMode:'default',maxTurns:6,includePartialMessages:true,
    ...(resume?{resume}:{}),
    env:{...process.env,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'},
    settings:{permissions:{ask:['Write','Edit','Bash']}},
    systemPrompt:{type:'preset',preset:'claude_code',append:'This is an explicitly authorized isolated Rin Desktop protocol test. Only operate in the current fixture directory. Do exactly the requested one-step test. Do not read other projects, credentials, network resources, or user files. Do not launch subagents or background tasks. Stop after a denied operation and report it; never find a workaround. Keep answers short.'},
    hooks:{PreToolUse:[{hooks:[async h=>{
      const tool=h.tool_name, data=h.tool_input??{}, ok=permitted(tool,data);
      log('pre-tool',{tool,allowedByFixtureGuard:ok});
      if(!ok)return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Outside the exact isolated test operation.'}};
      return {};
    }]}]},
    canUseTool:async(tool,data,context)=>{
      log('permission-request',{tool,policy,toolUseID:context.toolUseID,file:typeof data.file_path==='string'?relative(cwd,data.file_path):undefined});
      if(!permitted(tool,data))return {behavior:'deny',message:'Outside isolated fixture.'};
      if(tool==='AskUserQuestion'){
        const answers=Object.fromEntries((data.questions??[]).map(question=>[question.question,'BLUE']));
        log('question-answer',{answers:Object.values(answers)});
        return {behavior:'allow',updatedInput:{...data,answers}};
      }
      if(policy==='hold'){
        return new Promise(resolvePermission=>{
          let done=false;const release=()=>{if(done)return;done=true;log('permission-cancelled',{aborted:context.signal.aborted});resolvePermission({behavior:'deny',message:'Test user cancelled the waiting permission.',interrupt:true});};
          context.signal.addEventListener('abort',release,{once:true});pendingHold={release,signal:context.signal};
        });
      }
      const allow=policy==='allow';log('permission-answer',{tool,decision:allow?'allow':'deny'});
      return allow?{behavior:'allow',updatedInput:data}:{behavior:'deny',message:'Test user explicitly denied this fixture action. Do not retry it or use another tool.'};
    },
    spawnClaudeCodeProcess:options=>{
      const child=spawn(options.command,options.args,{cwd:options.cwd,env:options.env,signal:options.signal,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      pid=child.pid;const record={pid,startedAt:new Date().toISOString(),resume:!!resume};report.processes.push(record);
      let stderrBytes=0;child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;});child.once('exit',(code,signal)=>{Object.assign(record,{exitCode:code,signal,stderrBytes,exitedAt:new Date().toISOString()});});
      return child;
    }
  }});
  const read=(async()=>{try{for await(const message of q){
    if(message.type==='system'&&message.subtype==='init'){report.sessionId=message.session_id;report.model=message.model;report.permissionMode=message.permissionMode;log('initialized',{sessionId:message.session_id,model:message.model,permissionMode:message.permissionMode});}
    if(message.type==='stream_event'&&message.event?.type==='content_block_delta'&&message.event.delta?.type==='text_delta'){if(active)active.deltas++;}
    if(message.type==='assistant')for(const part of message.message.content??[])if(part.type==='tool_use')log('tool-use',{tool:part.name,id:part.id});
    if(message.type==='result'){
      const summary={subtype:message.subtype,isError:message.is_error,stopReason:message.stop_reason,sessionId:message.session_id,text:message.result??'',errors:message.errors??[],estimatedCostUsd:message.total_cost_usd,deltas:active?.deltas??0,durationMs:message.duration_ms};
      log('result',summary);const run=active;active=null;run?.resolve(summary);
    }
  }}catch(e){readerError=safeError(e);if(active){active.reject(e);active=null;}log('reader-ended',{error:readerError});}})();
  return {q,input,read,get pid(){return pid;},async close(){input.close();q.close();await timed(read,8000,'reader shutdown').catch(e=>log('shutdown-error',{error:safeError(e)}));}};
}
function turn(text,name,mode='deny') { if(active)throw new Error('Turn already active');stage=name;policy=mode;const promise=new Promise((resolve,reject)=>{active={resolve,reject,deltas:0};});client.input.push({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,uuid:randomUUID()});return timed(promise,100000,name); }
async function until(test,label,limit=20000){const started=Date.now();while(Date.now()-started<limit){if(await test())return;await pause(100);}throw new Error(`${label} not observed`);}
async function test(name,fn){try{await fn();}catch(e){check(name,e.blocked?null:false,{error:safeError(e)});await save();throw e;}await save();}

await mkdir(cwd,{recursive:true});await mkdir(resolve(root,'evidence'),{recursive:true});
try{
  report.cliVersion=execFileSync(binary,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
  const auth=JSON.parse(execFileSync(binary,['auth','status','--json'],{encoding:'utf8',windowsHide:true,timeout:20000}));
  report.authStatus={loggedIn:auth.loggedIn,authMethod:auth.authMethod,apiProvider:auth.apiProvider,subscriptionType:auth.subscriptionType};
  if(!auth.loggedIn||auth.authMethod!=='claude.ai'||auth.apiProvider!=='firstParty')throw new Error('Expected an existing first-party Claude subscription login; no fallback attempted.');
  client=await open();
  const account=await timed(client.q.accountInfo(),30000,'accountInfo');
  report.sdkAccount={subscriptionType:account.subscriptionType,tokenSource:account.tokenSource,apiKeySource:account.apiKeySource,apiProvider:account.apiProvider};log('account',report.sdkAccount);
  const models=await timed(client.q.supportedModels(),30000,'supportedModels');report.models=models.map(m=>({value:m.value,displayName:m.displayName}));
  const light=models.find(m=>/haiku/i.test(m.value));if(light){await client.q.setModel(light.value);report.selectedModel=light.value;}
  await test('existing-login-and-stream',async()=>{const r=await turn(`记住本次会话标记 ${nonce}。不要调用工具，用中文简短确认并原样重复标记。`,'login-stream');if(r.isError){report.blockedReason='existing-authentication';const error=new Error(r.text);error.blocked=true;throw error;}check('existing-login-and-stream',r.text.includes(nonce)&&r.deltas>0,{deltas:r.deltas});});
  await test('approve-write',async()=>{const before=report.events.length;const file=join(cwd,'allowed.txt');await turn(`请用 Write 工具在 ${file} 写入内容 APPROVED。只做这一件事，等客户端审批后执行。`,'approve-write','allow');check('approve-write',await exists(file)&& (await readFile(file,'utf8')).trim()==='APPROVED'&&report.events.slice(before).some(e=>e.type==='permission-answer'&&e.decision==='allow'));});
  await test('deny-write',async()=>{const before=report.events.length;const file=join(cwd,'denied.txt');await turn(`请用 Write 工具在 ${file} 写入内容 MUST-NOT-EXIST。客户端会拒绝；收到拒绝后立即停止，不得换工具或路径。`,'deny-write','deny');check('deny-write',!(await exists(file))&&report.events.slice(before).some(e=>e.type==='permission-answer'&&e.decision==='deny'));});
  await test('question-roundtrip',async()=>{const before=report.events.length;const r=await turn('请调用 AskUserQuestion 工具问我本次测试应选择 BLUE 还是 GREEN，等待客户端回答，然后只输出收到的颜色。','question');check('question-roundtrip',r.text.includes('BLUE')&&report.events.slice(before).some(e=>e.type==='question-answer'));});
  await test('cancel-running-tool',async()=>{
    const result=turn(`请使用 Bash 工具执行且只执行以下命令，不放到后台，不改变命令：\n${sleepCommand}\n这会在本目录记录启动 PID，等待一分钟再创建完成标记。`,'cancel-running-tool','allow');
    await until(()=>exists(join(cwd,'slow-started.txt')),'slow tool start',60000);
    const toolPid=Number((await readFile(join(cwd,'slow-started.txt'),'utf8')).trim());ownedToolPid=toolPid;const started=Date.now();const receipt=await timed(client.q.interrupt(),15000,'interrupt');
    const r=await timed(result,20000,'interrupted turn result');await pause(1500);
    let toolAlive=false;try{process.kill(toolPid,0);toolAlive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
    check('cancel-running-tool',!toolAlive&&!(await exists(join(cwd,'slow-finished.txt'))),{interruptMs:Date.now()-started,toolPid,toolAlive,stopReason:r.stopReason,receipt});
    if(toolAlive){execFileSync('taskkill.exe',['/PID',String(toolPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});log('fixture-cleanup',{toolPid,reason:'cancel left owned fixture sleeper alive'});}
    ownedToolPid=undefined;
  });
  await test('cancel-pending-approval',async()=>{
    pendingHold=null;const file=join(cwd,'pending.txt');const result=turn(`请用 Write 工具在 ${file} 写入内容 MUST-NOT-EXIST。只尝试一次并等待审批。`,'cancel-pending-approval','hold');
    await until(()=>!!pendingHold,'pending permission',60000);const started=Date.now();const interrupt=client.q.interrupt();await pause(300);
    const signalAborted=pendingHold.signal.aborted;pendingHold.release();await timed(interrupt,15000,'permission interrupt');const r=await timed(result,20000,'permission cancel result');
    check('cancel-pending-approval',!(await exists(file)),{signalAborted,interruptMs:Date.now()-started,stopReason:r.stopReason});
  });
  const sessionId=report.sessionId;await client.close();client=null;await pause(500);
  const sessions=await listSessions({dir:cwd});const history=await getSessionMessages(sessionId,{dir:cwd});
  check('history-after-process-exit',sessions.some(s=>s.sessionId===sessionId)&&history.length>0,{historyMessages:history.length,sessionListed:sessions.some(s=>s.sessionId===sessionId)});await save();
  await test('resume-after-process-exit',async()=>{client=await open(sessionId);const r=await turn('不要读任何文件，也不要调用工具。请原样输出这段会话第一轮让我记住的完整 RIN- 标记。','resume');check('resume-after-process-exit',r.sessionId===sessionId&&!r.isError&&r.text.includes(nonce),{sameSession:r.sessionId===sessionId});});
}catch(e){report.fatalError=safeError(e);log('probe-failed',{error:report.fatalError});process.exitCode=1;}
finally{if(pendingHold)pendingHold.release();if(client)await client.close();if(ownedToolPid){try{process.kill(ownedToolPid,0);execFileSync('taskkill.exe',['/PID',String(ownedToolPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});log('fixture-cleanup',{toolPid:ownedToolPid});}catch{}}await pause(500);report.finishedAt=new Date().toISOString();report.passed=report.tests.filter(t=>t.pass===true).length;report.failed=report.tests.filter(t=>t.pass===false).length;report.blocked=report.tests.filter(t=>t.pass===null).length;process.exitCode=report.failed?1:report.blocked?2:process.exitCode??0;await save();console.log(JSON.stringify({evidenceFile,passed:report.passed,failed:report.failed,blocked:report.blocked,fatalError:report.fatalError}));}
