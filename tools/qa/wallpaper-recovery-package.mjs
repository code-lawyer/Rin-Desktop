import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { packagedSession } from './packaged-session.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun('npm run qa:wallpaper-recovery -- --run --package=<test package>',
  'actual packaged decoder/play failure injection, recovery and restart; isolated storage, no accounts or devices');
const args = process.argv.slice(2), packages = args.filter(arg => arg.startsWith('--package='));
if (packages.length !== 1 || !packages[0].slice(10) || args.some(arg => arg !== '--run' && !arg.startsWith('--package=')))
  throw new Error('Use --run and one --package directory.');
const directory = resolve(packages[0].slice(10)), output = await createRunDirectory('wallpaper-recovery-package');
const report = { output, package: directory, accounts: false, hardware: false, checks: [], passed: false };
let session;
const launch = () => packagedSession({ directory, output });
const faultScript = kind => `window.recoveryFault=${JSON.stringify(kind)};window.recoveryFailures=[];
  const load=HTMLMediaElement.prototype.load,play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.load=function(){
    if(recoveryFault==='decode'&&this.src.includes('/motion/female/work-loop.mp4')){
      this.addEventListener('error',()=>recoveryFailures.push({kind:'decode',code:this.error?.code}),{once:true,capture:true});
      this.src='data:video/mp4;base64,bm90LWEtdmFsaWQtbXA0';
    }
    return load.call(this);
  };
  HTMLMediaElement.prototype.play=function(){
    if(recoveryFault==='play'&&this.src.includes('/motion/female/work-loop.mp4')){
      recoveryFailures.push({kind:'play'});return Promise.reject(new DOMException('Injected initial playback failure','NotAllowedError'));
    }
    return play.call(this);
  };`;
try {
  session = await launch();
  const { workspace, wallpaper, until } = session;
  const snapshot = async () => (await workspace.evaluate('companion.workspace()')).value;
  const saved = async () => {
    try { return JSON.parse(await readFile(join(session.storage, 'workspaces.json'), 'utf8')).settings; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const original = async () => {
    assert.equal((await workspace.evaluate("companion.saveSettings({animePlayback:'poses',wallpaperMotion:false})")).ok, true);
    await until(async () => (await snapshot()).wallpaper.model === 'rin-scene' && (await snapshot()).wallpaper.phase === 'ready', 'original renderer');
  };
  await original();
  await wallpaper.evaluate(faultScript(''));
  async function fail(kind) {
    const before = await saved();
    await wallpaper.evaluate('recoveryFault=' + JSON.stringify(kind));
    await workspace.evaluate('companion.saveSettings({wallpaperMotion:true})');
    await until(async () => (await snapshot()).wallpaper.phase === 'error', kind + ' failure');
    // A fresh profile can keep the default still mode entirely in memory.
    assert.equal((await snapshot()).settings.wallpaperMotion ?? false, false);
    assert.deepEqual(await saved(), before, 'failed replacement must not change persisted settings');
    const layers = await wallpaper.evaluate("({original:document.querySelectorAll('.wallpaper-puppet').length,video:document.querySelectorAll('.wallpaper-motion').length,rig:document.getElementById('wallpaper-view').dataset.rig})");
    assert.equal(layers.original, 1); assert.equal(layers.video, 0); assert.equal(layers.rig, 'scene');
    report.checks.push(kind + ': failed candidate disposed, original renderer and persisted settings retained');
  }
  for (const kind of ['decode', 'play']) {
    await fail(kind);
    await wallpaper.evaluate("recoveryFault=''");
    await workspace.evaluate("document.getElementById('retry-character').click()");
    await until(() => wallpaper.evaluate("document.getElementById('wallpaper-view').dataset.motionClip==='work-loop' && document.getElementById('wallpaper-view').dataset.rig==='motion'"), 'explicit recovery');
    assert.equal((await saved()).wallpaperMotion, true);
    report.checks.push(kind + ': explicit retry decodes the real media and commits only the successful choice');
    await original();
  }
  await fail('decode');
  report.injectedFailures = await wallpaper.evaluate('recoveryFailures');
  assert.ok(report.injectedFailures.some(failure => failure.kind === 'decode' && failure.code === 4));
  assert.ok(report.injectedFailures.some(failure => failure.kind === 'play'));
  await session.close(); session = null;
  session = await launch();
  await session.until(async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.model === 'rin-scene', 'restart restores the last successful style');
  assert.equal((await session.workspace.evaluate('companion.workspace()')).value.settings.wallpaperMotion, false);
  assert.equal(await session.wallpaper.evaluate("document.getElementById('wallpaper-view').dataset.rig"), 'scene');
  report.checks.push('fresh packaged process restores the original style after the failed replacement');
  // Reload only this isolated renderer after saving realistic mode. The new
  // document has no previous renderer, and faults are installed before startup.
  await session.workspace.evaluate('companion.saveSettings({wallpaperMotion:true})');
  await session.until(async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.phase === 'ready' &&
    await session.wallpaper.evaluate("document.getElementById('wallpaper-view').dataset.rig==='motion'"), 'saved realistic mode');
  await session.wallpaper.send('Page.enable');
  for (const kind of ['decode', 'play']) {
    const script = await session.wallpaper.send('Page.addScriptToEvaluateOnNewDocument', { source: faultScript(kind) });
    await session.wallpaper.send('Page.reload');
    await session.until(async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.phase === 'error', 'saved mode ' + kind + ' failure');
    const fallback = await session.wallpaper.evaluate(`(() => {
      const canvas=document.querySelector('.wallpaper-still'),ctx=canvas.getContext('2d');
      return {hasPoster:[0.2,0.5,0.8].some(x=>[0.2,0.5,0.8].some(y=>Array.from(ctx.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data).slice(0,3).some(value=>value>0))),
        videos:document.querySelectorAll('.wallpaper-motion').length,failures:recoveryFailures};
    })()`);
    assert.equal(fallback.hasPoster, true); assert.equal(fallback.videos, 0);
    assert.ok(fallback.failures.some(failure => failure.kind === kind && (kind !== 'decode' || failure.code === 4)));
    assert.equal((await saved()).wallpaperMotion, true);
    await session.wallpaper.evaluate("recoveryFault=''");
    await session.wallpaper.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
    await session.workspace.evaluate("document.getElementById('retry-character').click()");
    await session.until(async () => (await session.workspace.evaluate('companion.workspace()')).value.wallpaper.phase === 'ready' &&
      await session.wallpaper.evaluate("document.getElementById('wallpaper-view').dataset.rig==='motion'"), 'saved mode retry');
    report.checks.push(kind + ': saved realistic mode paints its poster on renderer startup failure and explicit retry restores video');
  }
  await session.close(); session = null; report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (session) await session.close().catch(error => { report.cleanupError = error.message; process.exitCode = 1; });
  await writeRunReport(output, report);
  console.log(JSON.stringify({ output, passed: report.passed, checks: report.checks, error: report.error }));
}
