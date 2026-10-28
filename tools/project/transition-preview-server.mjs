import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, relative, isAbsolute } from 'node:path';
import { validateTransitions } from '../../prototypes/video-companion/transition-catalog.mjs';
import { byteRange } from '../../prototypes/live2d-codex/backend/video-media.mjs';

const source = resolve(import.meta.dirname, '../../prototypes/video-companion');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.mp4': 'video/mp4' };
export async function createTransitionServer({ mediaRoot }) {
  const root = await realpath(mediaRoot);
  const manifest = validateTransitions(JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')));
  const files = new Map([['/', resolve(source, 'transitions.html')]]);
  for (const name of ['transitions.css', 'transitions.mjs', 'transition-player.mjs', 'transition-catalog.mjs', 'video-deck.mjs']) files.set('/' + name, resolve(source, name));
  for (const clip of manifest.transitions) {
    const file = await realpath(resolve(root, clip.file)), rel = relative(root, file);
    if (rel.startsWith('..') || isAbsolute(rel) || !(await stat(file)).isFile()) throw new Error('Media must be a regular file inside the preview directory.');
    files.set('/media/' + clip.file, file);
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path === '/manifest.json') {
        const body = JSON.stringify(manifest);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body); return;
      }
      const file = files.get(path);
      if (!file) { res.writeHead(404).end(); return; }
      const { size } = await stat(file), range = byteRange(req.headers.range, size);
      if (range === false) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      const headers = { 'Content-Type': types[extname(file)], 'Content-Length': range ? range.end - range.start + 1 : size, 'Accept-Ranges': 'bytes' };
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file, range || {});
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); }
  });
}
