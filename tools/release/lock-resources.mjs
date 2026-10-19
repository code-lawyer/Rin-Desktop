import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const directory=resolve(process.argv[2]||join(root,'release',`v${version}`)),file=`Rin-Desktop-${version}-Setup.exe`;
const hash=createHash('sha256');for await(const bytes of createReadStream(join(directory,file)))hash.update(bytes);
const manifest={version,repository:'code-lawyer/Rin-Desktop',files:[{file,bytes:(await stat(join(directory,file))).size,sha256:hash.digest('hex'),url:`https://github.com/code-lawyer/Rin-Desktop/releases/download/v${version}/${file}`}]};
await writeFile(join(root,'tools/release/resource-manifest.json'),JSON.stringify(manifest,null,2));
