import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { validateTransitions } from '../../prototypes/video-companion/transition-catalog.mjs';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('npm run art:idle-kit -- --run --source=<720p-bundle> --upscaled=<4k-bundle> --output=<new-kit-id>\nOffline selection of same-state anchors from existing clips, with frame matches and local prompts. No upload, account access, generation or source replacement. Candidates require visual review.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(source|upscaled|output)=([a-zA-Z0-9][a-zA-Z0-9_-]{0,90})$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  if (options.size !== 3) throw new Error('Specify source, upscaled and output bundle IDs.');
  const source = join(root, 'work/qa/three-state-preview', options.get('source'));
  const upscaled = join(root, 'work/qa/three-state-preview', options.get('upscaled'));
  const manifest = validateTransitions(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
  const hd = validateTransitions(JSON.parse(await readFile(join(upscaled, 'manifest.json'), 'utf8')));
  if (manifest.quality !== 'source-720p' || hd.quality !== 'upscaled-4k') throw new Error('Expected the existing 720p and upscaled 4K bundles.');
  const clips = [];
  for (const entry of manifest.transitions) {
    if (!hd.transitions.some(item => item.file === entry.file && item.from === entry.from && item.to === entry.to)) throw new Error('Bundles have different routes.');
    const path = join(source, entry.file), scaledPath = join(upscaled, entry.file);
    const probe = await inspect(path), scaledProbe = await inspect(scaledPath);
    const video = probe.streams[0], scaled = scaledProbe.streams[0];
    const times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
    const scaledTimes = scaledProbe.frames.map(frame => Number(frame.best_effort_timestamp_time));
    if (video.width !== 1280 || video.height !== 720 || scaled.width !== 3840 || scaled.height !== 2160 || times.length !== scaledTimes.length || times.some((time, i) => !Number.isFinite(time) || Math.abs(time - scaledTimes[i]) > .000002)) throw new Error('Source/upscaled frame correspondence is invalid.');
    const pixels = await command('ffmpeg', ['-v', 'error', '-i', path, '-vf', 'scale=320:180:flags=area', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
    const stride = 320 * 180 * 3;
    if (pixels.length !== times.length * stride) throw new Error('Unexpected decoded frame count.');
    clips.push({ ...entry, times, sha256: digest(await readFile(path)), upscaledSha256: digest(await readFile(scaledPath)), frames: times.map((_time, i) => pixels.subarray(i * stride, (i + 1) * stride)) });
  }
  const outputRoot = join(root, 'work/qa/idle-loop-kit'), out = join(outputRoot, options.get('output'));
  await mkdir(outputRoot, { recursive: true }); await mkdir(out);
  const report = { status: 'candidate-anchors-awaiting-visual-review', createdAt: new Date().toISOString(), sourceBundle: options.get('source'), upscaledBundle: options.get('upscaled'), scope: 'Three local anchor/prompt candidates; only a work-loop pilot is proposed for generation. No account calls.', method: 'Candidates are decoded source frames in 0.05–0.50s of a primary outgoing clip. Match all incoming tails (last 1.5s excluding last 0.15s) and outgoing heads (0.05–0.50s). Rank average plus worst weighted RGB difference at 320x180; not a perceptual pass/fail or exact alignment guarantee.', states: [] };
  for (const state of ['work', 'window', 'user']) {
    const primary = clips.find(clip => clip.from === state && clip.to === (state === 'user' ? 'work' : 'user'));
    const edges = clips.filter(clip => clip.from === state || clip.to === state);
    const candidates = [];
    for (let anchorFrame = 1; anchorFrame < primary.frames.length && primary.times[anchorFrame] <= .5; anchorFrame++) {
      if (primary.times[anchorFrame] < .05) continue;
      const anchor = primary.frames[anchorFrame];
      const matches = edges.map(clip => {
        const direction = clip.from === state ? 'outgoing' : 'incoming';
        const eligible = clip.times.map((time, frame) => ({ time, frame })).filter(item => direction === 'outgoing' ? item.time >= .05 && item.time <= .5 : item.time >= clip.duration - 1.5 && item.time < clip.duration - .15);
        if (!eligible.length) throw new Error('No settled-frame candidates for ' + clip.file);
        const sorted = eligible.map(item => ({ ...item, score: compare(anchor, clip.frames[item.frame]) })).sort((a, b) => a.score - b.score);
        return { file: clip.file, direction, ...sorted[0], originalBoundaryScore: compare(anchor, direction === 'outgoing' ? clip.frames[0] : clip.frames.at(-1)) };
      });
      const average = matches.reduce((sum, match) => sum + match.score, 0) / matches.length;
      candidates.push({ frame: anchorFrame, time: primary.times[anchorFrame], rank: average + Math.max(...matches.map(match => match.score)), matches });
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const selected = candidates[0];
    if (!selected) throw new Error('No anchor candidate.');
    const sourceImage = `${state}-anchor-720p.png`, upscaledImage = `${state}-anchor-upscaled-4k.png`;
    for (const [directory, file] of [[source, sourceImage], [upscaled, upscaledImage]]) await command('ffmpeg', ['-v', 'error', '-n', '-i', join(directory, primary.file), '-vf', `select=eq(n\\,${selected.frame})`, '-fps_mode', 'passthrough', '-frames:v', '1', join(out, file)]);
    const comparisons = [];
    for (let i = 0; i < selected.matches.length; i++) {
      const match = selected.matches[i], file = `${state}-connection-${i + 1}.png`;
      await command('ffmpeg', ['-v', 'error', '-n', '-i', join(out, sourceImage), '-i', join(source, match.file), '-filter_complex', `[0:v]scale=960:540[a];[1:v]select=eq(n\\,${match.frame}),scale=960:540[b];[a][b]hstack=inputs=2`, '-frames:v', '1', join(out, file)]);
      comparisons.push({ ...match, comparison: file });
    }
    const promptFile = `${state}-loop-prompt.txt`;
    await writeFile(join(out, promptFile), prompt(state));
    report.states.push({ state, primarySource: primary.file, sourceSha256: primary.sha256, upscaledSha256: primary.upscaledSha256, anchorFrame: selected.frame, anchorTime: selected.time, sourceImage, upscaledImage, sourceImageSha256: digest(await readFile(join(out, sourceImage))), firstLast: 'The identical sourceImage must occupy both ordered frame slots. No new reference image is generated.', proposedDurationSeconds: 6, proposedResolution: '720p', promptFile, connections: comparisons, alternatives: candidates.slice(1, 5) });
    console.log(JSON.stringify({ state, anchorSource: primary.file, frame: selected.frame, time: selected.time, connections: comparisons.map(match => ({ file: match.file, direction: match.direction, frame: match.frame, time: match.time, difference: match.score })) }));
  }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Prepared: ' + out);
}
function prompt(state) {
  const actions = {
    work: 'She remains focused on the laptop throughout. Both wrists stay supported near their original places. Use very small, anatomically coherent finger presses in two short, unhurried typing phrases with natural pauses; fingers remain above the same keys. Add subtle breathing and at most one natural blink near the middle. Her gaze stays down at the screen. Return the fingertips, shoulders, head, gaze and open eyelids gently to the exact supplied pose by the end.',
    window: 'She continues to look toward the window throughout. Add subtle breathing, at most one natural blink near the middle and a barely perceptible eye movement without changing her overall head direction. Both hands remain at their supplied resting positions on the laptop. Return her head, shoulders, gaze and open eyelids gently to the exact supplied pose by the end.',
    user: 'She continues to look calmly toward the person beyond the camera throughout. Add subtle breathing and at most one natural blink near the middle. Her lips remain closed with a neutral attentive expression; she is not talking. Hands stay at the supplied positions on the laptop. Return her head, shoulders, gaze and open eyelids gently to the exact supplied pose by the end.'
  };
  return `Create one 6-second photorealistic continuous idle shot for a desktop wallpaper. The ordered first and last reference images contain the EXACT SAME decoded frame from our existing video. Preserve this specific fictional adult East Asian woman, her face proportions, hair, wine-red blouse, seated body, crossed legs, hands, laptop, armchair, table, cup and rainy-window setting. Do not reinterpret her appearance.\n\n${actions[state]}\n\nThe shot is intended for a forward-playing seamless loop, not a transition to another pose. Maintain gentle natural activity between matching endpoints; do not make a frozen slideshow. Match both the visible endpoint pose and the near-zero motion at the loop boundary, without a snap or late correction to the reference. Keep camera, framing, furniture geometry, exposure, colors, window droplets and background completely fixed. Preserve the existing composition and any existing corner provenance mark. No head turn to a different target, body repositioning, speaking, camera movement, cuts, dissolves, reverse playback, new text, added objects, furniture movement or audio.\n`;
}
function compare(a, b) { return .55 * region(a, b, 190, 5, 85, 95) + .2 * region(a, b, 180, 112, 70, 28) + .25 * region(a, b, 0, 0, 320, 180); }
function region(a, b, x, y, width, height) {
  let sum = 0;
  for (let row = y; row < y + height; row++) for (let i = (row * 320 + x) * 3, end = i + width * 3; i < end; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (width * height * 3);
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
async function inspect(file) { return JSON.parse((await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-show_entries', 'stream=width,height:frame=best_effort_timestamp_time', '-of', 'json', file])).toString()); }
function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), stdout = [], stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(executable + ': ' + Buffer.concat(stderr).toString().slice(-2500))));
  });
}
