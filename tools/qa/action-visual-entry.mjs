import { ActionRig } from '../../prototypes/live2d-codex/renderer/action-rig.mjs';
import { ActionMotion } from '../../prototypes/live2d-codex/renderer/action-motion.mjs';
import { blinkAt, SCENE_GAZE } from '../../prototypes/live2d-codex/renderer/scene-motion.mjs';
const canvas = document.querySelector('canvas'),
  player = new ActionRig(canvas),
  motion = new ActionMotion();
await player.load('/assets/');
player.resize(1586, 992, 1);
let last = 0;
window.preview = {
  canvas,
  player,
  motion,
  render(time, overrides = {}) {
    const dt = Math.max(0, Math.min(0.1, time - last));
    last = time;
    const frame = motion.step(dt),
      pose = overrides.frame?.pose || frame.pose;
    player.render({
      time,
      frame,
      gaze: SCENE_GAZE[pose],
      blink: blinkAt(time),
      mouth: time > 46 ? Math.max(0, Math.sin(time * 9)) * 0.65 : 0,
      breath: Math.sin(time * 1.08) * 2.1,
      hair: Math.sin(time * 0.9) * 1.6,
      ...overrides,
    });
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
  },
};
preview.render(0);
