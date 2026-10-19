const { app, BrowserWindow, ipcMain, protocol, screen, Tray, Menu, nativeImage, dialog, globalShortcut, shell, net } = require('electron');
const { join, resolve, relative, extname, sep } = require('node:path');
const { readFile, writeFile, mkdir, rename } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { bubbleLayout } = require('./backend/bubble-layout.cjs');
const { avatarScale: normalizeAvatarScale, avatarBounds } = require('./backend/avatar-window.cjs');
const { WallpaperHost } = require('./backend/wallpaper-host.cjs');
const { registerInputActions } = require('./backend/input-actions.cjs');

const root = __dirname;
const packaged = require('node:fs').existsSync(join(root, 'portable.json'));
const legacyDotsAvailable = !packaged && require('node:fs').existsSync(join(root, '../dots-bridge/src/client.mjs')) && require('node:fs').existsSync(join(root, 'backend/dots.mjs'));
const projectRoot = packaged ? app.getPath('documents') : resolve(root, '../..');
const argument = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const wallpaperMode = packaged || (argument('mode') ?? 'wallpaper') === 'wallpaper';
const defaultStorage = join(process.env.LOCALAPPDATA || app.getPath('userData'), 'VibeVoice');
let importedStorage;
if (packaged) {
  try { const data = JSON.parse(require('node:fs').readFileSync(join(defaultStorage,'data-location.json'),'utf8')); if (typeof data.directory === 'string' && require('node:path').isAbsolute(data.directory) && require('node:fs').existsSync(data.directory)) importedStorage = data.directory; } catch {}
}
const storageDir = resolve(argument('storage') ?? (packaged ? importedStorage || defaultStorage : join(projectRoot, 'work/runtime/avatar')));
app.setPath('userData', join(storageDir, 'profile'));
const debugPort = argument('debug-port');
if (debugPort && /^\d{4,5}$/.test(debugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let avatar, chat, workbench, backend, tray, store, speech, voiceResources, captureTarget, captureTimer, closing = false;
let shortcutErrors = [], rememberedTarget = '', keyLearning = false, shortcutResumeAt = 0, workspaceVersion = 0;
let provider = 'codex', changingProvider = false, changingData = false;
let desiredBubble = { width: 440, height: 220 }, previousState, readingMode = false, avatarAnchor = null;
let characterScale = 1, characterBox, dragOrigin, appearanceTimer, appearanceQueue = Promise.resolve();
let bubblePosition = null, chatDragOrigin, currentChatLayout;
let wallpaperHost, manualPause = false, pendingMode = null, lastPresentation = '';
const isLocal = url => { try { const u = new URL(url); return u.protocol === 'app:' && u.hostname === 'local' && ['/renderer/index.html', '/renderer/workbench.html'].includes(u.pathname); } catch { return false; } };
const trusted = event => [avatar, chat, workbench].some(win => win && !win.isDestroyed() && win.webContents === event.sender) && isLocal(event.senderFrame?.url ?? '');
const appearance = () => ({ scale: characterScale, mode: wallpaperMode ? 'wallpaper' : 'avatar' });
const presentation = () => ({ mode: wallpaperMode ? 'wallpaper' : 'avatar', chatVisible: !!chat?.isVisible(), paused: manualPause || !!wallpaperHost?.status.occluded, manualPause, desktopAttached: !!wallpaperHost?.status.ok, desktopLayer: wallpaperHost?.status.parentClass ?? null, desktopBounds: wallpaperHost?.status.bounds ?? null });
function notifyPresentation() {
  if (!avatar || avatar.isDestroyed()) return;
  const value = presentation(), encoded = JSON.stringify(value);
  if (encoded !== lastPresentation) { lastPresentation = encoded; avatar.webContents.send('companion:presentation', value); }
}
function switchMode(mode) {
  if (packaged) return showChat();
  if (mode === (wallpaperMode ? 'wallpaper' : 'avatar')) return showChat();
  if (backend?.busy) { pendingMode = mode; return showChat(); }
  app.relaunch({ args: [...process.argv.slice(1).filter(arg => !arg.startsWith('--mode=') && !arg.startsWith('--provider=')), `--mode=${mode}`, `--provider=${provider}`] }); app.quit();
}
function saveAppearance() {
  clearTimeout(appearanceTimer);
  const data = JSON.stringify({ format: 1, scale: characterScale, position: { x: characterBox.x, y: characterBox.y }, bubblePosition }, null, 2) + '\n';
  appearanceQueue = appearanceQueue.catch(() => {}).then(async () => {
    await mkdir(storageDir, { recursive: true });
    const path = join(storageDir, 'appearance.json'); await writeFile(path + '.tmp', data); await rename(path + '.tmp', path);
  });
  return appearanceQueue;
}
function scheduleAppearance() { clearTimeout(appearanceTimer); appearanceTimer = setTimeout(() => { saveAppearance().catch(() => {}); }, 180); }
function applyAvatarBounds(position, scale = characterScale) {
  if (wallpaperMode) return appearance();
  characterScale = normalizeAvatarScale(scale);
  const area = screen.getDisplayMatching({ ...position, width: characterBox.width, height: characterBox.height }).workArea;
  characterBox = avatarBounds(position, area, characterScale);
  // Always carry canonical dimensions. Windows setPosition can accumulate a
  // rounded native height on transparent windows with display scaling.
  avatar.setBounds(characterBox);
  for (const win of [avatar, chat]) if (win && !win.isDestroyed()) win.webContents.send('companion:appearance', appearance());
  positionChat(); scheduleAppearance(); return appearance();
}
function resizeAvatar(scale) {
  const next = avatarBounds(characterBox, screen.getDisplayMatching(characterBox).workArea, scale);
  return applyAvatarBounds({ x: characterBox.x + (characterBox.width - next.width) / 2, y: characterBox.y + characterBox.height - next.height }, scale);
}
function resetAvatar() { const area = screen.getPrimaryDisplay().workArea; return applyAvatarBounds({ x: area.x + area.width - 320, y: area.y + area.height - 440 }, 1); }
function avatarMenu() {
  return Menu.buildFromTemplate([
    { label: chat.isVisible() ? '收起对话' : '打开对话', click: toggleChat },
    { label: '角色大小', submenu: [.8, 1, 1.25, 1.5].map(scale => ({ label: `${Math.round(scale * 100)}%`, type: 'radio', checked: Math.abs(characterScale - scale) < .001, click: () => resizeAvatar(scale) })) },
    { label: '恢复默认位置与大小', click: resetAvatar },
    { label: '切换为雨夜壁纸', click: () => switchMode('wallpaper') },
    { type: 'separator' },
    { label: '退出桌面伙伴', click: () => app.quit() }
  ]);
}
function showChat({ focus = true } = {}) {
  if (!chat || chat.isDestroyed()) return;
  positionChat();
  if (focus) { chat.show(); chat.moveTop(); chat.focus(); chat.webContents.send('companion:focus'); }
  else if (!chat.isVisible()) chat.showInactive();
}
function hideChat() { if (readingMode) { readingMode = false; chat.setFullScreen(false); } chat?.hide(); }
function toggleChat() { chat?.isVisible() ? hideChat() : showChat(); }
function recallChat() { chat?.isVisible() && chat.isFocused() ? hideChat() : showChat(); }
function showWorkbench(page) { hideChat(); workbench?.show(); workbench?.focus(); workbench?.webContents.send('workbench:refresh', typeof page === 'string' ? page : null); }
function workspaceSnapshot() { return { ...store.snapshot(), version: workspaceVersion, speech: speech.status(), resources: voiceResources?.snapshot(), shortcutErrors, legacyDotsAvailable }; }
function notifyWorkspace() { workspaceVersion++; for (const win of [chat, workbench]) if (win && !win.isDestroyed()) win.webContents.send('workbench:state', workspaceSnapshot()); }
function stopSpeech() { chat?.webContents.send('speech:stop'); return speech?.stop().catch(error => console.error('[speech:stop]', error.message)); }
function switchAllowed() { if (captureTarget) throw new Error('请先完成或取消听写，再切换对话。'); if (provider !== 'codex') throw new Error('项目工作台需要切换到 Codex。'); stopSpeech(); }
function sendInputAction(action) {
  if (changingData) return;
  if (action === 'record') showChat();
  if (['record', 'send', 'readReply'].includes(action)) chat?.webContents.send('companion:input-action', action);
}
function finishKeyLearning() {
  if (!keyLearning) return;
  keyLearning = false;
  // The key used to record a binding must not trigger it as focus leaves.
  shortcutResumeAt = Date.now() + 1200; registerShortcuts(); notifyWorkspace();
}
function registerShortcuts() {
  shortcutErrors = registerInputActions(globalShortcut, store.data.settings, {
    chat: recallChat, workbench: () => showWorkbench(), record: () => sendInputAction('record'),
    send: () => sendInputAction('send'), readReply: () => sendInputAction('readReply'), stopSpeech
  }, { suspended: argument('shortcut') === 'off' || keyLearning || changingData, resumeAt: shortcutResumeAt });
}
async function makeBackend(kind) {
  if (kind === 'dots') {
    if (!legacyDotsAvailable) throw new Error('Rin Desktop 公开版使用 Codex CLI，不包含私人 Dots 实验通道。');
    const { DotsCompanion } = await import(pathToFileURL(join(root, 'backend/dots.mjs')).href);
    return new DotsCompanion({ storageDir });
  }
  const { CodexCompanion } = await import(pathToFileURL(join(root, 'backend/codex.mjs')).href);
  return new CodexCompanion({ projectRoot: argument('project') ?? projectRoot, storageDir });
}
function bindBackend() {
  backend.on('state', state => {
    if (state.connection !== previousState?.connection || state.status !== previousState?.status) {
      console.info('[companion:connection]', JSON.stringify({ provider, connection: state.connection, status: state.status }));
    }
    for (const win of [avatar, chat, workbench]) if (win && !win.isDestroyed()) win.webContents.send('companion:state', { ...state, provider });
    const target = `${state.cwd}|${state.threadId}`;
    if (store && provider === 'codex' && state.connection === 'ready' && state.status !== 'configuring' && target !== rememberedTarget) { rememberedTarget = target; store.remember(state).then(notifyWorkspace).catch(error => console.error(error.message)); }
    if (previousState && ['starting', 'working', 'waiting', 'stopping'].includes(previousState.status) && state.status === 'idle') showChat({ focus: false });
    previousState = state;
    if (pendingMode && !backend.busy) { const next = pendingMode; pendingMode = null; switchMode(next); }
  });
  backend.on('attention', showChat);
  backend.on('reply-completed', reply => {
    // Only successful, complete, deduplicated turns emit this event. A chime
    // never depends on model residency or automatic narration being enabled.
    if (store?.data.settings.completionSound) chat?.webContents.send('notification:sound', { action: 'play' });
    const settings = store?.data.settings;
    if (settings?.ttsResident && (settings.autoSpeak || settings.prepareSpeech) && !captureTarget) chat?.webContents.send('speech:reply', reply);
  });
}
async function changeProvider(next) {
  if (captureTarget) throw new Error('请先完成或取消听写。');
  stopSpeech();
  if (!['codex', 'dots'].includes(next)) throw new Error('请选择 Codex 或 Dots。');
  if (changingProvider) throw new Error('正在切换对话来源。');
  if (next === provider) return;
  if (provider === 'codex' && backend.busy) throw new Error('请先等待或停止当前 Codex 任务。');
  changingProvider = true;
  try {
    const replacement = await makeBackend(next);
    backend.removeAllListeners(); await backend.close();
    backend = replacement; provider = next; previousState = null; bindBackend();
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(storageDir, 'provider.json'), JSON.stringify({ provider }));
    tray?.setToolTip(`Vibe Voice · ${provider === 'dots' ? '凛（Dots）' : 'Codex'} 桌面伙伴`);
    await backend.connect();
  } finally { changingProvider = false; }
}
function positionChat() {
  if (!avatar || !chat || chat.isDestroyed()) return;
  if (readingMode) { chat.webContents.send('companion:layout', { fullscreen: true }); return; }
  const a = wallpaperMode ? screen.getPrimaryDisplay().bounds : avatar.getContentBounds();
  const area = (bubblePosition ? screen.getDisplayNearestPoint(bubblePosition) : screen.getDisplayMatching(a)).workArea;
  const layout = bubbleLayout(a, area, chatDragOrigin?.size ?? desiredBubble, avatarAnchor, bubblePosition), b = chat.getBounds();
  currentChatLayout = layout;
  // Carry canonical dimensions when moving; native position-only moves can
  // accumulate height rounding on transparent Windows windows at high DPI.
  if (['x','y','width','height'].some(key => Math.abs(layout[key] - b[key]) > 1)) chat.setBounds({ x:layout.x, y:layout.y, width:layout.width, height:layout.height });
  const content = chat.getContentBounds();
  chat.webContents.send('companion:layout', { ...layout, contentWidth: content.width, contentHeight: content.height });
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === chat?.webContents && !!captureTarget && permission === 'media' && !details.mediaTypes?.includes('video') && isLocal(details.requestingUrl ?? contents.getURL())));
  win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => contents === chat?.webContents && !!captureTarget && permission === 'media' && details.mediaType !== 'video' && isLocal(contents.getURL()));
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('close', event => { if (!closing) { event.preventDefault(); if (win === chat) hideChat(); else win.hide(); } });
}
function icon() {
  const width = 32, pixels = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const inside = (x - 15.5) ** 2 + (y - 15.5) ** 2 < 225;
    const mark = y >= 9 && y <= 23 && Math.abs(Math.abs(x - 15.5) - (23 - y) * 0.45) < 1.4;
    pixels[i] = mark ? 246 : 135; pixels[i + 1] = mark ? 250 : 107; pixels[i + 2] = mark ? 252 : 66; pixels[i + 3] = inside ? 255 : 0;
  }
  return nativeImage.createFromBitmap(pixels, { width, height: width });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const mode = argv.find(arg => arg.startsWith('--mode='))?.slice(7);
    const requestedProvider = argv.find(arg => arg.startsWith('--provider='))?.slice(11);
    const ready = ['codex', 'dots'].includes(requestedProvider) ? changeProvider(requestedProvider) : Promise.resolve();
    ready.then(() => { if (['avatar', 'wallpaper'].includes(mode)) switchMode(mode); else showChat(); })
      .catch(error => { showChat(); dialog.showErrorBox('对话来源尚未切换', error.message); });
  });
  app.whenReady().then(async () => {
    console.info('[companion:startup]', 'ready');
    protocol.handle('app', async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'local' || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
        const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (!['renderer/', 'dist/', 'assets/', 'vendor/'].some(prefix => name.startsWith(prefix))) return new Response('', { status: 403 });
        const file = resolve(root, name), rel = relative(root, file);
        if (rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep)) return new Response('', { status: 403 });
        if (!['renderer/', 'dist/', 'assets/', 'vendor/'].some(prefix => rel.split(sep).join('/').startsWith(prefix))) return new Response('', { status: 403 });
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream' };
        return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('', { status: 404 }); }
    });
    provider = argument('provider') ?? 'codex';
    if (!['dots', 'codex'].includes(provider) || (provider === 'dots' && !legacyDotsAvailable)) provider = 'codex';
    backend = await makeBackend(provider);
    console.info('[companion:startup]', 'backend');
    const { WorkspaceStore } = await import(pathToFileURL(join(root, 'backend/workspace-store.mjs')).href);
    const { ResidentSpeech } = await import(pathToFileURL(join(root, 'backend/resident-speech.mjs')).href);
    store = new WorkspaceStore(storageDir); await store.load();
    const { VoiceResources, MODEL_FOLDERS } = await import(pathToFileURL(join(root, 'backend/voice-resources.mjs')).href);
    voiceResources = new VoiceResources(join(storageDir, 'voice-resources'), JSON.parse(await readFile(join(root, 'voice-resources.json'), 'utf8')), { fetch: (url, options) => net.fetch(url, options) });
    voiceResources.on('state', notifyWorkspace);
    const bundledQwen = join(root, 'runtime/qwen'), localQwen = resolve(root, '../qwen-tts-evaluation');
    const qwenRoot = argument('qwen-root') ?? (require('node:fs').existsSync(bundledQwen) ? bundledQwen : !packaged && require('node:fs').existsSync(localQwen) ? localQwen : voiceResources.directory('qwen'));
    const models = channel => {
      const id = channel === 'asr' ? 'asr' : 'kokoro', bundled = join(root, 'models');
      return require('node:fs').existsSync(join(bundled, MODEL_FOLDERS[id], 'model.int8.onnx')) ? bundled : voiceResources.directory(id);
    };
    speech = new ResidentSpeech(models, { executable: join(root, 'runtime/node.exe'), qwenRoot });
    speech.on('state', notifyWorkspace);
    console.info('[companion:startup]', 'services');
    const area = screen.getPrimaryDisplay().workArea;
    let savedAppearance;
    try { const saved = JSON.parse(await readFile(join(storageDir, 'appearance.json'), 'utf8')); if (saved.format === 1) savedAppearance = saved; } catch { /* Default placement on first use. */ }
    characterScale = normalizeAvatarScale(savedAppearance?.scale);
    if (Number.isFinite(savedAppearance?.bubblePosition?.x) && Number.isFinite(savedAppearance?.bubblePosition?.y)) bubblePosition = { x:savedAppearance.bubblePosition.x, y:savedAppearance.bubblePosition.y };
    const savedPosition = savedAppearance?.position;
    const displayArea = Number.isFinite(savedPosition?.x) && Number.isFinite(savedPosition?.y) ? screen.getDisplayNearestPoint(savedPosition).workArea : area;
    characterBox = avatarBounds(savedPosition, displayArea, characterScale);
    const common = { frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, show: false,
      webPreferences: { preload: join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, spellcheck: false } };
    avatar = new BrowserWindow({ ...common, ...(wallpaperMode ? screen.getPrimaryDisplay().bounds : characterBox),
      ...(wallpaperMode ? { transparent: false, backgroundColor: '#111821', alwaysOnTop: false, focusable: false } : {}),
      resizable: !wallpaperMode, ...(wallpaperMode ? { thickFrame: false } : {}), skipTaskbar: true, hasShadow: false, title: wallpaperMode ? 'Vibe Voice · 雨夜壁纸' : 'Vibe Voice · Live2D' });
    // Normalize the constructor's native frame rounding before the first draw.
    if (!wallpaperMode) avatar.setBounds(characterBox);
    avatar.on('will-resize', event => event.preventDefault());
    if (!wallpaperMode) avatar.webContents.on('context-menu', () => avatarMenu().popup({ window: avatar }));
    // Windows cannot reliably shrink a non-resizable transparent window (Electron #15560).
    // Keep native resizing enabled, and prevent user edge-resizing separately.
    chat = new BrowserWindow({ ...common, webPreferences: { ...common.webPreferences, autoplayPolicy: 'no-user-gesture-required' }, width: 440, height: 220, minWidth: 280, minHeight: 190, resizable: true, skipTaskbar: true, hasShadow: false, title: 'Vibe Voice · 对话气泡' });
    chat.on('will-resize', event => event.preventDefault());
    workbench = new BrowserWindow({ ...common, transparent: false, backgroundColor: '#f3f6f7', alwaysOnTop: false, width: Math.min(1120, area.width - 40), height: Math.min(760, area.height - 50), minWidth: 760, minHeight: 540, resizable: true, skipTaskbar: false, title: 'Vibe Voice · 工作台' });
    for (const win of [avatar, chat, workbench]) secureWindow(win);
    workbench.on('blur', finishKeyLearning);
    workbench.webContents.on('render-process-gone', finishKeyLearning);
    workbench.webContents.on('did-start-loading', finishKeyLearning);
    positionChat();
    avatar.on('move', positionChat);
    chat.on('show', notifyPresentation); chat.on('hide', notifyPresentation);
    chat.on('enter-full-screen', () => { readingMode = true; positionChat(); });
    chat.on('leave-full-screen', () => { readingMode = false; positionChat(); });
    bindBackend();
    console.info('[companion:startup]', 'windows');
    const handler = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, error: '不受信任的窗口。' };
      if (changingData && /^(companion:(send|new|provider|model)|speech:capture|workbench:(new|resume|remove|add|use-data))$/.test(channel)) return {ok:false,error:'正在选择数据目录，请稍候。'};
      try { return { ok: true, value: await fn(event, ...args) }; } catch (error) { return { ok: false, error: error.message }; }
    });
    handler('companion:snapshot', () => ({ ...backend.snapshot(), provider }));
    handler('workbench:use-data', async () => {
      if (backend.busy || captureTarget || voiceResources.active) throw new Error('请先完成当前任务、听写和资源下载，再切换数据目录。');
      changingData = true; registerShortcuts();
      try {
      const chosen = await dialog.showOpenDialog(workbench, { title:'选择已有 Vibe Voice 数据目录', properties:['openDirectory'] });
      if (chosen.canceled) return;
      const directory = chosen.filePaths[0];
      const state = JSON.parse(await readFile(join(directory,'workspaces.json'),'utf8'));
      if (state.format !== 1 || !Array.isArray(state.projects) || !state.settings) throw new Error('该目录不是有效的 Vibe Voice 数据目录。');
      if (resolve(directory) === storageDir) return;
      if (backend.busy || captureTarget || closing || changingProvider) throw new Error('应用状态已改变，数据目录未切换。');
      await mkdir(defaultStorage,{recursive:true});
      const pointer = join(defaultStorage,'data-location.json');
      await writeFile(pointer+'.tmp',JSON.stringify({format:1,directory})); await rename(pointer+'.tmp',pointer);
      app.relaunch({ args:[...process.argv.slice(1).filter(value=>!value.startsWith('--storage=')),`--storage=${directory}`] }); app.quit();
      } finally { changingData = false; if (!closing) registerShortcuts(); }
    });
    handler('companion:login', async () => {
      if (provider !== 'codex') throw new Error('请先切换到 Codex。');
      const url = await backend.startLogin();
      try { await shell.openExternal(url); } catch (error) { await backend.cancelLogin(); throw error; }
    });
    handler('companion:cancel-login', () => backend.cancelLogin());
    handler('companion:provider', (_event, kind) => changeProvider(kind));
    handler('companion:reconnect', () => { if (provider !== 'dots') throw new Error('请重启以恢复 Codex 连接。'); return backend.connect(); });
    handler('companion:open-dot', () => shell.openExternal('https://chatgpt.com/dots/home'));
    handler('companion:appearance', appearance);
    handler('companion:presentation', presentation);
    handler('companion:avatar-scale', (_event, scale) => { if (!Number.isFinite(scale)) throw new Error('角色大小无效。'); return resizeAvatar(scale); });
    handler('companion:avatar-reset', resetAvatar);
    handler('companion:open-link', async (_event, href) => {
      const url = new URL(href);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只能打开网页链接。');
      await shell.openExternal(url.href);
    });
    handler('companion:send', (_event, text) => { if (captureTarget) throw new Error('请先完成听写。'); stopSpeech(); return backend.send(text); });
    handler('companion:interrupt', () => backend.interrupt());
    handler('companion:new', () => { switchAllowed(); return backend.newConversation(); });
    handler('companion:model', (_event, model) => backend.chooseModel(model));
    handler('companion:respond', (_event, data) => backend.respond(data?.id, data?.answer));
    handler('companion:project', showWorkbench);
    handler('workbench:snapshot', workspaceSnapshot);
    handler('resources:download', (_event, id) => {
      if (changingData || closing) throw new Error('应用正在切换数据或退出，请稍后重试。');
      const download = voiceResources.start(id);
      download.then(async () => {
        if (closing) return;
        if (id === 'qwen') await store.updateSettings({ qwenRoot: voiceResources.directory('qwen') });
        if (store.data.settings.ttsEngine === id) speech.configure(store.data.settings);
        notifyWorkspace();
      }).catch(error => { console.error('[resources]', error.message); });
      return workspaceSnapshot();
    });
    handler('resources:cancel', () => { voiceResources.cancel(); return workspaceSnapshot(); });
    handler('workbench:add', async () => { const picked = await dialog.showOpenDialog(workbench, { title: '添加本地项目', defaultPath: backend.state.cwd, properties: ['openDirectory'] }); if (picked.canceled) return null; const result = await store.add(picked.filePaths[0]); notifyWorkspace(); return result; });
    handler('workbench:remove', async (_event, id) => { await store.remove(id, backend.state.cwd); notifyWorkspace(); });
    handler('workbench:list', (_event, id, cursor, search) => backend.listThreads(store.project(id).cwd, cursor, search));
    handler('workbench:history', (_event, id, cursor) => backend.history(id, cursor));
    handler('workbench:resume', async (_event, id, threadId) => { switchAllowed(); await backend.resumeConversation(threadId, store.project(id).cwd); showChat(); });
    handler('workbench:new', async (_event, id) => { switchAllowed(); await backend.newConversation(store.project(id).cwd); showChat(); });
    handler('workbench:rename', (_event, id, name) => backend.renameConversation(id, name));
    handler('workbench:effort', (_event, effort) => backend.chooseEffort(effort));
    handler('workbench:draft', (_event, target, text) => text === undefined ? store.draft(target) : store.saveDraft(target, text));
    handler('workbench:settings', async (_event, patch) => {
      if (!patch || typeof patch !== 'object') throw new Error('设置无效。');
      const previous = store.data.settings;
      if (patch.ttsResident === true && !speech.status().engines[patch.ttsEngine ?? previous.ttsEngine ?? 'qwen']) throw new Error('请先下载所选播报引擎的资源，再开启常驻。');
      await store.updateSettings(patch); registerShortcuts();
      const next = store.data.settings;
      if (!next.ttsResident || next.ttsEngine !== previous.ttsEngine || next.qwenRoot !== previous.qwenRoot) chat.webContents.send('speech:stop');
      else if ((previous.autoSpeak && !next.autoSpeak) || next.qwenVoice !== previous.qwenVoice || next.voice !== previous.voice || next.speed !== previous.speed) stopSpeech();
      if (patch.completionSound === false) chat.webContents.send('notification:sound', { action: 'stop' });
      if (['ttsResident','ttsEngine','qwenRoot'].some(key => key in patch)) speech.configure(next);
      notifyWorkspace(); return workspaceSnapshot();
    });
    handler('speech:choose-qwen', async () => {
      const result = await dialog.showOpenDialog(workbench, { title: '选择已有 Qwen 资源目录（包含 Python 和 models）', properties: ['openDirectory'] });
      if (result.canceled) return workspaceSnapshot();
      const { qwenAvailable } = await import(pathToFileURL(join(root, 'backend/qwen-speech.mjs')).href);
      if (!qwenAvailable(result.filePaths[0])) throw new Error('该目录缺少 Qwen 的 Python 环境或模型，请选择完整资源目录。');
      await store.updateSettings({ qwenRoot: result.filePaths[0] });
      chat.webContents.send('speech:stop'); speech.configure(store.data.settings); notifyWorkspace(); return workspaceSnapshot();
    });
    handler('workbench:learn-key', (event, learning) => {
      if (event.sender !== workbench.webContents || typeof learning !== 'boolean') throw new Error('请在工作台设置按键。');
      if (learning) { keyLearning = true; globalShortcut.unregisterAll(); }
      else finishKeyLearning();
    });
    handler('speech:capture', (event, target) => {
      if (event.sender !== chat.webContents) throw new Error('请从对话气泡开始听写。');
      if (target && !speech.status().asr) { showWorkbench('speech'); throw new Error('请先在工作台下载听写资源，完成后即可使用。'); }
      if (target) { if (captureTarget) throw new Error('听写正在进行。'); if (target.threadId !== backend.state.threadId || target.cwd !== backend.state.cwd) throw new Error('当前对话已切换，请重试。'); stopSpeech(); captureTarget = target; clearTimeout(captureTimer); captureTimer = setTimeout(() => { captureTarget = null; chat.webContents.send('speech:cancel'); }, 180000); }
      else { captureTarget = null; clearTimeout(captureTimer); }
    });
    handler('speech:transcribe', async (event, data) => { if (event.sender !== chat.webContents || !captureTarget) throw new Error('没有进行中的听写。'); try { return await speech.transcribe(data); } finally { captureTarget = null; clearTimeout(captureTimer); } });
    const { speechProfile } = await import(pathToFileURL(join(root,'backend/speech-plan.mjs')).href);
    handler('speech:synthesize', (_event, text, profile) => {
      const settings = {...store.data.settings};
      if (profile !== undefined && profile !== speechProfile(settings)) throw new Error('声音设置已改变，请重新朗读。');
      if (captureTarget) throw new Error('请先完成听写。');
      return speech.synthesize(text, settings);
    });
    handler('speech:stop', async (event, notify = true) => {
      // The chat already stopped its own playback. Echoing that stop can arrive
      // after it starts a new reply and accidentally cancel the new narration.
      if (notify !== false || event.sender !== chat.webContents) chat.webContents.send('speech:stop');
      await speech.stop();
    });
    handler('speech:preview', () => { if (speech.status().phase !== 'ready') throw new Error('请先开启常驻加载，等待语音模型就绪后试听。'); showChat(); chat.webContents.send('speech:reply', { text: '雨还在下。慢慢来，我们把眼前的事情一件一件做好。', preview: true }); });
    handler('notification:preview', () => { chat.webContents.send('notification:sound', { action: 'play' }); });
    handler('companion:window', (_event, action) => {
      if (action === 'toggle-chat') toggleChat();
      else if (action === 'recall-chat') recallChat();
      else if (action === 'show-chat') showChat();
      else if (action === 'workbench') showWorkbench();
      else if (action === 'speech-settings') showWorkbench('speech');
      else if (action === 'hide-workbench') workbench.hide();
      else if (action === 'hide-chat') hideChat();
      else if (action === 'toggle-reading') { readingMode = !readingMode; chat.setFullScreen(readingMode); positionChat(); }
      else if (action === 'leave-reading') { readingMode = false; chat.setFullScreen(false); positionChat(); }
      else if (action === 'align-chat') { bubblePosition = null; chatDragOrigin = null; positionChat(); scheduleAppearance(); }
      else if (action === 'quit') app.quit();
    });
    ipcMain.on('companion:hit', (event, hit) => { if (!wallpaperMode && trusted(event) && event.sender === avatar.webContents) avatar.setIgnoreMouseEvents(!hit, { forward: true }); });
    const avatarPointer = (event, point) => !wallpaperMode && trusted(event) && event.sender === avatar.webContents && Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.abs(point.x) < 1_000_000 && Math.abs(point.y) < 1_000_000;
    ipcMain.on('companion:drag-start', (event, point) => { if (avatarPointer(event, point)) dragOrigin = { pointer: point, bounds: { ...characterBox } }; });
    ipcMain.on('companion:drag-move', (event, point) => {
      if (!avatarPointer(event, point) || !dragOrigin) return;
      applyAvatarBounds({ x: dragOrigin.bounds.x + point.x - dragOrigin.pointer.x, y: dragOrigin.bounds.y + point.y - dragOrigin.pointer.y });
    });
    ipcMain.on('companion:drag-end', event => { if (trusted(event) && event.sender === avatar.webContents) { dragOrigin = null; scheduleAppearance(); } });
    const chatPointer = (event, point) => trusted(event) && event.sender === chat.webContents && !readingMode && Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.abs(point.x) < 1_000_000 && Math.abs(point.y) < 1_000_000;
    ipcMain.on('companion:chat-drag-start', (event, point) => { if (chatPointer(event, point) && currentChatLayout) chatDragOrigin = { pointer:point, position:{ x:currentChatLayout.x, y:currentChatLayout.y }, size:{ width:currentChatLayout.width, height:currentChatLayout.height } }; });
    ipcMain.on('companion:chat-drag-move', (event, point) => {
      if (!chatPointer(event, point) || !chatDragOrigin) return;
      const dx = point.x - chatDragOrigin.pointer.x, dy = point.y - chatDragOrigin.pointer.y;
      if (Math.hypot(dx, dy) < 3) return;
      bubblePosition = { x:chatDragOrigin.position.x + dx, y:chatDragOrigin.position.y + dy };
      positionChat();
    });
    ipcMain.on('companion:chat-drag-end', event => {
      if (!trusted(event) || event.sender !== chat.webContents) return;
      if (chatDragOrigin && bubblePosition && currentChatLayout) bubblePosition = { x:currentChatLayout.x, y:currentChatLayout.y };
      chatDragOrigin = null; positionChat(); scheduleAppearance();
    });
    ipcMain.on('companion:resize-bubble', (event, size) => {
      if (!trusted(event) || event.sender !== chat.webContents || !Number.isFinite(size?.height) || !Number.isFinite(size?.width)) return;
      if (readingMode) return;
      const content = chat.getContentBounds(), viewport = size.viewport;
      const scaleX = Number.isFinite(viewport?.width) && viewport.width > 0 ? content.width / viewport.width : 1;
      const scaleY = Number.isFinite(viewport?.height) && viewport.height > 0 ? content.height / viewport.height : 1;
      desiredBubble = { width: Math.max(280, Math.min(680, Math.round(size.width * scaleX))), height: Math.max(190, Math.min(1_000_000, Math.round(size.height * scaleY))) };
      positionChat();
    });
    ipcMain.on('companion:render-ready', (event, info) => {
      if (trusted(event) && event.sender === avatar.webContents && info?.ready === true) {
        avatar.setTitle(wallpaperMode ? 'Vibe Voice · 雨夜窗前' : 'Vibe Voice · Hiyori Live2D');
        console.info('[companion:render-ready]', JSON.stringify({ kind: info.kind, model: info.model,
          sourceWidth: info.sourceWidth, sourceHeight: info.sourceHeight,
          renderWidth: info.renderWidth, renderHeight: info.renderHeight }));
      }
    });
    ipcMain.on('companion:avatar-anchor', (event, anchor) => {
      if (!trusted(event) || event.sender !== avatar.webContents || !anchor) return;
      if (!['x', 'y', 'left', 'right'].every(key => Number.isFinite(anchor[key]) && anchor[key] >= 0 && anchor[key] <= 1)) return;
      if (anchor.left > anchor.x || anchor.x > anchor.right) return;
      avatarAnchor = anchor; positionChat();
    });
    await Promise.all([avatar.loadURL(`app://local/renderer/index.html?view=${wallpaperMode ? 'wallpaper' : 'avatar'}`), chat.loadURL('app://local/renderer/index.html?view=chat'), workbench.loadURL('app://local/renderer/workbench.html')]);
    console.info('[companion:startup]', 'loaded');
    if (wallpaperMode && argument('visual') !== 'hidden') {
      avatar.setIgnoreMouseEvents(true); avatar.setOpacity(0); avatar.showInactive();
      wallpaperHost = new WallpaperHost(avatar);
      wallpaperHost.on('status', value => { notifyPresentation(); if (!value.ok) console.error(value.error); });
      await wallpaperHost.start(); avatar.setOpacity(1); wallpaperHost.command('ensure');
      console.info('[companion:desktop]', JSON.stringify(presentation()));
      screen.on('display-metrics-changed', () => { wallpaperHost.command('ensure'); positionChat(); });
    } else if (argument('visual') !== 'hidden') avatar.showInactive(); // Isolated UI verification can omit the legacy character window.
    tray = new Tray(icon()); tray.setToolTip(`Vibe Voice · ${provider === 'dots' ? '凛（Dots）' : 'Codex'} 桌面伙伴`);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开对话  Ctrl+Alt+空格', click: showChat },
      { label: '项目与对话工作台', click: showWorkbench }, { label: '听写 / 完成听写', click: () => sendInputAction('record') },
      { label: '发送当前草稿', click: () => sendInputAction('send') }, { label: '朗读此条', click: () => sendInputAction('readReply') }, { label: '停止播报', click: stopSpeech },
      ...(wallpaperMode ? [{ label: '暂停壁纸动画', type: 'checkbox', checked: manualPause, click: item => { manualPause = item.checked; notifyPresentation(); } }, ...(!packaged ? [{ label: '切换为悬浮角色', click: () => switchMode('avatar') }] : [])]
        : [{ label: '显示 / 隐藏角色', click: () => avatar.isVisible() ? avatar.hide() : avatar.showInactive() }, { label: '恢复默认位置与大小', click: resetAvatar }, { label: '切换为雨夜壁纸', click: () => switchMode('wallpaper') }]),
      { type: 'separator' }, { label: '退出桌面伙伴', click: () => app.quit() }]));
    tray.on('click', toggleChat);
    registerShortcuts(); speech.configure(store.data.settings); notifyWorkspace();
    await backend.connect();
    if (argument('show') === 'workbench') showWorkbench();
  }).catch(error => { console.error('[companion:startup]', error.stack); dialog.showErrorBox('桌面伙伴未能启动', error.message); closing = true; app.exit(1); });
  app.on('before-quit', event => {
    if (closing) return; event.preventDefault(); closing = true;
    globalShortcut.unregisterAll(); tray?.destroy(); clearTimeout(captureTimer);
    Promise.allSettled([voiceResources?.close(), speech?.close(), wallpaperHost?.close(), backend?.close(), store?.queue, characterBox ? saveAppearance() : Promise.resolve()]).finally(() => app.exit(0));
  });
  app.on('window-all-closed', () => { if (closing) app.quit(); });
}
