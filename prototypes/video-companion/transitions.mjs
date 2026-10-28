import { VideoDeck } from './video-deck.mjs';
import { TransitionPlayer } from './transition-player.mjs';
import { validateTransitions } from './transition-catalog.mjs';

class TransitionDeck extends VideoDeck {
  constructor(element) {
    super(element);
    this.failure = () => { if (element.error) this.onFailure?.(new Error('视频暂时无法播放。原画面已保留，请重新载入。')); };
    element.addEventListener('error', this.failure);
  }
  dispose() { this.element.removeEventListener('error', this.failure); super.dispose(); }
}
const status = document.querySelector('#status'), error = document.querySelector('#error');
const pause = document.querySelector('#pause'), retry = document.querySelector('#retry');
let player, manifest, setupPending = false;
const labels = new Map();
function render(snapshot) {
  const label = id => labels.get(id) || '画面';
  const active = snapshot.destination || snapshot.current;
  status.textContent = snapshot.phase === 'error' ? snapshot.current ? '画面已保留，等待重试' : '暂时无法载入画面'
    : snapshot.phase === 'paused' ? '已暂停'
    : snapshot.phase === 'loading' ? '正在准备画面…'
    : snapshot.phase === 'transition' ? ({ work: '正在回到工作', window: '正在望向窗外', user: '正在看向你' }[active] || '正在转身') + (snapshot.target !== active ? ' · 接下来' + label(snapshot.target) : '')
    : label(snapshot.current) + ' · 停留中';
  error.hidden = !snapshot.error; error.textContent = snapshot.error || '';
  retry.hidden = !snapshot.error;
  pause.textContent = snapshot.manualPaused ? '继续' : '暂停';
  pause.setAttribute('aria-pressed', String(snapshot.manualPaused));
  document.querySelectorAll('[data-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === snapshot.target)));
}
async function setup() {
  if (setupPending || player) return;
  setupPending = true; retry.hidden = true; error.hidden = true; status.textContent = '正在准备画面…';
  try {
    const response = await fetch('/manifest.json');
    if (!response.ok) throw new Error('素材暂时无法载入，请重新载入。');
    manifest = validateTransitions(await response.json());
    document.querySelector('#media-note').textContent = (manifest.quality === 'upscaled-4k' ? '4K 超分预览' : '720p 原片预览') + ' · 动作结束后停留 · 原片中的 AI 标识保留';
    const states = document.querySelector('#states'); states.replaceChildren();
    for (const state of manifest.states) {
      labels.set(state.id, state.label);
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.state = state.id; button.textContent = state.label;
      button.addEventListener('click', () => player.request(state.id)); states.append(button);
    }
    player = new TransitionPlayer({ decks: [...document.querySelectorAll('video')].map(element => new TransitionDeck(element)), manifest, onChange: render });
    player.setSuspended(document.hidden); pause.disabled = false;
    await player.start();
  } catch {
    status.textContent = '暂时无法开始预览'; error.hidden = false; error.textContent = '素材暂时无法载入，请重新载入。'; retry.hidden = false;
  } finally { setupPending = false; }
}
pause.addEventListener('click', () => player?.setPaused(!player.manualPaused));
retry.addEventListener('click', () => { if (player) player.retry(); else void setup(); });
document.addEventListener('visibilitychange', () => player?.setSuspended(document.hidden));
document.querySelector('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.stage').requestFullscreen(); }
  catch { error.hidden = false; error.textContent = '当前窗口不支持全屏，可放大预览窗口观看。'; }
});
window.addEventListener('pagehide', event => { if (event.persisted) player?.setSuspended(true); else player?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) player?.setSuspended(document.hidden); });
void setup();
