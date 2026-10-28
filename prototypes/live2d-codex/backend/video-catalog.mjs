export function validateManifest(value, { mediaBase = '/media/' } = {}) {
  if (value?.version !== 1 || !Array.isArray(value.scenes) || !value.scenes.length) throw new Error('素材清单格式不正确。');
  const ids = new Set();
  const scenes = value.scenes.map(scene => {
    if (!/^[a-z][a-z0-9-]*$/.test(scene.id) || ids.has(scene.id)) throw new Error('素材标识无效或重复。');
    ids.add(scene.id);
    if (typeof scene.file !== 'string' || !/^[a-zA-Z0-9_-]+\.(webm|mp4)$/.test(scene.file) || typeof scene.poster !== 'string' || !/^[a-zA-Z0-9_-]+\.(jpg|png)$/.test(scene.poster)) throw new Error('素材文件名无效。');
    if (![scene.loopStart, scene.loopEnd, scene.fps].every(Number.isFinite) || scene.loopStart < 0 || scene.loopEnd - scene.loopStart < .5 || scene.fps < 1 || scene.fps > 120) throw new Error('循环区间无效。');
    return { id: scene.id, label: String(scene.label || scene.id), caption: String(scene.caption || ''), file: scene.file, poster: scene.poster, fps: scene.fps, loopStart: scene.loopStart, loopEnd: scene.loopEnd, src: `${mediaBase}${scene.file}`, posterUrl: `${mediaBase}${scene.poster}` };
  });
  return { version: 1, scenes };
}
