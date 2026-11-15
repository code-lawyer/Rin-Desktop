import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { archiveThirdPartySource } from '../tools/release/archive-third-party-source.mjs';

const options = { repository: 'example/project', sourceTag: 'v0.6.3-rc.4', sourceVersion: '0.3.1', destinationId: '42', destinationTag: 'v0.6.4-rc.1' };
function fixture({ corrupt = false, wrongTag = false, existing, badVerification = false, destinationTag = options.destinationTag } = {}) {
  const bytes = Buffer.from('synthetic corresponding source');
  const asset = { name: 'Third-Party-Corresponding-Source-0.3.1.zip', size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), state: 'uploaded' };
  const destination = { id: 42, tag_name: wrongTag ? 'wrong-target' : destinationTag, assets: existing ? [{ ...asset, ...(existing === 'different' ? { size: 1 } : {}) }] : [] };
  const calls = []; let downloads = '', uploaded = false;
  const gh = async args => {
    calls.push(args);
    if (args[0] === 'api') {
      if (args[1] === 'repos/example/project/releases/tags/v0.6.3-rc.4') return JSON.stringify({ tag_name: options.sourceTag, assets: [asset] });
      assert.equal(args[1], 'repos/example/project/releases/42');
      return JSON.stringify(uploaded && badVerification ? { ...destination, assets: [{ ...asset, digest: 'sha256:' + '0'.repeat(64) }] } : destination);
    }
    if (args[1] === 'download') {
      assert.equal(args[2], options.sourceTag); assert.equal(args[args.indexOf('--pattern') + 1], asset.name);
      downloads = args[args.indexOf('--dir') + 1]; await writeFile(join(downloads, asset.name), corrupt ? 'corrupt' : bytes); return '';
    }
    assert.equal(args[1], 'upload'); assert.equal(args[2], destination.tag_name);
    assert.equal(args.includes('--clobber'), false); assert.deepEqual(await readFile(args[3]), bytes);
    destination.assets.push({ ...asset }); uploaded = true; return '';
  };
  return { gh, calls, directory: () => downloads };
}

for (const destinationTag of ['v0.6.4-rc.1', 'third-party-source-v0.3.1']) test(`copies an older source archive from a prerelease to independent target ${destinationTag}`, async () => {
  const h = fixture({ destinationTag }), result = await archiveThirdPartySource({ ...options, destinationTag }, h.gh);
  assert.equal(result.copied, true); assert.equal(result.sourceTag, 'v0.6.3-rc.4'); assert.match(result.archive, /0\.3\.1\.zip$/);
  assert.equal(result.destinationTag, destinationTag);
  await assert.rejects(access(h.directory()), { code: 'ENOENT' });
});
test('matching destination is verified without downloading or uploading again', async () => {
  const h = fixture({ existing: 'same' }), result = await archiveThirdPartySource(options, h.gh);
  assert.equal(result.copied, false); assert.ok(h.calls.every(args => args[0] === 'api'));
});
for (const condition of ['corrupt', 'wrongTag', 'different']) test(`rejects ${condition} without publishing`, async () => {
  const h = fixture(condition === 'different' ? { existing: condition } : { [condition]: true });
  await assert.rejects(archiveThirdPartySource(options, h.gh));
  assert.equal(h.calls.some(args => args[1] === 'upload'), false);
  if (h.directory()) await assert.rejects(access(h.directory()), { code: 'ENOENT' });
});
test('a server-side digest mismatch cannot be reported as a successful copy', async () => {
  const h = fixture({ badVerification: true });
  await assert.rejects(archiveThirdPartySource(options, h.gh), /did not retain/);
});
test('unsafe source tags, versions and destinations are rejected before account access', async () => {
  for (const patch of [{ sourceTag: 'v1.0.0; echo bad' }, { sourceTag: '../tags/v1.0.0' }, { sourceVersion: '0.3.1/elsewhere' }, { destinationId: '42/other' }, { destinationTag: undefined }, { destinationTag: '--repo=wrong/target' }, { repository: 'wrong' }])
    await assert.rejects(archiveThirdPartySource({ ...options, ...patch }, () => assert.fail('must not call gh')));
});
