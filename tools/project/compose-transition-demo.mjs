import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { validateTransitions } from '../../prototypes/video-companion/transition-catalog.mjs';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) {
  console.log('npm run art:transition-demo -- --run --id=<4k-bundle> --output=<new-demo-id> [--trim-plan=<reviewed-analysis-id>]\nLocally concatenates work -> window -> user -> work with four-second endpoint holds. Optional reviewed-trim-plan.json comes from work/qa/transition-trim/<id>. No generation, paid services, blending or motion interpolation.');
} else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(id|output|trim-plan)=([a-zA-Z0-9][a-zA-Z0-9_-]{0,90})$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  if (!options.has('id') || !options.has('output')) throw new Error('Specify --id and --output.');
  const source = join(root, 'work/qa/three-state-preview', options.get('id'));
  const manifest = validateTransitions(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
  if (manifest.quality !== 'upscaled-4k') throw new Error('Expected the already prepared 4K bundle.');
  const trimPlan = options.has('trim-plan') ? JSON.parse(await readFile(join(root, 'work/qa/transition-trim', options.get('trim-plan'), 'reviewed-trim-plan.json'), 'utf8')) : null;
  if (trimPlan && (trimPlan.schema !== 'rin-transition-trim-v1' || trimPlan.sourceBundle !== options.get('id') || trimPlan.visualReview !== 'reviewed-for-preview' || !Array.isArray(trimPlan.clips) || trimPlan.clips.length !== 3 || new Set(trimPlan.clips.map(clip => clip.file)).size !== 3)) throw new Error('Trim plan must match this bundle and have reviewed cuts for exactly three clips.');
  const route = ['work', 'window', 'user', 'work'], fps = 60, hold = 4;
  const selected = [], inputs = [], timeline = [];
  let clock = hold;
  timeline.push({ kind: 'hold', state: 'work', start: 0, end: hold, source: 'First retained decoded frame of work-window.' });
  for (let index = 0; index < route.length - 1; index++) {
    const clip = manifest.transitions.find(item => item.from === route[index] && item.to === route[index + 1]);
    if (!clip) throw new Error('Missing required route.');
    const file = join(source, clip.file);
    const probe = await inspect(file), video = probe.streams.find(stream => stream.codec_type === 'video');
    if (video?.width !== 3840 || video?.height !== 2160 || Math.abs(Number(video.duration) - clip.duration) > .002) throw new Error('Unexpected input media: ' + clip.file);
    const times = await frameTimes(file);
    if (times.length !== Number(video.nb_read_frames) || times.some(time => Math.abs(time * fps - Math.round(time * fps)) > .0001)) throw new Error('Source timing does not fit the existing 60Hz clock.');
    const sha256 = digest(await readFile(file));
    const cut = trimPlan?.clips.find(item => item.file === clip.file);
    if (trimPlan && (!cut || cut.sourceSha256 !== sha256 || !Number.isInteger(cut.startFrame) || !Number.isInteger(cut.endFrameInclusive) || cut.startFrame < 0 || cut.endFrameInclusive >= times.length || cut.startFrame >= cut.endFrameInclusive)) throw new Error('Invalid trim or source hash mismatch: ' + clip.file);
    const startFrame = cut?.startFrame ?? 0, endFrameInclusive = cut?.endFrameInclusive ?? times.length - 1;
    const sourceStart = times[startFrame], sourceEndExclusive = times[endFrameInclusive + 1] ?? Number(video.duration);
    const duration = Math.round((sourceEndExclusive - sourceStart) * fps) / fps;
    inputs.push('-i', file);
    selected.push({ from: clip.from, to: clip.to, file: clip.file, sha256, frames: times.length, startFrame, endFrameInclusive, sourceStart, sourceEndExclusive, duration, motionStart: clock, frameTimesSeconds: times });
    timeline.push({ kind: 'transition', from: clip.from, to: clip.to, start: clock, end: clock + duration });
    clock += duration;
    timeline.push({ kind: 'hold', state: clip.to, start: clock, end: clock + hold, source: 'Last retained decoded frame of the preceding clip.' });
    clock += hold;
  }
  const outRoot = join(root, 'work/qa/transition-demo'), out = join(outRoot, options.get('output'));
  await mkdir(outRoot, { recursive: true }); await mkdir(out);
  const report = { status: 'rendering', createdAt: new Date().toISOString(), sourceBundle: options.get('id'), trimPlan: options.get('trim-plan') ?? null, route, holdSeconds: hold, expectedDuration: clock, outputFrameRate: fps, expectedFrames: Math.round(clock * fps), sources: selected, timeline,
    treatment: 'Hard concatenation and exact endpoint holds. 60Hz output repeats decoded source frames; no generated/interpolated motion, crossfade, alignment warp, furniture replacement, audio or new paid generation.' };
  const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await save();
  const filters = selected.map((clip, index) => {
    const trim = trimPlan ? `trim=start_frame=${clip.startFrame}:end_frame=${clip.endFrameInclusive + 1},setpts=PTS-STARTPTS,` : '';
    // Keep the retained last frame for its original display interval, then bound
    // the CFR segment explicitly; this avoids EOF rounding adding extra frames.
    const pad = trimPlan ? 'tpad=stop_mode=clone:stop=4,' : '';
    return `[${index}:v]${trim}fps=fps=60:round=near,${pad}trim=end_frame=${Math.round(clip.duration * fps)},setpts=PTS-STARTPTS,tpad=start_mode=clone:stop_mode=clone:start_duration=${index === 0 ? hold : 0}:stop_duration=${hold}[v${index}]`;
  });
  filters.push('[v0][v1][v2]concat=n=3:v=1:a=0[out]');
  const full = join(out, 'work-window-user-cycle-4k.mp4');
  const light = join(out, 'work-window-user-cycle-1080p.mp4');
  const encoding = ['-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-movflags', '+faststart'];
  console.log('Rendering ' + clock.toFixed(3) + ' seconds from existing clips.');
  await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-fps_mode', 'cfr', '-r', String(fps), '-enc_time_base:v', '1:60', ...encoding, full]);
  await ffmpeg(['-i', full, '-vf', 'scale=1920:1080:flags=lanczos', ...encoding, light]);
  report.outputs = [];
  for (const [file, width, height] of [[full, 3840, 2160], [light, 1920, 1080]]) {
    const result = await inspect(file), video = result.streams.find(stream => stream.codec_type === 'video');
    const times = await frameTimes(file);
    if (video.width !== width || video.height !== height || Number(video.nb_read_frames) !== report.expectedFrames || Math.abs(Number(video.duration) - clock) > .002 || times.some((time, index) => Math.abs(time - index / fps) > .000002)) throw new Error('Rendered timeline differs from the planned timeline.');
    await ffmpeg(['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
    report.outputs.push({ file: file === full ? 'work-window-user-cycle-4k.mp4' : 'work-window-user-cycle-1080p.mp4', width, height, frames: times.length, duration: Number(video.duration), decoded: true, bytes: (await stat(file)).size, sha256: digest(await readFile(file)) });
  }
  const joins = timeline.filter(item => item.kind === 'transition').slice(1).map(item => item.start);
  report.joins = [];
  for (let index = 0; index < joins.length; index++) {
    const atFrame = Math.round(joins[index] * fps), prefix = 'join-' + (index + 1);
    await ffmpeg(['-i', full, '-vf', `select=eq(n\\,${atFrame - 1})+eq(n\\,${atFrame}),scale=1280:720,tile=2x1`, '-frames:v', '1', join(out, prefix + '.png')]);
    report.joins.push({ atSeconds: joins[index], outgoingFrame: atFrame - 1, incomingFrame: atFrame, comparison: prefix + '.png' });
  }
  await ffmpeg(['-i', full, '-vf', 'select=not(mod(n\\,120)),scale=480:270,tile=5x3', '-frames:v', '1', join(out, 'timeline-filmstrip.png')]);
  report.status = 'rendered-and-decoded-awaiting-user-seam-review'; await save();
  console.log('Ready: ' + full);
  console.log('Light preview: ' + light);
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function inspect(file) { return JSON.parse(await command('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file])); }
async function frameTimes(file) { return JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file])).frames.map(frame => Number(frame.best_effort_timestamp_time)); }
function ffmpeg(args) { return command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args]); }
function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(executable + ': ' + stderr.slice(-3000))));
  });
}
