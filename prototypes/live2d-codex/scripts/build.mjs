import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, relative } from 'node:path';
import { checkedSourcePath, releaseGit } from '../../../tools/release/package-inputs.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function buildRenderer(outdir, { includeAvatar = false, write = true } = {}) {
  const entryPoints = ['renderer/app.js', 'renderer/workbench.js'];
  if (includeAvatar) entryPoints.push('renderer/avatar.js');
  return build({
    absWorkingDir: root,
    entryPoints,
    bundle: true,
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    outdir,
    format: 'esm',
    platform: 'browser',
    target: 'chrome140',
    external: ['app://local/dist/avatar.js'],
    sourcemap: false,
    logLevel: write ? 'info' : 'warning',
    write,
    metafile: !write,
  });
}

export async function packageRenderer(tracked) {
  // Write only this invocation's outputs. The source build may have extra or
  // stale files in dist, including the source-only avatar entry.
  const outdir = resolve(root, 'dist');
  const { outputFiles, metafile } = await buildRenderer(outdir, { write: false });
  const allowed = new Set([...tracked, 'node_modules/marked/lib/marked.esm.js']);
  const sharedDeck = 'prototypes/video-companion/video-deck.mjs';
  if (releaseGit(resolve(root, '../..'), ['ls-files', '--', sharedDeck]) === sharedDeck) allowed.add('../video-companion/video-deck.mjs');
  for (const file of Object.keys(metafile.inputs)) {
    if (!allowed.has(file)) throw new Error(`Unexpected renderer build input: ${file}`);
    await checkedSourcePath(root, file);
  }
  return outputFiles.map(file => {
    const name = relative(outdir, file.path).replaceAll('\\', '/');
    if (!/^(?:app\.js|workbench\.js|chunks\/chunk-[A-Z0-9]+\.js)$/.test(name)) {
      throw new Error(`Unexpected renderer build output: ${name}`);
    }
    return { name, bytes: file.contents };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outdir = resolve(root, 'dist');
  await rm(resolve(outdir, 'chunks'), { recursive: true, force: true });
  await buildRenderer(outdir, { includeAvatar: process.argv.includes('--avatar') });
}
