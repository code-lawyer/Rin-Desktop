import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const help = [
  'Prepare a local 16:9 wallpaper video comparison with existing Real-ESRGAN and FFmpeg.',
  'npm run art:video-4k -- --run --input=work/qa/example/original-720p.mp4 --id=work-to-user --gpu=1 --tile=512',
  'Requires the existing work/runtime/still-upscale tool and x4plus model; never downloads.',
  'Accepts short 16:9 SDR clips (up to 15s plus one source clock tick, 1080p, 60fps); preserves decoded frame timestamps.',
  'Writes a new work/qa/video-upscale/<id> directory; never overwrites application assets.',
  '4K is super-resolved output, not native 4K detail. No face restoration or frame interpolation.',
].join('\n');

if (args.includes('--help') || !args.includes('--run')) console.log(help);
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(input|id|gpu|tile)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument: ' + arg);
    options.set(match[1], match[2]);
  }
  if (!options.has('input') || !options.has('id')) throw new Error('Specify --input and --id.');
  const id = options.get('id');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/.test(id)) throw new Error('Invalid output id.');
  const gpu = options.get('gpu');
  if (gpu !== undefined && !/^\d+$/.test(gpu)) throw new Error('GPU must be an index.');
  const tile = Number(options.get('tile') ?? 192);
  if (!Number.isInteger(tile) || tile < 32 || tile > 1024) throw new Error('Tile size must be between 32 and 1024.');
  const input = resolve(root, options.get('input'));
  const runtime = join(root, 'work/runtime/still-upscale');
  const executable = join(runtime, 'realesrgan-ncnn-vulkan.exe');
  const models = join(runtime, 'models');
  const expected = JSON.parse(await readFile(join(root, 'prototypes/live2d-codex/assets/stills/processing-v2-4k.json'), 'utf8')).tool.hashes;
  const hashes = {};
  for (const file of ['realesrgan-ncnn-vulkan.exe', 'realesrgan-x4plus.bin', 'realesrgan-x4plus.param']) {
    const path = file.endsWith('.exe') ? executable : join(models, file);
    await access(path);
    hashes[file] = digest(await readFile(path));
    if (hashes[file] !== expected[file]) throw new Error('Tool/model differs from the recorded version: ' + file);
  }
  const source = await probe(input);
  const video = source.streams.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Input has no video stream.');
  const rate = fraction(video.avg_frame_rate);
  const nominalRate = fraction(video.r_frame_rate);
  const duration = Number(video.duration ?? source.format.duration);
  const count = Number(video.nb_read_frames);
  const times = await frameTimes(input);
  if (!(video.width > 0 && video.width <= 1920 && video.height > 0 && video.height <= 1080)
    || Math.abs(video.width / video.height - 16 / 9) > .001
    || !(duration > 0 && duration <= 15 + 1 / nominalRate + .000001 && rate > 0 && rate <= 60 && Number.isInteger(count) && count > 0 && count <= 900)
    || !(nominalRate > 0 && nominalRate <= 120) || times.length !== count
    || times.some((time, index) => !Number.isFinite(time) || (index > 0 && time <= times[index - 1]))
    || times[0] !== 0 || !(duration > times.at(-1))) {
    throw new Error('Expected a short 16:9 clip with valid frame timestamps within the documented limits.');
  }
  if (video.sample_aspect_ratio && !['1:1', 'N/A'].includes(video.sample_aspect_ratio)) throw new Error('Non-square pixels require a separate conversion plan.');
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer)) throw new Error('HDR requires a separate color pipeline.');
  const ffmpegVersion = (await run('ffmpeg', ['-version'])).split(/\r?\n/)[0];
  const output = join(root, 'work/qa/video-upscale', id);
  await mkdir(join(root, 'work/qa/video-upscale'), { recursive: true });
  await mkdir(output);
  const frames = join(output, 'frames-720p'), enlarged = join(output, 'frames-x4');
  await mkdir(frames); await mkdir(enlarged);
  const original = join(output, 'original.mp4'), final = join(output, 'upscaled-4k.mp4');
  await copyFile(input, original);
  const sourceHash = digest(await readFile(input));
  if (digest(await readFile(original)) !== sourceHash) throw new Error('Source copy checksum mismatch.');
  const report = {
    status: 'processing', createdAt: new Date().toISOString(),
    source: { sha256: sourceHash, bytes: (await stat(input)).size, video, frameTimesSeconds: times },
    tool: { name: 'Real-ESRGAN ncnn Vulkan', model: 'realesrgan-x4plus', hashes, ffmpegVersion },
    settings: { scale: 4, tile, gpu: gpu ?? 'auto', target: [3840, 2160], resize: 'Lanczos', frameInterpolation: false, faceRestoration: false, aiBlend: 1, outputColor: 'SDR BT.709', codec: 'libx264', crf: 16 },
    caveat: 'Super-resolved output; geometry, identity and temporal quality require visual inspection.',
  };
  const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await save();
  console.log('Output: ' + output);
  console.log('Extracting ' + count + ' frames; retaining original timestamps.');
  await ffmpeg(['-i', original, '-map', '0:v:0', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', join(frames, 'frame-%06d.png')]);
  const names = (await readdir(frames)).filter(name => /^frame-\d{6}\.png$/.test(name)).sort();
  if (names.length !== count) throw new Error('Extracted frame count differs from source.');
  console.log('Upscaling frames with the existing x4plus model.');
  await run(executable, ['-i', frames, '-o', enlarged, '-n', 'realesrgan-x4plus', '-m', models, '-s', '4', '-t', String(tile), '-j', '1:1:1', '-f', 'png', ...(gpu === undefined ? [] : ['-g', gpu])], join(output, 'upscale.log'));
  const enhancedNames = (await readdir(enlarged)).filter(name => /^frame-\d{6}\.png$/.test(name)).sort();
  if (JSON.stringify(names) !== JSON.stringify(enhancedNames)) throw new Error('Enhanced sequence is incomplete.');
  for (const name of enhancedNames) {
    const bytes = await readFile(join(enlarged, name));
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(16) !== video.width * 4 || bytes.readUInt32BE(20) !== video.height * 4) {
      throw new Error('Invalid enhanced frame: ' + name);
    }
  }
  console.log('Encoding 4K output and comparison.');
  const encode = ['-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-color_range', 'tv', '-movflags', '+faststart'];
  const sequence = ['ffconcat version 1.0'];
  for (let i = 0; i < names.length; i++) {
    sequence.push("file 'frames-x4/" + names[i] + "'", 'option framerate ' + video.r_frame_rate, 'duration ' + ((times[i + 1] ?? duration) - times[i]).toFixed(9));
  }
  await writeFile(join(output, 'sequence.ffconcat'), sequence.join('\n') + '\n');
  const [clockNumerator, clockDenominator = '1'] = video.r_frame_rate.split('/');
  const timing = ['-fps_mode', 'vfr', '-enc_time_base:v', clockDenominator + ':' + clockNumerator];
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(output, 'sequence.ffconcat'), '-frames:v', String(count), '-vf', 'scale=3840:2160:flags=lanczos:out_color_matrix=bt709,setsar=1', ...timing, ...encode, final]);
  const rendered = await probe(final), renderedVideo = rendered.streams.find(stream => stream.codec_type === 'video');
  const renderedTimes = await frameTimes(final);
  if (renderedVideo.width !== 3840 || renderedVideo.height !== 2160 || Number(renderedVideo.nb_read_frames) !== count || Math.abs(fraction(renderedVideo.avg_frame_rate) - rate) > .001 || renderedTimes.length !== times.length || renderedTimes.some((time, index) => Math.abs(time - times[index]) > .000002)) {
    throw new Error('Final dimensions, frame count, rate or frame timestamps differ from the source.');
  }
  await ffmpeg(['-i', original, '-i', final, '-filter_complex', '[0:v]setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[a];[1:v]setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[b];[a][b]hstack=inputs=2:shortest=1[out]', '-map', '[out]', ...timing, ...encode, join(output, 'comparison-left-original-right-4k.mp4')]);
  const frameIndex = Math.min(count - 1, Math.floor(count / 2));
  const frameName = names[frameIndex];
  const baseFace = join(output, 'face-original-lanczos.png'), enhancedFace = join(output, 'face-upscaled.png');
  const faceCrop = 'crop=768:768:2368:128';
  await ffmpeg(['-i', join(frames, frameName), '-vf', 'scale=3840:2160:flags=lanczos,' + faceCrop, '-frames:v', '1', baseFace]);
  await ffmpeg(['-i', join(enlarged, frameName), '-vf', 'scale=3840:2160:flags=lanczos,' + faceCrop, '-frames:v', '1', enhancedFace]);
  await ffmpeg(['-i', baseFace, '-i', enhancedFace, '-filter_complex', '[0:v][1:v]hstack=inputs=2[out]', '-map', '[out]', '-frames:v', '1', join(output, 'face-comparison.png')]);
  report.status = 'processed-awaiting-visual-review';
  report.output = { file: 'upscaled-4k.mp4', sha256: digest(await readFile(final)), bytes: (await stat(final)).size, video: renderedVideo, frameTimesMatch: true };
  report.comparison = { left: 'Original displayed with Lanczos scaling', right: 'Real-ESRGAN x4plus then Lanczos to 4K', faceFrameIndex: frameIndex, faceTimeSeconds: times[frameIndex], faceRectAt4K: [2368, 128, 768, 768], faceInputs: 'Lossless decoded/source-enhanced frames before delivery encoding' };
  await save();
  await writeFile(join(output, 'README.md'), '# Wallpaper upscale trial\n\nOriginal source bytes are preserved in original.mp4. upscaled-4k.mp4 is 3840×2160, super-resolved with no interpolation or face restoration. The comparison video has the original on the left and enhanced output on the right, both displayed at 1920×1080. face-comparison.png uses the same middle frame and 4K-coordinate crop on both sides, before final delivery encoding. See report.json for parameters and checksums. Visual acceptance remains open.\n');
  console.log('Ready for visual review: ' + final);
}

function fraction(value) {
  const [numerator, denominator = '1'] = String(value).split('/');
  return Number(numerator) / Number(denominator);
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function probe(path) {
  return JSON.parse(await run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path]));
}
async function frameTimes(path) {
  const result = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', path]));
  return result.frames.map(frame => Number(frame.best_effort_timestamp_time));
}
function ffmpeg(args) { return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args]); }
function run(command, args, logPath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', async code => {
      try {
        if (logPath) await writeFile(logPath, output);
        if (code === 0) resolveResult(output);
        else reject(new Error(command + ' failed (' + code + '): ' + output.slice(-3000)));
      } catch (error) { reject(error); }
    });
  });
}
