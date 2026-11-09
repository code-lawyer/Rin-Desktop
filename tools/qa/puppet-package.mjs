// Exercise the actual packaged main process with a fresh profile and no CLI.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';
import { connectPage } from './cdp.mjs';
import { inspectPuppetAssets } from '../release/puppet-assets.mjs';

requireLiveRun(
  'npm run qa:puppet-package -- --run --package=<extracted test package>',
  'the actual test executable twice with isolated storage, unavailable CLI and hidden desktop; no account, model download or hardware',
);
const args = process.argv.slice(2),
  packages = args.filter((arg) => arg.startsWith('--package='));
if (
  packages.length !== 1 ||
  !packages[0].slice(10) ||
  args.some((arg) => arg !== '--run' && !arg.startsWith('--package='))
)
  throw new Error('Use --run and one --package directory');
const directory = resolve(packages[0].slice(10));
const portable = JSON.parse(await readFile(join(directory, 'resources/app/portable.json'), 'utf8'));
assert.equal(portable.testBuild?.channel, 'internal-test', 'Use an isolated test build');
await inspectPuppetAssets(join(directory, 'resources/app/assets/scene/rin-poses'));
const output = await createRunDirectory('puppet-package'),
  checks = [];
const server = createServer();
await new Promise((done, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', done);
});
const port = server.address().port;
await new Promise((done) => server.close(done));
const env = { ...process.env, VIBE_CODEX_BINARY: join(output, 'unavailable-codex.exe'), VIBE_AGENT_CONFIG: join(output, 'custom-agents.json') };
delete env.ELECTRON_RUN_AS_NODE;
let child,
  exited,
  workspace,
  wallpaper,
  logs = '';
async function until(read, description) {
  for (let i = 0; i < 150; i++) {
    if (await read()) return;
    await delay(100);
  }
  const diagnostics = await wallpaper
    ?.evaluate(
      "(async()=>({hidden:document.hidden,clock:{...window.qaClock,now:performance.now()},rig:{...document.querySelector('.wallpaper-puppet[data-active=true]')?.dataset},presentation:(await companion.presentation()).value}))()",
    )
    .catch((error) => ({ error: error.message }));
  await writeFile(join(output, 'failure.json'), JSON.stringify({ description, diagnostics }, null, 2));
  throw new Error('Timed out: ' + description);
}
async function launch() {
  child = spawn(
    join(directory, 'VibeVoice.exe'),
    [
      `--storage=${join(output, 'data')}`,
      `--project=${output}`,
      '--provider=codex',
      '--visual=hidden',
      '--shortcut=off',
      `--debug-port=${port}`,
    ],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  exited = new Promise((done, fail) => {
    child.once('exit', done);
    child.once('error', fail);
  });
  child.stdout.on('data', (bytes) => {
    logs += bytes;
  });
  child.stderr.on('data', (bytes) => {
    logs += bytes;
  });
  let pages;
  await until(async () => {
    if (child.exitCode !== null) throw new Error('Packaged app exited during startup: ' + child.exitCode);
    try {
      pages = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
      ).json();
      return (
        pages.some((p) => p.url.includes('workbench.html')) &&
        pages.some((p) => p.url.includes('view=wallpaper'))
      );
    } catch {
      return false;
    }
  }, 'packaged windows');
  workspace = await connectPage(
    pages.find((p) => p.url.includes('workbench.html')),
    port,
  );
  wallpaper = await connectPage(
    pages.find((p) => p.url.includes('view=wallpaper')),
    port,
  );
  // Exercise rendering without reparenting a test window onto the real desktop.
  await wallpaper.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Capture this application target only. A live capture keeps the never-shown
  // window producing frames; focus emulation alone leaves native painting slow.
  wallpaper.on('Page.screencastFrame', ({ sessionId }) =>
    wallpaper.send('Page.screencastFrameAck', { sessionId }).catch(() => {}),
  );
  await wallpaper.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 1,
    maxWidth: 320,
    maxHeight: 200,
    everyNthFrame: 1,
  });
  await wallpaper.evaluate(
    'window.qaClock={start:performance.now(),frames:0};function qaFrame(){qaClock.frames++;requestAnimationFrame(qaFrame);}requestAnimationFrame(qaFrame)',
  );
  await until(async () => {
    const value = await workspace.evaluate('companion.workspace()');
    return value?.ok && value.value.wallpaper.phase === 'ready';
  }, 'ready packaged wallpaper');
}
const snapshot = () =>
  workspace.evaluate(
    '(async()=>{const s=(await companion.workspace()).value;return {wallpaper:s.wallpaper,settings:s.settings};})()',
  );
const host = "document.getElementById('wallpaper-view')";
async function quit() {
  await workspace.evaluate("companion.windowAction('quit')").catch(() => {});
  workspace.close();
  wallpaper.close();
  workspace = wallpaper = null;
  const code = await Promise.race([
    exited,
    delay(10000, null, { ref: false }).then(() => {
      throw new Error('Packaged app did not exit');
    }),
  ]);
  assert.equal(code, 0);
  child = null;
}
async function checkCustomAgents() {
  const fixture = join(output, 'synthetic-acp.mjs'), transcript = join(output, 'synthetic-acp-methods.txt');
  await writeFile(fixture, `import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const output=value=>process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line); appendFileSync(process.argv[2],request.method+'\\n');
  if(request.id===undefined)return;
  let result={};
  if(request.method==='initialize')result={protocolVersion:1,agentCapabilities:{loadSession:true},agentInfo:{name:'Synthetic QA',version:'1.0'}};
  else if(request.method==='session/new')result={sessionId:'qa-session'};
  else if(request.method==='session/prompt'){
    output({jsonrpc:'2.0',method:'session/update',params:{sessionId:request.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Synthetic ACP reply'}}}});
    result={stopReason:'end_turn'};
  }else if(request.method!=='session/load'){output({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unsupported synthetic method'}});return;}
  output({jsonrpc:'2.0',id:request.id,result});
});
`);
  const call = (name, ...args) => workspace.evaluate(`companion.${name}(...${JSON.stringify(args)})`);
  const value = result => { assert.equal(result.ok, true, result.error); return result.value; };
  let config = value(await call('customAgents'));
  assert.deepEqual(config.entries, []);
  const entry = { id: 'custom-package-qa', name: 'Synthetic package Agent', protocol: 'acp', command: join(directory, 'resources/app/runtime/node.exe'), args: [fixture, transcript] };
  config = value(await call('saveCustomAgent', entry, config.revision, true));
  await until(() => workspace.evaluate("!!document.querySelector('#agent-select option[value=custom-package-qa]')"), 'packaged custom picker');
  assert.equal((await wallpaper.evaluate('companion.customAgents()')).ok, false, 'wallpaper cannot read full launch settings');
  value(await call('chooseProvider', entry.id));
  let state = value(await call('snapshot'));
  assert.equal(state.connection, 'ready'); assert.equal(state.version, '1.0');
  assert.equal((await readFile(transcript, 'utf8')).includes('session/prompt'), false, 'connecting sends no model task');
  assert.equal((await call('removeCustomAgent', entry.id, config.revision)).ok, false);
  config = value(await call('saveCustomAgent', { ...entry, name: 'Edited package Agent' }, config.revision, false));
  assert.equal(config.needsReconnect, true);
  value(await call('reconnect'));
  assert.equal(value(await call('customAgents')).needsReconnect, false);
  state = value(await call('snapshot'));
  value(await call('send', 'Synthetic fixed task', { provider: entry.id, cwd: state.cwd, threadId: state.threadId }));
  await until(async () => {
    const current = value(await call('snapshot'));
    return current.status === 'idle' && current.messages.some(message => message.text === 'Synthetic ACP reply');
  }, 'packaged synthetic ACP response');
  const cache = join(output, 'data/agents', entry.id, 'session.json'), saved = await readFile(cache, 'utf8');
  value(await call('chooseProvider', 'codex'));
  config = value(await call('customAgents'));
  config = value(await call('removeCustomAgent', entry.id, config.revision));
  assert.deepEqual(config.entries, []);
  assert.equal(await readFile(cache, 'utf8'), saved, 'removing configuration retains session data');
  value(await call('windowAction', 'hide-chat'));
  checks.push('packaged custom Agent IPC, picker, real synthetic ACP child, edit/reconnect, removal and retained session data');
}
try {
  await launch();
  await checkCustomAgents();
  assert.equal((await snapshot()).wallpaper.model, 'rin-scene');
  assert.equal(await wallpaper.evaluate('document.hidden'), false);
  checks.push('actual packaged main/preload/renderer load our complete pose set without an installed CLI');
  await workspace.evaluate("companion.saveSettings({stillPose:'window',qwenVoice:'Vivian',voice:48})");
  await until(() => wallpaper.evaluate(host + ".dataset.pose==='window'"), 'saved gaze');
  for (const [motion, rig] of [
    [true, 'motion-clips'],
    [false, 'rin-scene'],
  ]) {
    assert.equal((await workspace.evaluate(`companion.saveSettings({wallpaperMotion:${motion}})`)).ok, true);
    await until(async () => {
      const { wallpaper: w } = await snapshot();
      return w.phase === 'ready' && w.model === rig;
    }, 'style ' + rig);
  }
  const state = await snapshot();
  assert.equal(state.settings.qwenVoice, 'Vivian');
  assert.equal(state.settings.voice, 48);
  checks.push('production settings transaction switches both styles and preserves custom voices');
  const puppet = "document.querySelector('.wallpaper-puppet[data-active=true]')";
  for (const pose of ['cup','attention','work','thinking','window']) {
    assert.equal((await workspace.evaluate(`companion.saveSettings({stillPose:'${pose}'})`)).ok, true);
    await until(() => wallpaper.evaluate(`${puppet}.dataset.actualPose==='${pose}' && ${puppet}.dataset.transitionPhase==='steady' && Number(${puppet}.dataset.poseAmount)===1`), 'packaged complete pose '+pose);
  }
  assert.equal((await workspace.evaluate("companion.wallpaperControl('gesture','wave')")).ok,false);
  assert.equal(await workspace.evaluate("document.querySelectorAll('[data-gesture]').length"),0);
  checks.push('all five complete poses settle through production IPC; retired skeletal gestures are rejected');
  const shot = await wallpaper.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, 'packaged-rin.png'), Buffer.from(shot.data, 'base64'));
  await quit();
  await launch();
  const restored = await snapshot();
  assert.equal(restored.wallpaper.model, 'rin-scene');
  assert.equal(restored.settings.stillPose, 'window');
  assert.equal(restored.settings.qwenVoice, 'Vivian');
  assert.equal(restored.settings.voice, 48);
  checks.push('a fresh packaged process restores the selected animated character, gaze and voices');
  await quit();
  checks.push('both actual packaged processes exit normally');
  await writeRunReport(output, {
    passed: true,
    build: portable.testBuild.id,
    checks,
    accounts: false,
    microphone: false,
    physicalDisplayAcceptance: false,
  });
  console.log(JSON.stringify({ output, checks, passed: true }));
} finally {
  workspace?.close();
  wallpaper?.close();
  if (child && child.exitCode === null) child.kill();
  await writeFile(join(output, 'application.log'), logs);
}
