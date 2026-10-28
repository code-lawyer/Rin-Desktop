import { readdir, lstat, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

async function inspect(path) {
  try { return await lstat(path); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}

// The checkout already contains manifests and some artwork. Fill nested holes
// without replacing source-owned files or traversing existing directory links.
export async function fillMissingAssets(source, destination) {
  const result={copied:0,preserved:0,skippedLinks:0};
  async function visit(from,to){
    const origin=await lstat(from), existing=await inspect(to);
    if(origin.isSymbolicLink())throw new Error('Resource archives must contain ordinary files and directories.');
    if(existing?.isSymbolicLink()){result.skippedLinks++;return;}
    if(origin.isDirectory()){
      if(existing&&!existing.isDirectory())throw new Error('An asset directory is occupied by a file: '+to);
      await mkdir(to,{recursive:true});
      for(const entry of await readdir(from))await visit(join(from,entry),join(to,entry));
    }else if(origin.isFile()){
      if(existing){result.preserved++;return;}
      try { await copyFile(from,to,constants.COPYFILE_EXCL);result.copied++; }
      catch(error){if(error.code==='EEXIST')result.preserved++;else throw error;}
    }else throw new Error('Unsupported resource archive entry: '+from);
  }
  await visit(source,destination);
  return result;
}
