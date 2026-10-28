import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

export function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end };
}

// Callers must resolve an allowlisted file before entering this shared reader.
export async function respondMediaFile(request, file) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  try {
    const { size } = await stat(file), range = byteRange(request.headers.get('range'), size);
    if (range === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const types = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png' };
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes',
      'Content-Length': String(range ? range.end - range.start + 1 : size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    const stream = request.method === 'HEAD' ? null : createReadStream(file, range || {});
    if (stream) {
      const cancel = () => stream.destroy(); request.signal?.addEventListener('abort', cancel, { once: true });
      stream.once('close', () => request.signal?.removeEventListener('abort', cancel));
      if (request.signal?.aborted) cancel();
    }
    return new Response(stream ? Readable.toWeb(stream) : null, { status: range ? 206 : 200, headers });
  } catch { return new Response(null, { status: 404 }); }
}
