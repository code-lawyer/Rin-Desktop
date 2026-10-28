import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRunDirectory, writeRunReport } from './run-output.mjs';

if (!process.argv.includes('--run') || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run qa:shutdown -- --run\nChecks real Electron preload draft acknowledgements, cancelled quit on a simulated disk failure, successful retry and parent-process readback. Uses hidden windows, synthetic Agent state and a new work/qa directory. No accounts, microphone or remote hardware. Default: help only; no files or processes.');
  process.exit(0);
}
if (process.argv.slice(2).some(arg => arg !== '--run')) throw new Error('Only --run is supported.');

const root = resolve(import.meta.dirname, '../..');
const output = await createRunDirectory('shutdown-desktop');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let child;
try {
  await new Promise((resolveExit, rejectExit) => {
    child = spawn(join(root, 'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'), [join(import.meta.dirname, 'shutdown-fixture.cjs'), output, '--run'], { env, windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); rejectExit(new Error('The isolated shutdown fixture exceeded 45 seconds.')); }, 45000);
    child.once('error', error => { clearTimeout(timer); rejectExit(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolveExit() : rejectExit(new Error(`Shutdown fixture exited ${code}.`)); });
  });
  const report = JSON.parse(await readFile(join(output, 'fixture.json'), 'utf8'));
  const saved = JSON.parse(await readFile(join(output, 'data/workspaces.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.handshakeCount, 2);
  assert.equal(report.firstQuitCancelled, true);
  assert.equal(saved.drafts[report.draftKey]?.text, report.expectedDraft);
  assert.equal(Object.keys(saved.drafts).length, 1);
  await writeRunReport(output, { ...report, checks: [...report.checks, 'the parent process read the committed draft after the Electron child exited'], parentReadback: true, childExited: true, accounts: false, hardware: false });
  console.log(JSON.stringify({ output, checks: report.checks.length + 1, parentReadback: true, accounts: false, hardware: false }));
} catch (error) {
  await writeRunReport(output, { passed: false, error: error.message, accounts: false, hardware: false });
  throw error;
}
