import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import stills from '../../prototypes/live2d-codex/backend/still-settings.cjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const help = `Prepare review-only 4K female stills using the previously approved local recipe.
  npm run art:stills-4k -- --run --poses=work --id=work-review
  npm run art:stills-4k -- --run --poses=cup,thinking,window,attention --id=remaining-review
Optional: --gpu=1 --runtime=work/runtime/still-upscale
Requires local Real-ESRGAN ncnn Vulkan and FFmpeg. No automatic downloads.
Outputs a new directory under work/qa/still-4k; never replaces application assets.
Result: super-resolved 3840x2400, not native 4K artwork.`;
if (args.includes('--help') || !args.includes('--run')) {
  console.log(help);
} else {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(poses|id|gpu|runtime)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error(`Invalid or repeated argument: ${arg}`);
    options.set(match[1], match[2]);
  }
  const poses = options.get('poses')?.split(',') ?? stills.POSES;
  if (new Set(poses).size !== poses.length || poses.some(pose => !stills.POSES.includes(pose))) throw new Error('Choose existing female poses, each once.');
  const id = options.get('id') ?? new Date().toISOString().replaceAll(':', '-');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/.test(id)) throw new Error('Use a short directory name for --id.');
  const gpu = options.get('gpu');
  if (gpu !== undefined && !/^\d+$/.test(gpu)) throw new Error('--gpu must be a GPU index.');
  const runtime = resolve(root, options.get('runtime') ?? 'work/runtime/still-upscale');
  const executable = join(runtime, 'realesrgan-ncnn-vulkan.exe');
  const models = join(runtime, 'models');
  const assets = join(root, 'prototypes/live2d-codex/assets/stills');
  const manifest = JSON.parse(await readFile(join(assets, 'manifest.json'), 'utf8'));
  const sources = [];
  for (const pose of poses) {
    const file = `female-v2/${pose}.png`, path = join(assets, file);
    const info = await pngInfo(path), expected = manifest.images.find(image => image.file === file);
    if (!expected || info.sha256 !== expected.sha256 || info.width !== 1586 || info.height !== 992) throw new Error(`Approved source changed: ${pose}. Inspect before processing.`);
    sources.push({ pose, path, info });
  }
  // Validate the existing toolchain before creating any output directory.
  const toolFiles = [executable, join(models, 'realesrgan-x4plus.bin'), join(models, 'realesrgan-x4plus.param')];
  for (const file of toolFiles) await access(file);
  const ffmpegVersion = (await run('ffmpeg', ['-version'])).split(/\r?\n/)[0];
  const parent = join(root, 'work/qa/still-4k'), output = join(parent, id);
  await mkdir(parent, { recursive: true });
  await mkdir(output); // Refuse to overwrite an earlier run, including partial output.
  const toolHashes = Object.fromEntries(await Promise.all(toolFiles.map(async file => [file.split(/[\\/]/).at(-1), digest(await readFile(file))])));
  const report = {
    date: new Date().toISOString(), status: 'review-only',
    tool: { name: 'Real-ESRGAN ncnn Vulkan', release: 'v0.2.5.0 / 20220424', model: 'realesrgan-x4plus', hashes: toolHashes, ffmpegVersion },
    processing: { scale: 4, tile: 192, fit: '3837x2400 with 1px left and 2px right edge extension; no crop', blend: { superResolution: .65, originalLanczos: .35 }, faceRestoration: false, colorGrading: false },
    caveat: 'Super-resolved 4K output, not native 4K painting. SSIM is not an identity or anatomy verdict.',
    assets: [],
  };
  console.log(`Review output: ${output}`);
  for (const { pose, path, info } of sources) {
    console.log(`${pose}: super-resolution`);
    const raw = join(output, `${pose}-x4.png`), base = join(output, `${pose}-base.png`), ai = join(output, `${pose}-ai.png`), candidate = join(output, `${pose}.png`);
    const inference = await run(executable, ['-i', path, '-o', raw, '-n', 'realesrgan-x4plus', '-m', models, '-s', '4', '-t', '192', ...(gpu === undefined ? [] : ['-g', gpu]), '-j', '1:1:1']);
    await writeFile(join(output, `${pose}-upscale.log`), inference);
    const rawInfo = await pngInfo(raw);
    if (rawInfo.width !== info.width * 4 || rawInfo.height !== info.height * 4) throw new Error(`Unexpected super-resolution size for ${pose}.`);
    const fit = 'scale=3837:2400:flags=lanczos,format=gbrp,pad=3840:2400:1:0,fillborders=left=1:right=2:mode=smear,setsar=1';
    for (const [input, target] of [[path, base], [raw, ai]]) await ffmpeg(['-i', input, '-vf', fit, '-frames:v', '1', '-pix_fmt', 'rgb24', target]);
    await ffmpeg(['-i', ai, '-i', base, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_expr=A*0.65+B*0.35,format=rgb24[out]', '-map', '[out]', '-frames:v', '1', candidate]);
    const candidateInfo = await pngInfo(candidate);
    if (candidateInfo.width !== 3840 || candidateInfo.height !== 2400) throw new Error(`Unexpected final dimensions for ${pose}.`);
    const metrics = await run('ffmpeg', ['-hide_banner', '-i', path, '-i', candidate, '-filter_complex', '[0:v]format=gbrp[a];[1:v]crop=3837:2400:1:0,scale=1586:992:flags=lanczos,setsar=1,format=gbrp[b];[a][b]ssim', '-frames:v', '1', '-f', 'null', '-']);
    await writeFile(join(output, `${pose}-similarity.log`), metrics);
    for (const [name, filter] of [['overview', 'scale=960:600:flags=lanczos'], ['face', 'crop=900:850:2300:100'], ['hands', 'crop=1100:700:2050:1100'], ['rain', 'crop=760:720:220:380']]) {
      await ffmpeg(['-i', base, '-i', candidate, '-filter_complex', `[0:v]${filter},setsar=1[a];[1:v]${filter},setsar=1[b];[a][b]hstack=inputs=2[out]`, '-map', '[out]', '-frames:v', '1', join(output, `${pose}-${name}.png`)]);
    }
    report.assets.push({ pose, source: { file: `female-v2/${pose}.png`, ...info }, output: { file: `${pose}.png`, ...candidateInfo }, sourceResolutionSSIM: Number(metrics.match(/All:([\d.]+)/)?.[1]) || null });
    await writeFile(join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${pose}: ready ${candidateInfo.width}x${candidateInfo.height}; source-resolution SSIM ${report.assets.at(-1).sourceResolutionSSIM}`);
  }
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function pngInfo(path) {
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Not a PNG: ${path}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: digest(bytes) };
}
function ffmpeg(args) { return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args]); }
function run(command, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = chunk => { output += chunk.toString(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveResult(output) : reject(new Error(`${command} failed (${code}): ${output.slice(-6000)}`)));
  });
}
