import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';
requireLiveRun('npm run qa:puppet -- --run', 'isolated Electron, our local artwork and synthetic PCM; no accounts, camera or microphone');
const root = resolve(import.meta.dirname, '../..'), output = await createRunDirectory('puppet-desktop');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolveRun, reject) => {
  const child = spawn(join(root, 'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),
    [join(import.meta.dirname, 'still-fixture.cjs'), output, '--puppet'], { env, windowsHide: true, stdio: 'inherit' });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Puppet checks exited ${code}; evidence: ${output}`)));
});
console.log(JSON.stringify({ output }));
