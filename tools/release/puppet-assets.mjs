import { readFile, lstat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { requireFreshDirectory } from './release-inputs.mjs';
import { POSE_FILES, POSE_SIZE, validatePoses } from '../../prototypes/live2d-codex/renderer/pose-assets.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const required = new Set(POSE_FILES);

// Gate the shipped files, independently of artwork quality and device acceptance.
export async function inspectPuppetAssets(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 4 ||
    manifest.renderer !== 'complete-pose-dissolve' ||
    JSON.stringify(manifest.sourceSize) !== JSON.stringify([3840, 2400]) ||
    JSON.stringify(manifest.poseSize) !== JSON.stringify(POSE_SIZE) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== required.size
  )
    throw new Error('Invalid Rin character manifest');
  const names = new Set();
  for (const entry of manifest.assets) {
    if (
      !required.has(entry.file) ||
      names.has(entry.file) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      entry.bytes > 50_000_000 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error('Invalid Rin asset: ' + entry.file);
    names.add(entry.file);
    const file = join(directory, entry.file),
      info = await lstat(file);
    if (!info.isFile() || info.size !== entry.bytes || hash(await readFile(file)) !== entry.sha256)
      throw new Error('Rin asset integrity mismatch: ' + entry.file);
  }
  validatePoses(JSON.parse(await readFile(join(directory, 'poses.json'), 'utf8')));
  for (const file of POSE_FILES.filter((file) => file.endsWith('.png'))) {
    const size = file === 'scene.png' ? [3840, 2400] : file.includes('-') ? [512, 512] : POSE_SIZE;
    const bytes = await readFile(join(directory, file));
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(16) !== size[0] ||
      bytes.readUInt32BE(20) !== size[1]
    )
      throw new Error('Rin texture dimensions mismatch: ' + file);
  }
  await readFile(join(directory, 'README.md')); // Artwork terms must accompany the scene.
  return { manifest, names: [...names] };
}

export async function copyPuppetAssets(source, destination) {
  await requireFreshDirectory(destination);
  const { manifest, names } = await inspectPuppetAssets(source);
  await mkdir(destination, { recursive: true });
  for (const file of [...names, 'README.md'])
    await copyFile(join(source, file), join(destination, file), constants.COPYFILE_EXCL);
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx',
  });
  await inspectPuppetAssets(destination);
}
