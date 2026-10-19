import './pixi-compat.js';
import { Application } from 'pixi.js';
import { Live2DModel } from '@jannchie/pixi-live2d-display/cubism4';
import { wallpaperState } from '../backend/wallpaper-state.cjs';
import { typingMotion } from './typing-motion.mjs';

export async function startWallpaper() {
  const host = document.getElementById('wallpaper-view'), api = window.companion;
  let backend = {}, presentation = {}, desired, look = 0, hands = 1, elapsed = 0;
  const app = new Application();
  await app.init({ resizeTo: host, resolution: window.devicePixelRatio || 1, autoDensity: true, backgroundAlpha: 1,
    background: '#111821', preference: 'webgl', preserveDrawingBuffer: true, gcActive: false });
  app.ticker.maxFPS = 30; host.appendChild(app.canvas);
  const model = await Live2DModel.from('app://local/assets/rainy-window-v2-4k/Generated_artwork.model3.json', { ticker: app.ticker, autoInteract: false });
  const internal = model.internalModel, originalDraw = internal.draw.bind(internal);
  internal.draw = gl => { internal.viewport[2] = gl.drawingBufferWidth; internal.viewport[3] = gl.drawingBufferHeight; originalDraw(gl); };
  app.stage.addChild(model);
  // The rig keeps its original coordinates; each scene texture is now 3840×2400.
  const natural = { width: 1586, height: 992 };
  let sceneScale = 1, origin = { x: 0, y: 0 };
  let reportedRenderSize = '';
  function reportReady() {
    if (host.dataset.ready !== 'true') return;
    const size = `${app.canvas.width}x${app.canvas.height}`;
    if (size === reportedRenderSize) return;
    reportedRenderSize = size;
    api.renderReady({ ready: true, kind: 'wallpaper', model: 'rainy-window-v2-4k',
      sourceWidth: 3840, sourceHeight: 2400, renderWidth: app.canvas.width, renderHeight: app.canvas.height });
  }
  function fit() {
    const density = window.devicePixelRatio || 1;
    app.renderer.resize(host.clientWidth, host.clientHeight, density);
    sceneScale = Math.max(host.clientWidth / natural.width, host.clientHeight / natural.height);
    origin = { x: (host.clientWidth - natural.width * sceneScale) / 2, y: (host.clientHeight - natural.height * sceneScale) / 2 };
    model.scale.set(sceneScale); model.position.set(origin.x, origin.y);
    const normalized = (value, dimension, offset) => Math.max(0, Math.min(1, (value * sceneScale + offset) / dimension));
    api.avatarAnchor({ x: normalized(1180, host.clientWidth, origin.x), y: normalized(250, host.clientHeight, origin.y), left: normalized(1065, host.clientWidth, origin.x), right: normalized(1310, host.clientWidth, origin.x) });
    rain.width = Math.round(host.clientWidth * density); rain.height = Math.round(host.clientHeight * density);
    host.dataset.renderWidth = String(app.canvas.width); host.dataset.renderHeight = String(app.canvas.height);
    app.render(); reportReady();
  }
  const rain = document.createElement('canvas'); rain.className = 'wallpaper-rain'; host.appendChild(rain);
  const ctx = rain.getContext('2d');
  // Only the unobstructed window panes receive moving drops.
  const panes = [{ x: 0, y: 0, w: 618, h: 805 }, { x: 660, y: 0, w: 305, h: 395 }];
  const drops = Array.from({ length: 44 }, (_, i) => ({ pane: i % 2, x: ((i * 73.13) % 101) / 101, y: ((i * 31.73) % 103) / 103, speed: .017 + (i % 5) * .006, length: 7 + i % 9 }));
  function drawRain(dt) {
    ctx.clearRect(0, 0, rain.width, rain.height); ctx.save();
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.translate(origin.x, origin.y); ctx.scale(sceneScale, sceneScale);
    for (const drop of drops) {
      const pane = panes[drop.pane]; drop.y = (drop.y + dt * drop.speed) % 1;
      const x = pane.x + drop.x * pane.w, y = pane.y + drop.y * pane.h;
      ctx.strokeStyle = 'rgba(190,215,232,0.16)'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - .5, y + drop.length); ctx.stroke();
    }
    ctx.restore();
  }
  function updateState() {
    desired = wallpaperState(backend, presentation);
    host.dataset.pose = desired.pose; host.dataset.typing = String(desired.typing); host.dataset.paused = String(desired.paused);
    if (desired.paused) app.ticker.stop(); else app.ticker.start();
  }
  internal.on('beforeModelUpdate', () => {
    const core = internal.coreModel;
    const typing = typingMotion(elapsed);
    core.setParameterValueById('ParamAttention', look);
    core.setParameterValueById('ParamSceneBreath', (Math.sin(elapsed * Math.PI * 2 / 5.8) + 1) / 2);
    core.setParameterValueById('ParamTypingLeft', hands * typing.left);
    core.setParameterValueById('ParamTypingRight', hands * typing.right);
  });
  app.ticker.add(ticker => {
    const dt = Math.min(.1, ticker.deltaMS / 1000); elapsed += dt;
    const ease = 1 - Math.exp(-dt * 8);
    look += ((desired?.pose === 'attention' ? 1 : 0) - look) * ease;
    hands += ((desired?.typing ? 1 : 0) - hands) * ease;
    drawRain(dt);
  }, undefined, 50);
  const unsubscribe = api.onPresentation(value => { presentation = value; updateState(); });
  const initial = await api.presentation(); if (initial.ok) presentation = initial.value;
  fit(); const observer = new ResizeObserver(fit); observer.observe(host); updateState();
  window.addEventListener('resize', fit);
  host.dataset.ready = 'true'; host.dataset.rig = 'fingertips-v2';
  reportReady();
  window.addEventListener('beforeunload', () => { unsubscribe(); observer.disconnect(); window.removeEventListener('resize', fit); app.destroy(true); });
  return { setBackendState(value) { backend = value; updateState(); } };
}
