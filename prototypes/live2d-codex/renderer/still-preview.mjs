import { StillSequence } from './still-sequence.mjs';
import { AmbientPreview, AMBIENT_DEFAULTS } from './ambient-preview.mjs';
const $ = id => document.getElementById(id);
const names = { work: '伏案工作', cup: '捧杯休息', thinking: '托腮思考', window: '侧身看雨', attention: '转身陪伴' };
const poses = Object.keys(names);
const cache = new Map(), audio = new AmbientPreview();
let autoTimer, paused = false, enabled = false, desired = 'work', soundRequest = 0;
const load = id => {
  if (!cache.has(id)) {
    const image = new Image(); image.src = `/media/${id}.png`;
    cache.set(id, image.decode().then(() => image).catch(error => { cache.delete(id); throw new Error('图片未能加载，请重试。', { cause: error }); }));
  }
  return cache.get(id);
};
const sequence = new StillSequence({ load, accept: id => Object.hasOwn(names, id),
  show(image) { $('base').src = image.src; },
  changed(id) {
    $('status').textContent = names[id]; document.body.dataset.pose = id;
    $('error').hidden = $('retry').hidden = true; audio.update({ pose: id });
  },
  failed(error) { $('error').textContent = error.message; $('error').hidden = $('retry').hidden = false; audio.update({ pose: sequence.current }); },
});
function select(id) {
  desired = id;
  for (const pose of poses) $(pose).setAttribute('aria-pressed', String(id === pose));
  return sequence.select(id);
}
function stopAuto() { clearInterval(autoTimer); autoTimer = null; $('auto').setAttribute('aria-pressed', 'false'); }
for (const id of poses) $(id).onclick = () => { stopAuto(); select(id); };
$('auto').onclick = () => {
  if (autoTimer) return stopAuto();
  $('auto').setAttribute('aria-pressed', 'true');
  autoTimer = setInterval(() => { if (!paused && !document.hidden) select(poses[(poses.indexOf(desired) + 1) % poses.length]); }, 5000);
};
$('pause').onclick = () => {
  paused = !paused; $('pause').textContent = paused ? '继续' : '暂停'; $('pause').setAttribute('aria-pressed', String(paused));
  sequence.setPaused(paused || document.hidden); audio.update({ paused });
};
$('retry').onclick = () => select(desired);
$('sound').onclick = async () => {
  const request = ++soundRequest;
  enabled = !enabled;
  $('sound').textContent = enabled ? '关闭声音' : '开启声音'; $('sound').setAttribute('aria-pressed', String(enabled));
  $('sound-status').textContent = enabled ? '正在载入小雨与轻敲录音…' : '声音已关闭。';
  document.body.dataset.audioState = enabled ? 'loading' : 'off';
  try {
    if (!enabled) { audio.update({ enabled: false }); return; }
    const ready = await audio.enable();
    if (request !== soundRequest || !ready) return;
    $('sound-status').textContent = '小雨与轻敲已开启，键盘会在工作姿态偶尔响起。';
    document.body.dataset.audioState = 'ready';
  } catch {
    if (request !== soundRequest) return;
    enabled = false; audio.update({ enabled: false }); $('sound').textContent = '开启声音'; $('sound').setAttribute('aria-pressed','false');
    $('sound-status').textContent = '声音未能载入，请再次点击开启声音重试。'; document.body.dataset.audioState = 'error';
  }
};
for (const [id,key] of [['rain','rainVolume'],['key','keyVolume']]) $(`${id}-volume`).oninput = () => {
  const value = Number($(`${id}-volume`).value); $(`${id}-value`).textContent = `${value}%`; audio.update({ [key]: value / 100 });
};
for (const [id,key] of [['capture','capturing'],['speaking','speaking']]) $(id).onclick = () => {
  const value = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', String(value)); audio.update({ [key]: value });
};
const panel = visible => { document.querySelector('.controls').hidden = !visible; $('show-panel').hidden = visible; };
$('hide-panel').onclick = () => panel(false); $('show-panel').onclick = () => panel(true);
$('show-panel').onmouseenter = () => panel(true);
document.addEventListener('keydown', event => { if (event.key === 'Escape') panel(true); });
$('fullscreen').onclick = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); };
document.addEventListener('visibilitychange', () => { sequence.setPaused(paused || document.hidden); audio.update({ hidden: document.hidden }); });
window.addEventListener('beforeunload', () => { stopAuto(); sequence.close(); audio.close(); });
audio.update({ pose: 'work', ...AMBIENT_DEFAULTS, enabled: false, hidden: document.hidden });
await select('work');
