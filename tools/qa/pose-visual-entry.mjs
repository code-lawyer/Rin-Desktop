import { PosePlayer } from '../../prototypes/live2d-codex/renderer/pose-player.mjs';
import { PoseDissolve } from '../../prototypes/live2d-codex/renderer/pose-dissolve.mjs';
import { blinkAt } from '../../prototypes/live2d-codex/renderer/scene-motion.mjs';
const canvas = document.querySelector('canvas'),
  player = new PosePlayer(canvas);
await player.load('/assets/');
player.resize(1586, 992, 1);
let last = 0;
window.preview = {
  canvas,
  player,
  motion: new PoseDissolve('cup'),
  render(time, overrides = {}, format = 'image/png') {
    const dt = Math.max(0, Math.min(0.1, time - last));
    last = time;
    const frame = this.motion.step(dt);
    player.render({
      frame,
      blink: blinkAt(time),
      gaze: [0, 0],
      mouth: time > 4 && time < 7 ? Math.max(0, Math.sin(time * 9)) * 0.65 : 0,
      ...overrides,
    });
    return canvas.toDataURL(format, 0.94).split(',')[1];
  },
  pixels() {
    const gl = player.gl,
      pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  },
};
preview.render(0);
