import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('npm run art:work-idle-demo -- --run --analysis=<reviewed-loop-report-id> --upscale=<existing-upscale-id> --output=<new-demo-id>\nUses reviewed-cut.json and verified existing 4K media. Shows three work loops, work-to-user, user-to-work, and three more loops; no frozen holds or new generation.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(analysis|upscale|output)=([a-zA-Z0-9][a-zA-Z0-9_-]{0,90})$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  if (options.size !== 3) throw new Error('Specify analysis, upscale and output.');
  const analysisDir = join(root, 'work/qa/idle-loop-media', options.get('analysis'));
  const analysis = JSON.parse(await readFile(join(analysisDir, 'report.json'), 'utf8'));
  const cut = JSON.parse(await readFile(join(analysisDir, 'reviewed-cut.json'), 'utf8'));
  if (cut.schema !== 'rin-work-idle-cut-v1' || cut.visualReview !== 'reviewed-for-comparison' || cut.loopSha256 !== analysis.loop.sha256) throw new Error('A reviewed, matching comparison cut is required.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(analysis.kit)) throw new Error('Invalid kit ID.');
  const kit = JSON.parse(await readFile(join(root, 'work/qa/idle-loop-kit', analysis.kit, 'report.json'), 'utf8'));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(kit.upscaledBundle)) throw new Error('Invalid existing 4K bundle ID.');
  const upscaleDir = join(root, 'work/qa/video-upscale', options.get('upscale'));
  const upscale = JSON.parse(await readFile(join(upscaleDir, 'report.json'), 'utf8'));
  if (!upscale.output?.frameTimesMatch || upscale.source.sha256 !== analysis.loop.sha256 || upscale.source.frameTimesSeconds.length !== analysis.loop.frames || upscale.source.frameTimesSeconds.some((time, i) => Math.abs(time - analysis.loop.frameTimesSeconds[i]) > .000002)) throw new Error('Upscale does not correspond to this generated loop.');
  const existingDir = join(root, 'work/qa/three-state-preview', kit.upscaledBundle);
  const definitions = [
    { key: 'loop', file: join(upscaleDir, 'upscaled-4k.mp4'), hash: upscale.output.sha256, start: cut.loopStartFrame, end: cut.loopEndFrameInclusive },
    { key: 'outgoing', file: join(existingDir, 'work-user.mp4'), hash: kit.states.find(item => item.primarySource === 'work-user.mp4')?.upscaledSha256, start: cut.outgoingStartFrame, end: cut.outgoingEndFrameInclusive },
    { key: 'incoming', file: join(existingDir, 'user-work.mp4'), hash: kit.states.find(item => item.primarySource === 'user-work.mp4')?.upscaledSha256, start: cut.incomingStartFrame, end: cut.incomingEndFrameInclusive }
  ];
  const fps = 60, sources = [];
  for (const definition of definitions) {
    const hash = digest(await readFile(definition.file));
    if (hash !== definition.hash) throw new Error('Media hash differs from the selected output.');
    const inspected = await inspect(definition.file), video = inspected.streams[0], times = inspected.frames.map(frame => Number(frame.best_effort_timestamp_time));
    if (video.width !== 3840 || video.height !== 2160 || times.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= times[i - 1]) || Math.abs(time * fps - Math.round(time * fps)) > .0001)) throw new Error('Invalid source dimensions/timing.');
    if (!Number.isInteger(definition.start) || !Number.isInteger(definition.end) || definition.start < 0 || definition.start >= definition.end || definition.end >= times.length) throw new Error('Invalid reviewed frame range.');
    const duration = Math.round(((times[definition.end + 1] ?? Number(video.duration)) - times[definition.start]) * fps) / fps;
    sources.push({ ...definition, path: relative(root, definition.file).split('\\').join('/'), hash, inputFrames: times.length, duration, outputFrames: Math.round(duration * fps) });
  }
  if (!['none', 'center-crop-1258x708'].includes(analysis.existing.spatialTreatment)) throw new Error('Unsupported spatial treatment.');
  const spatial = analysis.existing.spatialTreatment === 'center-crop-1258x708' ? 'crop=3774:2124:33:18:exact=1,scale=3840:2160:flags=lanczos,' : '';
  const outRoot = join(root, 'work/qa/work-idle-demo'), out = join(outRoot, options.get('output'));
  await mkdir(outRoot, { recursive: true }); await mkdir(out);
  const order = ['loop', 'loop', 'loop', 'outgoing', 'incoming', 'loop', 'loop', 'loop'];
  let cursor = 0;
  const timeline = order.map(key => { const source = sources.find(item => item.key === key); const segment = { kind: key, startFrame: cursor, endFrameExclusive: cursor + source.outputFrames, startSeconds: cursor / fps, endSeconds: (cursor + source.outputFrames) / fps }; cursor += source.outputFrames; return segment; });
  const report = { status: 'rendering', createdAt: new Date().toISOString(), analysis: options.get('analysis'), upscale: options.get('upscale'), fps, expectedFrames: cursor, expectedDuration: cursor / fps, timeline, sources: sources.map(({ file, ...source }) => source), spatialTreatment: analysis.existing.spatialTreatment, treatment: 'Forward playback, temporal trim, duplicated frames for the 60Hz display grid, and optional constant center crop of old transitions only. No frozen holds, reverse playback, blend, face warp, interpolation, new generation or main-app replacement. Cross-clip differences remain; comparison only.' };
  const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await save();
  const filters = sources.map((source, i) => `[${i}:v]trim=start_frame=${source.start}:end_frame=${source.end + 1},setpts=PTS-STARTPTS,${i ? spatial : ''}setsar=1,fps=60:round=near,tpad=stop_mode=clone:stop=4,trim=end_frame=${source.outputFrames},setpts=PTS-STARTPTS[${source.key}]`);
  filters.push('[loop]split=6[l0][l1][l2][l3][l4][l5]', '[l0][l1][l2][outgoing][incoming][l3][l4][l5]concat=n=8:v=1:a=0[out]');
  const encoding = ['-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-movflags', '+faststart'];
  const full = join(out, 'work-idle-roundtrip-4k.mp4'), preview = join(out, 'work-idle-roundtrip-1080p.mp4');
  console.log('Rendering ' + report.expectedDuration + ' seconds without frozen holds.');
  await ffmpeg([...sources.flatMap(source => ['-i', source.file]), '-filter_complex', filters.join(';'), '-map', '[out]', '-fps_mode', 'cfr', '-r', '60', '-enc_time_base:v', '1:60', ...encoding, full]);
  await ffmpeg(['-i', full, '-vf', 'scale=1920:1080:flags=lanczos', ...encoding, preview]);
  const cycle = join(out, 'work-loop-cycle-1080p.mp4'), repeats = join(out, 'work-loop-10x-1080p.mp4');
  await ffmpeg(['-i', preview, '-vf', `trim=end_frame=${sources[0].outputFrames},setpts=PTS-STARTPTS`, ...encoding, cycle]);
  await writeFile(join(out, 'loop-10x.ffconcat'), 'ffconcat version 1.0\n' + "file 'work-loop-cycle-1080p.mp4'\n".repeat(10));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(out, 'loop-10x.ffconcat'), '-c', 'copy', '-movflags', '+faststart', repeats]);
  report.outputs = [];
  for (const [file, width, height, expectedFrames] of [[full, 3840, 2160, cursor], [preview, 1920, 1080, cursor], [cycle, 1920, 1080, sources[0].outputFrames], [repeats, 1920, 1080, sources[0].outputFrames * 10]]) {
    const result = await inspect(file), video = result.streams[0], times = result.frames.map(frame => Number(frame.best_effort_timestamp_time));
    if (video.width !== width || video.height !== height || times.length !== expectedFrames || Math.abs(Number(video.duration) - expectedFrames / fps) > .002 || times.some((time, i) => Math.abs(time - i / fps) > .000002)) throw new Error('Rendered timing/dimensions mismatch.');
    await ffmpeg(['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
    report.outputs.push({ file: relative(out, file), width, height, frames: times.length, duration: Number(video.duration), decoded: true, bytes: (await stat(file)).size, sha256: digest(await readFile(file)) });
  }
  report.joins = [];
  for (let i = 1; i < timeline.length; i++) {
    const at = timeline[i].startFrame, name = 'join-' + i + '.png';
    await ffmpeg(['-i', preview, '-vf', `select=eq(n\\,${at - 1})+eq(n\\,${at}),scale=960:540,tile=2x1`, '-frames:v', '1', join(out, name)]);
    report.joins.push({ from: timeline[i - 1].kind, to: timeline[i].kind, atSeconds: at / fps, comparison: name });
  }
  await ffmpeg(['-i', preview, '-vf', 'select=not(mod(n\\,120)),scale=384:216,tile=5x4', '-frames:v', '1', join(out, 'timeline-filmstrip.png')]);
  report.status = 'rendered-and-decoded-awaiting-user-loop-and-join-review'; await save();
  console.log('Ready: ' + preview); console.log('Repeated loop: ' + repeats);
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
async function inspect(file) { return JSON.parse(await command('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-show_entries', 'stream=width,height,duration:frame=best_effort_timestamp_time', '-of', 'json', file])); }
function ffmpeg(args) { return command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args]); }
function command(executable, args) { return new Promise((resolve, reject) => { const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(executable + ': ' + stderr.slice(-2500)))); }); }
