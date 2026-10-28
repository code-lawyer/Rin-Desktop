import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('npm run qa:video-seam -- --run --input=<local-mp4> --at=<seconds> --output=<new-report-id> [--sources=<work-idle-demo-id>]\nChecks the actual decoded cut against nearby motion in this fixed-camera wallpaper. Optional sources compare the same cut before/after spatial crop and upscale. Exit 2 flags a sudden background/full-frame change; visual review still required. No account access or source edits.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(input|at|output|sources)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  const at = Number(options.get('at'));
  if (options.size !== (options.has('sources') ? 4 : 3) || !Number.isFinite(at) || at <= .5 || !validId(options.get('output')) || (options.has('sources') && !validId(options.get('sources')))) throw new Error('Specify local input, time above 0.5s, and new output ID.');
  const input = resolve(root, options.get('input')), path = relative(root, input);
  if (path.startsWith('..') || isAbsolute(path) || !input.endsWith('.mp4')) throw new Error('Input must be an MP4 inside the workspace.');
  const probe = JSON.parse((await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input])).toString());
  const times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
  const cut = times.findIndex(time => time >= at - .000002);
  if (cut < 2 || times.at(-1) < at + .5) throw new Error('Need half a second of context on both sides.');
  const start = times.findIndex(time => time >= at - .5), firstAfter = times.findIndex(time => time > at + .5), end = firstAfter < 0 ? times.length : firstAfter;
  const bytes = await command('ffmpeg', ['-v', 'error', '-i', input, '-vf', `select=between(n\\,${start}\\,${end - 1}),scale=320:180:flags=area`, '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  const stride = 320 * 180 * 3;
  if (bytes.length !== (end - start) * stride) throw new Error('Decoded frame count mismatch.');
  const frames = times.slice(start, end).map((_time, i) => bytes.subarray(i * stride, (i + 1) * stride));
  const regions = { full: [0, 0, 320, 180], window: [4, 25, 108, 140], windowFrame: [115, 5, 28, 75], lamp: [275, 2, 42, 58], sofa: [276, 90, 35, 77] };
  const changes = frames.slice(1).map((frame, i) => ({ frame: start + i + 1, time: times[start + i + 1], differences: Object.fromEntries(Object.entries(regions).map(([key, box]) => [key, difference(frames[i], frame, box)])) }));
  const seam = changes.find(change => change.frame === cut);
  // Ignore codec noise on the repeated 60Hz display frames. This threshold
  // selects nearby frames with actual motion instead of inflating the ratio.
  const baseline = Object.fromEntries(Object.keys(regions).map(key => [key, median(changes.filter(change => Math.abs(change.time - at) > .06 && change.differences.full > .3).map(change => change.differences[key]))]));
  const ratios = Object.fromEntries(Object.keys(regions).map(key => [key, seam.differences[key] / Math.max(.01, baseline[key])]));
  const backgroundFlags = Object.keys(regions).filter(key => key !== 'full' && seam.differences[key] > 2 && ratios[key] > 4);
  const jump = seam.differences.full > 3 && ratios.full > 4 && backgroundFlags.length >= 2;
  const outRoot = join(root, 'work/qa/video-seam'), out = join(outRoot, options.get('output'));
  await mkdir(outRoot, { recursive: true }); await mkdir(out);
  const report = { input: path.split('\\').join('/'), sha256: createHash('sha256').update(await readFile(input)).digest('hex'), at, cutFrame: cut, gapSeconds: times[cut] - times[cut - 1], suddenWholeFrameChange: jump, baseline, seam, ratios, backgroundFlags, changes, notes: 'Fixed-camera wallpaper diagnostic only. RGB MAE at 320x180; background/full-frame jumps relative to nearby nonduplicated frames are a repro signal, not art acceptance. Exit 2 flags the signal.' };
  if (options.has('sources')) report.sourceComparison = await compareSources(options.get('sources'), report, regions, out);
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [name, frame] of [['before', cut - 1], ['after', cut]]) await command('ffmpeg', ['-v', 'error', '-n', '-i', input, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', join(out, name + '.png')]);
  await command('ffmpeg', ['-v', 'error', '-n', '-ss', String(Math.max(0, at - 1)), '-i', input, '-t', '2', '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-movflags', '+faststart', join(out, 'boundary-2s.mp4')]);
  console.log(JSON.stringify({ output: relative(root, out), suddenWholeFrameChange: jump, at: seam.time, gapSeconds: report.gapSeconds, seam: seam.differences, baseline, ratios, backgroundFlags, sourceComparison: report.sourceComparison }, null, 2));
  if (jump) process.exitCode = 2;
}
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(value); }
async function compareSources(id, report, regions, out) {
  const demo = JSON.parse(await readFile(join(root, 'work/qa/work-idle-demo', id, 'report.json'), 'utf8'));
  if (!demo.outputs.some(output => output.sha256 === report.sha256) || !validId(demo.analysis)) throw new Error('Source report does not match the inspected video.');
  if (!demo.joins.some(item => item.from === 'incoming' && item.to === 'loop' && Math.abs(item.atSeconds - report.at) < .000002)) throw new Error('Source comparison supports only the selected return-to-loop cut.');
  const analysis = JSON.parse(await readFile(join(root, 'work/qa/idle-loop-media', demo.analysis, 'report.json'), 'utf8'));
  if (!validId(analysis.sourceBundle)) throw new Error('Invalid source bundle.');
  const incoming = demo.sources.find(source => source.key === 'incoming'), loop = demo.sources.find(source => source.key === 'loop');
  const files = [
    { name: 'old720', path: `work/qa/three-state-preview/${analysis.sourceBundle}/user-work.mp4`, hash: analysis.existing.incoming.sha256, frame: incoming.end },
    { name: 'loop720', path: analysis.input, hash: analysis.loop.sha256, frame: loop.start },
    { name: 'old4k', path: incoming.path, hash: incoming.hash, frame: incoming.end },
    { name: 'loop4k', path: loop.path, hash: loop.hash, frame: loop.start }
  ];
  for (const file of files) {
    file.absolute = resolve(root, file.path);
    const path = relative(root, file.absolute);
    if (path.startsWith('..') || isAbsolute(path) || createHash('sha256').update(await readFile(file.absolute)).digest('hex') !== file.hash) throw new Error('Source path/hash mismatch.');
  }
  const decoded = new Map();
  for (const file of files) {
    decoded.set(file.name, await frame(file, ''));
    if (file.name.startsWith('old')) decoded.set(file.name + 'Crop', await frame(file, file.name === 'old720' ? 'crop=1258:708:11:6:exact=1,' : 'crop=3774:2124:33:18:exact=1,'));
  }
  const stages = [['720p-original', 'old720', 'loop720'], ['720p-cropped', 'old720Crop', 'loop720'], ['4k-original', 'old4k', 'loop4k'], ['4k-cropped', 'old4kCrop', 'loop4k']].map(([stage, a, b]) => ({ stage, differences: Object.fromEntries(Object.entries(regions).map(([key, box]) => [key, difference(decoded.get(a), decoded.get(b), box)])) }));
  for (const file of files.slice(0, 2)) await command('ffmpeg', ['-v', 'error', '-n', '-i', file.absolute, '-vf', `select=eq(n\\,${file.frame})`, '-frames:v', '1', join(out, file.name + '-source.png')]);
  return { incomingFrame: incoming.end, incomingTime: analysis.existing.incoming.times[incoming.end], loopFrame: loop.start, loopTime: analysis.loop.frameTimesSeconds[loop.start], stages, sources: files.map(({ absolute, ...file }) => file) };
  async function frame(file, filter) {
    const data = await command('ffmpeg', ['-v', 'error', '-i', file.absolute, '-vf', `select=eq(n\\,${file.frame}),${filter}scale=320:180:flags=area`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    if (data.length !== 320 * 180 * 3) throw new Error('Wrong source frame length.');
    return data;
  }
}
function median(values) { if (!values.length) return 0; values.sort((a, b) => a - b); const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; }
function difference(a, b, [x, y, width, height]) { let sum = 0; for (let row = y; row < y + height; row++) for (let i = (row * 320 + x) * 3, stop = i + width * 3; i < stop; i++) sum += Math.abs(a[i] - b[i]); return sum / (width * height * 3); }
function command(executable, args) { return new Promise((resolve, reject) => { const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), stdout = [], stderr = []; child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk)); child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(executable + ': ' + Buffer.concat(stderr).toString().slice(-2500)))); }); }
