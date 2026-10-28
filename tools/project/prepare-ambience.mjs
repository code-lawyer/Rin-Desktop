import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYBOARD_CLIPS, AMBIENT_DEFAULTS } from '../../prototypes/live2d-codex/renderer/ambient-preview.mjs';

const rate = 24000, channels = 2;
const expectedHashes = {
  'light-rain': '115c3dd4a37773f932c724a113aa5680ba1c145a4e337c4bdf2a59dc8e38151a',
  'soft-keyboard': '95400d1d7db88206f05d22bc967333ade66a937bdfaa807a8498b45a31daa57f',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', ...args], { windowsHide: true, maxBuffer: 100 * 1024 * 1024 });
const decode = (file, args = []) => {
  const bytes = ffmpeg(['-i', file, ...args, '-ar', String(rate), '-ac', String(channels), '-f', 'f32le', 'pipe:1']);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
};
function stats(data) {
  let sum = 0, peak = 0;
  for (const sample of data) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  return { rmsDbfs: 10 * Math.log10(sum / data.length), peakDbfs: 20 * Math.log10(peak) };
}
function quiet(data, reference = data) {
  const gain = 10 ** ((-29 - stats(reference).rmsDbfs) / 20), ceiling = 10 ** (-12 / 20);
  for (let i = 0; i < data.length; i++) data[i] = ceiling * Math.tanh(data[i] * gain / ceiling);
  return data;
}
function circularRain(data, overlapSeconds = 4) {
  const overlap = overlapSeconds * rate * channels, output = data.slice(overlap);
  for (let i = 0; i < overlap; i++) {
    const angle = Math.floor(i / channels) / (overlap / channels) * Math.PI / 2;
    const index = output.length - overlap + i;
    output[index] = output[index] * Math.cos(angle) + data[i] * Math.sin(angle);
  }
  // A short zero-ended envelope also protects the lossy codec's loop boundary.
  const feather = Math.round(rate * .005);
  for (let frame = 0; frame < feather; frame++) {
    const gain = .5 - .5 * Math.cos(Math.PI * frame / (feather - 1));
    for (let channel = 0; channel < channels; channel++) {
      output[frame * channels + channel] *= gain;
      output[output.length - (frame + 1) * channels + channel] *= gain;
    }
  }
  return output;
}
export function prepareAmbience({ rain, keys, output }) {
  const recordings = [
    { id: 'light-rain', input: rain, title: 'Medium Light Rain', author: 'Baconation', page: 'https://freesound.org/people/Baconation/sounds/592482/', download: 'https://cdn.freesound.org/previews/592/592482_10870880-hq.mp3', filters: 'highpass=f=400,lowpass=f=5500', selection: '20–84 s; 4 s circular equal-power overlap; 5 ms endpoint feather; 60 s output' },
    { id: 'soft-keyboard', input: keys, title: 'typing on laptop keyboard 1.wav', author: 'Sorinious_Genious', page: 'https://freesound.org/people/Sorinious_Genious/sounds/561102/', download: 'https://cdn.freesound.org/previews/561/561102_12517458-hq.mp3', filters: 'highpass=f=400,lowpass=f=4200', selection: 'Original timing; runtime plays only the listed short phrases, with 5–12 s pauses' },
  ];
  mkdirSync(output, { recursive: true });
  const result = [];
  for (const item of recordings) {
    if (hash(readFileSync(item.input)) !== expectedHashes[item.id]) throw new Error('Source does not match the reviewed CC0 recording; review provenance before replacing it');
    let data = decode(item.input, [...(item.id === 'light-rain' ? ['-ss', '20', '-t', '64'] : []), '-af', item.filters]);
    if (item.id === 'light-rain') {
      if (data.length !== 64 * rate * channels) throw new Error('Rain recording is incomplete');
      data = quiet(circularRain(data));
    } else {
      if (data.length < 33 * rate * channels) throw new Error('Keyboard recording is incomplete');
      const selected = KEYBOARD_CLIPS.flatMap(([start, length]) => Array.from(data.subarray(Math.round(start * rate) * channels, Math.round((start + length) * rate) * channels)));
      data = quiet(data, selected);
    }
    const target = join(output, item.id + '.ogg');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '4', '-y', target], { input: Buffer.from(data.buffer, data.byteOffset, data.byteLength), windowsHide: true });
    const measured = decode(target), metrics = stats(measured), bytes = readFileSync(target);
    if (!Number.isFinite(metrics.rmsDbfs) || metrics.peakDbfs > -9) throw new Error('Prepared ambience level check failed');
    if (item.id === 'light-rain') {
      metrics.loopBoundaryJump = Math.max(...Array.from({ length: channels }, (_, channel) => Math.abs(measured[channel] - measured[measured.length - channels + channel])));
      if (metrics.loopBoundaryJump > .02) throw new Error('Prepared rain has an abrupt loop boundary');
    }
    result.push({ file: item.id + '.ogg', title: item.title, author: item.author, sourcePage: item.page, sourceDownload: item.download, license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceSha256: hash(readFileSync(item.input)), sha256: hash(bytes), bytes: bytes.length, duration: measured.length / rate / channels, processing: { filters: item.filters, selection: item.selection, referenceRmsDbfs: -29, softPeakCeilingDbfs: -12, sampleRate: rate, channels }, measured: metrics });
  }
  const manifest = { version: 2, recordings: result, keyboardClips: KEYBOARD_CLIPS, defaultVolumes: AMBIENT_DEFAULTS, note: 'Signal checks do not establish subjective listening acceptance.' };
  writeFileSync(join(output, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log('Usage: npm run audio:prepare -- --run --rain=<downloaded-rain.mp3> --keys=<downloaded-keyboard.mp3>\nProcesses local CC0 recordings with FFmpeg; does not download or install anything.');
  else {
    const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (!option('rain') || !option('keys')) throw new Error('Both local source files are required');
    const output = resolve(import.meta.dirname, '../../prototypes/live2d-codex/assets/ambience');
    const result = prepareAmbience({ rain: resolve(option('rain')), keys: resolve(option('keys')), output });
    console.log(JSON.stringify(result, null, 2));
  }
}
