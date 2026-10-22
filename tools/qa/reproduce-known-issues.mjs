// Audit-only probes: no GUI, hardware, model, paid agent or network request.
// npm run qa:known-issues. Exit 1 means at least one known issue still reproduces.
import { ResidentSpeech } from '../../prototypes/live2d-codex/backend/resident-speech.mjs';
import { NativeAgent } from '../../prototypes/live2d-codex/backend/native-agent.mjs';
import { currentReply } from '../../prototypes/live2d-codex/renderer/current-reply.mjs';
import { CodexCompanion } from '../../prototypes/live2d-codex/backend/codex.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, sep } from 'node:path';
if (process.argv.includes('--help')) {
  console.log('Synthetic known-issue probes; no GUI, hardware, models or live Agent. Results: work/qa/known-issues. Exit 1 = unresolved issue.');
  process.exit(0);
}
const projectRoot = resolve(import.meta.dirname, '../..');
const auditDir = join(projectRoot, 'work/qa/known-issues', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(auditDir, { recursive: true });
const results = { capturedUtc: new Date().toISOString(), probes: [], sourceHashes: {} };
for (const name of ['resident-speech.mjs', 'native-agent.mjs', 'codex.mjs']) {
  const bytes = await readFile(join(projectRoot, 'prototypes/live2d-codex/backend', name));
  results.sourceHashes[name] = createHash('sha256').update(bytes).digest('hex');
}

// The real KokoroResident.close() is synchronous; retain that contract here.
const unhandled = [];
const recordUnhandled = error => unhandled.push({ name: error.name, message: error.message });
process.on('unhandledRejection', recordUnhandled);
const speech = new ResidentSpeech(join(auditDir, 'nonexistent-models'), {
  factory: () => ({
    async load() { throw new Error('Synthetic unavailable model or worker'); },
    close() {},
  }),
});
let speechFailure = null;
try { await speech.configure({ ttsEngine: 'kokoro', ttsResident: true }); }
catch (error) { speechFailure = { name: error.name, message: error.message }; }
await new Promise(resolveTurn => setImmediate(resolveTurn));
results.probes.push({ name: 'kokoro-load-failure', rejected: speechFailure,
  phase: speech.phase, error: speech.error, unhandledRejections: unhandled });
await speech.close();
await new Promise(resolveTurn => setImmediate(resolveTurn));
process.off('unhandledRejection', recordUnhandled);

class FakeNative extends NativeAgent {
  async persist() {}
  async promptNative() {
    this.appendText('我先检查项目。');
    this.state.messages.at(-1).complete = true;
    this.appendText('修改完成，验证通过。');
  }
  async cancelNative() {}
  async disposeNative() {}
}
const native = new FakeNative({ provider: 'claude', projectRoot, storageDir: auditDir });
Object.assign(native.state, { connection: 'ready', status: 'idle', threadId: 'audit-fake-thread' });
let completed;
native.on('reply-completed', event => { completed = event; });
await native.send('Audit synthetic tool turn');
await native.run;
const visibleReply = currentReply(native.state.messages);
results.probes.push({ name: 'native-final-reply-contract', completedText: completed?.text,
  visibleText: visibleReply.text, matchesSpeechGate: completed?.text === visibleReply.text });
await native.close();

// Run only Node --version. The app-server is an in-memory EventEmitter.
const tempBase = resolve(auditDir, 'temp');
await mkdir(tempBase, { recursive: true });
const dir = await mkdtemp(join(tempBase, 'codex-close-'));
if (!dir.startsWith(tempBase + sep)) throw new Error('Invalid audit temp directory');
let spawned = false;
function fakeServer() {
  spawned = true;
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new PassThrough(), exitCode: null, signalCode: null, pid: undefined, kill() {} });
  child.stdin.on('data', chunk => {
    for (const line of String(chunk).trim().split('\n')) {
      const request = JSON.parse(line);
      if (request.id) child.stdout.write(JSON.stringify({ id: request.id,
        result: request.method === 'account/read' ? { account: null } : {} }) + '\n');
    }
  });
  return child;
}
const codex = new CodexCompanion({ projectRoot, storageDir: dir,
  binary: process.execPath, spawnServer: fakeServer });
try {
  const start = codex.connect();
  await codex.close();
  await start;
  results.probes.push({ name: 'codex-connect-close-race', closed: codex.closed,
    spawned, rpcClosed: codex.rpc?.closed });
} finally {
  await codex.rpc?.close();
  // Absolute target is checked against the audit-specific parent before deletion.
  if (!resolve(dir).startsWith(tempBase + sep)) throw new Error('Unsafe audit cleanup path');
  await rm(dir, { recursive: true, force: true });
}
results.probes[0].passed = results.probes[0].phase === 'error' && unhandled.length === 0 && speechFailure?.name !== 'TypeError';
results.probes[1].passed = results.probes[1].matchesSpeechGate;
results.probes[2].passed = results.probes[2].closed && !results.probes[2].spawned;
results.unresolved = results.probes.filter(probe => !probe.passed).length;
await writeFile(join(auditDir, 'result.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.unresolved ? 1 : 0;
