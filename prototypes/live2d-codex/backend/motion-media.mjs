import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { respondMediaFile } from './local-media.mjs';
import { motionCatalog } from '../renderer/motion-catalog.mjs';

const prefix = '/assets/motion/female/';
export async function createMotionMedia(directory) {
  async function inspect() {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
      const catalog = motionCatalog(manifest), files = new Set();
      for (const name of [...catalog.clips.values()].map(clip => clip.file).concat(manifest.posters.work, manifest.posters.user)) {
        if (!(await stat(resolve(directory, name))).isFile()) throw new Error('Missing motion media');
        files.add(name);
      }
      return { manifest, files };
    } catch { return { manifest: null, files: new Set() }; }
  }
  let current = await inspect(), loading;
  // A renderer retry must observe repaired files without restarting the app.
  // Concurrent catalogue requests share one complete, atomically published scan.
  const refresh = () => loading ??= inspect().then(value => (current = value)).finally(() => { loading = null; });
  return {
    get available() { return !!current.manifest; },
    async respond(request) {
      const url = new URL(request.url);
      if (url.protocol !== 'app:' || url.hostname !== 'local' || !url.pathname.startsWith(prefix)) return new Response(null, { status: 403 });
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const name = url.pathname.slice(prefix.length);
      if (name === 'manifest.json') {
        const { manifest } = await refresh();
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(manifest || { error: '动态壁纸素材尚未准备完整。' }),
          { status: manifest ? 200 : 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }
      if (!current.files.has(name)) return new Response(null, { status: 404 });
      return respondMediaFile(request, resolve(directory, name));
    },
  };
}
