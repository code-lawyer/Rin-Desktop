export const VIDEO_SCENES = ['auto', 'idle', 'focus', 'attention'];
export function videoScene(state = {}, presentation = {}) {
  if (VIDEO_SCENES.includes(presentation.videoScene) && presentation.videoScene !== 'auto') return presentation.videoScene;
  if (state.connection === 'error' || state.status === 'error' || state.status === 'waiting') return 'attention';
  if (['starting', 'working', 'stopping'].includes(state.status)) return 'focus';
  return presentation.chatVisible ? 'attention' : 'idle';
}
export function videoAnchor(width, height, sourceWidth = 1920, sourceHeight = 1080) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const x = (width - sourceWidth * scale) / 2, y = (height - sourceHeight * scale) / 2;
  const fit = (value, size, offset) => Math.max(0, Math.min(1, (value * scale + offset) / size));
  return { x: fit(sourceWidth * .68, width, x), y: fit(sourceHeight * .23, height, y), left: fit(sourceWidth * .57, width, x), right: fit(sourceWidth * .78, width, x) };
}
