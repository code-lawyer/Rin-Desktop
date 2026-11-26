// Real production HTML, bundle, preload and durable store; no Agent or device.
if (!process.argv.includes('--run') || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Use npm run qa:shutdown -- --run. Default: help only; no files or processes.');
} else {
  const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
  const { join, resolve, relative, isAbsolute, sep } = require('node:path');
  const { readFileSync, writeFileSync, existsSync } = require('node:fs');
  const fs = require('node:fs/promises');
  const { pathToFileURL } = require('node:url');
  const vm = require('node:vm');
  const assert = require('node:assert/strict');
  const root = resolve(__dirname, '../..'), application = join(root, 'prototypes/live2d-codex');
  const output = resolve(process.argv[2] || ''), local = relative(join(root, 'work/qa'), output);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Use a new output directory beneath work/qa.');
  if (['fixture.json', 'data', 'profile'].some(name => existsSync(join(output, name)))) throw new Error('The shutdown fixture requires an unused output directory.');
  app.setPath('userData', join(output, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
  const checks = [], acknowledgements = [], errors = [], dialogs = [];
  let chat, context, store, heldWrite, firstQuitCancelled = false, failWrites = false, finalRequested = false;
  const expectedDraft = 'Shutdown fixture: saved after the simulated disk failure.';
  const target = { provider: 'codex', cwd: output, threadId: 'shutdown-fixture' };
  const state = { ...target, connection: 'ready', status: 'idle', projectName: 'Offline fixture', threadName: 'Draft shutdown', models: [], messages: [], approvals: [], activity: '' };
  const evaluate = code => chat.webContents.executeJavaScript(code);
  async function until(condition, description) {
    for (let i = 0; i < 200; i++) { if (await condition()) return; await delay(25); }
    throw new Error(`Timed out: ${description}`);
  }
  function failure(error) {
    writeFileSync(join(output, 'fixture.json'), JSON.stringify({ passed: false, error: error.stack || error.message, checks, errors }, null, 2), { flag: 'wx' });
    app.exit(1);
  }
  app.whenReady().then(async () => {
    const { WorkspaceStore, draftKey } = await import(pathToFileURL(join(application, 'backend/workspace-store.mjs')).href);
    const { SubmissionGuard } = await import(pathToFileURL(join(application, 'backend/submission-guard.mjs')).href);
    const { remoteSettings } = await import(pathToFileURL(join(application, 'backend/remote-config.mjs')).href);
    store = new WorkspaceStore(join(output, 'data'), { io: { ...fs, rename: async (from, to) => {
      if (failWrites && to.endsWith('workspaces.json')) throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
      if (heldWrite && to.endsWith('workspaces.json')) {
        const gate = heldWrite;
        heldWrite = null;
        gate.entered.resolve();
        await gate.resume.promise;
      }
      return fs.rename(from, to);
    } } });
    await store.load(); await store.add(output);
    const original = '甲'.repeat(40000), newer = '乙'.repeat(30000);
    const submissions = new SubmissionGuard(store);
    await store.transaction(data => {
      store.setDraft(data, target, newer);
      data.submissions = { codex: { id: 'lost-receipt', status: 'unknown', text: original, target, originalTarget: target, checkedAt: Date.now() } };
    });
    const snapshot = () => ({ ...state, submission: submissions.snapshot('codex') });
    const remote = { phase: 'disconnected', audio: 'idle', config: remoteSettings(), devices: [], keysAvailable: false };
    const workspace = () => ({ ...store.snapshot(), version: 1, legacyDotsAvailable: false, speech: { phase: 'unloaded', asr: false, engines: {} }, remote, shortcutErrors: [], resources: { phase: 'idle', packs: [] } });
    protocol.handle('app', request => {
      let file;
      try { file = resolve(application, '.' + decodeURIComponent(new URL(request.url).pathname)); }
      catch { return new Response('', { status: 400 }); }
      if (!file.startsWith(application + sep)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    chat = new BrowserWindow({ show: false, width: 440, height: 520, webPreferences: { preload: join(application, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    chat.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    chat.webContents.session.setPermissionCheckHandler(() => false);
    chat.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    chat.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !message.includes('Electron Security Warning')) errors.push(message); });
    const main = readFileSync(join(application, 'main.cjs'), 'utf8');
    const extracted = (start, end) => {
      const a = main.indexOf(start), b = main.indexOf(end, a);
      assert.ok(a >= 0 && b > a, `Production boundary not found: ${start}`); return main.slice(a, b);
    };
    const appFacade = { on: app.on.bind(app), relaunch: () => assert.fail('The fixture must not relaunch'), exit: code => {
      try {
        assert.equal(code, 0); assert.equal(finalRequested, true); assert.equal(firstQuitCancelled, true);
        assert.equal(chat.isVisible(), false); assert.equal(context.closing, true); assert.equal(acknowledgements.length, 2);
        assert.equal(acknowledgements[0].ok, false); assert.equal(acknowledgements[1].ok, true);
        assert.equal(store.draft(target), expectedDraft); assert.deepEqual(errors, []);
        checks.push('production quit reached app.exit only after a successful real preload acknowledgement');
        writeFileSync(join(output, 'fixture.json'), JSON.stringify({ passed: true, checks, handshakeCount: acknowledgements.length, firstQuitCancelled,
          draftKey: draftKey(target), expectedDraft, electron: process.versions.electron, hidden: !chat.isVisible(), accounts: false, hardware: false }, null, 2), { flag: 'wx' });
        app.exit(0);
      } catch (error) { failure(error); }
    } };
    context = vm.createContext({ app: appFacade, ipcMain, URL, avatar: null, chat, workbench: null, store,
      closing: false, quitting: false, draftFlushRequest: null, draftFlushSerial: 0, pendingRelaunch: null, pendingDataSelection: null,
      changingData: false, changingProvider: false, changingAgentConfig: false, provider: 'codex', submissions, captureTarget: null,
      isCliAgent: require(join(application, 'backend/agent-catalog.cjs')).isCliAgent,
      remote: null, voiceResources: null, speech: null, wallpaperHost: null, backend: { close: async () => checks.push('owned backend cleanup occurred') }, providerChange: null,
      globalShortcut: { unregisterAll() {} }, registerShortcuts() {}, tray: null, captureTimer: null, ambientBarrier: { close() {} }, cancelWallpaperCommit() {}, characterBox: null,
      showChat: () => checks.push('failed quit retained the editable window'), dialog: { showErrorBox: (title, message) => dialogs.push({ title, message }) },
      setTimeout, clearTimeout, console,
    });
    vm.runInContext(main.match(/^const isLocal = .*;$/m)[0] + '\n' + main.match(/^const trusted = .*;$/m)[0] + '\n' +
      extracted('    const handler =', "    handler('companion:snapshot'") + extracted("    handler('workbench:draft'", "    handler('workbench:settings'") +
      extracted("    handler('companion:submission'", "    handler('companion:interrupt'") +
      extracted('  function flushChatDraft()', "  app.on('window-all-closed'"), context);
    const handle = (name, action) => ipcMain.handle(name, async (_event, ...args) => ({ ok: true, value: await action(...args) }));
    handle('companion:snapshot', snapshot); handle('companion:appearance', () => ({ scale: 1, mode: 'wallpaper' }));
    submissions.on('state', () => chat.webContents.send('companion:state', snapshot()));
    handle('workbench:snapshot', workspace); handle('remote:command', () => remote); handle('speech:stop', () => {}); handle('speech:capture', () => {});
    handle('companion:window', action => { if (action === 'quit') app.quit(); });
    ipcMain.on('draft:flushed', (event, id, result) => { assert.equal(event.sender, chat.webContents); acknowledgements.push({ id, ok: result?.ok }); });
    await chat.loadURL('app://local/renderer/index.html?view=chat');
    await until(() => evaluate("document.getElementById('prompt') === document.activeElement && document.getElementById('speaker-name').textContent === 'Codex'"), 'production chat initialization');
    assert.equal(chat.isVisible(), false);
    checks.push('production HTML, built renderer and actual sandboxed preload initialized in a hidden window');
    const promptLength = () => evaluate("document.getElementById('prompt').value.length");
    const chooseRecovery = () => evaluate("document.getElementById('draft-recoveries').open = true; document.querySelector('#draft-recovery-options button').click();");
    const clearDraft = () => evaluate("document.getElementById('prompt').value = ''; document.getElementById('prompt').dispatchEvent(new Event('input', { bubbles: true }));");
    await until(async () => await promptLength() === newer.length, 'newer draft loaded');
    await evaluate("document.getElementById('submission-release').click(); document.getElementById('submission-release').click();");
    await until(() => evaluate("document.querySelector('#draft-recovery-options button')?.disabled === false"), 'long draft recovery available');
    assert.equal(submissions.snapshot('codex').status, 'released');
    assert.equal(store.draft(target), newer);
    const gate = { entered: Promise.withResolvers(), resume: Promise.withResolvers() };
    heldWrite = gate;
    await chooseRecovery();
    await gate.entered.promise;
    try {
      for (const threadId of ['other-thread', target.threadId]) {
        state.threadId = threadId;
        chat.webContents.send('companion:state', snapshot());
        await until(() => evaluate(`document.getElementById('session-label').textContent.endsWith(${JSON.stringify(threadId.slice(-8))})`), 'switched conversation');
      }
    } finally { gate.resume.resolve(); }
    await until(async () => await promptLength() === original.length, 'original draft restored to the editor');
    assert.equal(store.draft(target), original);
    checks.push('returning to a conversation during an atomic swap reads the newly committed draft');
    await chooseRecovery();
    await until(async () => await promptLength() === newer.length, 'newer draft remained available after swapping');
    assert.equal(store.draft(target), newer);
    checks.push('review and real preload swap keep long original and newer drafts separately editable');
    await clearDraft();
    await chooseRecovery();
    await until(async () => await promptLength() === original.length, 'recovered copy moved into empty editor');
    assert.equal(store.draftSnapshot(target).recoveries, undefined);
    await clearDraft();
    await until(() => store.draft(target) === '', 'synthetic recovery drafts cleared before shutdown test');
    failWrites = true;
    await evaluate("document.getElementById('prompt').value = 'Shutdown fixture: retain this unsaved input.'; document.getElementById('prompt').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('quit-button').click();");
    await until(() => dialogs.length === 1 && !context.quitting, 'first quit cancellation');
    assert.equal(context.closing, false); assert.equal(store.draft(target), '');
    await until(() => evaluate("!document.getElementById('prompt').readOnly && document.getElementById('error-banner').textContent.includes('退出已取消')"), 'renderer editing restored');
    assert.equal(await evaluate("document.getElementById('prompt').value"), 'Shutdown fixture: retain this unsaved input.');
    firstQuitCancelled = true;
    checks.push('an atomic draft write failure cancelled quit and preserved the editable input through real IPC');
    failWrites = false; finalRequested = true;
    await evaluate(`document.getElementById('prompt').value = ${JSON.stringify(expectedDraft)}; document.getElementById('prompt').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('quit-button').click();`);
  }).catch(failure);
}
