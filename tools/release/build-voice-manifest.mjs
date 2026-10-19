// Resolve upstream metadata, never package or upload model weights.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), app = join(root, 'prototypes/live2d-codex');
const version = '1.0.0'; // Model/runtime revision, independent of desktop releases.
const definitions = [
  { id:'asr', label:'中文听写 · SenseVoice', repo:'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', revision:'2365baeacb507f821a0c8120fcee3d484dba7a07', modelDirectory:'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', select: name => ['model.int8.onnx','tokens.txt','LICENSE'].includes(name) },
  { id:'kokoro', label:'轻量播报 · Kokoro', repo:'csukuangfj/kokoro-int8-multi-lang-v1_1', revision:'155831f1b4ba23b1f5c058be6a61df90cefb2a37', modelDirectory:'kokoro-int8-multi-lang-v1_1', select: name => name !== '.gitattributes' },
  { id:'qwen', label:'自然女声 · Qwen3-TTS', repo:'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', revision:'0c0e3051f131929182e2c023b9537f8b1c68adfe', modelDirectory:'models/Qwen3-TTS-12Hz-1.7B-CustomVoice', select: name => name !== '.gitattributes' },
];
async function get(url) { const r=await fetch(url); if(!r.ok)throw Error(`Upstream HTTP ${r.status}: ${url}`);return r; }
const manifest={format:2,version,packs:[]};
for(const definition of definitions) {
  const {select,...pack}=definition;
  const metadata=await (await get(`https://huggingface.co/api/models/${pack.repo}/revision/${pack.revision}?blobs=true`)).json();
  if(metadata.sha!==pack.revision)throw Error('Upstream revision mismatch');
  pack.files=[];
  for(const item of metadata.siblings.filter(item=>select(item.rfilename))) {
    const path=item.rfilename, file=`${pack.modelDirectory}/${path}`;
    const url=`https://huggingface.co/${pack.repo}/resolve/${pack.revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
    let sha256=item.lfs?.sha256;
    if(!sha256) {
      const local=pack.id==='qwen'?join(root,'prototypes/qwen-tts-evaluation',file):join(app,'models',file);
      let bytes=await readFile(local).catch(()=>null);
      const blob=data=>createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
      if(!bytes||blob(bytes)!==item.blobId)bytes=Buffer.from(await (await get(url)).arrayBuffer());
      if(bytes.length!==item.size||blob(bytes)!==item.blobId)throw Error(`Upstream content mismatch: ${path}`);
      sha256=createHash('sha256').update(bytes).digest('hex');
    }
    pack.files.push({path,file,bytes:item.size,sha256,url});
  }
  pack.unpackedBytes=pack.files.reduce((sum,file)=>sum+file.bytes,0);
  const core=pack.id==='asr'?['model.int8.onnx','tokens.txt']:pack.id==='kokoro'?['model.int8.onnx','voices.bin','tokens.txt','lexicon-zh.txt','lexicon-us-en.txt','espeak-ng-data/phondata','dict/jieba.dict.utf8','date-zh.fst','number-zh.fst','phone-zh.fst']:pack.files.map(file=>file.path).filter(path=>path!=='README.md');
  pack.required=core.map(path=>`${pack.modelDirectory}/${path}`);
  if(pack.id==='qwen') {
    pack.required.push('python/python.exe','.runtime-ready.json');
    pack.runtime={python:'3.12.14',uvVersion:'0.13.1',estimatedDownloadBytes:3300000000,extraDiskBytes:10*1024**3,files:[
      {file:'bootstrap/uv.zip',bytes:15308685,sha256:'3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672',url:'https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip'},
      {file:'bootstrap/VC_redist.x64.exe',bytes:18731856,sha256:'843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c',url:'https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe'}
    ]};
  }
  manifest.packs.push(pack);
  console.log(JSON.stringify({id:pack.id,files:pack.files.length,modelBytes:pack.unpackedBytes}));
}
await writeFile(join(app,'voice-resources.json'),JSON.stringify(manifest,null,2)+'\n');
