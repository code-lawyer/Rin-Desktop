export const ANIME_CLIPS = Object.freeze({
  'work-loop': ['01-work-idle', 'work', 'work', 'loop'],
  'work-attention': ['02-work-to-attention', 'work', 'attention', 'transition'],
  'attention-nod': ['03-attentive-nod', 'attention', 'attention', 'gesture'],
  'attention-wave': ['04-greeting-wave', 'attention', 'attention', 'gesture'],
  'attention-work': ['05-attention-to-work', 'attention', 'work', 'transition'],
  'work-cup': ['06-work-to-cup', 'work', 'cup', 'transition'],
  'cup-sip': ['07-cup-sip', 'cup', 'cup', 'gesture'],
  'cup-work': ['08-cup-to-work', 'cup', 'work', 'transition'],
  'attention-loop': ['09-attention-idle', 'attention', 'attention', 'loop'],
  'cup-loop': ['10-cup-idle', 'cup', 'cup', 'loop'],
});
export const ANIME_POSTERS = Object.freeze({ work: 'anchors/A.png', attention: 'anchors/B.png', cup: 'anchors/C.png' });
export function animeCatalog(value, base = 'app://local/assets/motion/anime/') {
  if (value?.format !== 1 || JSON.stringify(value.canvas) !== '[1024,640]' || value.fps !== 24
    || !Array.isArray(value.clips) || value.clips.length !== 10) throw new Error('动漫视频素材清单不完整。');
  const clips = new Map();
  for (const item of value.clips) {
    const definition = ANIME_CLIPS[item.id];
    if (!definition || clips.has(item.id) || item.file !== `assets/${definition[0]}.mp4`
      || !Number.isSafeInteger(item.frames) || item.frames < 12 || item.frames > 480) throw new Error('动漫视频片段信息无效。');
    const [, from, to, kind] = definition, duration = item.frames / value.fps;
    clips.set(item.id, { id: item.id, file: item.file, frames: item.frames, from, to, kind, duration, loopEnd: duration, fps: value.fps, src: base + item.file });
  }
  if (!Object.entries(ANIME_POSTERS).every(([key, name]) => value.posters?.[key] === name)
    || value.window?.file !== 'window-layer.webm' || JSON.stringify(value.window.placement) !== '[0,0,610,528]'
    || value.window.frames !== 768) throw new Error('动漫视频的首尾画面或窗雨位置无效。');
  return { clips, canvas: value.canvas, posters: Object.fromEntries(Object.entries(ANIME_POSTERS).map(([key, name]) => [key, base + name])),
    window: { ...value.window, src: base + value.window.file, loopEnd: value.window.frames / value.fps },
    files: [...clips.values()].map(clip => clip.file).concat(Object.values(ANIME_POSTERS), value.window.file) };
}

export function animeTarget(backend = {}, presentation = {}, idle = 'work') {
  if (presentation.capturing || presentation.speaking || backend.status === 'waiting' || presentation.chatVisible) return 'attention';
  const pose = presentation.stills?.stillPose;
  if (Object.hasOwn(ANIME_POSTERS, pose)) return pose;
  if (backend.busy || ['starting', 'working', 'stopping'].includes(backend.status)) return 'work';
  return idle === 'cup' ? 'cup' : 'work';
}

// Retain the old five-pose preference on disk while the three-state video
// renderer treats an unsupported pose as automatic, just like the selector.
export function animePresentation(presentation) {
  const pose = presentation.stills?.stillPose;
  return !pose || pose === 'auto' || Object.hasOwn(ANIME_POSTERS, pose) ? presentation
    : { ...presentation, stills: { ...presentation.stills, stillPose: 'auto' } };
}
