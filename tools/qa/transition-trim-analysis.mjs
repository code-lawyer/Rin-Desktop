import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { validateTransitions } from '../../prototypes/video-companion/transition-catalog.mjs';

const args = process.argv.slice(2), root = resolve(import.meta.dirname, '../..');
if (!args.includes('--run') || args.includes('--help')) console.log('npm run qa:transition-trim -- --run --id=<existing-bundle>\nOffline scan of settled tails (last 1.5s) against opening 0.5s for the work/window/user demo. Exports both raw matches and candidates excluding the observed first 0.05s / last 0.15s boundary instability. Requires visual review; never edits source media or calls accounts.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });
async function main() {
  const id = args.find(arg => arg.startsWith('--id='))?.slice(5);
  if (args.length !== 2 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(id ?? '')) throw new Error('Specify --run and a valid --id.');
  const source = join(root, 'work/qa/three-state-preview', id);
  const manifest = validateTransitions(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
  const route = ['work-window.mp4', 'window-user.mp4', 'user-work.mp4'];
  const outputRoot = join(root, 'work/qa/transition-trim');
  const out = join(outputRoot, id + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(outputRoot, { recursive: true }); await mkdir(out);
  const clips = [];
  for (const file of route) {
    const entry = manifest.transitions.find(clip => clip.file === file);
    if (!entry) throw new Error('Missing route: ' + file);
    const path = join(source, file);
    const probe = JSON.parse((await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path])).toString());
    const times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
    const pixels = await command('ffmpeg', ['-v', 'error', '-i', path, '-vf', 'scale=320:180:flags=area', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    const stride = 320 * 180 * 3;
    if (pixels.length !== times.length * stride) throw new Error('Decoded frame count mismatch.');
    clips.push({ ...entry, times, hash: createHash('sha256').update(await readFile(path)).digest('hex'), frames: times.map((_time, index) => pixels.subarray(index * stride, (index + 1) * stride)) });
    console.log(file + ': decoded ' + times.length + ' frames');
  }
  const report = { createdAt: new Date().toISOString(), sourceBundle: id, sampleSize: [320, 180], scoreDefinition: '.55 head + .20 hands + .25 full-frame mean absolute RGB difference; numbers guide cuts and do not establish visual acceptance.', temporal: [], joins: [] };
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    const changes = clip.frames.slice(1).map((frame, i) => ({ fromFrame: i, toFrame: i + 1, atTime: clip.times[i + 1], ...compare(clip.frames[i], frame) }));
    report.temporal.push({ file: clip.file, changes });
    const indices = [0, 1, 3, 6, 9, 12, 84, 87, 90, 93, 95, 96].filter(i => i < clip.frames.length);
    const selection = indices.map(i => `eq(n\\,${i})`).join('+');
    await command('ffmpeg', ['-v', 'error', '-n', '-i', join(source, clip.file), '-vf', `select=${selection},scale=960:540,crop=300:360:540:0,tile=6x2`, '-frames:v', '1', join(out, `head-tail-${index + 1}.png`)]);
  }
  const plan = { schema: 'rin-transition-trim-v1', sourceBundle: id, visualReview: 'pending', clips: clips.map(clip => ({ file: clip.file, sourceSha256: clip.hash, startFrame: 0, endFrameInclusive: clip.times.length - 1 })) };
  for (let edge = 0; edge < clips.length; edge++) {
    const left = clips[edge], right = clips[(edge + 1) % clips.length];
    const baseline = compare(left.frames.at(-1), right.frames[0]), candidates = [];
    for (let end = 0; end < left.frames.length; end++) if (left.times[end] >= left.duration - 1.5) {
      for (let start = 0; start < right.frames.length && right.times[start] <= .5; start++) {
        candidates.push({ endFrame: end, endTime: left.times[end], startFrame: start, startTime: right.times[start], ...compare(left.frames[end], right.frames[start]) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    const guarded = candidates.filter(candidate => candidate.startTime >= .05 && candidate.endTime < left.duration - .15);
    const guardedBest = guarded[0];
    if (!guardedBest) throw new Error('No candidates after excluding observed unstable boundary frames.');
    const entry = { incoming: left.file, outgoing: right.file, baseline, best, reductionPercent: (1 - best.score / baseline.score) * 100, colorFitDiagnostic: colorFit(left.frames.at(-1), right.frames[0]), topCandidates: candidates.slice(0, 20), guardedBest, guardedCandidates: guarded.slice(0, 30), eventComparison: { windowSeconds: .5, original: boundaryEvent(left, right, left.frames.length - 1, 0), guarded: boundaryEvent(left, right, guardedBest.endFrame, guardedBest.startFrame) } };
    report.joins.push(entry);
    plan.clips[edge].endFrameInclusive = best.endFrame;
    plan.clips[(edge + 1) % clips.length].startFrame = best.startFrame;
    const filter = `[0:v]select=eq(n\\,${best.endFrame}),scale=1280:720[l];[1:v]select=eq(n\\,${best.startFrame}),scale=1280:720[r];[l][r]hstack=inputs=2`;
    await command('ffmpeg', ['-v', 'error', '-n', '-i', join(source, left.file), '-i', join(source, right.file), '-filter_complex', filter, '-frames:v', '1', join(out, `candidate-${edge + 1}.png`)]);
    const guardedFilter = `[0:v]select=eq(n\\,${guardedBest.endFrame}),scale=1280:720[l];[1:v]select=eq(n\\,${guardedBest.startFrame}),scale=1280:720[r];[l][r]hstack=inputs=2`;
    await command('ffmpeg', ['-v', 'error', '-n', '-i', join(source, left.file), '-i', join(source, right.file), '-filter_complex', guardedFilter, '-frames:v', '1', join(out, `guarded-${edge + 1}.png`)]);
    console.log(JSON.stringify({ edge: edge + 1, incoming: left.file, outgoing: right.file, best, reductionPercent: entry.reductionPercent }));
  }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(out, 'candidate-trim-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log('Output: ' + out);
}
function compare(a, b) {
  const full = region(a, b, 0, 0, 320, 180), head = region(a, b, 190, 5, 85, 95), hands = region(a, b, 180, 112, 70, 28);
  return { score: head * .55 + hands * .2 + full * .25, full, head, hands };
}
function region(a, b, x, y, width, height) {
  let sum = 0;
  for (let row = y; row < y + height; row++) for (let index = (row * 320 + x) * 3, end = index + width * 3; index < end; index++) sum += Math.abs(a[index] - b[index]);
  return sum / (width * height * 3);
}
// Diagnostic only: estimate a global per-channel affine match, without moving pixels.
// This is not applied to any source media, and cannot prove perceptual continuity.
function colorFit(target, source) {
  const coefficients = [], fitted = Buffer.alloc(source.length), count = source.length / 3;
  for (let channel = 0; channel < 3; channel++) {
    let x = 0, y = 0, xx = 0, xy = 0;
    for (let i = channel; i < source.length; i += 3) { x += source[i]; y += target[i]; xx += source[i] ** 2; xy += source[i] * target[i]; }
    const denominator = xx - x * x / count;
    const gain = denominator > 0 ? (xy - x * y / count) / denominator : 1;
    const offset = (y - gain * x) / count;
    coefficients.push({ gain, offset });
    for (let i = channel; i < source.length; i += 3) fitted[i] = Math.max(0, Math.min(255, Math.round(source[i] * gain + offset)));
  }
  return { coefficients, residual: compare(target, fitted) };
}
function boundaryEvent(left, right, end, start) {
  const scores = [{ kind: 'cut', score: compare(left.frames[end], right.frames[start]).score }];
  for (let i = 1; i <= end; i++) if (left.times[i - 1] >= left.times[end] - .5) scores.push({ kind: 'incoming-tail', frame: i, score: compare(left.frames[i - 1], left.frames[i]).score });
  for (let i = start + 1; i < right.frames.length && right.times[i] <= right.times[start] + .5; i++) scores.push({ kind: 'outgoing-head', frame: i, score: compare(right.frames[i - 1], right.frames[i]).score });
  return { peak: scores.reduce((a, b) => a.score > b.score ? a : b), scores };
}
function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [], errors = [];
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(executable + ': ' + Buffer.concat(errors).toString().slice(-2000))));
  });
}
