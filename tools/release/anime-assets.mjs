import { readFile, lstat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, sep } from 'node:path';
import { animeCatalog, ANIME_POSTERS } from '../../prototypes/live2d-codex/renderer/anime-catalog.mjs';
import { requireFreshDirectory } from './release-inputs.mjs';

export async function verifyAnimeFile(directory, name, record) {
  if (!Number.isSafeInteger(record?.bytes) || record.bytes <= 0 || !/^[a-f0-9]{64}$/.test(record?.sha256)) throw new Error('动漫视频哈希记录无效：' + name);
  // Fixed catalogue paths are also checked component by component: no linked
  // directory can substitute another resource during import or packaging.
  const file = resolve(directory, name);
  if (!file.startsWith(resolve(directory) + sep)) throw new Error('动漫视频路径越界。');
  for (let parent = dirname(file); parent !== resolve(directory); parent = dirname(parent)) {
    const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('动漫素材目录不能是链接。');
  }
  const info = await lstat(file), hash = createHash('sha256');
  if (!info.isFile() || info.isSymbolicLink() || info.size !== record.bytes) throw new Error('动漫视频文件无效：' + name);
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  if (hash.digest('hex') !== record.sha256) throw new Error('动漫视频校验不一致：' + name);
}
export async function inspectAnimeAssets(directory, manifestDirectory = directory) {
  const source = JSON.parse(await readFile(join(manifestDirectory, 'manifest.json'), 'utf8'));
  const catalog = animeCatalog(source), names = catalog.files;
  if (!source.integrity || Object.keys(source.integrity).length !== names.length || Object.keys(source.integrity).some(name => !names.includes(name))) throw new Error('动漫视频需要且仅接受十四个运行媒体的哈希记录。');
  for (const name of names) await verifyAnimeFile(directory, name, source.integrity[name]);
  const manifest = { format: 1, canvas: [1024, 640], fps: 24,
    clips: [...catalog.clips.values()].map(({ id, file, frames }) => ({ id, file, frames })),
    posters: { ...ANIME_POSTERS }, window: { file: 'window-layer.webm', placement: [0, 0, 610, 528], frames: 768 },
    integrity: Object.fromEntries(names.map(name => [name, { bytes: source.integrity[name].bytes, sha256: source.integrity[name].sha256 }])) };
  return { directory: resolve(directory), names, manifest };
}
export async function copyAnimeAssets(source, destination) {
  await requireFreshDirectory(destination);
  const inspected = await inspectAnimeAssets(source);
  await mkdir(destination, { recursive: true });
  for (const name of inspected.names) {
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await copyFile(join(source, name), join(destination, name), constants.COPYFILE_EXCL);
    await verifyAnimeFile(destination, name, inspected.manifest.integrity[name]);
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(inspected.manifest, null, 2) + '\n', { flag: 'wx' });
  return inspected.manifest;
}
