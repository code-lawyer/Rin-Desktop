import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const github = async args => (await execute('gh', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout;
const releaseTag = /^(?:v\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?|third-party-source-v\d+\.\d+\.\d+)$/;

export async function archiveThirdPartySource({ repository, sourceTag, sourceVersion, destinationId, destinationTag }, gh = github) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Use an owner/repository name.');
  if (!releaseTag.test(sourceTag ?? '')) throw new Error('Use an explicit source release tag, including its prerelease suffix.');
  if (!/^\d+\.\d+\.\d+$/.test(sourceVersion ?? '')) throw new Error('Use the CPU source archive version.');
  if (!/^[1-9]\d*$/.test(destinationId ?? '')) throw new Error('Use an existing destination release ID.');
  if (!releaseTag.test(destinationTag ?? '')) throw new Error('Use an explicit destination release tag, including its prerelease suffix.');
  const archive = `Third-Party-Corresponding-Source-${sourceVersion}.zip`;
  const api = async path => JSON.parse(await gh(['api', `repos/${repository}/${path}`]));
  const source = await api(`releases/tags/${sourceTag}`);
  const assets = source.assets?.filter(asset => asset.name === archive) ?? [];
  if (source.tag_name !== sourceTag || assets.length !== 1) throw new Error('The source release must contain exactly one matching archive.');
  const asset = assets[0];
  if (asset.state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') || !Number.isSafeInteger(asset.size) || asset.size <= 0)
    throw new Error('The source archive needs an uploaded state, SHA-256 digest and positive size.');
  const matches = candidate => candidate?.state === 'uploaded' && candidate.digest === asset.digest && candidate.size === asset.size;
  const destination = await api(`releases/${destinationId}`);
  if (String(destination.id) !== destinationId || destination.tag_name !== destinationTag) throw new Error('The destination release ID/tag does not match the requested target.');
  const existing = destination.assets?.filter(candidate => candidate.name === archive) ?? [];
  if (existing.length && (existing.length !== 1 || !matches(existing[0]))) throw new Error('A different destination archive already exists; nothing was overwritten.');
  if (!existing.length) {
    const base = resolve(tmpdir()), temporary = await mkdtemp(join(base, 'rin-source-archive-'));
    try {
      await gh(['release', 'download', sourceTag, '--repo', repository, '--pattern', archive, '--dir', temporary]);
      const file = join(temporary, archive), info = await stat(file), hash = createHash('sha256');
      for await (const bytes of createReadStream(file)) hash.update(bytes);
      if (info.size !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest) throw new Error('Downloaded source archive failed size/SHA-256 verification.');
      // Never clobber an existing asset, even if another run uploads concurrently.
      await gh(['release', 'upload', destinationTag, file, '--repo', repository]);
    } finally {
      if (!relative(base, temporary).startsWith('rin-source-archive-')) throw new Error('Unexpected temporary archive path.');
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const verified = await api(`releases/${destinationId}`);
  const copies = verified.assets?.filter(candidate => candidate.name === archive) ?? [];
  if (String(verified.id) !== destinationId || verified.tag_name !== destinationTag || copies.length !== 1 || !matches(copies[0]))
    throw new Error('The destination archive did not retain the expected size/SHA-256.');
  return { sourceTag, archive, destinationTag, destinationId, digest: asset.digest, size: asset.size, copied: !existing.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.log('Usage: npm run source:archive -- --run\nPublishes a verified source archive copy. Set GH_REPO, SOURCE_RELEASE_TAG, SOURCE_VERSION, DESTINATION_ID and DESTINATION_RELEASE_TAG; authenticate gh separately. Default: help only.');
    if (process.argv.length > 2 && !process.argv.includes('--help')) process.exitCode = 1;
  } else {
    const result = await archiveThirdPartySource({ repository: process.env.GH_REPO, sourceTag: process.env.SOURCE_RELEASE_TAG, sourceVersion: process.env.SOURCE_VERSION, destinationId: process.env.DESTINATION_ID, destinationTag: process.env.DESTINATION_RELEASE_TAG });
    console.log(JSON.stringify(result, null, 2));
  }
}
