import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { packagedSession } from './packaged-session.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';
import { closeChild } from '../../prototypes/live2d-codex/backend/agent-process.mjs';

requireLiveRun(
  'npm run qa:prerequisites -- --run --package=<test package> [--qwen-root=<existing Qwen runtime>]',
  'packaged missing-CLI/model guards, local-proxy download failure/cancellation and disabled-WebGL fallback; optional Qwen with CUDA hidden from that child only. No accounts, microphone, upstream downloads or system display changes',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!option('package') || args.some((arg) => arg !== '--run' && !/^--(package|qwen-root)=./.test(arg)))
  throw Error('Use --run, --package and optionally --qwen-root');
const output = await createRunDirectory('prerequisites'),
  directory = resolve(option('package'));
const report = { checks: [], accounts: false, hardware: false, upstreamDownloads: false, passed: false };
let session, qwen;
const sockets = new Set();
let connectionCount = 0,
  rejectConnections = false;
const proxy = createServer((socket) => {
  connectionCount++;
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  if (rejectConnections) socket.destroy();
});
await new Promise((done, fail) => {
  proxy.once('error', fail);
  proxy.listen(0, '127.0.0.1', done);
});
console.log(JSON.stringify({ output }));
try {
  session = await packagedSession({
    directory,
    output,
    extraArgs: [`--proxy-server=http://127.0.0.1:${proxy.address().port}`],
  });
  await session.until(
    async () => (await session.chat.evaluate('companion.snapshot()')).value.connection === 'error',
    'missing CLI guard',
  );
  const agent = (await session.chat.evaluate('companion.snapshot()')).value;
  assert.match(agent.error, /Codex|安装|找不到|未找到|启动/);
  const speech = await session.workspace.evaluate('companion.synthesize("固定测试")');
  assert.equal(speech.ok, false);
  assert.match(speech.error, /常驻加载|下载|未加载|未就绪/);
  const resources = (await session.workspace.evaluate('companion.workspace()')).value.resources;
  assert.ok(resources.packs.every((pack) => !pack.installed));
  report.checks.push(
    'packaged app gives actionable missing CLI and unloaded-model errors without starting inference',
  );
  await session.workspace.evaluate(
    "(()=>{globalThis.__qaDownload=null;companion.downloadResource('asr').then(result=>globalThis.__qaDownload=result);})()",
  );
  await session.until(() => connectionCount > 0, 'download reaches only the local failure proxy');
  assert.equal((await session.workspace.evaluate('companion.cancelDownload()')).ok, true);
  await session.until(
    async () =>
      (await session.workspace.evaluate('companion.workspace()')).value.resources.phase === 'cancelled',
    'download cancellation',
  );
  await session.until(
    () => session.workspace.evaluate('globalThis.__qaDownload!==null'),
    'cancelled download settles',
  );
  rejectConnections = true;
  for (const socket of sockets) socket.destroy();
  await session.workspace.evaluate(
    "(()=>{globalThis.__qaDownload=null;companion.downloadResource('asr').then(result=>globalThis.__qaDownload=result);})()",
  );
  await session.until(
    async () => (await session.workspace.evaluate('companion.workspace()')).value.resources.phase === 'error',
    'retry download failure',
    60000,
  );
  const failed = (await session.workspace.evaluate('companion.workspace()')).value.resources;
  assert.ok(failed.error && failed.packs.every((pack) => !pack.installed));
  assert.deepEqual(session.errors, []);
  report.checks.push(
    'download cancellation and retry failure settle with an error and never mark partial resources installed (local proxy fault injection)',
  );
  await session.close();
  session = null;

  session = await packagedSession({ directory, output, storage: join(output, 'no-webgl') });
  await session.wallpaper.evaluate(
    "document.querySelector('.wallpaper-puppet canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()",
  );
  await session.until(
    async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.phase === 'error',
    'actual WebGL context-loss fallback',
  );
  assert.equal(
    await session.wallpaper.evaluate(
      "(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:original.call(this,kind,...args);};return document.createElement('canvas').getContext('webgl2')===null;})()",
    ),
    true,
  );
  await session.workspace.evaluate("document.getElementById('retry-character').click()");
  await session.until(
    async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.phase === 'error',
    'unavailable WebGL fallback',
  );
  const poster = await session.wallpaper.evaluate(
    "(()=>{const c=document.querySelector('canvas.wallpaper-still'),d=c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;return {width:c.width,height:c.height,pixel:[...d],puppets:document.querySelectorAll('.wallpaper-puppet').length};})()",
  );
  assert.ok(poster.width > 1 && poster.height > 1 && poster.pixel.slice(0, 3).some((value) => value > 0));
  assert.ok(poster.puppets <= 1, 'failed retry does not accumulate puppet scenes');
  await session.until(
    () => session.workspace.evaluate("!document.getElementById('retry-character').hidden"),
    'visible retry action',
  );
  assert.deepEqual(session.errors, []);
  report.checks.push(
    'packaged WebGL context loss and retry creation failure retain a painted fallback, offer retry and do not accumulate puppets (fault injection)',
  );
  await session.close();
  session = null;

  if (option('qwen-root')) {
    const qwenRoot = resolve(option('qwen-root')),
      cache = join(output, 'qwen-cache');
    await mkdir(cache);
    const env = {
      ...process.env,
      CUDA_VISIBLE_DEVICES: '-1',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      PYTHONUTF8: '1',
      HF_HOME: cache,
      TORCH_HOME: cache,
      NUMBA_CACHE_DIR: cache,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    const { qwenPython } = await import(
      pathToFileURL(join(directory, 'resources/app/backend/qwen-speech.mjs'))
    );
    assert.ok(qwenPython(qwenRoot), 'Use an existing complete Qwen runtime');
    qwen = spawn(
      qwenPython(qwenRoot),
      ['-u', join(directory, 'resources/app/backend/qwen-worker.py'), qwenRoot],
      { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '',
      stderr = '';
    qwen.stderr.on('data', (bytes) => (stderr += bytes));
    const response = new Promise((done, fail) => {
      qwen.once('error', fail);
      qwen.stdout.on('data', (bytes) => {
        stdout += bytes;
        for (const line of stdout.split('\n').filter(Boolean)) {
          let value;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          if (value.ok === false || value.event === 'ready') done(value);
        }
      });
    });
    let timer;
    try {
      const result = await Promise.race([
        response,
        new Promise((_, fail) => {
          timer = setTimeout(() => fail(Error('No-CUDA check timed out')), 180000);
        }),
      ]);
      const rows = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(result.ok, false);
      assert.match(result.error || '', /NVIDIA CUDA/);
      assert.ok(
        !rows.some((row) => row.stage === 'weights'),
        'unavailable CUDA is rejected before loading model weights',
      );
      report.checks.push(
        'packaged Qwen worker with child-only CUDA visibility disabled rejects GPU absence before weights, with no slow CPU or cloud fallback',
      );
    } finally {
      clearTimeout(timer);
      await writeFile(join(output, 'qwen-diagnostics.log'), stderr);
      await writeFile(join(output, 'qwen-protocol.jsonl'), stdout);
      await closeChild(qwen);
      assert.ok(qwen.exitCode !== null || qwen.signalCode !== null, 'owned Qwen worker exits');
      qwen = null;
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (session)
    await session.close().catch((error) => {
      report.cleanupError = error.message;
      process.exitCode = 1;
    });
  if (qwen) await closeChild(qwen);
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => proxy.close(done));
  await writeRunReport(output, report);
  console.log(
    JSON.stringify({ output, passed: report.passed, checks: report.checks.length, error: report.error }),
  );
}
