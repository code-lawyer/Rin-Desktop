// Verify a built or installed package without launching it or using accounts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createRunDirectory, writeRunReport } from './run-output.mjs';
import { inspectMotionAssets } from '../release/motion-assets.mjs';

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
assert.deepEqual(motion.manifest, sourceMotion.manifest, 'Packaged motion media differs from the current approved runtime files');
assert.equal(manifest.version, (await json(join(root, 'package.json'))).version);
assert.equal(manifest.version, (await json(join(directory, 'resources/app/package.json'))).version);
assert.equal(manifest.version, (await json(join(directory, 'resources/app/portable.json'))).version);
const names = new Set(), forbidden = /\.(onnx|safetensors|wav|pcm)$|(^|\/)(codex|claude|grok|opencode)\.exe$|^resources\/app\/(models|runtime\/qwen|agents)\/|(^|\/)(workspaces|session|auth|provider|appearance)\.json$/i;
let bytes = 0, sourceMatches = 0;
for (const entry of manifest.files) {
  const file = resolve(directory, entry.file), inside = relative(directory, file);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Unsafe package path');
  assert.ok(!names.has(entry.file) && !forbidden.test(entry.file), 'Unexpected or duplicate package file: ' + entry.file);
  names.add(entry.file);
  assert.equal((await stat(file)).size, entry.bytes, entry.file);
  assert.equal(await hash(file), entry.sha256, entry.file);
  bytes += entry.bytes;
  const local = entry.file.replace(/^resources\/app\//, '');
  if (entry.file !== local && /^(main\.cjs|preload\.cjs|voice-resources\.json|backend\/|renderer\/|dist\/)/.test(local)) {
    assert.equal(await hash(join(root, 'prototypes/live2d-codex', local)), entry.sha256, 'Source mismatch: ' + local);
    sourceMatches++;
  }
}
assert.ok(names.size > 100 && sourceMatches > 20);
assert.equal(bytes, manifest.bytes);
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
  for (const entry of previous.files.filter(item => /^resources\/app\/(assets\/|node_modules\/sherpa-onnx|backend\/speech-worker\.cjs$)/.test(item.file))) {
    assert.equal(await hash(join(directory,entry.file)), entry.sha256, 'Changed artwork or CPU speech component: ' + entry.file);
    preserved++;
  }
  assert.ok(preserved > 10);
}
const report = {version:manifest.version,files:names.size,bytes,sourceMatches,motionMediaFiles:motion.names.length,preservedArtworkAndCpuFiles:preserved,noModelsCredentialsOrCli:true,accounts:false,hardware:false,passed:true};
await writeRunReport(output,report);
console.log(JSON.stringify({output,...report}));
