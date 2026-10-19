import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const staged=process.argv.includes('--staged');
const names=execFileSync('git',['-c',`safe.directory=${root}`,'ls-files',...(staged?['--cached']:['--others','--exclude-standard']),'-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const problems=[];let bytes=0;
const forbidden=/^(work|release|artwork)\/|(^|\/)(node_modules|\.venv|__pycache__|models|runtime|vendor|evidence|research)(\/|$)|(^|\/)(auth|session|workspaces|appearance|provider)\.json$|\.(wav|pcm|mp4|zip|7z|exe|dll|safetensors)$/i;
const secrets=[/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const name of names){
  if(forbidden.test(name))problems.push({file:name,reason:'non-public path'});
  const data=staged?execFileSync('git',['-c',`safe.directory=${root}`,'show',`:${name}`],{cwd:root,maxBuffer:64*1024*1024}):await readFile(join(root,name));bytes+=data.length;
  if(data.length>20*1024*1024)problems.push({file:name,reason:'unexpected large source file'});
  if(!data.subarray(0,8192).includes(0)){const content=data.toString('utf8');for(const pattern of secrets)if(pattern.test(content))problems.push({file:name,reason:'secret pattern'});
    const normalized=content.replaceAll('\\\\','\\').replaceAll('\\','/').toLowerCase();
    if([root,process.env.USERPROFILE].filter(Boolean).some(value=>normalized.includes(value.replaceAll('\\','/').toLowerCase())))problems.push({file:name,reason:'private machine reference'});
  }
}
console.log(JSON.stringify({staged,files:names.length,bytes,problems},null,2));if(!names.length||problems.length)process.exitCode=1;
