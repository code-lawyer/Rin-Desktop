import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunDirectory, writeRunReport, requireLiveRun } from './run-output.mjs';

// Parse data only. Downloaded JavaScript is never evaluated by this probe.
export function parseLookCatalog(source) {
  const match = /window\.PURPLE_LOOKS\s*=\s*Object\.freeze\s*\(/.exec(source);
  if (!match) throw new Error('Expected a literal PURPLE_LOOKS catalog.');
  const begin = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = begin; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) {
      const tail = source.slice(i + 1);
      const freezeOnly = tail.replace(/\s+/g, '').startsWith('.map(look=>Object.freeze({...look,dialogue:Object.freeze(look.dialogue)})));');
      if (!/^\s*\)\s*;/.test(tail) && !freezeOnly) throw new Error('Unexpected catalog wrapper.');
      const result = JSON.parse(source.slice(begin, i + 1));
      if (!Array.isArray(result)) throw new Error('Catalog must be an array.');
      return result;
    }
  }
  throw new Error('Unterminated catalog.');
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function analyzeFrames(bytes, width, height, start, end) {
  const size = width * height, count = bytes.length / size;
  if (![width, height, start, end, count].every(Number.isInteger) || width < 2 || height < 1 || start < 0 || end > count || end - start < 16) {
    throw new Error('Invalid decoded frame range.');
  }
  // A separate right-half result avoids letting the static background dominate.
  const measure = (a, b, rightHalf = false) => {
    let total = 0, samples = 0;
    for (let y = 0; y < height; y++) for (let x = rightHalf ? Math.floor(width / 2) : 0; x < width; x++) {
      const pixel = y * width + x;
      total += Math.abs(bytes[a * size + pixel] - bytes[b * size + pixel]); samples++;
    }
    return total / samples / 255 * 100;
  };
  const stride = Math.max(1, Math.floor((end - start) / 120));
  const regions = {};
  for (const [name, rightHalf] of [['wholeFrame', false], ['rightHalf', true]]) {
    const adjacent = [];
    for (let i = start; i < end - 1; i += stride) adjacent.push(measure(i, i + 1, rightHalf));
    const candidates = [];
    for (let offset = -4; offset <= 4; offset++) {
      const errors = [];
      for (let i = 4; i < Math.floor((end - start) / 2) - 4; i += stride) {
        const mirror = end - 1 - i + offset;
        if (mirror >= start && mirror < end) errors.push(measure(start + i, mirror, rightHalf));
      }
      candidates.push({ offset, meanMAEPercent: errors.reduce((a, b) => a + b, 0) / errors.length });
    }
    const half = Math.floor((end - start) / 2), forward = [];
    for (let i = 0; i < half - 4; i += stride) forward.push(measure(start + i, start + half + i, rightHalf));
    regions[name] = {
      firstLastMAEPercent: measure(start, end - 1, rightHalf),
      runtimeBoundaryMAEPercent: measure(start, end - 2, rightHalf),
      adjacentMedianMAEPercent: median(adjacent),
      forwardHalfMeanMAEPercent: forward.reduce((a, b) => a + b, 0) / forward.length,
      bestReverseMatch: candidates.sort((a, b) => a.meanMAEPercent - b.meanMAEPercent)[0],
    };
  }
  return { decodedFrames: count, startFrame: start, endFrameExclusive: end, regions };
}

async function main() {
  requireLiveRun('npm run qa:character-video -- --run --root="<downloaded Web wallpaper directory>"', 'read-only local FFmpeg analysis of catalog-defined companion loops; no network, accounts, browser or source changes');
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!option('root')) throw new Error('--root is required.');
  const root = resolve(option('root')), ffmpeg = option('ffmpeg') || 'ffmpeg', ffprobe = option('ffprobe') || 'ffprobe';
  const catalog = parseLookCatalog(await readFile(join(root, 'catalog.js'), 'utf8'));
  const sourceHashes = {};
  for (const file of ['catalog.js', 'app.js', 'index.html', 'project.json']) {
    sourceHashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  }
  const looks = catalog.filter(item => item.companion);
  if (!looks.length || looks.length > 12) throw new Error('Expected 1–12 explicitly defined companion clips.');
  const output = await createRunDirectory('character-video-analysis');
  const clips = [];
  for (const look of looks) {
    if (!/^[a-z0-9-]+$/.test(look.id)) throw new Error('Unsafe media identifier.');
    const file = join(root, 'media', '1080p', `look-${look.id}.webm`);
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,start_time', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
    const { startFrame: start, endFrame: end, fps } = look.companion;
    if (!Number.isInteger(fps) || fps < 1 || fps > 120 || Number(metadata.format.duration) > 60) throw new Error('Clip exceeds bounded offline analysis scope.');
    const bytes = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-an', '-vf', 'scale=160:90:flags=area,format=gray', '-fps_mode', 'passthrough', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, maxBuffer: 110 * 1024 * 1024, timeout: 120000 });
    const analysis = analyzeFrames(bytes, 160, 90, start, end);
    const frames = [0, start, Math.floor((start + end) / 2), end - 2];
    const select = frames.map(frame => `eq(n\\,${frame})`).join('+');
    const sheet = `${look.id}-sequence.png`;
    execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-an', '-vf', `select=${select},scale=480:270,tile=4x1`, '-frames:v', '1', '-update', '1', '-n', join(output, sheet)], { windowsHide: true, timeout: 120000 });
    clips.push({ id: look.id, name: look.name, file, sha256: createHash('sha256').update(await readFile(file)).digest('hex'), fileBytes: (await stat(file)).size, metadata, introSeconds: start / fps, loopSeconds: (end - start) / fps, analysis, contactSheet: { file: sheet, frames, nominalSeconds: frames.map(frame => frame / fps) } });
    console.log(JSON.stringify({ id: look.id, loopSeconds: (end - start) / fps, regions: analysis.regions, contactSheet: relative(process.cwd(), join(output, sheet)) }));
  }
  await writeRunReport(output, {
    scope: 'Decoded pixels and catalog-defined loop ranges only. Reduced grayscale MAE is a temporal diagnostic, not visual quality or identity acceptance. Reverse similarity can suggest ping-pong editing but cannot recover the authoring workflow. Frame indices are decode order; nominal seconds use catalog fps.',
    sourceRoot: root, sourceHashes, clips,
  });
  console.log(`Report: ${relative(process.cwd(), join(output, 'result.json'))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
