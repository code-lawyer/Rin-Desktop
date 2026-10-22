import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { connectWebSocket } from './websocket-transport.mjs';
import { accountOnlyEnvironment, initialize } from './stdio-transport.mjs';
import { TurnObserver } from './turn-observer.mjs';
import { createRunDirectory, writeRunReport, requireLiveRun } from '../qa/run-output.mjs';

const { values: args } = parseArgs({ options: {
  run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false }, output: { type: 'string' },
  codex: { type: 'string', default: process.env.VIBE_CODEX_PATH ?? 'codex' },
  'expected-version': { type: 'string' },
  'with-tui': { type: 'boolean', default: false }
} });
requireLiveRun('node tools/probes/codex-tui-probe.mjs --run [--with-tui] [--output=work/qa/new-run]', 'two real test prompts and native CLI session history', args.run, args.help);
const runDirectory = await createRunDirectory('codex-shared', args.output);
const cwd = resolve(runDirectory, 'project');
await mkdir(cwd, { recursive: true });
const version = execFileSync(args.codex, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (args['expected-version'] && version !== `codex-cli ${args['expected-version']}`) throw new Error('CLI version mismatch');
if (args['with-tui'] && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('--with-tui requires a real terminal');
// Reserve a random loopback port. A bind race fails safely; no shared daemon is used.
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const endpoint = `ws://127.0.0.1:${reservation.address().port}`;
await new Promise(resolve => reservation.close(resolve));
const token = randomBytes(32).toString('hex'); // Memory only. No token files/logs.
const digest = createHash('sha256').update(token).digest('hex');
const backend = spawn(args.codex, ['app-server', '--listen', endpoint, '--ws-auth', 'capability-token', '--ws-token-sha256', digest, '-c', 'forced_login_method="chatgpt"'], {
  cwd, env: accountOnlyEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe']
});
let stderrBytes = 0; let backendError;
backend.stderr.on('data', bytes => { stderrBytes += bytes.length; });
backend.on('error', error => { backendError = error; });
const evidence = { date: new Date().toISOString(), probe: 'codex-shared', cliVersion: version, transport: 'authenticated-loopback-websocket', experimental: true, tests: [], accountDetailsPersisted: false };
let controller, viewer, observer, tui;
let phase = 'server-start';
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended;
}
try {
  const deadline = Date.now() + 15_000;
  while (!controller) {
    if (backendError) throw backendError;
    if (backend.exitCode !== null) throw new Error('Owned backend exited before ready');
    try { controller = await connectWebSocket(endpoint, token); }
    catch (error) { if (Date.now() >= deadline) throw error; await delay(100); }
  }
  phase = 'auth-rejection';
  let rejected = false;
  try { const unexpected = await connectWebSocket(endpoint, 'incorrect-test-token'); await unexpected.close(); }
  catch (error) { rejected = /Unexpected server response: (401|403)/.test(error.message); }
  evidence.tests.push({ id: 'invalid-token-rejected', status: rejected ? 'passed' : 'failed' });
  await initialize(controller.rpc, 'vibe_voice_controller_probe');
  const account = await controller.rpc.request('account/read', { refreshToken: false });
  if (account.account?.type !== 'chatgpt') throw new Error('Existing ChatGPT CLI account required');
  phase = 'shared-session';
  const models = (await controller.rpc.request('model/list', { limit: 100 })).data;
  const model = models.find(item => item.model === 'gpt-6-luna') ?? models.find(item => item.isDefault);
  if (!model) throw new Error('No available model');
  const opened = await controller.rpc.request('thread/start', { cwd, model: model.model, modelProvider: 'openai', sandbox: 'read-only', approvalPolicy: 'on-request' });
  const threadId = opened.thread.id; evidence.threadId = threadId;
  // A brand-new thread has no persisted rollout yet in 0.159.2. This seed
  // is only a diagnostic. Product startup must solve empty-thread attachment.
  phase = 'materialize-test-history';
  const seedObserver = new TurnObserver(controller.rpc, threadId);
  try {
    const seed = await controller.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply only SHARED_SESSION_SETUP_OK. Do not use tools or read or modify files.' }] });
    const seedDone = await seedObserver.waitCompleted(seed.turn.id);
    if (seedDone.status !== 'completed') throw new Error('Test setup did not complete');
  } finally { seedObserver.close(); }
  phase = 'shared-session';
  viewer = await connectWebSocket(endpoint, token);
  await initialize(viewer.rpc, 'vibe_voice_viewer_probe');
  const resumed = await viewer.rpc.request('thread/resume', { threadId });
  evidence.tests.push({ id: 'two-clients-same-thread', status: resumed.thread.id === threadId ? 'passed' : 'failed' });
  observer = new TurnObserver(viewer.rpc, threadId);
  if (args['with-tui']) {
    phase = 'original-tui-start';
    // Remote resume inherits the server's read-only/on-request policy. This
    // version rejects TUI permission overrides for a remote task.
    tui = spawn(args.codex, ['--remote', endpoint, '--remote-auth-token-env', 'VIBE_VOICE_PROBE_TOKEN', '--no-alt-screen', '-C', cwd, 'resume', threadId], {
      cwd, env: { ...accountOnlyEnvironment(), TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color', VIBE_VOICE_PROBE_TOKEN: token }, shell: false, windowsHide: true, stdio: 'inherit'
    });
    tui.on('error', error => { backendError = error; });
    console.log('Original CLI started for a separate probe thread. Controller sends after startup.');
    // Startup window for an explicitly authorized folder-trust dialog.
    // This delay is diagnostic only, not a product readiness check.
    await delay(5000);
    if (backendError) throw backendError;
    if (tui.exitCode !== null) throw new Error('Original CLI exited before test');
    evidence.originalTui = { started: true, rendering: 'requires-terminal-observation', approvals: 'not-tested' };
  }
  phase = 'controller-send-viewer-watch';
  const turn = await controller.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply only VIBE_VOICE_SHARED_SESSION_OK. Do not use tools or read or modify files.' }] });
  const completion = await observer.waitCompleted(turn.turn.id);
  evidence.tests.push({ id: 'controller-send-viewer-watch', status: completion.status === 'completed' ? 'passed' : 'failed', turnStatus: completion.status });
  const read = await viewer.rpc.request('thread/read', { threadId, includeTurns: true });
  evidence.tests.push({ id: 'viewer-read-controller-turn', status: read.thread.turns.some(item => item.id === turn.turn.id && item.status === 'completed') ? 'passed' : 'failed' });
  if (tui) await delay(2000);
} catch (error) {
  evidence.failure = { phase, name: error.name, code: error.code ?? 'PROBE_FAILED' }; process.exitCode = 1;
} finally {
  observer?.close();
  await stopChild(tui);
  await viewer?.close(); await controller?.close();
  await stopChild(backend);
  evidence.diagnostics = { stderrBytes };
  await writeRunReport(runDirectory, evidence);
  console.log(`Report: ${resolve(runDirectory, 'result.json')}`);
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.tests.some(test => test.status === 'failed')) process.exitCode = 1;
}
