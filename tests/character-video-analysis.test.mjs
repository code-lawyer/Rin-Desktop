import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseLookCatalog, analyzeFrames } from '../tools/qa/character-video-analysis.mjs';

test('default and explicit help never read media or invoke configured decoders', () => {
  for (const flags of [[], ['--run', '--help']]) {
    const output = execFileSync(process.execPath, ['tools/qa/character-video-analysis.mjs', '--root=missing-fixture', '--ffmpeg=missing-decoder', '--ffprobe=missing-probe', ...flags], { cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true });
    assert.match(output, /Default: help only/);
  }
});

test('downloaded catalog is parsed as literal JSON, including nested arrays and bracket text', () => {
  const records = [{ id: 'fixture', text: 'a ] and " quote', nested: [1, 2] }];
  assert.deepEqual(parseLookCatalog(`window.PURPLE_LOOKS = Object.freeze(${JSON.stringify(records)});\nwindow.next = 1;`), records);
  assert.deepEqual(parseLookCatalog(`window.PURPLE_LOOKS = Object.freeze(${JSON.stringify(records)}.map(look => Object.freeze({...look,dialogue:Object.freeze(look.dialogue)})));`), records);
  assert.throws(() => parseLookCatalog('window.PURPLE_LOOKS = Object.freeze([runExternalCode()]);'));
  assert.throws(() => parseLookCatalog('window.PURPLE_LOOKS = Object.freeze([1].map(runExternalCode));'));
});

test('temporal analysis distinguishes a mirrored sequence from forward motion', () => {
  const mirrored = [...Array.from({ length: 20 }, (_, i) => i * 10), ...Array.from({ length: 20 }, (_, i) => (19 - i) * 10)];
  const bytes = values => Buffer.from(values.flatMap(value => [0, value]));
  const result = analyzeFrames(bytes(mirrored), 2, 1, 0, 40);
  assert.equal(result.regions.rightHalf.bestReverseMatch.meanMAEPercent, 0);
  assert.equal(result.regions.rightHalf.firstLastMAEPercent, 0);
  assert.ok(result.regions.rightHalf.forwardHalfMeanMAEPercent > 10);
  const forward = analyzeFrames(bytes(Array.from({ length: 40 }, (_, i) => i * 5)), 2, 1, 0, 40);
  assert.ok(forward.regions.rightHalf.bestReverseMatch.meanMAEPercent > 20);
  assert.equal(forward.regions.rightHalf.runtimeBoundaryMAEPercent, 190 / 255 * 100);
});

test('out-of-range or truncated frame buffers cannot create misleading loop measurements', () => {
  assert.throws(() => analyzeFrames(Buffer.alloc(79), 2, 1, 0, 40));
  assert.throws(() => analyzeFrames(Buffer.alloc(80), 2, 1, -1, 39));
  assert.throws(() => analyzeFrames(Buffer.alloc(80), 2, 1, 20, 41));
});
