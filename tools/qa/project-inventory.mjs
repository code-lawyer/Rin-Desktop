import { readdir, lstat, readlink, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';

// Metadata only: do not follow junctions, read user content, or hash models.
export async function inventoryProject(root) {
  const files=[], links=[], errors=[], directories=new Map();
  const pending=[root];
  while(pending.length){
    const directory=pending.pop();
    let entries;
    try { entries=await readdir(directory,{withFileTypes:true}); }
    catch(error){errors.push({path:relative(root,directory),code:error.code});continue;}
    for(let offset=0;offset<entries.length;offset+=32){
      const batch=await Promise.all(entries.slice(offset,offset+32).map(async entry=>{
        const absolute=join(directory,entry.name), path=relative(root,absolute).replaceAll('\\','/');
        if(path==='.git')return;
        try {
          const metadata=await lstat(absolute);
          if(metadata.isSymbolicLink()){links.push({path,target:await readlink(absolute)});return;}
          if(metadata.isDirectory()){pending.push(absolute);return;}
          if(!metadata.isFile())return;
          return {path,bytes:metadata.size,modified:metadata.mtime.toISOString()};
        }catch(error){errors.push({path,code:error.code});}
      }));
      for(const file of batch.filter(Boolean)){
        files.push(file);
        const parts=file.path.split('/');
        for(let depth=1;depth<parts.length;depth++){
          const name=parts.slice(0,depth).join('/');
          const total=directories.get(name)??{path:name,files:0,bytes:0};
          total.files++;total.bytes+=file.bytes;directories.set(name,total);
        }
      }
    }
  }
  return {files,links,errors,directories:[...directories.values()].sort((a,b)=>b.bytes-a.bytes)};
}

async function main(){
  requireLiveRun('Usage: npm run qa:inventory -- --run','read repository file metadata without following links; no content reads or deletion');
  const root=resolve(import.meta.dirname,'../..');
  const output=await createRunDirectory('project-inventory');
  const report=await inventoryProject(root);
  const summary={output,files:report.files.length,bytes:report.files.reduce((n,file)=>n+file.bytes,0),links:report.links.length,errors:report.errors,
    topLevel:report.directories.filter(dir=>!dir.path.includes('/')),
    // QA uses both flat run directories and category/run layouts. Keep these
    // levels separate rather than labelling every fourth-level folder a run.
    qaTopLevel:report.directories.filter(dir=>dir.path.startsWith('work/qa/')&&dir.path.split('/').length===3).slice(0,25),
    qaChildren:report.directories.filter(dir=>dir.path.startsWith('work/qa/')&&dir.path.split('/').length===4).slice(0,25)};
  await writeFile(join(output,'inventory.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(join(output,'result.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(summary,null,2));
  if(report.errors.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
