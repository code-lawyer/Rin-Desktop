import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseVersion, requireFreshDirectory, reserveFreshDirectory } from '../tools/release/release-inputs.mjs';

test('release preflight rejects mismatched and unsafe versions before creating output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rin-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'prototypes/live2d-codex'), { recursive: true });
  const set = (file, version) => writeFile(join(root, file), JSON.stringify({version}));
  await set('package.json', '0.5.0');
  await set('prototypes/live2d-codex/package.json', '0.4.0');
  await assert.rejects(releaseVersion(root), /must match/);
  await set('prototypes/live2d-codex/package.json', '0.5.0');
  assert.equal(await releaseVersion(root), '0.5.0');
  await set('package.json', '../existing');
  await assert.rejects(releaseVersion(root), /Invalid release version/);
});

test('only one concurrent build reserves the same package output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rin-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'packages', 'same-output');
  const results = await Promise.allSettled([reserveFreshDirectory(output), reserveFreshDirectory(output)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.match(results.find(result=>result.status==='rejected').reason.message,/already exists/);
});

test('release preflight preserves existing artifacts, including a partial previous build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rin-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'v0.5.0');
  await requireFreshDirectory(output);
  await mkdir(output);
  const artifact = join(output, 'existing.exe');
  await writeFile(artifact, 'preserve');
  await assert.rejects(requireFreshDirectory(output), /already exists/);
  await assert.rejects(requireFreshDirectory(artifact), /already exists/);
  assert.equal(await readFile(artifact, 'utf8'), 'preserve');
});
