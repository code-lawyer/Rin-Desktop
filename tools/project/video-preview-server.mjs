import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { validateManifest } from '../../prototypes/video-companion/catalog.mjs';

export const root = resolve(import.meta.dirname, '../..');
export const sourceRoot = resolve(root, 'prototypes/video-companion');
export const runtimeRoot = resolve(root, 'work/runtime/video-companion');
export async function buildPreview() {
  const require = createRequire(resolve(root, 'prototypes/live2d-codex/package.json'));
  const output = resolve(runtimeRoot, 'web/preview.js');
  await mkdir(resolve(output, '..'), { recursive: true });
  await require('esbuild').build({ entryPoints: [resolve(sourceRoot, 'preview.js')], outfile: output, bundle: true, format: 'esm', platform: 'browser', target: 'chrome130', logLevel: 'warning' });
  return output;
}
export { byteRange } from '../../prototypes/live2d-codex/backend/video-media.mjs';
import { byteRange } from '../../prototypes/live2d-codex/backend/video-media.mjs';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png' };
export async function createPreviewServer({ mediaRoot = resolve(runtimeRoot, 'media'), bundle = resolve(runtimeRoot, 'web/preview.js') } = {}) {
  let manifest, manifestError;
  try { manifest = validateManifest(JSON.parse(await readFile(resolve(mediaRoot, 'manifest.json'), 'utf8'))); }
  catch (error) { manifestError = error.code === 'ENOENT' ? '尚未准备视频素材。请先运行 video:import，再重启预览。' : '素材清单无效，请检查文件与循环区间后重启预览。'; }
  const files = new Map([['/', resolve(sourceRoot, 'index.html')], ['/style.css', resolve(sourceRoot, 'style.css')], ['/preview.js', bundle]]);
  for (const scene of manifest?.scenes || []) {
    files.set(`/media/${scene.file}`, resolve(mediaRoot, scene.file));
    files.set(`/media/${scene.poster}`, resolve(mediaRoot, scene.poster));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname === '/manifest.json') {
        const body = JSON.stringify(manifest || { error: manifestError });
        res.writeHead(manifest ? 200 : 503, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body); return;
      }
      const file = files.get(pathname);
      if (!file) { res.writeHead(404).end('Not found'); return; }
      const { size } = await stat(file);
      const range = byteRange(req.headers.range, size);
      if (range === false) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      const headers = { 'Content-Type': types[extname(file)], 'Accept-Ranges': 'bytes', 'Content-Length': range ? range.end - range.start + 1 : size };
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file, range || {});
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) { if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Preview resource unavailable'); else res.destroy(); }
  });
  return server;
}
export async function listenPreview(server, port = 5319) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}/`;
}
