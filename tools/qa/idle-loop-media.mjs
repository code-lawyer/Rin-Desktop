import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('npm run qa:idle-loop -- --run --input=<local-720p-mp4> --kit=<idle-kit-id> --output=<new-report-id> [--align-existing]\nOffline work-loop boundary, motion and transition matching. Optional alignment evaluates a centered 1258x708 crop of the existing 1280x720 transitions. Exports candidate cuts for visual review, never generates or edits source media.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    if (arg === '--align-existing') { if (options.has('alignment')) throw new Error('Repeated alignment argument.'); options.set('alignment', 'center-crop-1258x708'); continue; }
    const match = /^--(input|kit|output)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  if (options.size !== (options.has('alignment') ? 4 : 3) || !['kit', 'output'].every(key => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(options.get(key)))) throw new Error('Specify input, kit and output.');
  const input = resolve(root, options.get('input')), inputRelative = relative(root, input);
  if (inputRelative.startsWith('..') || isAbsolute(inputRelative) || !input.endsWith('.mp4')) throw new Error('Input must be an MP4 inside this workspace.');
  const kit = JSON.parse(await readFile(join(root, 'work/qa/idle-loop-kit', options.get('kit'), 'report.json'), 'utf8'));
  const bundle = join(root, 'work/qa/three-state-preview', kit.sourceBundle);
  const alignmentFilter = options.has('alignment') ? 'crop=1258:708:11:6:exact=1,scale=1280:720:flags=lanczos,' : '';
  const loop = await decode(input), incoming = await decode(join(bundle, 'user-work.mp4'), alignmentFilter), outgoing = await decode(join(bundle, 'work-user.mp4'), alignmentFilter);
  const validStarts = loop.times.map((time, frame) => ({ time, frame })).filter(item => item.time >= .05 && item.time <= .6);
  const validEnds = loop.times.map((time, frame) => ({ time, frame })).filter(item => item.time >= loop.duration - 1.5 && item.time < loop.duration - .15);
  const incomingFrames = incoming.times.map((time, frame) => ({ time, frame })).filter(item => item.time >= incoming.duration - 1.5 && item.time < incoming.duration - .15);
  const outgoingFrames = outgoing.times.map((time, frame) => ({ time, frame })).filter(item => item.time >= .05 && item.time <= .5);
  if (!validStarts.length || !validEnds.length || !incomingFrames.length || !outgoingFrames.length) throw new Error('No bounded seam candidates.');
  const inMatches = new Map(validStarts.map(start => [start.frame, bestMatch(loop.frames[start.frame], incoming, incomingFrames)]));
  const outMatches = new Map(validEnds.map(end => [end.frame, bestMatch(loop.frames[end.frame], outgoing, outgoingFrames)]));
  const candidates = [];
  for (const start of validStarts) for (const end of validEnds) {
    const endExclusive = loop.times[end.frame + 1] ?? loop.duration, duration = endExclusive - start.time;
    if (duration < 4.5) continue;
    const wrap = score(loop.frames[end.frame], loop.frames[start.frame]);
    const entry = inMatches.get(start.frame), exit = outMatches.get(end.frame);
    const scores = [wrap, entry.score, exit.score];
    // Keep forward playback and prefer endpoints near a resting pose. Numeric
    // matching does not certify anatomy, gaze, typing or seamless perception.
    const boundaryMotion = score(loop.frames[end.frame - 1], loop.frames[end.frame]) + score(loop.frames[start.frame], loop.frames[start.frame + 1]);
    candidates.push({ startFrame: start.frame, endFrameInclusive: end.frame, startTime: start.time, endTimeExclusive: endExclusive, duration, wrapDifference: wrap, entry, exit, boundaryMotion, rank: Math.max(...scores) + scores.reduce((a, b) => a + b) / 3 + .15 * boundaryMotion });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  if (!candidates.length) throw new Error('No candidate retaining at least 4.5 seconds.');
  const outRoot = join(root, 'work/qa/idle-loop-media'), out = join(outRoot, options.get('output'));
  await mkdir(outRoot, { recursive: true }); await mkdir(out);
  const best = candidates[0];
  const report = {
    status: 'candidate-cuts-awaiting-visual-review', createdAt: new Date().toISOString(), input: inputRelative.split('\\').join('/'), kit: options.get('kit'), sourceBundle: kit.sourceBundle,
    loop: { width: loop.width, height: loop.height, duration: loop.duration, frames: loop.frames.length, sha256: loop.sha256, frameTimesSeconds: loop.times },
    original: { wrapDifference: score(loop.frames.at(-1), loop.frames[0]), adjacentChanges: loop.frames.slice(1).map((frame, i) => ({ toFrame: i + 1, time: loop.times[i + 1], difference: score(loop.frames[i], frame) })) },
    best, candidates: candidates.slice(0, 20),
    existing: { spatialTreatment: options.get('alignment') ?? 'none', incoming: { file: 'user-work.mp4', sha256: incoming.sha256, frames: incoming.frames.length, times: incoming.times }, outgoing: { file: 'work-user.mp4', sha256: outgoing.sha256, frames: outgoing.frames.length, times: outgoing.times } },
    notes: 'Different endpoints remain different images. Matching is a diagnostic at 320x180, with .55 head / .20 hands / .25 full-frame mean absolute RGB difference. No account calls, motion interpolation, face warp or source overwrite.'
  };
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await command('ffmpeg', ['-v', 'error', '-n', '-i', input, '-vf', `select=eq(n\\,0)+eq(n\\,${loop.frames.length - 1}),scale=960:540,tile=2x1`, '-frames:v', '1', join(out, 'raw-first-last.png')]);
  await command('ffmpeg', ['-v', 'error', '-n', '-i', input, '-vf', `select=eq(n\\,${best.startFrame})+eq(n\\,${best.endFrameInclusive}),scale=960:540,tile=2x1`, '-frames:v', '1', join(out, 'candidate-first-last.png')]);
  for (const [name, other, leftFrame, rightFrame, leftInput, rightInput] of [
    ['return-to-loop', incoming, best.entry.frame, best.startFrame, join(bundle, 'user-work.mp4'), input],
    ['loop-to-user', outgoing, best.endFrameInclusive, best.exit.frame, input, join(bundle, 'work-user.mp4')]
  ]) {
    if (!other) throw new Error('Missing connection.');
    const leftAlignment = leftInput === input ? '' : alignmentFilter, rightAlignment = rightInput === input ? '' : alignmentFilter;
    await command('ffmpeg', ['-v', 'error', '-n', '-i', leftInput, '-i', rightInput, '-filter_complex', `[0:v]select=eq(n\\,${leftFrame}),${leftAlignment}scale=960:540[a];[1:v]select=eq(n\\,${rightFrame}),${rightAlignment}scale=960:540[b];[a][b]hstack=inputs=2`, '-frames:v', '1', join(out, name + '.png')]);
  }
  const interval = Math.max(1, Math.floor(loop.frames.length / 12));
  await command('ffmpeg', ['-v', 'error', '-n', '-i', input, '-vf', `select=not(mod(n\\,${interval})),scale=480:270,tile=4x4`, '-frames:v', '1', join(out, 'motion-filmstrip.png')]);
  await command('ffmpeg', ['-v', 'error', '-n', '-i', input, '-vf', `select=not(mod(n\\,${interval})),crop=360:240:700:390,scale=360:240,tile=4x4`, '-frames:v', '1', join(out, 'hands-filmstrip.png')]);
  await command('ffmpeg', ['-v', 'error', '-xerror', '-i', input, '-map', '0:v:0', '-f', 'null', '-']);
  report.sourceFullDecode = true; await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, original: report.original.wrapDifference, best }));
}
function bestMatch(reference, clip, candidates) { return candidates.map(candidate => ({ ...candidate, score: score(reference, clip.frames[candidate.frame]) })).sort((a, b) => a.score - b.score)[0]; }
function score(a, b) { return .55 * region(a, b, 190, 5, 85, 95) + .2 * region(a, b, 180, 112, 70, 28) + .25 * region(a, b, 0, 0, 320, 180); }
function region(a, b, x, y, width, height) { let sum = 0; for (let row = y; row < y + height; row++) for (let i = (row * 320 + x) * 3, end = i + width * 3; i < end; i++) sum += Math.abs(a[i] - b[i]); return sum / (width * height * 3); }
async function decode(file, spatialFilter = '') {
  const result = JSON.parse((await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-show_entries', 'stream=width,height,duration:frame=best_effort_timestamp_time', '-of', 'json', file])).toString());
  const video = result.streams[0], times = result.frames.map(frame => Number(frame.best_effort_timestamp_time)), duration = Number(video.duration);
  if (video.width !== 1280 || video.height !== 720 || !(duration >= 3 && duration <= 15) || times.length < 24 || times.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= times[i - 1]))) throw new Error('Expected existing short 720p footage.');
  const bytes = await command('ffmpeg', ['-v', 'error', '-i', file, '-vf', spatialFilter + 'scale=320:180:flags=area', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  const stride = 320 * 180 * 3;
  if (bytes.length !== times.length * stride) throw new Error('Decoded frames do not match timestamps.');
  return { width: video.width, height: video.height, times, duration, frames: times.map((_time, i) => bytes.subarray(i * stride, (i + 1) * stride)), sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}
function command(executable, args) { return new Promise((resolve, reject) => { const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), stdout = [], stderr = []; child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk)); child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(executable + ': ' + Buffer.concat(stderr).toString().slice(-2500)))); }); }
