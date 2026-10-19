import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),root=resolve(import.meta.dirname,'../..');
const output=join(root,'work/release-build/corresponding-source/onnx-cpu-dependencies');await mkdir(output,{recursive:true});
const deps=join(output,'deps.txt');
execFileSync('curl.exe',['-fsSL','--retry','3','--max-time','120','-o',deps,'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.28.2/cmake/deps.txt'],{windowsHide:true});
const enabled=new Set(['abseil_cpp','date','eigen','flatbuffers','json','microsoft_gsl','microsoft_wil','mp11','onnx','protobuf','pytorch_cpuinfo','re2','safeint']);
const entries=(await readFile(deps,'utf8')).split(/\r?\n/).map(line=>line.split(';')).filter(([name])=>enabled.has(name));
if(entries.length!==enabled.size)throw Error('Missing CPU dependency pins');
const index=[];
async function download([name,url,sha1]){
  const file=join(output,`${name}.zip`);let bytes;try{bytes=await readFile(file);}catch{}
  if(!bytes?.length||createHash('sha1').update(bytes).digest('hex')!==sha1){
    await run('curl.exe',['-fsSL','--retry','3','--max-time','180','-o',file+'.partial',url],{windowsHide:true});
    bytes=await readFile(file+'.partial');
    if(createHash('sha1').update(bytes).digest('hex')!==sha1)throw Error(`Hash mismatch: ${name}`);
    await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});await rename(file+'.partial',file);
  }
  index.push({name,file:`${name}.zip`,url,sha1,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(name);
}
for(let i=0;i<entries.length;i+=3)await Promise.all(entries.slice(i,i+3).map(download));
await writeFile(join(output,'SOURCES.json'),JSON.stringify(index,null,2));
