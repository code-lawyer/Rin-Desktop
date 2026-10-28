export const MOTION_IDS = Object.freeze(['work-loop', 'work-user', 'user-loop', 'user-work']);
export function motionCatalog(value, base = 'app://local/assets/motion/female/') {
  if (value?.format !== 1 || !Array.isArray(value.clips) || value.clips.length !== 4) throw new Error('动态壁纸素材清单不完整。');
  const clips = new Map();
  for (const item of value.clips) {
    if (!MOTION_IDS.includes(item.id) || clips.has(item.id)
      || !/^[a-z0-9-]+\.mp4$/.test(item.file) || !Number.isFinite(item.duration) || item.duration <= .25 || item.duration > 20
      || !Number.isFinite(item.fps) || item.fps < 12 || item.fps > 120) throw new Error('动态壁纸片段信息无效。');
    clips.set(item.id, { ...item, src: base + item.file, loopEnd: item.duration,
      kind: item.id.endsWith('-loop') ? 'loop' : 'transition',
      from: item.id.split('-')[0], to: item.id.endsWith('-loop') ? item.id.split('-')[0] : item.id.split('-')[1] });
  }
  if (!value.posters || !['work', 'user'].every(key => /^[a-z0-9-]+\.png$/.test(value.posters[key]))) throw new Error('动态壁纸缺少回退画面。');
  return { clips, posters: Object.fromEntries(Object.entries(value.posters).map(([key, name]) => [key, base + name])) };
}

export function motionTarget(backend = {}, presentation = {}) {
  // Listening and narration always face the user, including a manually pinned work pose.
  if (presentation.capturing || presentation.speaking || backend.status === 'waiting') return 'user';
  const pose = presentation.stills?.stillPose;
  if (pose === 'attention') return 'user';
  if (pose === 'work') return 'work';
  return presentation.chatVisible ? 'user' : 'work';
}
