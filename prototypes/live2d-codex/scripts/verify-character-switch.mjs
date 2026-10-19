// Real Electron regression check. Uses fresh storage and sends no conversation.
// Set VIBE_PLAYWRIGHT to an installed Playwright module when it is not on NODE_PATH.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url), { _electron } = require(process.env.VIBE_PLAYWRIGHT || 'playwright');
const root = resolve(import.meta.dirname, '..'), repo = resolve(root, '../..');
const packageRoot = process.argv.find(arg => arg.startsWith('--package='))?.slice(10);
const output = join(repo, 'work/runtime/character-recovery'); await mkdir(output, { recursive: true });
const storage = await mkdtemp(join(output, 'session-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
const report = { storage, packageRoot, checks: [], errors: [] };
let app, wallpaper, workbench;
const snapshot = () => workbench.evaluate(async () => (await window.companion.workspace()).value);
const persisted = async () => JSON.parse(await readFile(join(storage, 'workspaces.json'), 'utf8')).settings;
const radio = id => workbench.locator(`[name="wallpaper-character"][value="${id}"]`);
const retry = () => workbench.locator('#retry-character');
async function waitStatus(phase, character, afterRequest = -1) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const state = (await snapshot()).wallpaper;
    if (state.phase === phase && (!character || state.character === character) && state.requestId > afterRequest) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Expected ${character ?? 'initial'} wallpaper ${phase}: ${JSON.stringify((await snapshot()).wallpaper)}`);
}
async function expectActive(character, qwenVoice, voice) {
  const value = await snapshot();
  for (const settings of [value.settings, await persisted()]) {
    assert.equal(settings.character, character); assert.equal(settings.qwenVoice, qwenVoice); assert.equal(settings.voice, voice);
  }
  assert.equal(await wallpaper.locator('#wallpaper-view').getAttribute('data-character'), character);
  await workbench.waitForFunction(({ qwenVoice, voice }) => document.getElementById('qwen-voice').value === qwenVoice && document.getElementById('voice').value === String(voice), { qwenVoice, voice });
}
async function launch() {
  app = await _electron.launch({ executablePath: packageRoot ? resolve(packageRoot, 'VibeVoice.exe') : join(root, 'node_modules/electron/dist/electron.exe'), args: [...(packageRoot ? [] : [root]), `--storage=${storage}`, '--mode=wallpaper', '--visual=hidden', '--shortcut=off'], cwd: repo, env, timeout: 25000 });
  app.on('window', page => page.on('pageerror', error => report.errors.push(error.message)));
  const deadline = Date.now() + 25000;
  while (!app.windows().some(page => page.url().includes('workbench.html'))) {
    if (Date.now() > deadline) throw new Error('Missing workbench');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  wallpaper = app.windows().find(page => page.url().includes('view=wallpaper'));
  workbench = app.windows().find(page => page.url().includes('workbench.html'));
  await workbench.locator('#settings-tab').click();
  await waitStatus('ready');
}
async function intercept(character, suffix, hold = false) {
  await app.evaluate(({ session }, { character, suffix, hold }) => {
    globalThis.characterProbe = { callbacks: [], hits: 0 };
    session.defaultSession.webRequest.onBeforeRequest({ urls: [`app://local/assets/${character === 'male' ? 'rainy-window-male' : 'rainy-window-v2-4k'}/*`] }, (details, callback) => {
      if (!details.url.endsWith(suffix)) return callback({ cancel: false });
      globalThis.characterProbe.hits++;
      if (hold) globalThis.characterProbe.callbacks.push(callback); else callback({ cancel: true });
    });
  }, { character, suffix, hold });
}
async function release(cancel = false) {
  await app.evaluate(({ session }, cancel) => {
    session.defaultSession.webRequest.onBeforeRequest(null);
    for (const callback of globalThis.characterProbe?.callbacks ?? []) callback({ cancel });
  }, cancel);
}
async function waitHeld() {
  await app.evaluate(async () => {
    const deadline = Date.now() + 15000;
    while (!globalThis.characterProbe.callbacks.length) {
      if (Date.now() > deadline) throw new Error('Expected a held asset request');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
}
async function save(patch) {
  const result = await workbench.evaluate(patch => window.companion.saveSettings(patch), patch);
  assert.equal(result.ok, true, result.error);
}

try {
  await launch(); await expectActive('female', 'Serena', 3);
  await save({ qwenVoice: 'Vivian', voice: 46, ttsEngine: 'kokoro' });
  await workbench.locator('#speed').selectOption('0.9');
  await intercept('male', 'Generated_artwork.model3.json', true);
  await radio('male').check(); await waitStatus('loading', 'male'); await waitHeld();
  const attempt = (await snapshot()).wallpaper.requestId;
  await expectActive('female', 'Vivian', 46);
  await wallpaper.evaluate(requestId => window.companion.renderReady({ ready: true, character: 'male', requestId: requestId - 1 }), attempt);
  await expectActive('female', 'Vivian', 46);
  await release(true); await waitStatus('error', 'male');
  await expectActive('female', 'Vivian', 46);
  assert.equal(await radio('female').isChecked(), true); assert.equal(await retry().isVisible(), true);
  assert.equal(await workbench.locator('#speed').inputValue(), '0.9');
  report.checks.push('Pending and failed loads retain the active wallpaper, both custom voices and persisted settings; stale confirmations are ignored');

  await intercept('male', 'Generated_artwork.model3.json');
  await retry().click(); await waitStatus('error', 'male', attempt);
  assert.ok((await snapshot()).wallpaper.requestId > attempt);
  await expectActive('female', 'Vivian', 46);
  await release(); await retry().focus(); await retry().press('Enter');
  await waitStatus('ready', 'male'); await expectActive('male', 'Dylan', 58);
  assert.equal(await retry().isVisible(), false); assert.equal(await radio('male').isChecked(), true);
  assert.equal(await workbench.locator('#speed').inputValue(), '0.9');
  await workbench.locator('#save-settings').click();
  assert.equal((await snapshot()).settings.speed, .9);
  report.checks.push('Explicit retry survives repeated failures, supports keyboard activation, then applies both male defaults without losing unrelated form edits');

  await save({ qwenVoice: 'Uncle_Fu', voice: 59 });
  await intercept('female', '.png');
  await radio('female').check(); await waitStatus('error', 'female');
  const failedAttempt = (await snapshot()).wallpaper.requestId;
  const failedAssetRequests = await app.evaluate(() => globalThis.characterProbe.hits);
  await expectActive('male', 'Uncle_Fu', 59);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=wallpaper')).setSize(900, 600);
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('workbench.html')).setSize(760, 540);
  });
  await workbench.evaluate(() => window.companion.windowAction('show-chat'));
  await workbench.waitForTimeout(150);
  assert.equal((await snapshot()).wallpaper.phase, 'error');
  assert.equal((await snapshot()).wallpaper.requestId, failedAttempt);
  assert.equal(await app.evaluate(() => globalThis.characterProbe.hits), failedAssetRequests, 'Resize/chat changes must not silently retry failed assets');
  await retry().scrollIntoViewIfNeeded();
  assert.equal(await workbench.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('workbench.html'));
    window.webContents.invalidate(); await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  await writeFile(join(storage, 'retry.png'), Buffer.from(screenshot, 'base64'));
  await app.close(); app = null;
  await launch(); await expectActive('male', 'Uncle_Fu', 59);
  report.checks.push('Texture failure retains custom male voices; resize/chat updates do not clear the error; restart restores the last successful character');

  await intercept('female', 'Generated_artwork.model3.json', true);
  await radio('female').check(); await waitStatus('loading', 'female'); await waitHeld();
  await radio('male').check(); await release(true);
  await waitStatus('ready', 'male'); await expectActive('male', 'Uncle_Fu', 59);
  assert.equal(await retry().isVisible(), false);
  await radio('female').check(); await waitStatus('ready', 'female'); await expectActive('female', 'Serena', 3);
  assert.equal((await snapshot()).settings.speed, .9);
  report.checks.push('Cancelling an in-flight switch rejects the stale failure, and a subsequent normal switch restores both female defaults');

  // Delay the main-process confirmation of an actually displayed male scene,
  // then fail the next choice. Its eventual confirmation must still align audio
  // with the visible scene, without erasing the newer failure/retry target.
  await app.evaluate(({ ipcMain }) => {
    const channel = 'companion:render-ready', listeners = ipcMain.listeners(channel);
    const probe = globalThis.characterAcknowledgementProbe = { listeners, events: [] };
    for (const listener of listeners) ipcMain.removeListener(channel, listener);
    probe.listener = (event, info) => {
      if (info?.ready && info.character === 'male') probe.events.push([event, info]);
      else for (const listener of listeners) listener(event, info);
    };
    ipcMain.on(channel, probe.listener);
  });
  await radio('male').check();
  await wallpaper.waitForFunction(() => document.getElementById('wallpaper-view').dataset.character === 'male');
  await intercept('female', 'Generated_artwork.model3.json');
  await radio('female').check(); await waitStatus('error', 'female');
  await app.evaluate(({ ipcMain }) => {
    const probe = globalThis.characterAcknowledgementProbe, channel = 'companion:render-ready';
    ipcMain.removeListener(channel, probe.listener);
    for (const listener of probe.listeners) ipcMain.on(channel, listener);
    for (const [event, info] of probe.events) for (const listener of probe.listeners) listener(event, info);
  });
  await workbench.waitForFunction(() => document.getElementById('qwen-voice').value === 'Dylan');
  await expectActive('male', 'Dylan', 58); await waitStatus('error', 'female');
  await release(); await retry().click(); await waitStatus('ready', 'female'); await expectActive('female', 'Serena', 3);
  report.checks.push('A delayed confirmation follows the actually visible scene and preserves the newer failure and retry target');
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  if (app) await app.close();
  await writeFile(join(storage, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
