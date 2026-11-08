// Audition-only timing/effect variants; production defaults are unchanged.
import { PosePlayer } from '../../prototypes/live2d-codex/renderer/pose-player.mjs';
import { blinkAt } from '../../prototypes/live2d-codex/renderer/scene-motion.mjs';

const OPTIONS = [
  { id: 'a', name: '舒缓淡化', out: 0.6, hold: 0, in: 0.9, note: '人物渐变 · 背景清晰固定' },
  { id: 'b', name: '慢入淡化', out: 0.8, hold: 0.1, in: 1.5, note: '淡入更慢 · 背景清晰固定' },
  { id: 'c', name: '柔焦淡化', out: 0.9, hold: 0.1, in: 1.4, note: '整幅画面短暂柔焦' },
  { id: 'd', name: '夜色淡化', out: 0.9, hold: 0.2, in: 1.5, note: '整幅画面压暗后恢复' },
];
const width = 1280,
  height = 800,
  header = 60;
const stage = document.querySelector('#stage'),
  output = document.querySelector('#output');
output.width = width;
output.height = height + header;
const player = new PosePlayer(stage),
  context = output.getContext('2d', { alpha: false });
await player.load('/assets/');
player.resize(width, height, 1);
const smooth = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));

function frameAt(option, time) {
  if (time < 1.5) return { pose: 'cup', opacity: 1, progress: null, label: '持杯休息' };
  const returning = time >= 6,
    elapsed = time - (returning ? 6 : 1.5);
  const from = returning ? 'attention' : 'cup',
    to = returning ? 'work' : 'attention';
  const duration = option.out + option.hold + option.in;
  if (elapsed >= duration)
    return { pose: to, opacity: 1, progress: null, label: returning ? '专注工作' : '看向你' };
  const progress = elapsed / duration;
  if (elapsed < option.out)
    return { pose: from, opacity: 1 - smooth(elapsed / option.out), progress, label: '淡出' };
  if (elapsed < option.out + option.hold) return { pose: to, opacity: 0, progress, label: '短暂留白' };
  return {
    pose: to,
    opacity: smooth((elapsed - option.out - option.hold) / option.in),
    progress,
    label: '淡入',
  };
}

window.audition = {
  options: OPTIONS,
  player,
  health() {
    return { backend: 'WebGL2', glError: player.gl.getError() };
  },
  render(id, time) {
    const option = OPTIONS.find((value) => value.id === id);
    if (!option || !Number.isFinite(time) || time < 0) throw Error('Invalid audition frame');
    const frame = frameAt(option, time);
    player.render({ frame, blink: blinkAt(time), mouth: 0, gaze: [0, 0] });
    const envelope = frame.progress === null ? 0 : Math.sin(Math.PI * frame.progress);
    context.fillStyle = '#111923';
    context.fillRect(0, 0, width, height + header);
    context.save();
    context.beginPath();
    context.rect(0, header, width, height);
    context.clip();
    context.drawImage(stage, 0, header);
    if (id === 'c' && envelope > 0) {
      context.filter = `blur(${4 * envelope}px)`;
      context.drawImage(stage, 0, header);
      context.filter = 'none';
    }
    if (id === 'd' && envelope > 0) {
      context.fillStyle = `rgba(0,0,0,${0.65 * envelope})`;
      context.fillRect(0, header, width, height);
    }
    context.restore();
    context.fillStyle = '#f4ece3';
    context.font = 'bold 24px "Microsoft YaHei",sans-serif';
    context.fillText(`${id.toUpperCase()}  ${option.name}`, 24, 39);
    context.fillStyle = '#b8c5d4';
    context.font = '18px "Microsoft YaHei",sans-serif';
    context.fillText(`${(option.out + option.hold + option.in).toFixed(1)} 秒  ·  ${option.note}`, 250, 38);
    context.textAlign = 'right';
    context.fillText(frame.label, width - 24, 38);
    context.textAlign = 'left';
    return { frame, jpeg: output.toDataURL('image/jpeg', 0.94).split(',')[1] };
  },
};
