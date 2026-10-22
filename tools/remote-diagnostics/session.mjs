import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { LocalSpeech } from '../../prototypes/live2d-codex/backend/speech.mjs';

const root = resolve(import.meta.dirname, '../..');
const { values: args } = parseArgs({ options: { directory:{type:'string'}, seconds:{type:'string',default:'600'} } });
const directory = args.directory ? resolve(args.directory) : join(root,'work/runtime',`rc003-${Date.now()}`);
if (!directory.startsWith(join(root,'work/runtime')+'\\') && !directory.startsWith(join(root,'work/runtime')+'/')) throw new Error('Session directory must be inside work/runtime');
await mkdir(directory,{recursive:true});
let statusQueue=Promise.resolve();
const status = message => statusQueue=statusQueue.catch(()=>{}).then(()=>writeFile(join(directory,'status.json'),JSON.stringify({message})));
await status('正在连接遥控器语音服务……');
const speech = new LocalSpeech(join(root,'prototypes/live2d-codex/models'),{executable:process.execPath});
const result = {schema:1,date:new Date().toISOString(),session:directory.split(/[\\/]/).at(-1),asrModel:'SenseVoice int8',recordings:[],audioUploaded:false,audioPersisted:false,transcriptPersisted:false};
let transcribing=false, finished=false, raw='';
const pending = [];
const python = spawn(join(root,'work/runtime/rc003-probe/Scripts/python.exe'),['-u',join(import.meta.dirname,'ble_probe.py'),'--seconds',args.seconds,'--max-sessions','10','--stream-pcm','--stop-file',join(directory,'stop'),'--report',join(directory,'ble.json')],{cwd:root,windowsHide:true,env:{...process.env,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']});
let stderrBytes=0;python.stderr.on('data',bytes=>{stderrBytes+=bytes.length;});
const names = { 'enumerating-paired-device':'正在查找已配对的小米遥控器……','reading-model-and-services':'正在读取型号与语音服务……','waiting-for-capabilities':'正在协商蓝牙语音协议……' };
async function handle(message){
  if(message.event==='phase')await status(names[message.value]??message.value);
  if(message.event==='ready'){result.device=message;console.log(JSON.stringify(message));await status(`语音已就绪：${message.model} / 固件 ${message.firmware} / 16 kHz。请按住语音键说测试句。`);}
  if(message.event==='recording')await status(message.active?'正在接收遥控器语音，请说测试句并松开语音键。':'已松开语音键，正在检查音频……');
  if(message.event==='capture'){result.recordings.push(message);console.log(JSON.stringify(message));}
  if(message.event==='failure'){result.failure=message.code;console.log(JSON.stringify(message));await status('语音连接失败：'+message.code+'。按键检测仍可继续。');}
  if(message.event==='pcm'){
    // Raw PCM exists only in private child-process pipes and temporary memory.
    if(transcribing){await status('上一段尚在识别，本段仅检查音频，请稍后重试。');return;}
    transcribing=true;
    const recording=result.recordings.at(-1);
    try{
      const bytes=Buffer.from(message.samplesBase64,'base64');
      if(bytes.length>16000*60*2||bytes.length%2)throw new Error('INVALID_PCM_SIZE');
      const samples=new Float32Array(bytes.length/2);for(let i=0;i<samples.length;i++)samples[i]=bytes.readInt16LE(i*2)/32768;
      const started=performance.now();const transcript=await speech.transcribe({sampleRate:message.sampleRate,samples});
      const text=transcript.text??'';
      const metadata={recognized:Boolean(text.trim()),characters:text.length,recognitionMs:Math.round(performance.now()-started),expectedPhraseMatched:text.includes('遥控器')&&text.includes('测试')&&/一二三|123|一、二、三/.test(text)};
      recording.localAsr=metadata;console.log(JSON.stringify({event:'local-asr',...metadata}));
      // Do not print or persist the user's words, even for a test sentence.
      const number=result.recordings.filter(item=>item.localAsr?.recognized).length;
      await status(metadata.recognized?`已识别第 ${number}/2 段（${metadata.recognitionMs} ms），测试句匹配：${metadata.expectedPhraseMatched?'是':'否'}。${number<2?'请再按住语音键说一句，先不要关闭。':'两段已完成，可以关闭窗口。'}`:'收到音频但未识别出文字，请靠近遥控器再试一次。');
    }catch(error){result.asrFailure=error.message;console.log(JSON.stringify({event:'asr-failure',code:error.message}));await status('收到音频；本地识别未完成：'+error.message);}
    finally{transcribing=false;}
  }
}
python.stdout.setEncoding('utf8');
python.stdout.on('data',bytes=>{
  raw+=bytes;if(raw.length>4*1024*1024){python.kill();result.failure='PIPE_LIMIT';return;}
  let end;while((end=raw.indexOf('\n'))>=0){const line=raw.slice(0,end);raw=raw.slice(end+1);try{const message=JSON.parse(line);const task=handle(message).catch(()=>{result.failure='CONTROLLER_EVENT_FAILED';});pending.push(task);}catch{result.failure='INVALID_WORKER_MESSAGE';}}
});
python.on('error',error=>{result.failure=error.code??'WORKER_START_FAILED';});
const watchdog=setTimeout(async()=>{await writeFile(join(directory,'stop'),'timeout');setTimeout(()=>{if(!finished)python.kill();},15000).unref();},(Number(args.seconds)+90)*1000);
await new Promise(resolve=>python.once('close',resolve));finished=true;clearTimeout(watchdog);
await Promise.all(pending);speech.close();
result.stderrBytes=stderrBytes;
try {const lines=(await readFile(join(directory,'keys.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);result.keys=lines.findLast(line=>line.event==='summary')??{event:'in-progress',observedRemoteEvents:lines.filter(line=>line.event==='key').length};}catch{result.keys={event:'not-started'};}
await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({event:'session-finished',report:join(directory,'result.json'),recordings:result.recordings.length,failure:result.failure??null}));
