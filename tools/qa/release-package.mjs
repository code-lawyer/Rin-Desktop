// Verify a built or installed package without launching it or using accounts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRunDirectory, writeRunReport } from './run-output.mjs';
import { inspectMotionAssets } from '../release/motion-assets.mjs';
import { inspectPuppetAssets } from '../release/puppet-assets.mjs';
import { retiredWallpaperAsset, sourceAvatarAsset } from '../release/resource-assets.mjs';
import { readElectronFuses, PACKAGED_FUSES } from '../release/electron-fuses.mjs';
import { checkPackageGuides, inspectPackage } from '../release/manifest.mjs';
import { trackedPackageInputs } from '../release/package-inputs.mjs';
import { packageRenderer } from '../../prototypes/live2d-codex/scripts/build.mjs';
import catalog from '../../prototypes/live2d-codex/backend/agent-catalog.cjs';
import characters from '../../prototypes/live2d-codex/backend/character-profiles.cjs';

const option = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!option('package') || process.argv.includes('--help')) {
  console.log('node tools/qa/release-package.mjs --package=<directory> [--baseline=<old package>] [--output=work/qa/new-directory]');
  process.exit(option('package') ? 0 : process.argv.includes('--help') ? 0 : 1);
}
const root = resolve(import.meta.dirname, '../..'), directory = resolve(option('package'));
const output = await createRunDirectory('release-package', option('output'));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
const { files, bytes } = await inspectPackage(directory, { installed: true });
const actual = new Map(files.map(file => [file.file, file]));
await checkPackageGuides(directory, files);
const manifest = await json(join(directory, 'manifest.json'));
const motion = await inspectMotionAssets(join(directory, 'resources/app/assets/motion/female'));
const sourceMotion = await inspectMotionAssets(join(root, 'prototypes/live2d-codex/assets/motion/female'));
let puppetFiles = 0;
for (const name of characters.POSE_DIRECTORIES) {
  const assetPath = join('assets/scene', name);
  const puppet = await inspectPuppetAssets(join(directory, 'resources/app', assetPath));
  const sourcePuppet = await inspectPuppetAssets(join(root, 'prototypes/live2d-codex', assetPath));
  assert.deepEqual(puppet.manifest, sourcePuppet.manifest, 'Packaged character differs from the source rig: ' + name);
  puppetFiles += puppet.names.length;
}
assert.deepEqual(motion.manifest, sourceMotion.manifest, 'Packaged motion media differs from the current approved runtime files');
assert.equal(manifest.version, (await json(join(root, 'package.json'))).version);
assert.equal(manifest.version, (await json(join(directory, 'resources/app/package.json'))).version);
const portable = await json(join(directory, 'resources/app/portable.json'));
assert.equal(manifest.version, portable.version);
assert.equal(portable.backend, 'codex');
assert.deepEqual(portable.backends, Object.keys(catalog.AGENTS));
assert.deepEqual(portable.experimentalBackends, Object.keys(catalog.AGENTS).filter(id => catalog.AGENTS[id].experimental));
const names = new Set();
const tracked = new Set(trackedPackageInputs(root));
const bundles = new Map((await packageRenderer(tracked)).map(({ name, bytes }) => [`dist/${name}`, createHash('sha256').update(bytes).digest('hex')]));
// Source-owned asset metadata and READMEs intentionally updated since earlier
// baselines: verify them against current source, and compare all other assets
// to the baseline package byte-for-byte.
const revisedAssetMetadata = new Set(['assets/ambience/README.md']);
const wallpaperScripts = new Set(['scripts/wallpaper-host.ps1', 'scripts/wallpaper-pose-input.cs']);
const fuses = await readElectronFuses(join(directory, 'VibeVoice.exe'));
for (const [name, expected] of Object.entries(PACKAGED_FUSES)) {
  assert.equal(fuses.values[name], expected, `Unexpected Electron fuse state for ${name}: ${fuses.values[name]}`);
}
let sourceMatches = 0;
for (const entry of manifest.files) {
  assert.ok(!names.has(entry.file), 'Duplicate manifest file: ' + entry.file);
  assert.deepEqual(actual.get(entry.file), entry, 'Package contents mismatch: ' + entry.file);
  names.add(entry.file);
  const local = entry.file.replace(/^resources\/app\//, '');
  if (entry.file !== local && local.startsWith('dist/')) {
    assert.equal(bundles.get(local), entry.sha256, 'Unexpected or stale renderer bundle: ' + local);
    sourceMatches++;
  } else if (entry.file !== local && (/^(main\.cjs|preload\.cjs|voice-resources\.json|backend\/|renderer\/|assets\/ambience\/)/.test(local) || wallpaperScripts.has(local))) {
    assert.ok(tracked.has(local), 'Unexpected application source file: ' + local);
    assert.equal(await hash(join(root, 'prototypes/live2d-codex', local)), entry.sha256, 'Source mismatch: ' + local);
    sourceMatches++;
  }
}
for (const local of bundles.keys()) assert.ok(names.has(`resources/app/${local}`), 'Missing renderer bundle: ' + local);
for (const asset of revisedAssetMetadata) assert.ok(names.has('resources/app/' + asset), 'Missing asset metadata: ' + asset);
for (const script of wallpaperScripts) assert.ok(names.has('resources/app/' + script), 'Missing wallpaper helper: ' + script);
assert.ok(names.size > 100 && sourceMatches > 20);
assert.equal(names.size, files.length, 'Unlisted installed file');
assert.equal(bytes, manifest.bytes);
const licenseIndex = await json(join(directory, 'licenses/SOURCES.json'));
for (const { file } of licenseIndex) {
  const path = `licenses/${file}`;
  assert.ok(!sourceAvatarAsset(path) && (names.has(path) || files.some(entry => entry.file.startsWith(`${path}/`))), `Unexpected or missing package license: ${file}`);
}
let preserved = 0;
if (option('baseline')) {
  const previous = await json(join(resolve(option('baseline')), 'manifest.json'));
  for (const entry of previous.files.filter(item => /^resources\/app\/(assets\/|node_modules\/sherpa-onnx|backend\/speech-worker\.cjs$)/.test(item.file)
    && !sourceAvatarAsset(item.file)
    && !retiredWallpaperAsset(item.file.replace(/^resources\/app\/assets\//, ''))
    && !item.file.startsWith('resources/app/assets/motion/anime/')
    && !item.file.startsWith('resources/app/assets/stills/')
    && !item.file.startsWith('resources/app/assets/character-previews/')
    && !revisedAssetMetadata.has(item.file.replace(/^resources\/app\//, '')))) {
    assert.equal(await hash(join(directory,entry.file)), entry.sha256, 'Changed artwork or CPU speech component: ' + entry.file);
    preserved++;
  }
  assert.ok(preserved > 10);
}
const report = {version:manifest.version,files:names.size,bytes,sourceMatches,backends:portable.backends,claudeSdkSuppliedByUser:true,electronFusesHardened:true,motionMediaFiles:motion.names.length,animeVideoExcluded:true,sourceAvatarExcluded:true,puppetFiles,preservedArtworkAndCpuFiles:preserved,noModelsCredentialsOrCli:true,accounts:false,hardware:false,passed:true};
await writeRunReport(output,report);
console.log(JSON.stringify({output,...report}));
