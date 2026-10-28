import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({ absWorkingDir: root, entryPoints: [resolve(root, 'renderer/app.js'), resolve(root, 'renderer/workbench.js')], bundle: true, outdir: resolve(root, 'dist'), format: 'esm', platform: 'browser', target: 'chrome140', sourcemap: false, logLevel: 'info' });
