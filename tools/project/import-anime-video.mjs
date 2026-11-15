import { mkdir, copyFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { inspectAnimeAssets, verifyAnimeFile } from '../release/anime-assets.mjs';

const source = process.argv.find(value => value.startsWith('--source='))?.slice(9);
if (!process.argv.includes('--run') || !source) {
  console.log('用法：npm run art:anime-video -- --run --source=<动漫视频交付目录>\n按项目清单校验并导入 10 段动作、3 张首尾姿态和窗雨图层。已有不同内容不会被覆盖。');
} else {
  const directory = resolve(import.meta.dirname, '../../prototypes/live2d-codex/assets/motion/anime');
  const inspected = await inspectAnimeAssets(resolve(source), directory);
  // Validate the whole source and any existing destinations before copying.
  const missing = [];
  for (const name of inspected.names) {
    try { await lstat(join(directory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(name); continue; }
    await verifyAnimeFile(directory, name, inspected.manifest.integrity[name]);
  }
  for (const name of missing) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await copyFile(join(inspected.directory, name), join(directory, name), constants.COPYFILE_EXCL);
  }
  await inspectAnimeAssets(directory);
  console.log(`动漫动作视频已准备完整：${inspected.names.length} 个媒体文件；新增 ${missing.length} 个。`);
}
