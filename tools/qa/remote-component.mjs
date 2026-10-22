// Windows component build/pipe check. No scan, pairing, connection or recording.
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NativeRemote, buildRemoteHelper } from '../../prototypes/live2d-codex/backend/remote-native.mjs';
import input from '../../prototypes/live2d-codex/backend/remote-input.cjs';
import { copyAgentDependencies } from '../../prototypes/live2d-codex/scripts/copy-agent-dependencies.mjs';
const root=resolve(import.meta.dirname,'../..');
const output=join(root,'work/qa/remote-component',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const native=new NativeRemote({root:join(root,'prototypes/live2d-codex'),storageDir:output});
try {
  const keys=new input.RemoteInput();keys.initialize();
  const application=join(root,'prototypes/live2d-codex'),copied=join(output,'app');
  await copyAgentDependencies(application,copied);
  await mkdir(join(copied,'backend'),{recursive:true});
  await cp(join(application,'backend/remote-input.cjs'),join(copied,'backend/remote-input.cjs'));
  const probe=join(output,'input-bindings.cjs'),result=join(output,'electron-bindings.json');
  await writeFile(probe,`const {RemoteInput}=require('./app/backend/remote-input.cjs');new RemoteInput().initialize();require('node:fs').writeFileSync(process.argv[2],JSON.stringify({electron:process.versions.electron,koffiBindings:true}));`);
  await promisify(execFile)(join(application,'node_modules/electron/dist/electron.exe'),[probe,result],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:15000});
  const electron=JSON.parse(await readFile(result,'utf8'));
  if(!electron.electron || !electron.koffiBindings)throw new Error('Electron input dependency check failed.');
  const helper=await buildRemoteHelper(join(application,'native/rc003-helper.cs'),join(output,'components'));
  const consumer=JSON.parse((await promisify(execFile)(helper,['--self-test-input'],{windowsHide:true,timeout:15000})).stdout.replace(/^\uFEFF/,''));
  if(!consumer.consumerEdges || !consumer.repeatsSuppressed || !consumer.unknownUsagesIgnored)throw new Error('Consumer controls check failed.');
  await native.start();await native.close();
  const summary={compiled:true,pipeHandshake:true,ownedProcessClosed:true,nativeInputBindings:true,copiedDependencies:true,consumer,electron:electron.electron,deviceAccess:false};
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
} finally { await native.close(); }
