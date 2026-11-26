import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');
const includeAvatar = process.argv.includes('--avatar');
await rm(resolve(outdir, 'chunks'), { recursive: true, force: true });
const entryPoints = ['renderer/app.js', 'renderer/workbench.js'];
if (includeAvatar) entryPoints.push('renderer/avatar.js');
await build({
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
  logLevel: 'info',
});
