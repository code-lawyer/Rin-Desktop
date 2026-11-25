import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';
requireLiveRun(
  'npm run qa:poses -- --run [--stills] [--anime-male]',
  'isolated complete-pose rendering with local artwork; no accounts or hardware',
);
const options = process.argv.slice(2).filter(arg => arg !== '--run');
if (options.some(arg => !['--stills', '--anime-male'].includes(arg)))
  throw Error('Use --run with optional --stills and --anime-male');
const root = resolve(import.meta.dirname, '../..'),
  output = await createRunDirectory('pose-visual');
const require = createRequire(join(root, 'prototypes/live2d-codex/package.json'));
await require('esbuild').build({
  entryPoints: [join(import.meta.dirname, 'pose-visual-entry.mjs')],
  bundle: true,
  format: 'esm',
  outfile: join(output, 'entry.js'),
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const stills = process.argv.includes('--stills');
await command(
  join(root, 'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),
  [join(import.meta.dirname, 'pose-visual-fixture.cjs'), output, ...options],
  env,
);
if (!stills)
  await command('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-n',
    '-framerate',
    '24',
    '-i',
    join(output, 'frames/%04d.jpg'),
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(output, 'poses.mp4'),
  ]);
console.log(JSON.stringify({ output }));
function command(exe, args, env = process.env) {
  return new Promise((done, fail) => {
    const child = spawn(exe, args, { env, windowsHide: true, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(Error(`${exe}: ${code}`))));
  });
}
