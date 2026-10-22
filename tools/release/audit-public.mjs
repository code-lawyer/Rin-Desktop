import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const staged=process.argv.includes('--staged');
const worktree=process.argv.includes('--worktree');
if(staged&&worktree)throw new Error('Choose --staged or --worktree, not both.');
const listing=staged?['--cached']:worktree?['--cached','--others','--exclude-standard']:['--others','--exclude-standard'];
const names=[...new Set(execFileSync('git',['-c',`safe.directory=${root}`,'ls-files',...listing,'-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];
const problems=[];let bytes=0;
let scanned=0;
const forbidden=/^(work|release|artwork)\/|(^|\/)(node_modules|\.venv|__pycache__|models|runtime|vendor|evidence|research)(\/|$)|(^|\/)(auth|session|workspaces|appearance|provider)\.json$|\.(wav|pcm|mp4|zip|7z|exe|dll|safetensors)$/i;
const secrets=[/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,/gh[pousr]_[A-Za-z0-9]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const name of names){
  let data;
  try { data=staged?execFileSync('git',['-c',`safe.directory=${root}`,'show',`:${name}`],{cwd:root,maxBuffer:64*1024*1024}):await readFile(join(root,name)); }
  catch(error) { if(worktree&&error.code==='ENOENT')continue; throw error; }
  if(forbidden.test(name))problems.push({file:name,reason:'non-public path'});
  bytes+=data.length;scanned++;
  if(data.length>20*1024*1024)problems.push({file:name,reason:'unexpected large source file'});
  if(!data.subarray(0,8192).includes(0)){const content=data.toString('utf8');for(const pattern of secrets)if(pattern.test(content))problems.push({file:name,reason:'secret pattern'});
    const normalized=content.replaceAll('\\\\','\\').replaceAll('\\','/').toLowerCase();
    if([root,process.env.USERPROFILE].filter(Boolean).some(value=>normalized.includes(value.replaceAll('\\','/').toLowerCase())))problems.push({file:name,reason:'private machine reference'});
  }
}
console.log(JSON.stringify({staged,worktree,files:scanned,bytes,problems},null,2));if(!scanned||problems.length)process.exitCode=1;
