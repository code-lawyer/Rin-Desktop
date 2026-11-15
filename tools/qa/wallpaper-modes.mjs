import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';

requireLiveRun('npm run qa:wallpaper-modes -- --run', 'isolated Electron with original anime poses and actual realistic videos; synthetic backend only, no accounts or devices');
if (process.argv.slice(2).some(arg => arg !== '--run')) throw new Error('Use --run only.');
const root = resolve(import.meta.dirname, '../..'), output = await createRunDirectory('wallpaper-modes');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
for (const mode of ['--wallpaper-modes', '--wallpaper-modes-restore']) {
  const child = spawn(join(root, 'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'), [join(import.meta.dirname, 'still-fixture.cjs'), output, mode], { env, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`Wallpaper modes verification failed: ${code}; evidence: ${output}`);
}
const first = JSON.parse(await readFile(join(output, 'modes.json'), 'utf8'));
const restored = JSON.parse(await readFile(join(output, 'modes-restore.json'), 'utf8'));
await writeFile(join(output, 'result.json'), JSON.stringify({ ...first, checks: [...first.checks, ...restored.checks], freshProcessRestore: true, passed: true }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, checks: first.checks.length + restored.checks.length, accounts: false, hardware: false, passed: true }));
