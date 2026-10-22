import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import vm from 'node:vm';
import characters from '../../prototypes/live2d-codex/backend/character-profiles.cjs';
import { createRunDirectory, writeRunReport, requireLiveRun } from './run-output.mjs';

requireLiveRun('npm run qa:live2d-models -- --run', 'offline inspection of existing Cubism files; no GUI, accounts, audio, downloads or asset changes');
const root = resolve(import.meta.dirname, '../..');
const local = path => relative(root, path).replaceAll('\\', '/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const coreFile = resolve(root, 'prototypes/live2d-codex/vendor/live2dcubismcore.min.js');
const coreSource = await readFile(coreFile);
const context = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, atob, setTimeout, clearTimeout, performance });
vm.runInContext(coreSource.toString('utf8'), context, { filename: local(coreFile), timeout: 5000 });
const core = context.Live2DCubismCore;
const deadline = Date.now() + 10000;
let version;
while (!version) {
  try { version = core.Version.csmGetVersion(); } catch { /* Embedded WASM may still be initializing. */ }
  if (!version) {
    if (Date.now() >= deadline) throw new Error('Cubism Core initialization timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function snapshot(model) {
  return {
    vertices: model.drawables.vertexPositions.map(values => Array.from(values)),
    opacities: Array.from(model.drawables.opacities),
  };
}

function inspectParameter(model, index) {
  const parameters = model.parameters, attention = parameters.ids.indexOf('ParamAttention');
  const minimum = parameters.minimumValues[index], maximum = parameters.maximumValues[index];
  const samples = new Set([parameters.defaultValues[index], ...parameters.keyValues[index]]);
  for (let step = 0; step <= 4; step++) samples.add(minimum + (maximum - minimum) * step / 4);
  let vertexDelta = 0, opacityDelta = 0;
  const affected = new Set();
  // Check both visible poses, including their transition, so an invisible pose
  // at the default attention value does not hide an existing binding.
  for (const pose of attention < 0 ? [null] : [0, 0.5, 1]) {
    const reset = () => {
      parameters.values.set(parameters.defaultValues);
      if (attention >= 0 && attention !== index) parameters.values[attention] = pose;
    };
    reset(); model.update();
    const baseline = snapshot(model);
    for (const value of samples) {
      reset(); parameters.values[index] = value; model.update();
      for (let drawable = 0; drawable < model.drawables.count; drawable++) {
        let changed = false;
        for (let position = 0; position < baseline.vertices[drawable].length; position++) {
          const delta = Math.abs(model.drawables.vertexPositions[drawable][position] - baseline.vertices[drawable][position]);
          vertexDelta = Math.max(vertexDelta, delta);
          if (delta > 1e-6) changed = true;
        }
        const delta = Math.abs(model.drawables.opacities[drawable] - baseline.opacities[drawable]);
        opacityDelta = Math.max(opacityDelta, delta);
        if (changed || delta > 1e-6) affected.add(model.drawables.ids[drawable]);
      }
    }
  }
  return { id: parameters.ids[index], minimum, maximum, samples: [...samples], vertexDelta, opacityDelta, affectedDrawables: [...affected] };
}

const models = [];
const manifestArgument = process.argv.find(value => value.startsWith('--manifest='))?.slice('--manifest='.length);
const profiles = manifestArgument ? [{ id: 'custom', manifest: resolve(root, manifestArgument) }] : Object.values(characters.CHARACTERS);
for (const profile of profiles) {
  const manifestPath = profile.manifest ?? resolve(root, 'prototypes/live2d-codex/assets', profile.model, 'Generated_artwork.model3.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const mocPath = resolve(dirname(manifestPath), manifest.FileReferences.Moc);
  const bytes = await readFile(mocPath);
  const moc = core.Moc.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!moc) throw new Error(`Unable to load ${local(mocPath)}`);
  let model;
  try {
    model = core.Model.fromMoc(moc);
    if (!model) throw new Error(`Unable to create model from ${local(mocPath)}`);
    models.push({
      character: profile.id, manifest: local(manifestPath), moc: local(mocPath), sha256: hash(bytes),
      drawables: model.drawables.ids.map((id, i) => ({ id, vertexCount: model.drawables.vertexCounts[i] })),
      physics: manifest.FileReferences.Physics ?? null,
      motions: Object.keys(manifest.FileReferences.Motions ?? {}),
      parameters: model.parameters.ids.map((_, i) => inspectParameter(model, i)),
    });
  } finally { model?.release(); moc._release(); }
}
const directory = await createRunDirectory('live2d-models');
await writeRunReport(directory, {
  coreVersion: version, coreSha256: hash(coreSource), models,
  scope: 'Offline single-parameter samples against defaults at attention 0/0.5/1; compares vertices and opacity only. Does not validate rendered appearance, every multi-parameter combination, performance or new model quality.',
});
console.log(JSON.stringify({ report: local(resolve(directory, 'result.json')), models: models.map(model => ({ character: model.character, drawables: model.drawables.length, parameters: model.parameters.length, active: model.parameters.filter(parameter => parameter.affectedDrawables.length).map(parameter => parameter.id) })) }, null, 2));
