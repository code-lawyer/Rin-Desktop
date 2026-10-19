import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'), app=join(root,'prototypes/live2d-codex');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const output=join(root,'release',`v${version}`), build=join(root,'work/release-build');
await mkdir(output,{recursive:true});await mkdir(build,{recursive:true});
const compiler=process.env.INNO_ISCC||join(build,'tools/inno/ISCC.exe');
const definitions=[
  {id:'asr',label:'中文听写 · SenseVoice',directory:process.env.VIBE_ASR_RESOURCES||join(app,'models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'),sub:'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',required:['model.int8.onnx','tokens.txt']},
  {id:'kokoro',label:'轻量播报 · Kokoro',directory:process.env.VIBE_KOKORO_RESOURCES||join(app,'models/kokoro-int8-multi-lang-v1_1'),sub:'kokoro-int8-multi-lang-v1_1',required:['model.int8.onnx','voices.bin','tokens.txt','lexicon-zh.txt','lexicon-us-en.txt','espeak-ng-data/phondata','dict/jieba.dict.utf8','date-zh.fst','number-zh.fst','phone-zh.fst']},
  {id:'qwen',label:'自然女声 · Qwen3-TTS',directory:process.env.VIBE_QWEN_RESOURCES||join(build,'qwen'),sub:'',required:['python/python.exe','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/config.json','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/model.safetensors','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/speech_tokenizer/model.safetensors']}
];
const manifest={format:1,version,packs:[]};
async function bytes(directory){let total=0;for(const e of await readdir(directory,{withFileTypes:true})){if(['cache','__pycache__','.cache','.git'].includes(e.name)||/\.(pyc|pyo|tmp|log)$/.test(e.name))continue;const file=join(directory,e.name);total+=e.isDirectory()?await bytes(file):(await stat(file)).size;}return total;}
for(const pack of definitions){
  for(const name of pack.required)await stat(join(pack.directory,name));
  const base=`Rin-Desktop-${version}-voice-${pack.id}`;
  if((await readdir(output)).some(name=>name.startsWith(base)))throw new Error(`Resource pack already exists: ${base}. Use a clean output directory to avoid mixing old slices.`);
  const script=`[Setup]
AppName=Rin Desktop ${pack.id} resources
AppVersion=${version}
AppPublisher=code-lawyer
DefaultDirName={localappdata}\\VibeVoice\\voice-resources\\${pack.id}-${version}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Uninstallable=no
CreateUninstallRegKey=no
DisableProgramGroupPage=yes
DirExistsWarning=no
Compression=zip/1
SolidCompression=no
DiskSpanning=yes
DiskSliceSize=1500000000
SlicesPerDisk=1
OutputDir=${output}
OutputBaseFilename=${base}
WizardStyle=modern
LicenseFile=${join(root,'tools/release/license-agreement.txt')}
[Files]
Source: "${resolve(pack.directory)}\\*"; DestDir: "{app}${pack.sub?'\\'+pack.sub:''}"; Excludes: "cache\\*,__pycache__\\*,*.pyc,*.pyo,*.tmp,*.log"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "${join(app,'licenses')}\\*"; DestDir: "{app}\\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
${pack.id==='qwen'?`[Code]\n#include "${join(root,'tools/release/vc-runtime.iss')}"`:''}
`;
  const path=join(build,`voice-${pack.id}.iss`);await writeFile(path,script);
  execFileSync(compiler,['/Qp',path],{windowsHide:true,stdio:'inherit'});
  const files=[];
  for(const name of(await readdir(output)).filter(name=>name.startsWith(base)&&/\.(exe|bin)$/.test(name)).sort()){
    const file=join(output,name),hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    files.push({file:name,bytes:(await stat(file)).size,sha256:hash.digest('hex'),url:`https://github.com/code-lawyer/Rin-Desktop/releases/download/v${version}/${name}`});
  }
  manifest.packs.push({id:pack.id,label:pack.label,unpackedBytes:await bytes(pack.directory)+await bytes(join(app,'licenses')),required:pack.required.map(name=>pack.sub?`${pack.sub}/${name}`:name),files});
  console.log(JSON.stringify({id:pack.id,downloadBytes:files.reduce((sum,f)=>sum+f.bytes,0)}));
}
await writeFile(join(app,'voice-resources.json'),JSON.stringify(manifest,null,2));
await writeFile(join(output,'voice-resources.json'),JSON.stringify(manifest,null,2));
