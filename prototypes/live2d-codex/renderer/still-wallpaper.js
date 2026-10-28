import characters from '../backend/character-profiles.cjs';
import stillSettings from '../backend/still-settings.cjs';
import { StillSequence } from './still-sequence.mjs';
import { AmbientPreview } from './ambient-preview.mjs';
import { stillPose, createIdleCycle, idleDuration, stillActivity } from './still-policy.mjs';
import { MotionWallpaper, loadMotionCatalog } from './motion-wallpaper.mjs';

export async function startStillWallpaper({ host, api }) {
  const canvas = document.createElement('canvas'); canvas.className = 'wallpaper-still'; host.append(canvas);
  const context = canvas.getContext('2d', { alpha: false });
  const audio = new AmbientPreview({ mediaRoot: 'app://local/assets/ambience' });
  const cache = new Map();
  let imageAttempt = 0, frameRevision = 0;
  let presentation = {}, backend = {}, shown, desiredKey, closed = false, audioAttempt = '', audioLoading = false;
  const nextIdlePose = createIdleCycle();
  let idle = 'work', idleTimer, remaining = idleDuration('work'), began = 0, lastReport;
  let received = false, audioRevision = 0, committedRequest = -1;
  let motion, motionInfo;
  function loadImage(character, pose, override) {
    const url = override || `app://local/assets/stills/${character === 'female' ? 'female-v2-4k' : 'male'}/${pose}.png`;
    if (!cache.has(url)) {
      const promise = (async () => { const image = new Image(); image.src = `${url}?attempt=${++imageAttempt}`; await image.decode(); return image; })();
      cache.set(url, promise); promise.catch(() => cache.delete(url));
    }
    return cache.get(url);
  }
  // Female v2 frames include the entire pose: never discard arms or shoulders.
  // The existing male pair retains its original spatial composition.
  function compose(base, pose, character) {
    const frame = document.createElement('canvas'); frame.width = base.naturalWidth; frame.height = base.naturalHeight;
    const ctx = frame.getContext('2d', { alpha: false }); ctx.drawImage(base, 0, 0);
    if (character === 'male' && pose !== base) {
      const scaleX = frame.width / 1586, scaleY = frame.height / 992;
      const box = [1000, 38, 350, 340];
      const [x, y, w, h] = box, patch = document.createElement('canvas');
      patch.width = Math.round(w * scaleX); patch.height = Math.round(h * scaleY);
      const p = patch.getContext('2d');
      p.drawImage(pose, x / 1586 * pose.naturalWidth, y / 992 * pose.naturalHeight,
        w / 1586 * pose.naturalWidth, h / 992 * pose.naturalHeight, 0, 0, patch.width, patch.height);
      // A rectangular region includes the union of the original and new hair
      // silhouettes, including the ribbons at the top corners.
      p.globalCompositeOperation = 'destination-in';
      for (const edge of [p.createLinearGradient(0, 0, patch.width, 0), p.createLinearGradient(0, 0, 0, patch.height)]) {
        edge.addColorStop(0, 'transparent'); edge.addColorStop(.03, '#fff'); edge.addColorStop(.97, '#fff'); edge.addColorStop(1, 'transparent');
        p.fillStyle = edge; p.fillRect(0, 0, patch.width, patch.height);
      }
      ctx.drawImage(patch, Math.round(x * scaleX), Math.round(y * scaleY));
    }
    return frame;
  }
  function fit() {
    const density = window.devicePixelRatio || 1, width = host.clientWidth, height = host.clientHeight;
    canvas.width = Math.max(1, Math.round(width * density)); canvas.height = Math.max(1, Math.round(height * density));
    if (shown) {
      const frame = shown.frame, scale = Math.max(canvas.width / frame.width, canvas.height / frame.height);
      context.drawImage(frame, (canvas.width - frame.width * scale) / 2, (canvas.height - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
    }
    const [sourceWidth, sourceHeight, headX, headY, headLeft, headRight] = shown?.catalog
      ? [1280, 720, 940, 210, 830, 1055] : [1586, 992, 1180, 250, 1065, 1310];
    const scale = Math.max(width / sourceWidth, height / sourceHeight), left = (width - sourceWidth * scale) / 2, top = (height - sourceHeight * scale) / 2;
    const bounded = v => Math.max(0, Math.min(1, v));
    api.avatarAnchor({ x: bounded((headX * scale + left) / width), y: bounded((headY * scale + top) / height), left: bounded((headLeft * scale + left) / width), right: bounded((headRight * scale + left) / width) });
    host.dataset.renderWidth = canvas.width; host.dataset.renderHeight = canvas.height;
  }
  const sequence = new StillSequence({
    accept: key => typeof key === 'string',
    async load(key) {
      const revision = frameRevision;
      const [requestId, character, pose, animated] = JSON.parse(key);
      let catalog, motionError, image;
      if (animated) {
        try { catalog = await loadMotionCatalog(); image = await loadImage(character, pose, catalog.posters.work); }
        catch (error) { motionError = error.message; catalog = null; }
      }
      image ??= await loadImage(character, pose);
      const base = character === 'female' ? image : await loadImage(character, 'work');
      return { frame: compose(base, image, character), frameRevision: revision, requestId, character, pose, animated, catalog, motionError, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
    },
    async show(frame, key) {
      if (frame.requestId !== committedRequest) {
        const info = { ready: true, wallpaperKind: 'artwork', character: frame.character, requestId: frame.requestId, initial: !shown };
        let result = await api.commitWallpaper(info);
        if (closed || key !== desiredKey || (shown && (presentation.paused || document.hidden))) {
          api.finishWallpaper(info, false); return false;
        }
        // No await between the final commit and paint: pause/selection events
        // cannot replace this frame's intent after its settings are published.
        if (result?.ok && result.value) result = api.finishWallpaper(info, true);
        if (!result?.ok || !result.value) {
          host.dataset.loading = 'false';
          host.dataset.error = result?.error || '人物设置未能保存或选择已更新，已保留当前画面。请在工作台重试。';
          return false;
        }
        committedRequest = frame.requestId;
      }
      motion?.close(); motion = null; motionInfo = null;
      shown = frame; fit(); host.dataset.ready = 'true'; host.dataset.loading = 'false'; delete host.dataset.error;
      host.dataset.character = frame.character; host.dataset.pose = frame.pose; host.dataset.rig = 'static';
      host.dataset.sourceWidth = frame.sourceWidth; host.dataset.sourceHeight = frame.sourceHeight;
      if (frame.catalog) {
        motion = new MotionWallpaper({ host, catalog: frame.catalog, changed(info) {
          if (closed || shown !== frame) return;
          motionInfo = info; host.dataset.motionPhase = info.phase; host.dataset.motionClip = info.clip || '';
          host.dataset.motionPlayCount = String(info.playCount);
          host.dataset.rig = 'motion'; host.dataset.pose = info.state === 'user' ? 'attention' : 'work';
          host.dataset.typing = String(info.typing);
          if (info.error) host.dataset.error = '动态壁纸未能继续播放，已保留画面。请在工作台重试加载。';
          else delete host.dataset.error;
          report(info.phase === 'loop' || info.phase === 'transition'); updateAudio();
        } });
        motion.start(backend, presentation, document.hidden);
      } else { delete host.dataset.motionPhase; delete host.dataset.motionClip; }
      report(true);
      updateAudio();
    },
    failed(error, key) {
      const [requestId, character] = JSON.parse(key);
      host.dataset.loading = 'false'; host.dataset.error = '姿态图片未能载入，已保留当前画面。请在工作台重试加载。';
      api.renderReady({ ready: false, kind: 'wallpaper', wallpaperKind: 'artwork', character, requestId, frameRevision, error: host.dataset.error });
      console.error('[wallpaper:still]', error.message);
    },
  });
  function report(painted = false) {
    if (!shown) return;
    const error = shown.motionError || motionInfo?.error;
    const info = { ready: true, kind: 'wallpaper', wallpaperKind: 'artwork', character: shown.character, requestId: shown.requestId,
      pose: motionInfo?.state === 'user' ? 'attention' : shown.pose,
      activity: stillActivity(backend, presentation, document.hidden), model: shown.animated ? 'motion-clips' : 'static-stills',
      motionPhase: motionInfo?.phase || null, frameRevision: shown.frameRevision, painted, ...(error ? { ready: false, error } : {}),
      sourceWidth: shown.frame.width, sourceHeight: shown.frame.height,
      poseSourceWidth: shown.sourceWidth, poseSourceHeight: shown.sourceHeight, renderWidth: canvas.width, renderHeight: canvas.height };
    host.dataset.activity = info.activity;
    const signature = JSON.stringify(info);
    if (signature !== lastReport) { lastReport = signature; api.renderReady(info); }
  }
  function audioStatus(phase, error = '') { host.dataset.audioState = phase; api.ambientStatus?.({ phase, error }); }
  function updateAudio() {
    if (closed) return;
    const settings = stillSettings.stillSettings(presentation.stills);
    const patch = { enabled: settings.ambienceEnabled, rainVolume: settings.rainVolume, keyVolume: settings.keyVolume,
      pose: shown?.animated ? (motionInfo?.typing ? 'work' : 'attention') : shown?.pose,
      paused: !!presentation.paused, hidden: document.hidden, capturing: !!presentation.capturing, speaking: !!presentation.speaking };
    const levels = audio.update(patch);
    host.dataset.audioRain = String(levels.rain); host.dataset.audioKeys = String(levels.keys);
    // Acknowledge only after gains and pending keyboard sources are silenced.
    audioRevision = presentation.ambientRevision ?? 0; api.ambientApplied?.(audioRevision);
    if (!settings.ambienceEnabled) { audioAttempt = ''; audioStatus('off'); return; }
    const attempt = String(presentation.ambientRetry ?? 0);
    if (audioAttempt === attempt || audioLoading) return;
    audioAttempt = attempt; audioLoading = true; audioStatus('loading');
    audio.enable().then(ok => { if (!closed && ok) audioStatus('ready'); })
      .catch(error => { if (!closed) audioStatus('error', error.message); })
      .finally(() => { audioLoading = false; if (!closed && audioAttempt !== String(presentation.ambientRetry ?? 0) && presentation.stills?.ambienceEnabled) updateAudio(); });
  }
  function idleActive() {
    return !presentation.stills?.wallpaperMotion && stillActivity(backend, presentation, document.hidden) === 'auto';
  }
  function updateIdle() {
    if (!idleActive()) {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; remaining = Math.max(0, remaining - (performance.now() - began)); }
    } else if (!idleTimer) {
      began = performance.now();
      idleTimer = setTimeout(() => { idleTimer = null; idle = nextIdlePose(idle); remaining = idleDuration(idle); update(); }, remaining);
    }
  }
  function update() {
    if (closed) return;
    updateAudio(); updateIdle();
    const character = characters.characterProfile(presentation.character).id;
    const animated = character === 'female' && presentation.stills?.wallpaperMotion === true;
    const pose = animated ? 'work' : stillPose(backend, { ...presentation, character }, idle);
    const key = JSON.stringify([presentation.characterRequest ?? 0, character, pose, animated]);
    host.dataset.paused = String(!!presentation.paused); host.dataset.typing = String(shown?.animated ? !!motionInfo?.typing : shown?.pose === 'work');
    motion?.update(backend, presentation, document.hidden);
    sequence.setPaused(!!shown && (!!presentation.paused || document.hidden));
    if (key !== desiredKey) { desiredKey = key; frameRevision++; host.dataset.loading = 'true'; sequence.select(key); }
    report();
  }
  const unsubscribe = api.onPresentation(value => { received = true; presentation = value; update(); });
  const initial = await api.presentation(); if (initial.ok && !received) presentation = initial.value;
  const observer = new ResizeObserver(fit); observer.observe(host);
  document.addEventListener('visibilitychange', update); update();
  function destroy() {
    if (closed) return; closed = true; clearTimeout(idleTimer); unsubscribe(); observer.disconnect(); sequence.close();
    document.removeEventListener('visibilitychange', update); window.removeEventListener('beforeunload', destroy); motion?.close(); audio.close(); canvas.remove(); cache.clear(); shown = null;
  }
  window.addEventListener('beforeunload', destroy);
  return { setBackendState(value) { backend = value; update(); }, destroy };
}
