import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..'), target=join(root,'prototypes/live2d-codex/licenses');
await mkdir(target,{recursive:true});
const sources=[
 ['live2d-proprietary-agreement.html','https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'],
 ['Qwen-Apache-2.0.txt','https://raw.githubusercontent.com/QwenLM/Qwen3-TTS/main/LICENSE'],
 ['cuda-12.8-eula.html','https://docs.nvidia.com/cuda/archive/12.8.0/eula/index.html'],
 ['cudnn-9.10.2-eula.html','https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.2/reference/eula.html'],
 ['flatbuffers-LICENSE.txt','https://raw.githubusercontent.com/google/flatbuffers/v25.12.19/LICENSE'],
 ['tokenizers-LICENSE.txt','https://raw.githubusercontent.com/huggingface/tokenizers/v0.22.2/LICENSE'],
 ['gradio-client-LICENSE.txt','https://raw.githubusercontent.com/gradio-app/gradio/gradio%406.17.3/LICENSE']
];
const index=[];
for(const [name,url] of sources){execFileSync('curl.exe',['-fsSL','--retry','2','--max-time','90','-o',join(target,name),url],{windowsHide:true});const bytes=await readFile(join(target,name));if(!/license/i.test(bytes.toString()))throw new Error(`Invalid license response: ${name}`);index.push({file:name,source:url,sha256:createHash('sha256').update(bytes).digest('hex')});}
const python=join(root,'work/release-build/qwen/python');
await cp(join(python,'LICENSE.txt'),join(target,'python-LICENSE.txt'));
const site=join(python,'Lib/site-packages');
for(const entry of await readdir(site,{withFileTypes:true})) {
  if(!entry.isDirectory()||!entry.name.endsWith('.dist-info'))continue;
  for(const file of await readdir(join(site,entry.name))){if(!/^(licenses?|copying|notice)([._-]|$)/i.test(file))continue;
    const dest=join('python-packages',entry.name,file);await cp(join(site,entry.name,file),join(target,dest),{recursive:true});index.push({file:dest.replaceAll('\\','/'),source:`Python installed distribution: ${entry.name}`});}
}
await cp(join(site,'_soundfile_data/COPYING'),join(target,'libsndfile-COPYING.txt'));
await writeFile(join(target,'SOURCES.json'),JSON.stringify(index,null,2));
console.log(`Archived ${index.length} license entries`);
