const { app, BrowserWindow } = require('electron');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

// A separate, ordinary desktop window. It neither attaches to another host nor starts the main app.
app.setName('Rin Video Preview');
app.setPath('userData', resolve(__dirname, '../../work/runtime/video-companion/desktop-data'));
let server, window;
app.whenReady().then(async () => {
  const { createPreviewServer, listenPreview } = await import(pathToFileURL(resolve(__dirname, '../../tools/project/video-preview-server.mjs')).href);
  server = await createPreviewServer();
  const url = await listenPreview(server, 0);
  window = new BrowserWindow({ width: 1280, height: 820, minWidth: 600, minHeight: 480, title: 'Rin · 动态视频样例', backgroundColor: '#151321', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadURL(url);
  console.log(`Independent video window ready: ${url}`);
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { server?.closeAllConnections(); server?.close(); });
