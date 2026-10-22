import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import vm from 'node:vm';
import { createRunDirectory, writeRunReport, requireLiveRun } from './run-output.mjs';

requireLiveRun('npm run qa:halfbody:diagnose -- --run', 'offline diagnosis of the local ART-02 sample; no browser, accounts, GPU or asset changes');
const root = resolve(import.meta.dirname, '../..');
const artwork = resolve(root, 'artwork/female-halfbody-v1');
const assembly = await readFile(resolve(artwork, 'assemble.mjs'), 'utf8');
// This is an audit of this sample's literal placement table, not a JS evaluator.
// Reject changed syntax rather than execute authoring code or silently skip it.
const table = assembly.match(/const specs = \[([\s\S]*?)\n\];/)?.[1];
if (!table) throw new Error('The local sample placement table is unavailable.');
const rows = table.trim().split(/\r?\n/).map(line => JSON.parse(line.trim().replace(/,$/, '').replaceAll("'", '"')));
const transforms = [];
for (const [name, role, side, crop, x, y, width, height] of rows) {
  const png = await readFile(resolve(artwork, 'layers', `${name}.png`));
  if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) throw new Error(`Stale layer dimensions: ${name}`);
  const scaleX = width / crop[2], scaleY = height / crop[3];
  transforms.push({ name, role, side, crop, placed: [x, y, width, height], scaleX, scaleY, aspectChange: scaleX / scaleY });
}
const context = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, atob, setTimeout, clearTimeout, performance });
vm.runInContext(await readFile(resolve(root, 'prototypes/live2d-codex/vendor/live2dcubismcore.min.js'), 'utf8'), context, { timeout: 5000 });
const core = context.Live2DCubismCore;
const deadline = Date.now() + 10000;
while (true) {
  try { if (core.Version.csmGetVersion()) break; } catch { /* WASM initialization */ }
  if (Date.now() > deadline) throw new Error('Cubism initialization timed out');
  await new Promise(resolve => setTimeout(resolve, 20));
}
const bytes = await readFile(resolve(artwork, 'runtime/Generated_artwork.moc3'));
const moc = core.Moc.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
if (!moc) throw new Error('Could not load the sample MOC3.');
let model;
const poses = [];
try {
  model = core.Model.fromMoc(moc);
  if (!model) throw new Error('Could not instantiate the sample.');
  const indices = Object.fromEntries(model.parameters.ids.map((id, index) => [id, index]));
  const tracked = ['ArtMeshFace', 'ArtMeshEyewhiteL', 'ArtMeshEyewhiteR', 'ArtMeshMouthClose', 'ArtMeshTopwear'];
  let neutral;
  for (const [yaw, pitch] of [[0, 0], [-10, 0], [10, 0], [-45, 0], [45, 0], [-45, 20], [45, -20]]) {
    model.parameters.values.set(model.parameters.defaultValues);
    for (const [id, value] of Object.entries({ ParamAngleX: yaw, ParamAngleY: pitch, ParamBreath: 0, ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamMouthOpenY: 0 })) model.parameters.values[indices[id]] = value;
    model.update();
    const bounds = {};
    for (const id of tracked) {
      const i = model.drawables.ids.indexOf(id);
      if (i < 0) throw new Error(`Missing diagnostic mesh: ${id}`);
      const v = model.drawables.vertexPositions[i], xs = [], ys = [];
      for (let j = 0; j < v.length; j += 2) { xs.push(v[j]); ys.push(v[j + 1]); }
      const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
      bounds[id] = { width, height, aspect: width / height };
    }
    neutral ??= bounds;
    poses.push({ yaw, pitch, bounds, faceAspectRelativeToNeutral: bounds.ArtMeshFace.aspect / neutral.ArtMeshFace.aspect });
  }
} finally { model?.release(); moc._release(); }
const nonUniform = transforms.filter(t => Math.abs(Math.log(t.aspectChange)) > Math.log(1.05));
const report = {
  scope: 'Source placement aspect ratios and exported mesh bounds. Mesh bounds include transparent margins and are not anatomical landmarks. Neither this report nor triangle orientation checks establish visual quality.',
  assemblySha256: createHash('sha256').update(assembly).digest('hex'),
  mocSha256: createHash('sha256').update(bytes).digest('hex'),
  transforms, poses,
  sourceAspectPreservation: { tolerance: '5% (diagnostic alert, not an aesthetic standard)', passed: nonUniform.length === 0, flagged: nonUniform.map(t => t.name) },
  visualAcceptance: 'not-evaluated-by-this-probe; see the ART-02 ledger for human acceptance',
};
const output = await createRunDirectory('live2d-halfbody-diagnosis');
await writeRunReport(output, report);
console.log(JSON.stringify({ output: relative(root, output), sourceAspectPreservation: report.sourceAspectPreservation, transforms: nonUniform.map(({ name, scaleX, scaleY, aspectChange }) => ({ name, scaleX, scaleY, aspectChange })), poses: poses.map(({ yaw, pitch, faceAspectRelativeToNeutral }) => ({ yaw, pitch, faceAspectRelativeToNeutral })), visualAcceptance: report.visualAcceptance }, null, 2));
// Nonzero means the source-proportion gate is red; it is not a tool crash.
if (nonUniform.length) process.exitCode = 1;
