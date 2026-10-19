import './pixi-compat.js';
import { Application } from 'pixi.js';
import { Live2DModel } from '@jannchie/pixi-live2d-display/cubism4';
import { measureAvatarAnchor } from './avatar-anchor.mjs';

export async function startAvatar() {
  const host = document.getElementById('avatar-canvas');
  const app = new Application();
  await app.init({ resizeTo: host, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), backgroundAlpha: 0,
    antialias: false, preference: 'webgl', preserveDrawingBuffer: true, premultipliedAlpha: true, gcActive: false });
  app.ticker.maxFPS = 30; host.appendChild(app.canvas);
  const model = await Live2DModel.from('app://local/assets/hiyori/Hiyori.model3.json', { ticker: app.ticker, autoInteract: false });
  // Adapted from Agent Avatar (MIT): Cubism needs physical pixels on Windows HiDPI.
  const internal = model.internalModel, draw = internal.draw.bind(internal);
  internal.draw = gl => {
    internal.viewport[2] = gl.drawingBufferWidth; internal.viewport[3] = gl.drawingBufferHeight;
    draw(gl);
  };
  app.stage.addChild(model);
  const localBounds = model.getLocalBounds();
  const natural = { x: localBounds.x, y: localBounds.y, width: localBounds.width, height: localBounds.height };
  let fitTimer, needsAnchor = true, anchorFrames = 3, lastAnchor;
  function fit() {
    needsAnchor = true; anchorFrames = 3;
    const factor = Math.min(host.clientWidth * .93 / natural.width, host.clientHeight * .98 / natural.height);
    model.scale.set(factor); model.position.set((host.clientWidth - natural.width * factor) / 2 - natural.x * factor, (host.clientHeight - natural.height * factor) / 2 - natural.y * factor);
    clearTimeout(fitTimer); fitTimer = setTimeout(fitVisibleModel, 250);
  }
  // Cubism changes shared WebGL clear state; preserve the transparent desktop surface.
  app.ticker.add(() => { app.renderer.gl?.clearColor(0, 0, 0, 0); }, undefined, -100);
  let lastHit, dragging = false, down;
  const drag = document.getElementById('avatar-drag');
  function setHit(hit) { if (hit !== lastHit) { lastHit = hit; window.companion.hit(hit); } }
  // Alpha mask comes from an actual rendered frame. Transparent areas pass through.
  let mask = null, maskWidth = 0, maskHeight = 0;
  const scratch = document.createElement('canvas'), context = scratch.getContext('2d', { willReadFrequently: true });
  function updateMask() {
    try {
      scratch.width = app.canvas.width; scratch.height = app.canvas.height;
      context.clearRect(0, 0, scratch.width, scratch.height); context.drawImage(app.canvas, 0, 0);
      mask = context.getImageData(0, 0, scratch.width, scratch.height).data; maskWidth = scratch.width; maskHeight = scratch.height;
      if (!anchorFrames) {
        const rect = host.getBoundingClientRect();
        const anchor = measureAvatarAnchor(mask, maskWidth, maskHeight, { windowWidth: innerWidth, windowHeight: innerHeight, canvasWidth: rect.width, canvasHeight: rect.height, canvasLeft: rect.left, canvasTop: rect.top });
        // Refresh after actual frames, and follow material pose changes without
        // moving the bubble for subpixel motion. Zoom can invalidate an early fit.
        if (anchor && (needsAnchor || !lastAnchor || Math.abs(anchor.y - lastAnchor.y) > .006 || Math.abs(anchor.x - lastAnchor.x) > .02)) {
          window.companion.avatarAnchor(anchor); lastAnchor = anchor; needsAnchor = false;
        }
      }
    } catch { /* Fallback uses model bounds until a readable frame is available. */ }
  }
  function fitVisibleModel() {
    updateMask(); if (!mask) return;
    let left = maskWidth, top = maskHeight, right = -1, bottom = -1;
    for (let y = 0; y < maskHeight; y += 2) for (let x = 0; x < maskWidth; x += 2) {
      if (mask[(y * maskWidth + x) * 4 + 3] > 24) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (right <= left || bottom <= top) return;
    const ratio = app.canvas.width / host.clientWidth;
    const width = (right - left) / ratio, height = (bottom - top) / ratio;
    const factor = Math.min(host.clientWidth * .84 / width, host.clientHeight * .93 / height);
    model.position.set(model.x * factor + (host.clientWidth - width * factor) / 2 - left / ratio * factor,
      model.y * factor + (host.clientHeight - height * factor) / 2 - top / ratio * factor);
    model.scale.set(model.scale.x * factor);
    mask = null; needsAnchor = true; anchorFrames = 3;
  }
  // Pixi renders at priority -25; calibrate from the frame after the fit is drawn.
  app.ticker.add(() => { if (anchorFrames && --anchorFrames === 0) updateMask(); }, undefined, -101);
  fit(); new ResizeObserver(fit).observe(host);
  const timer = setInterval(updateMask, 500); setTimeout(updateMask, 200);
  const onMove = event => {
    if (dragging) {
      const point = { x: event.screenX, y: event.screenY };
      window.companion.moveTo(point); setHit(true); return;
    }
    model.focus?.(event.clientX, event.clientY);
    const interactive = event.target.closest?.('.interactive');
    const x = Math.floor(event.clientX * maskWidth / host.clientWidth), y = Math.floor(event.clientY * maskHeight / host.clientHeight);
    const visible = mask ? (x >= 0 && x < maskWidth && y >= 0 && y < maskHeight && mask[(y * maskWidth + x) * 4 + 3] > 24) : (model.hitTest?.(event.clientX, event.clientY)?.length > 0);
    setHit(!!interactive || !!visible);
  };
  window.addEventListener('mousemove', onMove);
  document.addEventListener('mouseleave', () => { if (!dragging) setHit(false); });
  drag.addEventListener('pointerdown', event => {
    if (event.button !== 0) return; dragging = true; window.companion.beginMove({ x: event.screenX, y: event.screenY }); drag.setPointerCapture(event.pointerId); setHit(true);
  });
  const endDrag = () => { if (dragging) window.companion.endMove(); dragging = false; };
  drag.addEventListener('pointerup', endDrag); drag.addEventListener('pointercancel', endDrag); drag.addEventListener('lostpointercapture', endDrag);
  host.addEventListener('pointerdown', event => { if (event.button === 0) down = { x: event.screenX, y: event.screenY }; });
  host.addEventListener('pointerup', event => {
    if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) < 6) window.companion.windowAction('toggle-chat'); down = null;
  });
  host.addEventListener('keydown', event => { if (!event.isComposing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); window.companion.windowAction('toggle-chat'); } });
  window.addEventListener('beforeunload', () => { clearInterval(timer); clearTimeout(fitTimer); app.destroy(true); });
  window.companion.renderReady({ ready: true, model: 'Hiyori' });
  return { app, model };
}
