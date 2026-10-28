const { app, BrowserWindow, ipcMain, protocol, screen, Tray, Menu, nativeImage, dialog, globalShortcut, shell, net, session, powerMonitor } = require('electron');
const { isCliAgent, agentName } = require('./backend/agent-catalog.cjs');
const { join, resolve, relative, extname, sep } = require('node:path');
const { readFile, writeFile, mkdir, rename } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { bubbleLayout } = require('./backend/bubble-layout.cjs');
const { avatarScale: normalizeAvatarScale, avatarBounds } = require('./backend/avatar-window.cjs');
const { WallpaperHost } = require('./backend/wallpaper-host.cjs');
const { registerInputActions } = require('./backend/input-actions.cjs');
const { RemoteInput, RESERVED_KEYS } = require('./backend/remote-input.cjs');
const { characterProfile, isCharacter } = require('./backend/character-profiles.cjs');
const { wallpaperChoice, isWallpaperKind } = require('./backend/wallpaper-choice.cjs');
const { stillSettings } = require('./backend/still-settings.cjs');
const { acceptWallpaperReport } = require('./backend/wallpaper-report.cjs');
const { AmbientBarrier } = require('./backend/ambient-barrier.cjs');
const { dataHome, storageLocation } = require('./backend/storage-location.cjs');

const root = __dirname;
const packaged = require('node:fs').existsSync(join(root, 'portable.json'));
const legacyDotsAvailable = !packaged && require('node:fs').existsSync(join(root, '../dots-bridge/src/client.mjs')) && require('node:fs').existsSync(join(root, 'backend/dots.mjs'));
const projectRoot = packaged ? app.getPath('documents') : resolve(root, '../..');
const argument = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const wallpaperMode = packaged || (argument('mode') ?? 'wallpaper') === 'wallpaper';
let portable, startupStorageError, defaultStorage, storageDir;
try {
  if (packaged) portable = JSON.parse(require('node:fs').readFileSync(join(root, 'portable.json'), 'utf8'));
  defaultStorage = dataHome(process.env.LOCALAPPDATA || app.getPath('userData'), portable);
  storageDir = storageLocation({ defaultStorage, sourceStorage: join(projectRoot, 'work/runtime/avatar'), packaged, override: argument('storage') });
} catch (error) {
  startupStorageError = error;
  storageDir = join(app.getPath('temp'), 'rin-startup-error');
}
app.setPath('userData', join(storageDir, 'profile'));
const debugPort = argument('debug-port');
if (debugPort && /^\d{4,5}$/.test(debugPort)) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let avatar, chat, workbench, backend, tray, store, submissions, speech, voiceResources, remote, captureTarget, captureTimer, closing = false;
let quitting = false, draftFlushRequest, draftFlushSerial = 0, pendingRelaunch = null, pendingDataSelection = null;
let shortcutErrors = [], rememberedTarget = '', keyLearning = false, shortcutResumeAt = 0, workspaceVersion = 0;
let provider = 'codex', changingProvider = false, providerChange = null, changingData = false;
let desiredBubble = { width: 440, height: 220 }, previousState, readingMode = false, avatarAnchor = null;
let characterScale = 1, characterBox, dragOrigin, appearanceTimer, appearanceQueue = Promise.resolve();
let bubblePosition = null, chatDragOrigin, currentChatLayout;
let wallpaperHost, manualPause = false, pendingMode = null, lastPresentation = '', trayMenu;
let wallpaperStatus = { phase: 'loading', requestId: 0 }, appliedWallpaperRequest = -1, wallpaperCommit;
let suspended = false, screenLocked = false, speaking = false, playbackRevision = 0, ambientRevision = 0, ambientRetry = 0;
let ambienceStatus = { phase: 'off', error: '' };
const ambientBarrier = new AmbientBarrier({ publish(revision) { ambientRevision = revision; notifyPresentation(); } });
const applyAmbientBeforeAudio = () => ambientBarrier.wait(wallpaperMode && !!avatar && !avatar.isDestroyed());
const remoteInput = new RemoteInput({onError:error=>remote?.disconnect().then(()=>remote.update({notice:error.message})).catch(()=>{})});
const isLocal = url => { try { const u = new URL(url); return u.protocol === 'app:' && u.hostname === 'local' && ['/renderer/index.html', '/renderer/workbench.html'].includes(u.pathname); } catch { return false; } };
const trusted = event => [avatar, chat, workbench].some(win => win && !win.isDestroyed() && win.webContents === event.sender) && isLocal(event.senderFrame?.url ?? '');
const appearance = () => ({ scale: characterScale, mode: wallpaperMode ? 'wallpaper' : 'avatar' });
const presentation = () => ({ mode: wallpaperMode ? 'wallpaper' : 'avatar', wallpaperKind: wallpaperStatus.wallpaperKind || 'artwork', character: wallpaperStatus.character ?? characterProfile(store?.data.settings.character).id, characterRequest: wallpaperStatus.requestId, chatVisible: !!chat?.isVisible(), paused: manualPause || suspended || screenLocked || !!wallpaperHost?.status.occluded, manualPause, stills: stillSettings(store?.data.settings), capturing: !!captureTarget, speaking, ambientRevision, ambientRetry, desktopAttached: !!wallpaperHost?.status.ok, desktopLayer: wallpaperHost?.status.parentClass ?? null, desktopBounds: wallpaperHost?.status.bounds ?? null });
function notifyPresentation() {
  if (!avatar || avatar.isDestroyed() || avatar.webContents.isCrashed()) return;
  const value = presentation(), encoded = JSON.stringify(value);
  if (encoded !== lastPresentation) { lastPresentation = encoded; avatar.webContents.send('companion:presentation', value); }
}
function switchMode(mode) {
  if (quitting || closing) return;
  if (packaged) return showChat();
  if (mode === (wallpaperMode ? 'wallpaper' : 'avatar')) return showChat();
  if (backend?.busy) { pendingMode = mode; return showChat(); }
  pendingRelaunch = { args: [...process.argv.slice(1).filter(arg => !arg.startsWith('--mode=') && !arg.startsWith('--provider=')), `--mode=${mode}`, `--provider=${provider}`] }; app.quit();
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
function workspaceSnapshot() { return { ...store.snapshot(), version: workspaceVersion, speech: speech.status(), remote: remote?.snapshot(), wallpaper: wallpaperStatus, ambience: ambienceStatus, wallpaperPaused: manualPause, resources: voiceResources?.snapshot(), shortcutErrors, legacyDotsAvailable }; }
function notifyWorkspace() { workspaceVersion++; notifyPresentation(); for (const win of [chat, workbench]) if (win && !win.isDestroyed()) win.webContents.send('workbench:state', workspaceSnapshot()); }
function stopSpeech() { playbackRevision++; speaking = false; notifyPresentation(); chat?.webContents.send('speech:stop'); return speech?.stop().catch(error => console.error('[speech:stop]', error.message)); }
async function confirmWallpaper(info) {
  const requested = wallpaperStatus;
  const rendererKind = info?.wallpaperKind || 'artwork';
  const matches = info?.character === requested.character && info.requestId === requested.requestId && rendererKind === (requested.wallpaperKind || 'artwork');
  if (info?.error) {
    if (!matches) return false;
    cancelWallpaperCommit();
    wallpaperStatus = { ...requested, phase: 'error', errorFrameRevision: info.frameRevision,
      error: info.model === 'motion-clips' ? '动态壁纸未能继续播放，已保留当前画面和声线。请重试加载或切回静态壁纸。' : '人物壁纸未能载入，已保留原人物和声线设置。' };
    notifyWorkspace(); return false;
  }
  if (info?.ready !== true || !isWallpaperKind(rendererKind) || !isCharacter(info.character) || !Number.isSafeInteger(info.requestId)) return false;
  if (wallpaperCommit) {
    if (wallpaperCommit.requestId === info.requestId) return wallpaperCommit.character === info.character ? wallpaperCommit.promise : false;
    const pending = wallpaperCommit.promise; cancelWallpaperCommit(); await pending;
    return confirmWallpaper(info);
  }
  if (info.requestId <= appliedWallpaperRequest) return info.requestId === appliedWallpaperRequest && info.character === store.data.settings.character;
  if (!matches || requested.phase === 'error') return false;
  // Stage bytes under the store queue, but do not publish settings yet. The
  // renderer rechecks pause/latest intent before the synchronous final rename.
  const commit = { requestId: info.requestId, character: info.character, requested, cancelled: false }; wallpaperCommit = commit;
  commit.promise = (async () => {
    try {
      if (info.character !== store.data.settings.character || rendererKind !== store.data.settings.wallpaperKind) {
        commit.prepared = await store.prepareSettings({ character: info.character, wallpaperKind: rendererKind });
      }
      if (commit.cancelled || wallpaperStatus !== requested) { commit.cancelled = true; commit.prepared?.cancel(); return false; }
      commit.ready = true;
      commit.timer = setTimeout(() => {
        if (wallpaperCommit !== commit) return;
        cancelWallpaperCommit();
        if (wallpaperStatus === requested) wallpaperStatus = { ...requested, phase: 'error', error: '人物切换未能及时完成，已保留原画面和声线。请重试。' };
        notifyWorkspace();
      }, 5000);
      return true;
    } catch (error) {
      if (wallpaperStatus === requested) wallpaperStatus = { ...requested, phase: 'error', error: '人物设置未能保存，已保留原画面和声线。请重试。' };
      console.error('[wallpaper:settings]', error.message);
      commit.cancelled = true;
      return false;
    } finally {
      if (commit.cancelled && wallpaperCommit === commit) wallpaperCommit = null;
      notifyWorkspace();
    }
  })();
  return commit.promise;
}
function cancelWallpaperCommit() {
  const commit = wallpaperCommit;
  if (!commit) return;
  commit.cancelled = true; clearTimeout(commit.timer); commit.prepared?.cancel(); wallpaperCommit = null;
}
function finishWallpaper(info, accept) {
  const commit = wallpaperCommit;
  if (!commit) return accept === true && info?.requestId === appliedWallpaperRequest && info?.character === store.data.settings.character;
  if (info?.requestId !== commit.requestId || info?.character !== commit.character) return false;
  try {
    if (accept !== true || !commit.ready || commit.cancelled || wallpaperStatus !== commit.requested || (presentation().paused && info.initial !== true)) { cancelWallpaperCommit(); return false; }
    if (commit.prepared) stopSpeech();
    commit.prepared?.commit();
    appliedWallpaperRequest = info.requestId;
    wallpaperStatus = { ...commit.requested, phase: 'ready' };
    return true;
  } catch (error) {
    cancelWallpaperCommit();
    wallpaperStatus = { ...commit.requested, phase: 'error', error: '人物设置未能保存，已保留原画面和声线。请重试。' };
    console.error('[wallpaper:settings]', error.message); return false;
  } finally {
    clearTimeout(commit.timer); if (wallpaperCommit === commit) wallpaperCommit = null;
    // A notification failure after rename must not tell the renderer to keep
    // the old canvas: the durable character and voices have already changed.
    try { notifyWorkspace(); } catch (error) { console.error('[wallpaper:notify]', error.message); }
  }
}
function recoverWallpaperRenderer() {
  if (!wallpaperMode || !ambientBarrier.stopped || !avatar || avatar.isDestroyed()) return;
  if (wallpaperStatus.phase === 'error') wallpaperStatus = { phase: 'loading', character: wallpaperStatus.character,
    wallpaperKind: wallpaperStatus.wallpaperKind || 'artwork', requestId: wallpaperStatus.requestId + 1 };
  lastPresentation = '';
  avatar.webContents.reload();
}
function switchAllowed() { if (captureTarget) throw new Error('请先完成或取消听写，再切换对话。'); if (!isCliAgent(provider)) throw new Error('请先选择 CLI Agent。'); stopSpeech(); }
function sendInputAction(action) {
  if (changingData || quitting || closing) return;
  if (action === 'record') showChat();
  if (['record', 'send', 'readReply', 'clearDraft', 'undoDraft', 'volumeUp', 'volumeDown'].includes(action)) chat?.webContents.send('companion:input-action', action);
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
  }, { suspended: argument('shortcut') === 'off' || keyLearning || changingData, resumeAt: shortcutResumeAt, reserved:remoteInput.enabled?RESERVED_KEYS:new Set() });
}
async function makeBackend(kind) {
  if (kind === 'dots') {
    if (!legacyDotsAvailable) throw new Error('Rin Desktop 公开版使用 Codex CLI，不包含私人 Dots 实验通道。');
    const { DotsCompanion } = await import(pathToFileURL(join(root, 'backend/dots.mjs')).href);
    return new DotsCompanion({ storageDir });
  }
  if (kind === 'claude') {
    const { ClaudeCompanion } = await import(pathToFileURL(join(root, 'backend/claude-agent.mjs')).href);
    return new ClaudeCompanion({ projectRoot: argument('project') ?? projectRoot, storageDir });
  }
  if (kind === 'grok' || kind === 'opencode') {
    const { AcpCompanion } = await import(pathToFileURL(join(root, 'backend/acp-agent.mjs')).href);
    return new AcpCompanion({ provider: kind, projectRoot: argument('project') ?? projectRoot, storageDir });
  }
  const { CodexCompanion } = await import(pathToFileURL(join(root, 'backend/codex.mjs')).href);
  return new CodexCompanion({ projectRoot: argument('project') ?? projectRoot, storageDir });
}
function bindBackend() {
  submissions?.bind(backend, provider);
  backend.on('state', state => {
    if (state.connection !== previousState?.connection || state.status !== previousState?.status) {
      console.info('[companion:connection]', JSON.stringify({ provider, connection: state.connection, status: state.status }));
    }
    for (const win of [avatar, chat, workbench]) if (win && !win.isDestroyed()) win.webContents.send('companion:state', { ...state, provider, submission: submissions?.snapshot(provider) });
    const target = `${provider}|${state.cwd}|${state.threadId}`;
    if (store && isCliAgent(provider) && state.connection === 'ready' && state.status !== 'configuring' && target !== rememberedTarget) { rememberedTarget = target; store.remember({ ...state, provider }).then(notifyWorkspace).catch(error => console.error(error.message)); }
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
async function changeProvider(next, { reconnect = false } = {}) {
  if (closing || quitting) throw new Error('应用正在退出。');
  if (!backend || !store) throw new Error('应用正在启动，请稍候。');
  if (captureTarget) throw new Error('请先完成或取消听写。');
  stopSpeech();
  if (!isCliAgent(next) && next !== 'dots') throw new Error('请选择支持的 Agent。');
  if (changingProvider) throw new Error('正在切换对话来源。');
  if (next === provider && !reconnect) return;
  if (backend.busy) throw new Error('请先等待或停止当前任务。');
  changingProvider = true;
  const switching = (async () => {
    let replacement;
    try {
      replacement = await makeBackend(next);
      if (closing) return;
      backend.removeAllListeners(); await backend.close();
      if (closing) return;
      backend = replacement; provider = next; previousState = null; rememberedTarget = null; bindBackend();
      for (const win of [avatar, chat, workbench]) if (win && !win.isDestroyed()) win.webContents.send('companion:state', { ...backend.snapshot(), provider });
      await mkdir(storageDir, { recursive: true });
      if (closing) return;
      await writeFile(join(storageDir, 'provider.json'), JSON.stringify({ provider }));
      if (closing) return;
      tray?.setToolTip(`Vibe Voice · ${agentName(provider)} 桌面伙伴`);
      await replacement.connect();
    } finally {
      // Quit owns the published backend. A replacement still being constructed
      // belongs to this operation, and must be released before quit completes.
      if (replacement && replacement !== backend) await replacement.close();
    }
  })();
  providerChange = switching;
  try { await switching; }
  finally { changingProvider = false; if (providerChange === switching) providerChange = null; }
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
    const ready = isCliAgent(requestedProvider) || requestedProvider === 'dots' ? changeProvider(requestedProvider) : Promise.resolve();
    ready.then(() => { if (['avatar', 'wallpaper'].includes(mode)) switchMode(mode); else showChat(); })
      .catch(error => { showChat(); dialog.showErrorBox('对话来源尚未切换', error.message); });
  });
  app.whenReady().then(async () => {
    if (startupStorageError) throw startupStorageError;
    console.info('[companion:startup]', 'ready');
    if (argument('wallpaper') && argument('wallpaper') !== 'artwork') throw new Error('视频壁纸路线已停用，请使用原画壁纸入口。');
    const { createMotionMedia } = await import(pathToFileURL(join(root, 'backend/motion-media.mjs')).href);
    const motionMedia = await createMotionMedia(join(root, 'assets/motion/female'));
    protocol.handle('app', async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'local' || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
        const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (name.startsWith('assets/motion/')) return motionMedia.respond(request);
        if (!['renderer/', 'dist/', 'assets/', 'vendor/'].some(prefix => name.startsWith(prefix))) return new Response('', { status: 403 });
        const file = resolve(root, name), rel = relative(root, file);
        if (rel.startsWith('..' + sep) || rel === '..' || rel.startsWith(sep)) return new Response('', { status: 403 });
        if (!['renderer/', 'dist/', 'assets/', 'vendor/'].some(prefix => rel.split(sep).join('/').startsWith(prefix))) return new Response('', { status: 403 });
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.moc3': 'application/octet-stream' };
        return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers: { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('', { status: 404 }); }
    });
    let savedProvider;
    try { savedProvider = JSON.parse(await readFile(join(storageDir, 'provider.json'), 'utf8')).provider; } catch {}
    provider = argument('provider') ?? savedProvider ?? 'codex';
    if ((!isCliAgent(provider) && provider !== 'dots') || (provider === 'dots' && !legacyDotsAvailable)) provider = 'codex';
    backend = await makeBackend(provider);
    console.info('[companion:startup]', 'backend');
    const { WorkspaceStore } = await import(pathToFileURL(join(root, 'backend/workspace-store.mjs')).href);
    const { ResidentSpeech } = await import(pathToFileURL(join(root, 'backend/resident-speech.mjs')).href);
    store = new WorkspaceStore(storageDir); await store.load();
    const { SubmissionGuard } = await import(pathToFileURL(join(root, 'backend/submission-guard.mjs')).href);
    submissions = new SubmissionGuard(store);
    submissions.on('state', value => { if (value.provider === provider && !closing) backend?.changed(); });
    wallpaperStatus.character = store.data.settings.character;
    wallpaperStatus.wallpaperKind = store.data.settings.wallpaperKind || 'artwork';
    const { VoiceResources, MODEL_FOLDERS } = await import(pathToFileURL(join(root, 'backend/voice-resources.mjs')).href);
    const { upstreamProxyEnvironment } = await import(pathToFileURL(join(root, 'backend/voice-runtime.mjs')).href);
    const { activateVoiceResource } = await import(pathToFileURL(join(root, 'backend/voice-activation.mjs')).href);
    voiceResources = new VoiceResources(join(storageDir, 'voice-resources'), JSON.parse(await readFile(join(root, 'voice-resources.json'), 'utf8')), {
      fetch: (url, options) => net.fetch(url, options),
      runtimeEnvironment: () => upstreamProxyEnvironment(url => session.defaultSession.resolveProxy(url)),
      activate: (id, signal) => activateVoiceResource(id, signal, {
        speech, store, stopSpeech, isClosing: () => closing,
        qwenDirectory: () => voiceResources.directory('qwen'), notifyWorkspace
      })
    });
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
    avatar = new BrowserWindow({ ...common, webPreferences: { ...common.webPreferences, autoplayPolicy: 'no-user-gesture-required' }, ...(wallpaperMode ? screen.getPrimaryDisplay().bounds : characterBox),
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
    const { RemoteController } = await import(pathToFileURL(join(root,'backend/remote-controller.mjs')).href);
    const { NativeRemote } = await import(pathToFileURL(join(root,'backend/remote-native.mjs')).href);
    remote = new RemoteController({
      settings:store.data.settings.rc003,
      prepareKeys:()=>remoteInput.start(),
      createTransport:() => new NativeRemote({root,storageDir,packaged}),
      save:async rc003 => { await store.updateSettings({rc003}); notifyWorkspace(); },
      begin:async id => {
        if(closing || quitting || changingData || changingProvider || suspended || screenLocked || backend.lifecycle?.active || backend.busy && !backend.state.threadId || ['connecting','starting','configuring'].includes(backend.state.status) || submissions.active.has(provider)) throw new Error('应用正在切换、暂停或启动，请稍后再按住语音键。');
        if(captureTarget)throw new Error('已有听写正在进行，请先结束或取消。');
        if(voiceResources.active)throw new Error('语音模型正在准备，请完成或取消准备后再按住语音键。');
        if(!speech.status().asr) { showWorkbench('speech'); throw new Error('首次使用请在语音模型中下载听写资源，然后按住遥控器语音键。'); }
        const target={provider,cwd:backend.state.cwd,threadId:backend.state.threadId};
        const owned = captureTarget = {...target,origin:'rc003',id}; stopSpeech(); showChat();
        try { await applyAmbientBeforeAudio(); return target; }
        catch(error) { if(captureTarget === owned) captureTarget = null; notifyPresentation(); throw error; }
      },
      transcribe:data => speech.transcribe(data),
      deliver:async (target,text,id) => {
        await store.appendDictation(target,text,id);
        if(!chat.isDestroyed()) chat.webContents.send('remote:text',{target,text,id});
      },
      end:id => { if(captureTarget?.origin==='rc003' && captureTarget.id===id) { captureTarget=null; notifyPresentation(); } },
      action:async action => {
        if(changingData || changingProvider || closing || quitting || keyLearning) return;
        if(action==='chat')return recallChat();
        if(action==='workbench')return showWorkbench();
        if(action==='remoteSettings')return showWorkbench('remote');
        if(action==='back'){workbench.hide();return showChat();}
        if(action==='stopSpeech')return stopSpeech();
        if(action==='interrupt'){if(backend.busy)await backend.interrupt();return;}
        if(['send','readReply','clearDraft','undoDraft'].includes(action)){showChat({focus:false});return sendInputAction(action);}
        if(['volumeUp','volumeDown'].includes(action))return sendInputAction(action);
        const destination=workbench.isFocused()?workbench:chat;
        if(destination===chat && !chat.isFocused()){showChat();return;}
        destination.webContents.send('remote:action',action);
      }
    });
    remoteInput.attach(chat);
    remote.on('devices',devices=>remoteInput.setDevices(devices));
    remote.on('diagnostic',value=>console.info('[companion:remote]',JSON.stringify(value)));
    let remoteShortcuts=false,remoteDiagnostic='';
    remote.on('state',value=>{
      const diagnostic=JSON.stringify({phase:value.phase,keysAvailable:value.keysAvailable,notice:value.notice});
      if(diagnostic!==remoteDiagnostic){remoteDiagnostic=diagnostic;console.info('[companion:remote]',diagnostic);}
      if(['disconnected','disconnecting','error'].includes(value.phase))remoteInput.stop();
      if(remoteShortcuts!==remoteInput.enabled){remoteShortcuts=remoteInput.enabled;registerShortcuts();notifyWorkspace();}
      for(const win of [chat,workbench])if(!win.isDestroyed())win.webContents.send('remote:state',value);
    });
    powerMonitor.on('suspend',()=>{ suspended=true; notifyPresentation(); stopSpeech(); remote.suspend(); chat.webContents.send('speech:cancel'); });
    powerMonitor.on('resume',()=>{ suspended=false; notifyPresentation(); remote.resume(); });
    powerMonitor.on('lock-screen',()=>{ screenLocked=true; notifyPresentation(); stopSpeech(); remote.cancel(); chat.webContents.send('speech:cancel'); });
    powerMonitor.on('unlock-screen',()=>{ screenLocked=false; notifyPresentation(); });
    chat.webContents.on('render-process-gone',()=>{ playbackRevision++; speaking=false; if(captureTarget?.origin!=='rc003')captureTarget=null; clearTimeout(captureTimer); notifyPresentation(); });
    avatar.webContents.on('did-start-loading',()=>ambientBarrier.startOwner());
    avatar.webContents.on('render-process-gone',()=>{
      cancelWallpaperCommit();
      ambientBarrier.stopOwner();
      ambienceStatus={phase:'error',error:'壁纸窗口已停止，环境音已静音；听写与朗读仍可使用。请重试恢复壁纸。'};
      wallpaperStatus={...wallpaperStatus,phase:'error',error:'壁纸窗口已停止，请重试加载。'};
      notifyWorkspace();
    });
    console.info('[companion:startup]', 'windows');
    const handler = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, error: '不受信任的窗口。' };
      if (closing) return { ok: false, error: '应用正在退出。' };
      if (quitting && channel !== 'workbench:draft' && channel !== 'speech:stop' && !(channel === 'speech:capture' && args[0] === null) && !(channel === 'speech:playback' && args[0] === false)) return { ok: false, error: '正在保存草稿并退出，请稍候。' };
      if (submissions.active.has(provider) && /^(companion:(send|new|provider|reconnect|model)|workbench:(new|resume|effort|use-data))$/.test(channel)) return { ok: false, error: '正在保存发送记录，请稍候。' };
      if (changingProvider && /^(companion:(send|new|provider|reconnect|login|model|respond|submission)|workbench:(list|history|resume|new|rename|effort))$/.test(channel)) return { ok: false, error: '正在连接 Agent，请稍候。' };
      if (changingData && /^(companion:(send|new|provider|model)|speech:capture|workbench:(new|resume|remove|add|use-data))$/.test(channel)) return {ok:false,error:'正在选择数据目录，请稍候。'};
      try { return { ok: true, value: await fn(event, ...args) }; } catch (error) { return { ok: false, error: error.message }; }
    });
    handler('companion:snapshot', () => ({ ...backend.snapshot(), provider, submission: submissions.snapshot(provider) }));
    handler('workbench:use-data', async () => {
      if (backend.busy || captureTarget || voiceResources.active) throw new Error('请先完成当前任务、听写和资源下载，再切换数据目录。');
      changingData = true; registerShortcuts();
      try {
      const chosen = await dialog.showOpenDialog(workbench, { title: portable?.testBuild ? '选择测试用数据副本（请先备份原目录）' : '选择已有 Vibe Voice 数据目录', properties:['openDirectory'] });
      if (chosen.canceled) return;
      const { validateDataDirectory, selectDataDirectory } = await import(pathToFileURL(join(root,'backend/data-directory.mjs')).href);
      const directory = await validateDataDirectory(chosen.filePaths[0]);
      if (resolve(directory) === storageDir) return;
      if (backend.busy || captureTarget || closing || changingProvider) throw new Error('应用状态已改变，数据目录未切换。');
      const pointer = join(defaultStorage,'data-location.json');
      await store.queue;
      pendingDataSelection = () => selectDataDirectory(directory, pointer);
      pendingRelaunch = { args:[...process.argv.slice(1).filter(value=>!value.startsWith('--storage=')),`--storage=${directory}`] }; app.quit();
      } finally { changingData = false; if (!closing) registerShortcuts(); }
    });
    handler('companion:login', async () => {
      if (provider !== 'codex') throw new Error('请先切换到 Codex。');
      const url = await backend.startLogin();
      try { await shell.openExternal(url); } catch (error) { await backend.cancelLogin(); throw error; }
    });
    handler('companion:cancel-login', () => backend.cancelLogin());
    handler('companion:provider', (_event, kind) => changeProvider(kind));
    handler('companion:reconnect', () => changeProvider(provider, { reconnect: true }));
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
    handler('companion:send', (_event, text, expected) => { if (captureTarget) throw new Error('请先完成听写。'); stopSpeech(); return isCliAgent(provider) ? submissions.send(backend, provider, text, expected) : backend.send(text); });
    handler('companion:submission', (_event, action, id) => {
      if (!isCliAgent(provider)) throw new Error('请先选择 CLI Agent。');
      if (action === 'check') return submissions.reconcile(backend, provider, id);
      if (action === 'release') return submissions.release(backend, provider, id);
      throw new Error('发送核查操作无效。');
    });
    handler('companion:interrupt', () => backend.interrupt());
    handler('companion:new', () => { switchAllowed(); return backend.newConversation(); });
    handler('companion:model', (_event, model) => backend.chooseModel(model));
    handler('companion:respond', (_event, data) => backend.respond(data?.id, data?.answer));
    handler('companion:project', showWorkbench);
    handler('workbench:snapshot', workspaceSnapshot);
    handler('remote:command', (event, command, value) => {
      if(command==='snapshot')return remote.snapshot();
      if(command==='cancel')return remote.cancel('本次遥控器听写已取消。');
      if(event.sender!==workbench.webContents || changingData || closing)throw new Error('请在工作台的遥控器页面操作。');
      if(command==='scan')return remote.scan();
      if(command==='connect')return remote.connect(value);
      if(command==='disconnect')return remote.disconnect();
      if(command==='forget')return remote.disconnect({forget:true});
      if(command==='settings' && value && typeof value==='object')return remote.configure(value);
      throw new Error('遥控器操作无效。');
    });
    handler('resources:download', (_event, id) => {
      if (changingData || closing) throw new Error('应用正在切换数据或退出，请稍后重试。');
      if (captureTarget) throw new Error('请先结束当前听写。');
      const status = speech.status();
      const download = voiceResources.start(id, { existing: id === 'asr' ? status.asr : !!status.engines[id] });
      download.catch(error => { console.error('[resources]', error.message); });
      return workspaceSnapshot();
    });
    handler('resources:unload', async (_event, id) => {
      voiceResources.pack(id);
      if (changingData || closing || voiceResources.active || captureTarget) throw new Error('请先完成当前语音操作。');
      if (id === 'asr') speech.unloadAsr();
      else if (store.data.settings.ttsEngine === id) {
        stopSpeech(); await store.updateSettings({ ttsResident: false }); await speech.configure(store.data.settings);
      }
      notifyWorkspace(); return workspaceSnapshot();
    });
    handler('resources:cancel', () => { voiceResources.cancel(); return workspaceSnapshot(); });
    handler('workbench:add', async () => { const picked = await dialog.showOpenDialog(workbench, { title: '添加本地项目', defaultPath: backend.state.cwd, properties: ['openDirectory'] }); if (picked.canceled) return null; const result = await store.add(picked.filePaths[0]); notifyWorkspace(); return result; });
    handler('workbench:remove', async (_event, id) => { await store.remove(id, backend.state.cwd); notifyWorkspace(); });
    const requireProvider = expected => { if (expected !== undefined && expected !== provider) throw new Error('Agent 已切换，请刷新列表。'); };
    handler('workbench:list', (_event, id, cursor, search, expected) => { requireProvider(expected); return backend.listThreads(store.project(id).cwd, cursor, search); });
    handler('workbench:history', (_event, id, cursor, expected) => { requireProvider(expected); return backend.history(id, cursor); });
    handler('workbench:resume', async (_event, id, threadId, expected) => { requireProvider(expected); switchAllowed(); await backend.resumeConversation(threadId, store.project(id).cwd); showChat(); });
    handler('workbench:new', async (_event, id, expected) => { requireProvider(expected); switchAllowed(); await backend.newConversation(store.project(id).cwd); showChat(); });
    handler('workbench:rename', (_event, id, name, expected) => { requireProvider(expected); return backend.renameConversation(id, name); });
    handler('workbench:effort', (_event, effort) => backend.chooseEffort(effort));
    handler('workbench:draft', (_event, target, text) => text === undefined ? store.draftSnapshot(target) : store.saveDraft(target, text));
    ipcMain.on('draft:flushed', (event, id, result) => {
      const pending = draftFlushRequest;
      if (!trusted(event) || event.sender !== chat?.webContents || pending?.sender !== event.sender || pending.id !== id) return;
      if (result?.ok === true) pending.confirm();
      else pending.finish(new Error(typeof result?.error === 'string' ? result.error.slice(0, 1000) : '聊天窗口未能确认草稿已保存。'));
    });
    handler('workbench:settings', async (_event, patch) => {
      if (!patch || typeof patch !== 'object') throw new Error('设置无效。');
      const choice = wallpaperMode ? wallpaperChoice(patch, store.data.settings) : null;
      if (choice) cancelWallpaperCommit();
      // Character selection is a load request; a decoded frame must commit its
      // settings before the renderer replaces the currently visible canvas.
      if (choice) { patch = { ...patch }; delete patch.character; delete patch.wallpaperKind; }
      const previous = store.data.settings;
      const changesEngine = ['ttsResident','ttsEngine','qwenRoot'].some(key => key in patch && patch[key] !== previous[key]);
      if (voiceResources.active && changesEngine) throw new Error('模型正在准备，请先取消下载或等待载入完成。');
      if (patch.ttsResident === true && !speech.status().engines[patch.ttsEngine ?? previous.ttsEngine ?? 'qwen']) throw new Error('请先下载所选播报引擎的资源，再开启常驻。');
      if (Object.keys(patch).length) await store.updateSettings(patch);
      registerShortcuts();
      const next = store.data.settings;
      if (!next.ttsResident || next.ttsEngine !== previous.ttsEngine || next.qwenRoot !== previous.qwenRoot) chat.webContents.send('speech:stop');
      else if ((previous.autoSpeak && !next.autoSpeak) || next.character !== previous.character || next.qwenVoice !== previous.qwenVoice || next.voice !== previous.voice || next.speed !== previous.speed) stopSpeech();
      if (patch.completionSound === false) chat.webContents.send('notification:sound', { action: 'stop' });
      if (!closing && !voiceResources.active && (changesEngine || patch.ttsResident === true && speech.phase === 'error')) speech.configure(next);
      if (choice) {
        wallpaperStatus = { phase: 'loading', ...choice, requestId: wallpaperStatus.requestId + 1 };
        recoverWallpaperRenderer();
        notifyPresentation();
      }
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
    handler('speech:capture', async (event, target) => {
      if (event.sender !== chat.webContents) throw new Error('请从对话气泡开始听写。');
      if (target && !speech.status().asr) { showWorkbench('speech'); throw new Error('请先在工作台下载听写资源，完成后即可使用。'); }
      if (target) {
        if (suspended || screenLocked) throw new Error('电脑已暂停，请解锁后重试。');
        if (captureTarget) throw new Error('听写正在进行。');
        if (backend.lifecycle?.active || backend.busy && !backend.state.threadId || ['connecting','starting','configuring'].includes(backend.state.status) || submissions.active.has(provider)) throw new Error('正在连接、切换对话或发送任务，请稍后再开始听写。');
        if (changingProvider || target.provider && target.provider !== provider || target.threadId !== backend.state.threadId || target.cwd !== backend.state.cwd) throw new Error('当前对话已切换，请重试。');
        stopSpeech(); captureTarget = target; clearTimeout(captureTimer);
        captureTimer = setTimeout(() => { captureTarget = null; notifyPresentation(); chat.webContents.send('speech:cancel'); }, 180000);
        try { await applyAmbientBeforeAudio(); }
        catch(error) { if(captureTarget === target) { captureTarget=null; clearTimeout(captureTimer); } notifyPresentation(); throw error; }
      } else if(captureTarget?.origin!=='rc003') { captureTarget = null; clearTimeout(captureTimer); notifyPresentation(); }
    });
    handler('speech:transcribe', async (event, data) => {
      if (event.sender !== chat.webContents || !captureTarget || captureTarget.origin === 'rc003') throw new Error('没有进行中的电脑听写。');
      const owned = captureTarget;
      try { return await speech.transcribe(data); }
      finally {
        // A cancelled request may finish after another recording has started.
        // Its cleanup owns neither the newer target nor the newer watchdog.
        if (captureTarget === owned) { captureTarget = null; clearTimeout(captureTimer); captureTimer = null; notifyPresentation(); }
      }
    });
    const { speechProfile } = await import(pathToFileURL(join(root,'backend/speech-plan.mjs')).href);
    handler('speech:playback', async (event, active) => {
      if (event.sender !== chat.webContents || typeof active !== 'boolean') throw new Error('播放状态无效。');
      if(active && (captureTarget || suspended || screenLocked)) throw new Error('请先结束听写或恢复电脑，再朗读。');
      const owned = ++playbackRevision; speaking=active;
      if(active) {
        try {
          await applyAmbientBeforeAudio();
          if (owned !== playbackRevision) throw new Error('本次朗读已取消。');
        } catch(error) { if (owned === playbackRevision) { speaking=false; notifyPresentation(); } throw error; }
      }
      else notifyPresentation();
    });
    handler('wallpaper:control', (_event, action, value) => {
      if(action==='retry-audio') { ambientRetry++; recoverWallpaperRenderer(); notifyWorkspace(); }
      else if(action==='pause' && typeof value==='boolean') { manualPause=value; const item=trayMenu?.getMenuItemById('pause-wallpaper'); if(item)item.checked=value; notifyWorkspace(); }
      else throw new Error('壁纸操作无效。');
      return workspaceSnapshot();
    });
    handler('wallpaper:commit', (event, info) => {
      if (!wallpaperMode || event.sender !== avatar.webContents) throw new Error('请从壁纸窗口提交人物画面。');
      return confirmWallpaper(info);
    });
    ipcMain.on('wallpaper:finish', (event, info, accept) => {
      if (!wallpaperMode || !trusted(event) || event.sender !== avatar.webContents) { event.returnValue = { ok: false, error: '请从壁纸窗口确认人物画面。' }; return; }
      // Only a prepared atomic rename occurs synchronously. Returning before
      // paint lets the renderer keep both canvas and saved voices on failure.
      event.returnValue = { ok: true, value: finishWallpaper(info, accept) };
    });
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
    handler('speech:volume', async (_event, value) => { await store.updateSettings({playbackVolume:value}); notifyWorkspace(); return workspaceSnapshot(); });
    handler('speech:preview', () => { if (speech.status().phase !== 'ready') throw new Error('请先开启常驻加载，等待语音模型就绪后试听。'); showChat(); chat.webContents.send('speech:reply', { text: '雨还在下。慢慢来，我们把眼前的事情一件一件做好。', preview: true }); });
    handler('notification:preview', () => { chat.webContents.send('notification:sound', { action: 'play' }); });
    handler('companion:window', (_event, action) => {
      if (action === 'toggle-chat') toggleChat();
      else if (action === 'recall-chat') recallChat();
      else if (action === 'show-chat') showChat();
      else if (action === 'workbench') showWorkbench();
      else if (action === 'speech-settings') showWorkbench('speech');
      else if (action === 'remote-settings') showWorkbench('remote');
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
      if (!trusted(event) || event.sender !== avatar.webContents) return;
      if (wallpaperMode && info?.error) confirmWallpaper(info).catch(error => console.error('[wallpaper:ready]', error.message));
      if (trusted(event) && event.sender === avatar.webContents && info?.ready === true) {
        const reported = acceptWallpaperReport(wallpaperStatus, info, appliedWallpaperRequest, store.data.settings.character);
        if (reported !== wallpaperStatus) {
          wallpaperStatus = reported;
          notifyWorkspace();
        }
        avatar.setTitle(wallpaperMode ? 'Vibe Voice · 雨夜窗前' : 'Vibe Voice · Hiyori Live2D');
        console.info('[companion:render-ready]', JSON.stringify({ kind: info.kind, model: info.model,
          character: info.character, pose: info.pose, activity: info.activity,
          sourceWidth: info.sourceWidth, sourceHeight: info.sourceHeight,
          renderWidth: info.renderWidth, renderHeight: info.renderHeight }));
      }
    });
    ipcMain.on('wallpaper:ambient-applied', (event, revision) => { if(trusted(event) && event.sender===avatar.webContents) ambientBarrier.acknowledge(revision); });
    ipcMain.on('wallpaper:ambient-status', (event, value) => {
      if(!trusted(event) || event.sender!==avatar.webContents || !['off','loading','ready','error'].includes(value?.phase))return;
      const next={phase:value.phase,error:typeof value.error==='string'?value.error.slice(0,300):''};
      if(JSON.stringify(next)!==JSON.stringify(ambienceStatus)) { ambienceStatus=next; notifyWorkspace(); }
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
    tray = new Tray(icon()); tray.setToolTip(`${portable?.testBuild ? 'Rin Desktop 测试版' : 'Vibe Voice'} · ${agentName(provider)} 桌面伙伴`);
    trayMenu = Menu.buildFromTemplate([{ label: '打开对话  Ctrl+Alt+空格', click: showChat },
      { label: '壁纸人物', click: () => showWorkbench('wallpaper') },
      { label: '项目与对话工作台', click: showWorkbench }, { label:'连接与设置遥控器', click:()=>showWorkbench('remote') }, { label: '听写 / 完成听写', click: () => sendInputAction('record') },
      { label: '发送当前草稿', click: () => sendInputAction('send') }, { label: '朗读此条', click: () => sendInputAction('readReply') }, { label: '停止播报', click: stopSpeech },
      ...(wallpaperMode ? [{ id: 'pause-wallpaper', label: '暂停壁纸动画', type: 'checkbox', checked: manualPause, click: item => { manualPause = item.checked; notifyPresentation(); notifyWorkspace(); } }, ...(!packaged ? [{ label: '切换为悬浮角色', click: () => switchMode('avatar') }] : [])]
        : [{ label: '显示 / 隐藏角色', click: () => avatar.isVisible() ? avatar.hide() : avatar.showInactive() }, { label: '恢复默认位置与大小', click: resetAvatar }, { label: '切换为雨夜壁纸', click: () => switchMode('wallpaper') }]),
      { type: 'separator' }, { label: '退出桌面伙伴', click: () => app.quit() }]);
    tray.setContextMenu(trayMenu);
    tray.on('click', toggleChat);
    registerShortcuts(); speech.configure(store.data.settings); notifyWorkspace();
    remote.start();
    await backend.connect();
    if (argument('show') === 'wallpaper') showWorkbench('wallpaper');
    else if (argument('show') === 'workbench') showWorkbench();
    else if (argument('show') === 'chat') showChat();
  }).catch(error => {
    // Closing the CLI during startup rejects its connection promise. A native
    // error dialog here would block the pending quit until somebody dismissed it.
    if (closing) return;
    console.error('[companion:startup]', error.stack); dialog.showErrorBox('桌面伙伴未能启动', error.message); closing = true; app.exit(1);
  });
  function flushChatDraft() {
    // A missing or already crashed renderer has no remaining editable memory.
    // Its previously dispatched saves are still drained by the store queue.
    return new Promise((resolveFlush, rejectFlush) => {
      const id = ++draftFlushSerial;
      const sender = chat && !chat.isDestroyed() && !chat.webContents.isDestroyed() && !chat.webContents.isCrashed() ? chat.webContents : null;
      const finish = error => {
        if (draftFlushRequest?.id !== id) return;
        clearTimeout(timer); draftFlushRequest = null;
        error ? rejectFlush(error) : resolveFlush();
      };
      const timer = setTimeout(() => finish(new Error('聊天窗口未能及时确认草稿已保存，退出已取消。请检查草稿后重试。')), 10000);
      const confirm = () => Promise.resolve(store?.queue).then(() => finish(), finish);
      draftFlushRequest = { id, sender, finish, confirm };
      if (!sender) { confirm(); return; }
      try { sender.send('draft:flush', id); } catch (error) { finish(error); }
    });
  }
  app.on('before-quit', event => {
    if (closing) return; event.preventDefault(); if (quitting) return;
    quitting = true; globalShortcut.unregisterAll(); cancelWallpaperCommit();
    (async () => {
      try {
        remote?.cancel().catch(() => {});
        await flushChatDraft();
        if (pendingDataSelection) { await pendingDataSelection(); pendingDataSelection = null; }
        if (pendingRelaunch) { app.relaunch(pendingRelaunch); pendingRelaunch = null; }
      } catch (error) {
        quitting = false; pendingDataSelection = null; pendingRelaunch = null; registerShortcuts();
        try { if (chat && !chat.isDestroyed()) { chat.webContents.send('draft:flush-cancelled', error.message); showChat(); } } catch { /* A renderer can disappear while the flush is pending. */ }
        dialog.showErrorBox('草稿尚未保存，退出已取消', error.message);
        return;
      }
      closing = true;
      tray?.destroy(); clearTimeout(captureTimer); ambientBarrier.close();
      await Promise.allSettled([remote?.close(), voiceResources?.close(), speech?.close(), wallpaperHost?.close(), backend?.close(), providerChange, store?.queue, characterBox ? saveAppearance() : Promise.resolve()]);
      try { await speech?.close(); } finally { app.exit(0); }
    })();
  });
  app.on('window-all-closed', () => { if (closing) app.quit(); });
}
