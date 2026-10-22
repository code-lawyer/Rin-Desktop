import { appDependency, outputRoot, requireLiveRun } from './paths.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
requireLiveRun('node tools/probes/cli-agents/acp-probe.mjs grok|opencode --run [--full] [--only=test-name]');
const { ClientSideConnection, ndJsonStream } = await appDependency('@agentclientprotocol/sdk');

const engine=process.argv[2];
if(!['grok','opencode'].includes(engine))throw new Error('Usage: node acp-probe.mjs grok|opencode --run [--full]');
const full=process.argv.includes('--full');
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const root=outputRoot;
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const cwd=resolve(root,'fixtures',`${engine} 中文 path ${runId}`);
const binary=engine==='grok'?(process.env.PROBE_GROK_BINARY||'grok.exe'):(process.env.PROBE_OPENCODE_BINARY||'opencode.exe');
const evidenceFile=resolve(root,'evidence',`${engine}-${runId}.json`);
const nonce=`RIN-${randomUUID()}`;
const report={engine,runId,cwd,sdk:'@agentclientprotocol/sdk@1.9.0',full,only,tests:[],events:[],processes:[],isolation:{scope:'Dedicated fixture and native CLI account/session storage; not an OS sandbox',approval:'Scripted allow_once/reject_once only; no durable grants',credentials:'Native CLI only; no credential file reads or token capture'}};
let client,stage='setup',policy='deny',active,inFlight,sessionId,pendingHold,ownedToolPid;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const safeError=e=>String(e?.message??e).replace(/(?:sk-ant-|xai-)[\w-]+/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,1500);
const exists=async p=>{try{await stat(p);return true;}catch{return false;}};
const save=()=>writeFile(evidenceFile,JSON.stringify(report,null,2)+'\n');
function log(type,data={}){const event={at:new Date().toISOString(),stage,type,...data};report.events.push(event);console.log(JSON.stringify(event));}
function check(name,pass,details={}){const test={name,status:pass?'pass':'fail',...details};report.tests.push(test);console.log(JSON.stringify({test}));return pass;}
function blocked(name,reason){const test={name,status:'blocked',reason};report.tests.push(test);console.log(JSON.stringify({test}));}
async function timed(p,ms,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]);}finally{clearTimeout(timer);}}
function inside(path){if(typeof path!=='string')return false;const rel=relative(cwd,resolve(cwd,path));return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);}
const sleepCommand=`node -e "require('fs').writeFileSync('slow-started.txt',String(process.pid));setTimeout(()=>require('fs').writeFileSync('slow-finished.txt','finished'),60000)"`;
function guardCall(call){const input=call.rawInput??{};const command=input.command??input.cmd;const paths=(call.locations??[]).map(l=>l.path);for(const key of ['file_path','filePath','path'])if(typeof input[key]==='string')paths.push(input[key]);if(command){const dir=input.workdir??input.cwd??input.working_directory;return command===sleepCommand&&(!dir||resolve(dir)===cwd)&&input.is_background!==true&&input.run_in_background!==true;}if(paths.length)return paths.every(inside);return false;}
const sessionMeta=engine==='grok'?{yoloMode:false,autoMode:false,'x.ai/hooks':{pre_tool_use:[{hookCallbackIds:['fixture-guard']}]}}:{};
async function open(){
  const args=engine==='grok'?['--no-auto-update','--permission-mode','default','--no-subagents','--disable-web-search','--tools','Read,Write,Edit,Bash,AskUserQuestion','agent','--no-leader','stdio']:['acp'];
  const child=spawn(binary,args,{cwd,env:{...process.env,GROK_LOGIN_ENV:'0'},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const record={pid:child.pid,startedAt:new Date().toISOString()};report.processes.push(record);
  let stderr='';child.stderr.on('data',b=>{record.stderrBytes=(record.stderrBytes??0)+b.length;stderr=(stderr+b.toString()).slice(-12000);});
  const exited=new Promise(resolveExit=>child.once('exit',(code,signal)=>{Object.assign(record,{exitCode:code,signal,exitedAt:new Date().toISOString()});resolveExit();}));
  child.on('error',e=>log('process-error',{error:safeError(e)}));
  const close=async()=>{pendingHold?.();child.stdin.end();try{await timed(exited,10000,'EOF exit');}catch{record.forcedCleanup=true;execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await exited;}};
  client={child,record,close,stderrSummary:()=>safeError(stderr)};
  const conn=new ClientSideConnection(()=>({
    sessionUpdate({update}){
      if(update.sessionUpdate==='session_info_update'&&update._meta?.['opencode/retry'])log('provider-retry',{retry:update._meta['opencode/retry']});
      if(update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'){if(active){active.text+=update.content.text;active.chunks++;}else report.replayChunks=(report.replayChunks??0)+1;}
      if(['tool_call','tool_call_update'].includes(update.sessionUpdate))log('tool',{id:update.toolCallId,kind:update.kind,title:update.title,status:update.status});
    },
    requestPermission(params){
      const allowed=guardCall(params.toolCall);log('permission-request',{policy,fixtureAllowed:allowed,toolCall:params.toolCall,options:params.options});
      if(policy==='hold')return new Promise(resolvePermission=>{pendingHold=()=>{log('permission-answer',{decision:'cancelled'});resolvePermission({outcome:{outcome:'cancelled'}});pendingHold=null;};});
      const kind=policy==='allow'&&allowed?'allow_once':'reject_once';const option=params.options.find(o=>o.kind===kind);log('permission-answer',{decision:kind});
      return {outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}};
    },
    extMethod(method,params){
      const wireMethod=method;method=method.replace(/^_/,'');log('extension-request',{method,wireMethod,keys:Object.keys(params)});
      if(method==='x.ai/hooks/run'){
        const tool=params.toolName??params.tool_name;const input=params.toolInput??params.tool_input??{};
        const ok=(/ask_user_question|AskUserQuestion/.test(tool)||guardCall({rawInput:input}))&&!/always|bypass/i.test(params.permissionMode??'');
        log('pre-tool',{tool,fixtureAllowed:ok,permissionMode:params.permissionMode});return ok?{}:{decision:'deny',systemMessage:'Outside the exact isolated fixture operation; stop without a workaround.'};
      }
      if(method==='x.ai/ask_user_question')return {outcome:'accepted',answers:Object.fromEntries((params.questions??[]).map(q=>[q.question,[q.options?.find(o=>o.label.includes('BLUE'))?.label??q.options?.[0]?.label??'BLUE']]))};
      if(method==='x.ai/folder_trust/request')return {outcome:'reject'};
      if(method==='x.ai/mcp/elicit')return {outcome:'cancel'};
      throw new Error(`Unsupported extension ${method}`);
    },
    createElicitation(params){log('question-form',{mode:params.mode});const content={};for(const [key,schema]of Object.entries(params.requestedSchema?.properties??{})){if(key.endsWith('_custom'))continue;content[key]=schema.oneOf?.find(o=>String(o.const).includes('BLUE'))?.const??schema.oneOf?.[0]?.const??schema.enum?.[0]??'BLUE';}return {action:'accept',content};},
    extNotification(){}
  }),ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout)));
  const init=await timed(conn.initialize({protocolVersion:1,clientInfo:{name:'rin-isolated-validation',version:'0.0.1'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false,elicitation:{form:{}}},_meta:{clientIdentifier:'rin-isolated-validation',startupHints:{nonInteractive:false}}}),45000,'initialize');
  report.initialization={protocolVersion:init.protocolVersion,agentInfo:init.agentInfo,agentCapabilities:init.agentCapabilities,authMethods:init.authMethods?.map(m=>({id:m.id,name:m.name,type:m.type})),metaKeys:Object.keys(init._meta??{})};
  log('initialized',report.initialization);
  const api={conn,init,child,record,close,stderrSummary(){return safeError(stderr);}};
  client=api;
  if(engine==='grok'){
    if(!init.authMethods?.some(m=>m.id==='cached_token')){report.blockedReason='cached-login-not-advertised';throw new Error('Grok did not advertise cached_token; native login required.');}
    await timed(conn.authenticate({methodId:'cached_token',_meta:{headless:true}}),30000,'cached authentication');log('native-auth-accepted',{methodId:'cached_token'});
  }
  return api;
}
async function turn(text,name,mode='deny'){if(inFlight)throw new Error('Previous prompt has not settled');stage=name;policy=mode;active={text:'',chunks:0};const collected=active;log('prompt-started',{name});inFlight=client.conn.prompt({sessionId,prompt:[{type:'text',text:'This is a new independent, explicitly authorized fixture test. Earlier denial/cancellation ended the previous task only; do not retry any denied operation.\n'+text}]});try{const response=await timed(inFlight,90000,name);const result={...response,text:collected.text,chunks:collected.chunks};log('prompt-result',result);return result;}catch(e){log('prompt-error',{message:safeError(e),code:e.code,data:e.data});throw e;}finally{active=null;inFlight=null;}}
async function until(test,label,result,limit=45000){const started=Date.now();let ended=false;result?.then(()=>{ended=true;},()=>{ended=true;});while(Date.now()-started<limit){if(await test())return;if(ended)throw new Error(`Turn ended before ${label}`);await pause(100);}throw new Error(`${label} not observed`);}
async function runCheck(name,fn){if(only&&!only.includes(name))return;try{await fn();}catch(e){check(name,false,{error:safeError(e)});await client.conn.cancel({sessionId}).catch(()=>{});pendingHold?.();if(inFlight)await timed(inFlight,15000,'settle cancelled prompt');}await save();}
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
function cleanSleeper(){if(ownedToolPid&&alive(ownedToolPid)){execFileSync('taskkill.exe',['/PID',String(ownedToolPid),'/T','/F'],{windowsHide:true,stdio:'ignore'});log('fixture-cleanup',{pid:ownedToolPid});}ownedToolPid=undefined;}
async function extended(){
  await runCheck('approve-write',async()=>{const before=report.events.length;const file=join(cwd,'allowed.txt');await turn(`Use the file write tool once to create ${file} with exactly APPROVED. Wait for client permission. Do not use shell or any other path.`,'approve-write','allow');check('approve-write',await exists(file)&&(await readFile(file,'utf8')).trim()==='APPROVED'&&report.events.slice(before).some(e=>e.type==='permission-answer'&&e.decision==='allow_once'));});
  await runCheck('deny-write',async()=>{const before=report.events.length;const file=join(cwd,'denied.txt');await turn(`Use the file write tool once to create ${file} with MUST-NOT-EXIST. The client will deny it. After denial, stop immediately. Do not retry or use another tool or path.`,'deny-write');check('deny-write',!await exists(file)&&report.events.slice(before).some(e=>e.type==='permission-answer'&&e.decision==='reject_once'));});
  await runCheck('question-roundtrip',async()=>{const before=report.events.length;const r=await turn('Use your question tool to ask the client to choose BLUE or GREEN. Wait for its answer, then repeat the chosen color. Do not just ask as chat text.','question');check('question-roundtrip',r.text.includes('BLUE')&&report.events.slice(before).some(e=>e.type==='question-form'||e.method==='x.ai/ask_user_question'));});
  await runCheck('cancel-running-tool',async()=>{
    const result=turn(`Run exactly this one command with the shell/terminal tool in the current directory, do not change it, and keep it in foreground:\n${sleepCommand}\nIt records its PID, waits one minute and creates a completion marker. Wait for the tool; do nothing else.`,'cancel-running-tool','allow');result.catch(()=>{});
    try{await until(()=>exists(join(cwd,'slow-started.txt')),'sleeper start',result);ownedToolPid=Number((await readFile(join(cwd,'slow-started.txt'),'utf8')).trim());const started=Date.now();await client.conn.cancel({sessionId});pendingHold?.();const r=await timed(result,20000,'cancel response');await pause(1500);const toolAlive=alive(ownedToolPid);check('cancel-running-tool',r.stopReason==='cancelled'&&!toolAlive&&!await exists(join(cwd,'slow-finished.txt')),{stopReason:r.stopReason,elapsedMs:Date.now()-started,toolPid:ownedToolPid,toolAlive});}finally{cleanSleeper();}
  });
  await runCheck('followup-after-stop',async()=>{const started=Date.now();const r=await turn('Do not use any tools. Reply with exactly READY.','followup-after-stop');check('followup-after-stop',r.text.includes('READY'),{elapsedMs:Date.now()-started});});
  await runCheck('cancel-pending-approval',async()=>{
    pendingHold=null;const file=join(cwd,'pending.txt');const result=turn(`Use the file write tool once to create ${file} with MUST-NOT-EXIST. Wait for permission and do nothing else.`,'cancel-pending-approval','hold');result.catch(()=>{});
    await until(()=>!!pendingHold,'pending permission',result);const started=Date.now();await client.conn.cancel({sessionId});pendingHold?.();const r=await timed(result,20000,'cancel pending result');check('cancel-pending-approval',r.stopReason==='cancelled'&&!await exists(file),{stopReason:r.stopReason,elapsedMs:Date.now()-started});
  });
  await runCheck('cancel-streaming',async()=>{
    const result=turn('Do not call tools. Produce a numbered list from 1 to 1000, one item per line, with one short sentence about counting at each number. Start immediately.','cancel-streaming');result.catch(()=>{});await until(()=>active?.chunks>=3,'stream chunks',result);const started=Date.now();await client.conn.cancel({sessionId});const r=await timed(result,20000,'stream cancel result');check('cancel-streaming',r.stopReason==='cancelled',{elapsedMs:Date.now()-started,chunks:r.chunks});
  });
}
await mkdir(cwd,{recursive:true});await mkdir(resolve(root,'evidence'),{recursive:true});
execFileSync('git.exe',['-c','init.defaultBranch=probe','init','--quiet',cwd],{windowsHide:true,stdio:'ignore'});
await writeFile(join(cwd,'AGENTS.md'),'Isolated protocol validation only. Never access files outside this directory, credentials, network tools or subagents. Follow each single-step request exactly. Stop the current turn after a denied action; never retry or work around it. Later user turns may authorize separate independent tests.\n');
await mkdir(join(cwd,'.grok'),{recursive:true});await writeFile(join(cwd,'.grok','config.toml'),'[ui]\npermission_mode = "ask"\nremember_tool_approvals = false\n[permission]\nask = ["Read", "Write", "Edit", "Bash"]\ndeny = ["Agent", "WebFetch", "WebSearch", "MCPTool(*)"]\n');
await writeFile(join(cwd,'opencode.json'),JSON.stringify({snapshots:false,permissions:[{action:'*',resource:'*',effect:'deny'},...['read','edit','shell'].map(action=>({action,resource:'*',effect:'ask'})),{action:'question',resource:'*',effect:'allow'},{action:'external_directory',resource:'*',effect:'deny'}],policies:[{action:'integration.use',resource:'*',effect:'deny'}]},null,2));
try{
  report.cliVersion=execFileSync(binary,['--version'],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
  if(engine==='opencode'){const listing=execFileSync(binary,['auth','list'],{encoding:'utf8',windowsHide:true,timeout:15000});report.existingAuthenticatedIntegration=!listing.includes('No authenticated integrations');if(!report.existingAuthenticatedIntegration)blocked('existing-login-reuse','Native auth list: No authenticated integrations. Free built-in model tests do not prove login reuse.');}
  await open();check('acp-initialize',true);await save();
  const session=await timed(client.conn.newSession({cwd,mcpServers:[],_meta:sessionMeta}),30000,'session/new');sessionId=session.sessionId;report.sessionId=sessionId;report.sessionConfiguration=session;log('session-created',{sessionId,configOptions:session.configOptions});await save();
  if(engine==='grok'){await client.conn.extNotification('_x.ai/yolo_mode_changed',{yolo_mode:false,auto_mode:false,permission_mode:'ask'});log('session-permission-override',{yolo_mode:false,auto_mode:false,scope:'Dedicated no-leader process only'});}
  let baseline;
  try{baseline=await turn(`不要调用工具。记住本次会话标记 ${nonce}，用中文确认并原样重复标记。`,'login-stream');const ok=baseline.text.includes(nonce)&&baseline.chunks>0;check('native-model-stream',ok,{chunks:baseline.chunks});if(engine==='grok')check('existing-login-reuse',ok,{authMethod:'cached_token'});}
  catch(e){report.blockedReason='native-request-failed';blocked('native-model-stream',safeError(e));}
  await save();
  if((full||only)&&baseline?.text.includes(nonce))await extended();
  if(client.init.agentCapabilities?.sessionCapabilities?.list){const listed=await timed(client.conn.listSessions({cwd}),15000,'session/list');check('session-list',listed.sessions?.some(s=>s.sessionId===sessionId),{scopedCount:listed.sessions?.length});}
  const oldPid=client.child.pid;await client.close();check('stdin-eof-process-exit',!client.record.forcedCleanup,{pid:oldPid,exitCode:client.record.exitCode});client=null;await save();
  await open();stage='load-after-process-exit';report.replayChunks=0;
  const loaded=await timed(client.conn.loadSession({sessionId,cwd,mcpServers:[],_meta:sessionMeta}),30000,'session/load');report.loadedConfiguration=loaded;check('session-load-after-process-exit',true,{replayChunks:report.replayChunks});
  if(engine==='grok')await client.conn.extNotification('_x.ai/yolo_mode_changed',{yolo_mode:false,auto_mode:false,permission_mode:'ask'});
  if(baseline?.text.includes(nonce)){const resumed=await turn('不要读文件或使用工具。只输出本会话最开始记住的完整 RIN- 标记。','resume');check('resume-context',resumed.text.includes(nonce));}
  else blocked('resume-context','Native model request unavailable; load handshake alone is not context continuity proof.');
}catch(e){report.fatalError=safeError(e);report.errorCode=e.code;report.errorData=e.data?JSON.parse(JSON.stringify(e.data)):undefined;log('probe-stopped',{error:report.fatalError,code:report.errorCode,data:report.errorData});if(client?.record.exitCode!==undefined)report.startupStderr=client.stderrSummary();process.exitCode=1;}
finally{cleanSleeper();if(client)await client.close();report.finishedAt=new Date().toISOString();process.exitCode=report.fatalError||report.tests.some(t=>t.status==='fail')?1:report.tests.some(t=>t.status==='blocked')?2:0;await save();console.log(JSON.stringify({evidenceFile,tests:report.tests,blockedReason:report.blockedReason,fatalError:report.fatalError}));}
