import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(import.meta.dirname, '../..');
export function stillRoutes({ scene = false } = {}) {
  const files = new Map([
    ['/', ['prototypes/live2d-codex/renderer/still-preview.html', 'text/html']],
    ['/media/light-rain.ogg', ['prototypes/live2d-codex/assets/ambience/light-rain.ogg', 'audio/ogg']],
    ['/media/soft-keyboard.ogg', ['prototypes/live2d-codex/assets/ambience/soft-keyboard.ogg', 'audio/ogg']],
  ]);
  for (const pose of ['work', 'cup', 'thinking', 'window', 'attention']) files.set(`/media/${pose}.png`, [`prototypes/live2d-codex/assets/stills/female-v2-4k/${pose}.png`, 'image/png']);
  for (const name of ['still-preview.mjs','still-sequence.mjs','ambient-preview.mjs','still-preview.css']) files.set('/renderer/' + name, ['prototypes/live2d-codex/renderer/' + name, name.endsWith('.css') ? 'text/css' : 'text/javascript']);
  if (scene) {
    files.set('/', ['prototypes/live2d-codex/renderer/still-scene-preview.html', 'text/html']);
    files.set('/media/scene.png', ['prototypes/live2d-codex/assets/stills/scene-v3/room.png', 'image/png']);
    for (const pose of ['work', 'cup', 'thinking', 'window', 'attention']) {
      files.set(`/media/${pose}.png`, [`prototypes/live2d-codex/assets/stills/${pose === 'thinking' ? 'scene-v3' : 'female-v2'}/${pose}.png`, 'image/png']);
      files.set(`/media/original/${pose}.png`, [`prototypes/live2d-codex/assets/stills/female-v2/${pose}.png`, 'image/png']);
    }
    for (const name of ['still-scene-preview.mjs', 'still-scene-compose.mjs', 'still-scene-preview.css']) files.set('/renderer/' + name, ['prototypes/live2d-codex/renderer/' + name, name.endsWith('.css') ? 'text/css' : 'text/javascript']);
  }
  return files;
}
export function createStillServer(options) {
  const files = stillRoutes(options);
  return createServer(async (request, response) => {
    try {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); return response.end(); }
      const path = new URL(request.url, 'http://127.0.0.1').pathname, entry = files.get(path);
      if (!entry) { response.writeHead(404); return response.end(); }
      const file = resolve(root, entry[0]), info = await stat(file);
      if (!info.isFile()) { response.writeHead(404); return response.end(); }
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': entry[1] + (entry[1].startsWith('text/') ? '; charset=utf-8' : ''), 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else { response.writeHead(error.code === 'ERR_INVALID_URL' ? 400 : 404); response.end(request.method === 'HEAD' ? undefined : 'Preview asset unavailable'); }
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || 5321);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  const server = createStillServer({ scene: process.argv.includes('--scene') });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Static wallpaper audition: http://127.0.0.1:${port}/`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
