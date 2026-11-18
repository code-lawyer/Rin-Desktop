import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: ['renderer/app.js', 'renderer/workbench.js', 'renderer/avatar.js'],
  bundle: true,
  outdir: resolve(root, 'dist'),
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  external: ['app://local/dist/avatar.js'],
  sourcemap: false,
  logLevel: 'info',
});
