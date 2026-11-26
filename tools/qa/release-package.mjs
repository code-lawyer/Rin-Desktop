// Verify a built or installed package without launching it or using accounts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createRunDirectory, writeRunReport } from './run-output.mjs';
import { inspectMotionAssets } from '../release/motion-assets.mjs';
import { inspectPuppetAssets } from '../release/puppet-assets.mjs';
import { retiredWallpaperAsset, sourceAvatarAsset } from '../release/resource-assets.mjs';
import { readElectronFuses, PACKAGED_FUSES } from '../release/electron-fuses.mjs';
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
const names = new Set(), forbidden = /\.(onnx|safetensors|wav|pcm)$|(^|\/)(codex|claude|grok|agy|dsh|opencode)\.exe$|^resources\/app\/(models|runtime\/qwen|agents)\/|(^|\/)custom-agents\.json(?:\..*)?$|(^|\/)(workspaces|session|auth|provider|appearance)\.json$/i;
const retiredAgentFile = /(?:^|\/)(?:custom-agents|custom-agent-settings|agent-setup-prompt)\.mjs$|(?:^|\/)@anthropic-ai\/claude-agent-sdk(?:[-/]|$)/i;
// Source-owned asset metadata and READMEs intentionally updated since earlier
// baselines: verify them against current source, and compare all other assets
// to the baseline package byte-for-byte.
const revisedAssetMetadata = new Set(['assets/ambience/README.md']);
const wallpaperScripts = new Set(['scripts/wallpaper-host.ps1', 'scripts/wallpaper-pose-input.cs']);
const fuses = await readElectronFuses(join(directory, 'VibeVoice.exe'));
for (const [name, expected] of Object.entries(PACKAGED_FUSES)) {
  assert.equal(fuses.values[name], expected, `Unexpected Electron fuse state for ${name}: ${fuses.values[name]}`);
}
let bytes = 0, sourceMatches = 0;
for (const entry of manifest.files) {
  const file = resolve(directory, entry.file), inside = relative(directory, file);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Unsafe package path');
  assert.ok(!names.has(entry.file) && !forbidden.test(entry.file) && !retiredAgentFile.test(entry.file), 'Unexpected or duplicate package file: ' + entry.file);
  names.add(entry.file);
  assert.ok(!sourceAvatarAsset(entry.file), 'Source-only Live2D file in package: ' + entry.file);
  assert.equal((await stat(file)).size, entry.bytes, entry.file);
  assert.equal(await hash(file), entry.sha256, entry.file);
  bytes += entry.bytes;
  const local = entry.file.replace(/^resources\/app\//, '');
  assert.ok(!/^(assets\/motion\/anime\/|renderer\/anime-(catalog|player|wallpaper)\.mjs$)/.test(local), 'Experimental anime video must not be packaged: ' + entry.file);
  assert.ok(!/^assets\/livliv\//.test(local), 'Rejected split character must not be packaged: ' + entry.file);
  assert.ok(!/^assets\/(stills|character-previews)\//.test(local), 'Unused authoring artwork must not be packaged: ' + entry.file);
  assert.ok(!retiredWallpaperAsset(local.replace(/^assets\//, '')), 'Retired wallpaper in package: ' + entry.file);
  if (entry.file !== local && (/^(main\.cjs|preload\.cjs|voice-resources\.json|backend\/|renderer\/|dist\/)/.test(local) || revisedAssetMetadata.has(local) || wallpaperScripts.has(local))) {
    assert.equal(await hash(join(root, 'prototypes/live2d-codex', local)), entry.sha256, 'Source mismatch: ' + local);
    sourceMatches++;
  }
}
for (const asset of revisedAssetMetadata) assert.ok(names.has('resources/app/' + asset), 'Missing asset metadata: ' + asset);
for (const script of wallpaperScripts) assert.ok(names.has('resources/app/' + script), 'Missing wallpaper helper: ' + script);
assert.ok(names.size > 100 && sourceMatches > 20);
assert.equal(bytes, manifest.bytes);
const licenseIndex = await json(join(directory, 'licenses/SOURCES.json'));
assert.ok(licenseIndex.every(entry => !sourceAvatarAsset(`licenses/${entry.file}`)), 'Source-only Live2D entries in the package license index');
// Installed instructions must resolve locally or point to a public web page.
const guide = await readFile(join(directory, 'CLI-AGENTS.md'), 'utf8');
for (const [, target] of guide.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  if (/^(https?:|#)/i.test(target)) continue;
  const file = resolve(directory, target.split('#')[0]), inside = relative(directory, file);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Guide link escapes the package: ' + target);
  assert.ok((await stat(file)).isFile(), 'Missing packaged guide link: ' + target);
}
async function checkExtra(folder, prefix = '') {
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await checkExtra(join(folder,entry.name), name + '/');
    else if (name !== 'manifest.json' && !/^unins\d+\.(exe|dat|msg)$/i.test(name)) assert.ok(names.has(name), 'Unlisted installed file: ' + name);
  }
}
await checkExtra(directory);
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
