import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateManifest } from './video-catalog.mjs';
import { respondMediaFile } from './local-media.mjs';
export { byteRange } from './local-media.mjs';

export async function createVideoMedia(directory) {
  let manifest, error;
  try {
    manifest = validateManifest(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')), { mediaBase: 'app://local/video/' });
    if (!['idle', 'focus', 'attention'].every(id => manifest.scenes.some(scene => scene.id === id))) throw new Error('需要陪伴、专注和等待回应三段素材。');
    for (const scene of manifest.scenes) for (const name of [scene.file, scene.poster]) if (!(await stat(resolve(directory, name))).isFile()) throw new Error('素材不可用。');
  } catch { manifest = null; error = '视频素材尚未准备完整，请重新导入本地素材并重启应用。'; }
  const files = new Set((manifest?.scenes || []).flatMap(scene => [scene.file, scene.poster]));
  return {
    available: Boolean(manifest), error,
    poster: manifest?.scenes[0]?.posterUrl ?? null,
    async respond(request) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 405 });
      const url = new URL(request.url), name = url.pathname.slice('/video/'.length);
      if (url.protocol !== 'app:' || url.hostname !== 'local' || !url.pathname.startsWith('/video/')) return new Response('', { status: 403 });
      if (name === 'manifest.json') return new Response(request.method === 'HEAD' ? null : JSON.stringify(manifest || { error }), { status: manifest ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      if (!files.has(name)) return new Response('', { status: 404 });
      return respondMediaFile(request, resolve(directory, name));
    },
  };
}
