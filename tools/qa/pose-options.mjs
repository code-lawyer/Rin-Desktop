import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';
requireLiveRun(
  'npm run qa:pose-options -- --run [--cyber]',
  'isolated local transition auditions; writes four previews and one comparison; no changes to the running app',
);
if (process.argv.slice(2).some((arg) => !['--run', '--cyber'].includes(arg)))
  throw Error('Use --run and optionally --cyber');
const cyber = process.argv.includes('--cyber');
const root = resolve(import.meta.dirname, '../..'),
  output = await createRunDirectory(cyber ? 'pose-cyber-options' : 'pose-transition-options');
const require = createRequire(join(root, 'prototypes/live2d-codex/package.json'));
await require('esbuild').build({
  entryPoints: [join(import.meta.dirname, cyber ? 'pose-cyber-options-entry.mjs' : 'pose-options-entry.mjs')],
  bundle: true,
  format: 'esm',
  outfile: join(output, 'entry.js'),
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await command(
  join(root, 'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),
  [join(import.meta.dirname, 'pose-options-fixture.cjs'), output],
  env,
);
for (const id of ['a', 'b', 'c', 'd'])
  await command('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-n',
    '-framerate',
    '30',
    '-i',
    join(output, id, '%04d.jpg'),
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    join(output, id + '.mp4'),
  ]);
await command('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-n',
  ...['a', 'b', 'c', 'd'].flatMap((id) => ['-i', join(output, id + '.mp4')]),
  '-filter_complex',
  '[0:v]scale=960:645[a];[1:v]scale=960:645[b];[2:v]scale=960:645[c];[3:v]scale=960:645[d];[a][b][c][d]xstack=inputs=4:layout=0_0|960_0|0_645|960_645[v]',
  '-map',
  '[v]',
  '-c:v',
  'libx264',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  join(output, 'comparison.mp4'),
]);
console.log(JSON.stringify({ output, preview: join(output, 'comparison.mp4') }));
function command(exe, args, env = process.env) {
  return new Promise((done, fail) => {
    const child = spawn(exe, args, { env, windowsHide: true, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(Error(`${exe}: ${code}`))));
  });
}
