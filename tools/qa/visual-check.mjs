// One batched visual inspection of the built renderer; no accounts or devices.
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createRunDirectory,requireLiveRun} from './run-output.mjs';
requireLiveRun('Usage: npm run qa:visual -- --run', 'isolated Electron screenshots and layout checks', process.argv.includes('--run'), process.argv.includes('--help') || process.argv.includes('-h'));
const root=resolve(import.meta.dirname,'../..');
const output=await createRunDirectory('visual');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),[join(import.meta.dirname,'interface-fixture.cjs'),output,'--visual'],{env,windowsHide:true,stdio:'inherit'});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
console.log(JSON.stringify({output,accounts:false,hardware:false,code}));
if(code!==0)process.exitCode=1;
