import { readFile, lstat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { motionCatalog, MOTION_IDS } from '../../prototypes/live2d-codex/renderer/motion-catalog.mjs';
import { requireFreshDirectory } from './release-inputs.mjs';

const digest = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};

// This gate proves package completeness and byte identity, not art quality.
// Generation records, source masters and account responses are never copied.
export async function inspectMotionAssets(directory) {
  directory = resolve(directory);
  let source;
  try { source = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')); }
  catch { throw new Error('正式动态壁纸素材尚未准备：需要四段视频、两张回退图及锁定清单，不能构建发布包。'); }
  const catalog = motionCatalog(source);
  const clips = MOTION_IDS.map(id => {
    const { file, duration, fps } = catalog.clips.get(id);
    return { id, file, duration, fps };
  });
  const posters = { work: source.posters.work, user: source.posters.user };
  const names = clips.map(clip => clip.file).concat(Object.values(posters));
  if (new Set(names).size !== 6) throw new Error('四段视频和两张回退图必须使用独立文件。');
  if (!source.integrity || Object.keys(source.integrity).length !== 6
    || Object.keys(source.integrity).some(name => !names.includes(name))) throw new Error('动态壁纸需要且仅接受六个运行媒体的哈希记录。');
  const integrity = {};
  for (const name of names) {
    const record = source.integrity[name], file = join(directory, name);
    if (!Number.isSafeInteger(record?.bytes) || record.bytes <= 0 || !/^[a-f0-9]{64}$/.test(record?.sha256)) throw new Error('动态壁纸哈希记录无效：' + name);
    const info = await lstat(file);
    if (!info.isFile() || info.size !== record.bytes || await digest(file) !== record.sha256) throw new Error('动态壁纸文件缺失、被替换或校验不一致：' + name);
    integrity[name] = { bytes: record.bytes, sha256: record.sha256 };
  }
  return { directory, names, manifest: { format: 1, clips, posters, integrity } };
}

export async function copyMotionAssets(source, destination) {
  await requireFreshDirectory(destination);
  const inspected = await inspectMotionAssets(source);
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const name of inspected.names) {
    const file = join(destination, name);
    await copyFile(join(inspected.directory, name), file, constants.COPYFILE_EXCL);
    const record = inspected.manifest.integrity[name];
    if ((await lstat(file)).size !== record.bytes || await digest(file) !== record.sha256) throw new Error('复制期间动态壁纸发生变化：' + name);
  }
  // Publish the usable catalogue only after all six byte-for-byte copies pass.
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(inspected.manifest, null, 2) + '\n', { flag: 'wx' });
  return inspected.manifest;
}
