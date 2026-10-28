import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { byteRange } from '../../prototypes/live2d-codex/backend/video-media.mjs';

const args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) {
  console.log('npm run preview:video-4k -- --run --id=<completed-local-trial-id> [--port=0]\nServes only completed comparison files on 127.0.0.1. No generation or downloads.');
} else {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(id|port)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument: ' + arg);
    options.set(match[1], match[2]);
  }
  const id = options.get('id'), port = Number(options.get('port') ?? 0);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/.test(id ?? '')) throw new Error('Specify a valid --id.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  const output = resolve(import.meta.dirname, '../../work/qa/video-upscale', id);
  const report = JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8'));
  if (!report.output?.frameTimesMatch) throw new Error('The trial has not finished validation.');
  const files = new Map([
    ['/', resolve(import.meta.dirname, 'video-4k-preview.html')],
    ...['original.mp4', 'upscaled-4k.mp4', 'comparison-left-original-right-4k.mp4', 'face-comparison.png'].map(name => ['/' + name, resolve(output, name)]),
  ]);
  for (const file of files.values()) await stat(file);
  const types = { '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      const file = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
      if (!file) { res.writeHead(404).end(); return; }
      const { size } = await stat(file);
      const range = byteRange(req.headers.range, size);
      if (range === false) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      const headers = { 'Content-Type': types[extname(file)], 'Content-Length': range ? range.end - range.start + 1 : size, 'Accept-Ranges': 'bytes' };
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file, range || {});
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); }
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('4K comparison: http://127.0.0.1:' + server.address().port + '/'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
