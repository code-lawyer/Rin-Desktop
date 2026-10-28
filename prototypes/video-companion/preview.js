import { validateManifest } from './catalog.mjs';
import { VideoCompanion } from './player.mjs';
import { VideoDeck } from './video-deck.mjs';
import { verifyVideoPlayback } from '../../tools/qa/video-companion-browser.mjs';

const el = id => document.getElementById(id);
const decks = ['deck-a', 'deck-b'].map(id => new VideoDeck(el(id)));
let scenes = [], testController, manifestFailure = null;
const player = new VideoCompanion({ decks, onChange: render });
const statusText = { empty: '准备中', loading: '正在载入', playing: '播放中', paused: '已暂停', error: '等待重试' };
function render(state = player.snapshot()) {
  const current = scenes.find(scene => scene.id === state.current);
  el('empty').hidden = Boolean(state.current);
  el('play-state').textContent = statusText[state.phase];
  el('scene-caption').textContent = current ? `${current.label} · ${current.caption}` : '动态陪伴';
  el('error').hidden = !state.error && !manifestFailure;
  el('error-text').textContent = state.error || manifestFailure || '';
  el('pause').textContent = state.manualPaused ? '继续播放' : '暂停';
  el('pause').setAttribute('aria-pressed', String(state.manualPaused));
  const testing = Boolean(testController);
  for (const id of ['pause', 'replay', 'near-boundary', 'simulate-error', 'run-tests']) el(id).disabled = !current || testing;
  el('retry').disabled = state.loading || testing;
  for (const button of el('scenes').children) {
    button.setAttribute('aria-pressed', String(button.dataset.scene === state.current));
    button.dataset.loading = String(button.dataset.scene === state.target && state.loading);
    button.disabled = testing;
  }
  el('metric-scene').textContent = current?.caption || '—';
  el('metric-time').textContent = `${state.time.toFixed(2)} s`;
  el('metric-loops').textContent = String(state.loops);
  el('metric-handoff').textContent = state.lastHandoffMs === null ? '—' : `${state.lastHandoffMs} ms`;
  el('summary-state').textContent = `${state.loops} 次循环 · ${statusText[state.phase]}`;
}
async function initialize() {
  try {
    const response = await fetch('/manifest.json'); const data = await response.json();
    if (!response.ok) throw new Error(data.error || '素材清单读取失败。');
    scenes = validateManifest(data).scenes; manifestFailure = null;
    el('scenes').replaceChildren(...scenes.map(scene => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = scene.label; button.dataset.scene = scene.id;
      button.addEventListener('click', () => player.select(scene)); return button;
    }));
    el('poster').src = scenes[0].posterUrl; el('poster').hidden = false;
    await player.select(scenes[0]);
  } catch (error) { manifestFailure = error.message; render(); }
}
el('pause').addEventListener('click', () => player.setPaused(!player.manualPaused));
el('replay').addEventListener('click', () => { if (player.current) player.select(player.current, { entry: true }); });
el('retry').addEventListener('click', () => manifestFailure ? initialize() : player.retry());
el('near-boundary').addEventListener('click', () => player.nearBoundary().catch(error => player.fail(error, 'loop')));
el('simulate-error').addEventListener('click', () => {
  const next = scenes[(scenes.findIndex(scene => scene.id === player.current?.id) + 1) % scenes.length];
  player.select(next, { sourceOverride: '/media/missing-test-video.webm' });
});
el('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await el('screen').requestFullscreen(); } catch { el('fullscreen').title = '当前窗口不支持全屏，可放大窗口预览。'; } });
el('run-tests').addEventListener('click', async () => {
  testController = new AbortController(); const controller = testController;
  el('qa-result').hidden = true; el('cancel-tests').hidden = false; render();
  const result = await verifyVideoPlayback({ player, scenes, decks, signal: controller.signal, progress: text => { el('qa-progress').textContent = text; } });
  el('qa-result').textContent = JSON.stringify(result, null, 2); el('qa-result').hidden = false;
  el('qa-progress').textContent = result.status === 'passed' ? `播放验证通过 · ${result.checks.length} 项检查 · ${result.durationSeconds} 秒` : `${result.status === 'cancelled' ? '验证已停止' : '验证未通过'}：${result.error}`;
  el('qa-result').dataset.status = result.status;
  testController = null; el('cancel-tests').hidden = true; render();
});
el('cancel-tests').addEventListener('click', () => testController?.abort());
document.addEventListener('visibilitychange', () => player.setSuspended(document.hidden));
window.addEventListener('pagehide', () => { testController?.abort(); player.close(); });
setInterval(() => render(), 250);
player.setSuspended(document.hidden); initialize();
