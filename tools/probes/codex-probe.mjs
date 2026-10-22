import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { startStdio, initialize } from './stdio-transport.mjs';
import { TurnObserver } from './turn-observer.mjs';
import { createRunDirectory, writeRunReport, requireLiveRun } from '../qa/run-output.mjs';

const { values: args } = parseArgs({ options: {
  run: { type: 'boolean', default: false }, help: { type: 'boolean', default: false }, output: { type: 'string' },
  codex: { type: 'string', default: process.env.VIBE_CODEX_PATH ?? 'codex' },
  'expected-version': { type: 'string' },
  'create-thread': { type: 'boolean', default: false },
  'live-turn': { type: 'boolean', default: false }
} });
requireLiveRun('node tools/probes/codex-probe.mjs --run [--live-turn] [--output=work/qa/new-run]', 'the local CLI and account checks; --live-turn also sends test prompts', args.run, args.help);
const runDirectory = await createRunDirectory('codex-stdio', args.output);
const cwd = resolve(runDirectory, 'project');
const createThread = args['create-thread'] || args['live-turn'];
const version = execFileSync(args.codex, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (args['expected-version'] && version !== `codex-cli ${args['expected-version']}`) {
  throw new Error('CLI version does not match the configured schema version');
}
await mkdir(cwd, { recursive: true });
const evidence = {
  date: new Date().toISOString(), probe: 'codex-stdio', cliVersion: version,
  environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, memoryGB: Math.round(os.totalmem() / 1024 ** 3) },
  tests: [], inferenceStarted: false, accountDetailsPersisted: false
};
let transport = startStdio({ executable: args.codex, cwd });
let observer;
let phase = 'initialize';
try {
  await initialize(transport.rpc);
  evidence.tests.push({ id: 'initialize', status: 'passed' });
  phase = 'account';
  const account = await transport.rpc.request('account/read', { refreshToken: false });
  evidence.account = { type: account.account?.type ?? 'none', apiBillingAllowed: false };
  if (account.account?.type !== 'chatgpt') throw new Error('Existing ChatGPT CLI account is required; API mode is rejected');
  evidence.tests.push({ id: 'existing-cli-account', status: 'passed' });
  phase = 'models';
  const response = await transport.rpc.request('model/list', { limit: 100, includeHidden: false });
  const models = response.data ?? [];
  evidence.models = models.map(model => ({ id: model.id, model: model.model, isDefault: model.isDefault === true }));
  evidence.tests.push({ id: 'model-discovery', status: models.length ? 'passed' : 'failed' });
  if (createThread) {
    const selected = (args['live-turn'] && models.find(model => model.model === 'gpt-6-luna')) || models.find(model => model.isDefault) || models[0];
    if (!selected) throw new Error('No account models available');
    phase = 'thread-start';
    const result = await transport.rpc.request('thread/start', {
      cwd, model: selected.model ?? selected.id, modelProvider: 'openai',
      approvalPolicy: 'on-request', sandbox: 'read-only', ephemeral: !args['live-turn']
    }, { timeoutMs: 30000 });
    evidence.thread = { id: result.thread?.id, ephemeral: !args['live-turn'], provider: result.modelProvider, model: result.model };
    evidence.tests.push({ id: 'isolated-thread-start', status: result.thread?.id ? 'passed' : 'failed' });
    if (args['live-turn']) {
      const threadId = result.thread.id;
      observer = new TurnObserver(transport.rpc, threadId);
      phase = 'turn-completion'; evidence.inferenceStarted = true;
      const started = await transport.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply only VIBE_VOICE_PROBE_OK. Do not use tools or read or modify any files.' }] });
      const completed = await observer.waitCompleted(started.turn.id);
      evidence.tests.push({ id: 'explicit-thread-send', status: completed.status === 'completed' ? 'passed' : 'failed', turnStatus: completed.status, errorCode: completed.errorCode });
      if (completed.status !== 'completed') throw new Error('Live turn did not complete');
      phase = 'interrupt-turn-start';
      const second = await transport.rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Write a long explanation of binary search. Do not use tools or read or modify any files.' }] });
      phase = 'interrupt-wait-activity';
      await observer.waitActivity(second.turn.id);
      phase = 'turn-interrupt';
      await transport.rpc.request('turn/interrupt', { threadId, turnId: second.turn.id });
      const interrupted = await observer.waitCompleted(second.turn.id);
      evidence.tests.push({ id: 'explicit-turn-interrupt', status: interrupted.status === 'interrupted' ? 'passed' : 'failed', turnStatus: interrupted.status });
      observer.close(); observer = undefined;
      phase = 'process-restart-resume';
      await transport.close();
      transport = startStdio({ executable: args.codex, cwd });
      await initialize(transport.rpc);
      const resumed = await transport.rpc.request('thread/resume', { threadId, cwd, sandbox: 'read-only', approvalPolicy: 'on-request', modelProvider: 'openai' });
      const restored = resumed.thread.turns ?? [];
      const recoveryMatches = restored.some(turn => turn.id === started.turn.id && turn.status === 'completed');
      evidence.tests.push({ id: 'resume-after-process-restart', status: resumed.thread.id === threadId && recoveryMatches ? 'passed' : 'failed', restoredTurns: restored.length });
      const alternative = models.find(model => (model.model ?? model.id) !== resumed.model);
      phase = 'model-selection';
      if (alternative) {
        const changed = await transport.rpc.request('thread/resume', { threadId, model: alternative.model ?? alternative.id });
        evidence.modelResumeObservation = { requestedModel: alternative.model ?? alternative.id, returnedModel: changed.model, changed: changed.model === (alternative.model ?? alternative.id) };
        // A loaded thread ignores resume overrides in this version. Use turn/start,
        // then confirm current configuration from thread/read, not the request alone.
        observer = new TurnObserver(transport.rpc, threadId);
        const model = selected.model ?? selected.id;
        const modelTurn = await transport.rpc.request('turn/start', { threadId, model, input: [{ type: 'text', text: 'Reply only MODEL_SELECTION_PROBE_OK. Do not use tools or read or modify any files.' }] });
        const modelCompletion = await observer.waitCompleted(modelTurn.turn.id);
        const current = await transport.rpc.request('thread/read', { threadId, includeTurns: false });
        evidence.tests.push({ id: 'model-backend-confirmation', status: current.thread.model === model && modelCompletion.status === 'completed' ? 'passed' : 'failed', requestedModel: model, confirmedModel: current.thread.model, inferenceWithChangedModel: true, confirmationScope: 'configured-model-not-per-turn-execution-telemetry' });
      }
    }
  }
} catch (error) {
  // Do not write raw upstream messages: these can contain user paths or account details.
  evidence.failure = { phase, name: error.name, code: error.code ?? 'PROBE_FAILED' };
  process.exitCode = 1;
} finally {
  evidence.diagnostics = transport.diagnostics();
  observer?.close();
  await transport.close();
  await writeRunReport(runDirectory, evidence);
  console.log(`Report: ${resolve(runDirectory, 'result.json')}`);
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.tests.some(test => test.status === 'failed')) process.exitCode = 1;
}
