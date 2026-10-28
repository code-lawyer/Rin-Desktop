import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '../../prototypes/video-companion/catalog.mjs';

export const sampleScenes = [
  { id: 'idle', label: '陪伴', caption: '测试片段 A', file: 'look-sit-loop-01.webm', poster: 'look-sit-loop-01.jpg', fps: 60, loopStart: 9, loopEnd: 22.5 },
  { id: 'focus', label: '专注', caption: '测试片段 B', file: 'look-sit-loop-02.webm', poster: 'look-sit-loop-02.jpg', fps: 60, loopStart: 524 / 60, loopEnd: 1389 / 60 },
  { id: 'attention', label: '等待回应', caption: '测试片段 C', file: 'look-sit-loop-03.webm', poster: 'look-sit-loop-03.jpg', fps: 60, loopStart: 8, loopEnd: 1280 / 60 },
];
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
export async function importSample(source, destination) {
  const manifest = { version: 1, scenes: sampleScenes };
  validateManifest(manifest);
  const files = sampleScenes.flatMap(scene => [
    { from: resolve(source, 'media/1080p', scene.file), name: scene.file },
    { from: resolve(source, 'images', scene.poster), name: scene.poster },
  ]);
  // Preflight every file before copying. Existing different assets are never overwritten.
  for (const file of files) {
    file.sha256 = digest(await readFile(file.from));
    try {
      if (digest(await readFile(resolve(destination, file.name))) !== file.sha256) throw new Error(`Destination differs: ${file.name}`);
      file.exists = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  try {
    if (await readFile(resolve(destination, 'manifest.json'), 'utf8') !== manifestText) throw new Error('Existing manifest differs; choose an empty destination.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(destination, { recursive: true });
  for (const file of files) if (!file.exists) await copyFile(file.from, resolve(destination, file.name), 1 /* COPYFILE_EXCL */);
  try { await writeFile(resolve(destination, 'manifest.json'), manifestText, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return { count: files.length, assets: files.map(({ name, sha256 }) => ({ name, sha256 })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
  if (!source || process.argv.includes('--help')) console.log('Usage: npm run video:import -- --source="<local example folder>"\nCopies only three 1080p videos and their posters into the ignored local preview media directory. No source code or runtime is imported.');
  else {
    const destination = resolve(import.meta.dirname, '../../work/runtime/video-companion/media');
    const result = await importSample(resolve(source), destination);
    console.log(`Prepared ${result.count} local media files. Run npm run preview:video or npm run start:video.`);
  }
}
