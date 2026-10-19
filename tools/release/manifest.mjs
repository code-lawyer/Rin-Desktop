import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir,stat,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';

export async function writeManifest(output,version) {
  const files=[];
  async function collect(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const file=join(dir,entry.name);
      if(entry.isDirectory()) await collect(file);
      else if(file!==join(output,'manifest.json')) {
        const hash=createHash('sha256');
        for await(const bytes of createReadStream(file)) hash.update(bytes);
        files.push({file:relative(output,file).replaceAll('\\','/'),bytes:(await stat(file)).size,sha256:hash.digest('hex')});
      }
    }
  }
  await collect(output);
  const manifest={version,platform:'win32-x64',bytes:files.reduce((sum,file)=>sum+file.bytes,0),files};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  return {bytes:manifest.bytes,files:files.length};
}
