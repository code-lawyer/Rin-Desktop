import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(resolve(root,'prototypes/live2d-codex/package.json'));
const {build}=require('esbuild');
const source=resolve(root,'prototypes/live2d-halfbody'),assets=resolve(root,'artwork/female-halfbody-v1');
const output=resolve(root,'work/runtime/halfbody-preview/preview.js');
await mkdir(resolve(output,'..'),{recursive:true});
await build({entryPoints:[resolve(source,'preview.js')],outfile:output,bundle:true,format:'esm',platform:'browser',target:'chrome140',nodePaths:[resolve(root,'prototypes/live2d-codex/node_modules')],logLevel:'warning'});
if(process.argv.includes('--build')){console.log('Half-body preview built.');process.exit(0);}
const files=new Map([['/',resolve(source,'index.html')],['/style.css',resolve(source,'style.css')],['/preview.js',output],['/cubism-core.js',resolve(root,'prototypes/live2d-codex/vendor/live2dcubismcore.min.js')],['/sample.wav',resolve(assets,'sample.wav')]]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.moc3':'application/octet-stream','.png':'image/png','.wav':'audio/wav'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');let file=files.get(url.pathname);
    if(!file&&url.pathname.startsWith('/model/')){
      const modelRoot=resolve(assets,'runtime');const candidate=resolve(modelRoot,decodeURIComponent(url.pathname.slice(7)));
      if(candidate.startsWith(modelRoot+sep)&&['.json','.png','.moc3'].includes(extname(candidate)))file=candidate;
    }
    if(!file){res.writeHead(404).end('Not found');return;}
    const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:400).end('Preview resource unavailable');}
});
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]||5317);
server.listen(port,'127.0.0.1',()=>console.log(`Female half-body preview: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
