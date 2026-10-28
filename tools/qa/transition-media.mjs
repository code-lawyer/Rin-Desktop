import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { validateTransitions } from '../../prototypes/video-companion/transition-catalog.mjs';

const args = process.argv.slice(2), root = resolve(import.meta.dirname, '../..');
if (!args.includes('--run') || args.includes('--help')) console.log('npm run qa:transitions -- --run --id=<local-bundle> [--resolution=720p|4k]\nOffline decode, frame timing and boundary inspection of a prepared transition bundle. Defaults to 4k. No accounts or hardware input.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });
async function main() {
  if (args.filter(arg => arg === '--run').length !== 1 || args.filter(arg => arg.startsWith('--id=')).length !== 1 || args.filter(arg => arg.startsWith('--resolution=')).length > 1 || args.some(arg => arg !== '--run' && !/^--(id|resolution)=/.test(arg))) throw new Error('Specify --run, --id and optional --resolution only.');
  const id = args.find(arg => arg.startsWith('--id='))?.slice(5);
  const resolution = args.find(arg => arg.startsWith('--resolution='))?.slice(13) ?? '4k';
  if (!['720p', '4k'].includes(resolution)) throw new Error('Invalid expected resolution.');
  const expected = resolution === '4k' ? [3840, 2160] : [1280, 720];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(id ?? '')) throw new Error('Invalid bundle id.');
  const bundle = join(root, 'work/qa/three-state-preview', id);
  const outputRoot = join(root, 'work/qa/transition-media');
  const out = join(outputRoot, id + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  const manifest = validateTransitions(JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')));
  await mkdir(outputRoot, { recursive: true }); await mkdir(out);
  const report = { inspectedAt: new Date().toISOString(), resolution, status: 'inspecting', clips: [], seams: [], caveat: 'Timing and boundary metrics do not prove anatomy, motion or visual acceptance.' };
  const pixels = new Map();
  for (const clip of manifest.transitions) {
    const path = join(bundle, clip.file), key = clip.from + '-' + clip.to;
    const probe = JSON.parse((await command('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path])).toString());
    const stream = probe.streams[0], frames = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
    if (stream.width !== expected[0] || stream.height !== expected[1] || frames.length !== Number(stream.nb_read_frames) || !frames.length || frames[0] !== 0 || frames.some((time, index) => !Number.isFinite(time) || (index && time <= frames[index - 1])) || Math.abs(Number(stream.duration) - clip.duration) > .002) throw new Error('Invalid media contract: ' + clip.file);
    await command('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-f', 'null', '-']);
    const selected = [...new Set([0, Math.floor(frames.length / 4), Math.floor(frames.length / 2), Math.floor(frames.length * .75), frames.length - 1])];
    const expression = selected.map(index => `eq(n\\,${index})`).join('+');
    await ffmpeg(['-i', path, '-vf', `select=${expression},scale=640:360,tile=5x1`, '-frames:v', '1', join(out, key + '-filmstrip.png')]);
    for (const [name, index] of [['first', 0], ['last', frames.length - 1]]) {
      const frame = join(out, key + '-' + name + '.png');
      await ffmpeg(['-i', path, '-vf', `select=eq(n\\,${index}),scale=1280:720`, '-frames:v', '1', frame]);
      const raw = await command('ffmpeg', ['-v', 'error', '-i', frame, '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      if (raw.length !== 320 * 180 * 3) throw new Error('Unexpected boundary frame size.');
      pixels.set(key + ':' + name, raw);
    }
    report.clips.push({ from: clip.from, to: clip.to, file: clip.file, width: stream.width, height: stream.height, frames: frames.length, duration: Number(stream.duration), decoded: true, bytes: (await stat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex'), frameTimesSeconds: frames });
    console.log(key + ': decoded ' + frames.length + ' frames');
  }
  for (const incoming of manifest.transitions) for (const outgoing of manifest.transitions.filter(clip => clip.from === incoming.to)) {
    const left = incoming.from + '-' + incoming.to, right = outgoing.from + '-' + outgoing.to;
    const a = pixels.get(left + ':last'), b = pixels.get(right + ':first');
    let delta = 0; for (let index = 0; index < a.length; index++) delta += Math.abs(a[index] - b[index]);
    report.seams.push({ incoming: left, outgoing: right, meanAbsoluteRgbDifferenceOn0To255: Number((delta / a.length).toFixed(4)) });
    await ffmpeg(['-i', join(out, left + '-last.png'), '-i', join(out, right + '-first.png'), '-filter_complex', '[0:v][1:v]hstack=inputs=2', '-frames:v', '1', join(out, left + '--' + right + '-seam.png')]);
  }
  const gridInputs = report.seams.flatMap(seam => ['-i', join(out, seam.incoming + '--' + seam.outgoing + '-seam.png')]);
  const scales = report.seams.map((_seam, index) => `[${index}:v]scale=640:180[s${index}]`).join(';');
  const labels = report.seams.map((_seam, index) => `[s${index}]`).join('');
  const layout = report.seams.map((_seam, index) => `${index % 3 * 640}_${Math.floor(index / 3) * 180}`).join('|');
  await ffmpeg([...gridInputs, '-filter_complex', `${scales};${labels}xstack=inputs=${report.seams.length}:layout=${layout}`, '-frames:v', '1', join(out, 'all-seams.png')]);
  report.status = 'decoded-awaiting-user-visual-acceptance';
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Inspected ' + report.clips.length + ' clips and ' + report.seams.length + ' directed joins.');
  console.log('Output: ' + out);
}
function ffmpeg(args) { return command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }
function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [], errors = [];
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(executable + ': ' + Buffer.concat(errors).toString().slice(-2000))));
  });
}
