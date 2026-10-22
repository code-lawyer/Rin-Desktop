import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export async function releaseVersion(root) {
  const read = async file => JSON.parse(await readFile(join(root, file), 'utf8')).version;
  const version = await read('package.json');
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version.');
  if (await read('prototypes/live2d-codex/package.json') !== version) throw new Error('Root and application versions must match before packaging.');
  return version;
}

export async function requireFreshDirectory(directory) {
  try { await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Output already exists; previous artifacts are preserved: ${directory}`);
}
