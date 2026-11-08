import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connectPage } from './cdp.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun(
  'npm run qa:local-speech -- --run --package=<test package> --models=<existing models> [--qwen-port=<running app debug port>]',
  'local model inference using fixed synthetic phrases; no microphone, playback, account or downloads. Optional Qwen uses the already loaded, idle app without changing settings',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (
  !option('package') ||
  !option('models') ||
  args.some((arg) => arg !== '--run' && !/^--(package|models|qwen-port)=./.test(arg))
)
  throw Error('Use --run, --package, --models and optionally --qwen-port');
const directory = resolve(option('package')),
  models = resolve(option('models'));
const portable = JSON.parse(await readFile(join(directory, 'resources/app/portable.json'), 'utf8'));
assert.equal(portable.testBuild?.channel, 'internal-test');
const output = await createRunDirectory('local-speech');
const report = {
  package: directory,
  checks: [],
  samples: [],
  accounts: false,
  microphone: false,
  audiblePlayback: false,
  passed: false,
};
const { LocalSpeech } = await import(pathToFileURL(join(directory, 'resources/app/backend/speech.mjs')));
const speech = new LocalSpeech(models, { executable: join(directory, 'resources/app/runtime/node.exe') });
let page,
  sharedRequestStarted = false;
async function drainSharedRequest(milliseconds = 300000) {
  if (!page || !sharedRequestStarted) return;
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await page.evaluate('globalThis.__rinSpeechQa?.phase!=="pending"')) return;
    await delay(250);
  }
  throw Error('Shared Qwen request has not settled; cleanup cannot be confirmed');
}
const phrase = '雨还在下，我们把眼前的事情做好。';
function audioMetrics(audio) {
  assert.ok(audio.samples instanceof Float32Array && audio.sampleRate >= 16000);
  assert.ok(audio.samples.length > audio.sampleRate);
  assert.ok(audio.samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 2));
  const rms = Math.sqrt(audio.samples.reduce((sum, value) => sum + value * value, 0) / audio.samples.length);
  assert.ok(rms > 0.001, 'generated audio is not silent');
  return { sampleRate: audio.sampleRate, seconds: audio.samples.length / audio.sampleRate, rms };
}
async function recognize(engine, audio, elapsedMs) {
  const metrics = audioMetrics(audio),
    start = Date.now();
  const result = await speech.transcribe(audio);
  assert.ok(
    result.text.includes('眼前') && result.text.includes('事情'),
    'SenseVoice recognizes the synthetic Chinese phrase',
  );
  report.samples.push({
    engine,
    ...metrics,
    synthesisMs: elapsedMs,
    recognitionMs: Date.now() - start,
    recognizedText: result.text,
  });
}
console.log(JSON.stringify({ output }));
try {
  assert.deepEqual({ asr: speech.status().asr, tts: speech.status().tts }, { asr: true, tts: true });
  await speech.run('load-asr', {});
  for (const voice of [3, 58]) {
    const start = Date.now(),
      audio = await speech.synthesize(phrase, { voice, speed: 1 });
    await recognize('kokoro-cpu-' + voice, audio, Date.now() - start);
  }
  report.checks.push(
    'packaged Node and native dependencies run Kokoro and SenseVoice on CPU with existing models',
  );
  if (option('qwen-port')) {
    const port = Number(option('qwen-port'));
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
    const pages = await (
      await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })
    ).json();
    page = await connectPage(
      pages.find((value) => value.url.includes('workbench.html')),
      port,
    );
    const state = await page.evaluate(
      '(async()=>({agent:(await companion.snapshot()).value,presentation:(await companion.presentation()).value,workspace:(await companion.workspace()).value}))()',
    );
    assert.equal(state.agent.status, 'idle');
    assert.equal(state.presentation.capturing, false);
    assert.equal(state.presentation.speaking, false);
    assert.equal(state.workspace.resources.phase, 'idle');
    assert.equal(state.workspace.speech.engine, 'qwen');
    assert.equal(state.workspace.speech.phase, 'ready');
    const start = Date.now();
    await page.evaluate(
      `(()=>{globalThis.__rinSpeechQa={phase:'pending'};companion.synthesize(${JSON.stringify(phrase)}).then(value=>{globalThis.__rinSpeechQa={phase:'done',result:value};},error=>{globalThis.__rinSpeechQa={phase:'error',error:String(error)};});})()`,
    );
    sharedRequestStarted = true;
    // Fixed short phrase: wait beyond the worker's four-minute watchdog. Do
    // not issue a global stop against a shared app and a later user request.
    await drainSharedRequest();
    const generated = await page.evaluate(
      '(()=>{const q=globalThis.__rinSpeechQa;if(q.phase!=="done")return q;const r=q.result;return {phase:q.phase,ok:r.ok,error:r.error,value:r.ok?{sampleRate:r.value.sampleRate,samples:Array.from(r.value.samples)}:null};})()',
    );
    assert.equal(generated.phase, 'done');
    assert.equal(generated.ok, true, generated.error);
    await recognize(
      'qwen-existing-resident-gpu',
      { samples: Float32Array.from(generated.value.samples), sampleRate: generated.value.sampleRate },
      Date.now() - start,
    );
    assert.equal((await page.evaluate('companion.workspace()')).value.speech.phase, 'ready');
    report.checks.push(
      'existing Qwen resident synthesizes through actual app IPC and returns to ready without changing settings or playing sound',
    );
  }
  const children = [...speech.workers.values()].map((worker) => worker.child);
  speech.close();
  const end = Date.now() + 10000;
  while (children.some((child) => child.exitCode === null && child.signalCode === null) && Date.now() < end)
    await delay(100);
  assert.ok(
    children.every((child) => child.exitCode !== null || child.signalCode !== null),
    'owned inference workers exit',
  );
  report.checks.push('all owned CPU inference workers exit');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  speech.close();
  if (page) {
    try {
      await drainSharedRequest();
      await page.evaluate('delete globalThis.__rinSpeechQa');
    } catch (error) {
      report.cleanupError = error.message;
      report.passed = false;
      process.exitCode = 1;
    }
    page.close();
  }
  await writeRunReport(output, report);
  console.log(
    JSON.stringify({ output, passed: report.passed, samples: report.samples.length, error: report.error }),
  );
}
