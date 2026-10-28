import { VideoCompanion } from '../../video-companion/player.mjs';
import { VideoDeck } from '../../video-companion/video-deck.mjs';
import { validateManifest } from '../backend/video-catalog.mjs';
import { videoScene, videoAnchor } from './video-state.mjs';

export async function startVideoWallpaper({ host, api, initialState = {} }) {
  const response = await fetch('app://local/video/manifest.json'), data = await response.json();
  if (!response.ok) throw new Error(data.error || '视频清单未能载入。');
  const scenes = validateManifest(data, { mediaBase: 'app://local/video/' }).scenes;
  const decks = [0, 1].map(() => {
    const video = document.createElement('video'); video.className = 'wallpaper-video'; video.dataset.active = 'false';
    video.setAttribute('aria-hidden', 'true'); host.append(video); return new VideoDeck(video);
  });
  let state = initialState, presentation = {}, request, destroyed = false, reported = null, replay = 0, retry = 0;
  const player = new VideoCompanion({ decks, onChange: reportStatus });
  function reportStatus() {
    if (destroyed) return;
    const snapshot = player.snapshot();
    host.dataset.ready = String(Boolean(snapshot.current)); host.dataset.paused = String(snapshot.paused);
    host.dataset.scene = snapshot.current || ''; host.dataset.loops = String(snapshot.loops);
    api.videoStatus?.({ phase: snapshot.phase, scene: snapshot.current, target: snapshot.target, error: snapshot.error, loops: snapshot.loops, paused: snapshot.paused });
    if (snapshot.current && reported !== presentation.characterRequest) {
      reported = presentation.characterRequest;
      api.renderReady({ ready: true, kind: 'video', character: 'female', requestId: reported, model: 'local-video', sourceWidth: player.active.element.videoWidth, sourceHeight: player.active.element.videoHeight, renderWidth: host.clientWidth, renderHeight: host.clientHeight });
    }
  }
  const fit = () => api.avatarAnchor(videoAnchor(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight)));
  function update() {
    if (destroyed) return;
    player.setSuspended(Boolean(presentation.paused));
    const desired = videoScene(state, presentation), scene = scenes.find(value => value.id === desired);
    if (!scene) return;
    // State refreshes must not turn a load error into an endless implicit retry.
    if (request !== desired) { request = desired; player.select(scene); }
    if ((presentation.videoReplay ?? 0) !== replay) { replay = presentation.videoReplay ?? 0; player.select(scene, { entry: true }); }
    if ((presentation.videoRetry ?? 0) !== retry) { retry = presentation.videoRetry ?? 0; player.retry(); }
  }
  let received = false;
  const unsubscribe = api.onPresentation(value => { received = true; presentation = value; update(); fit(); });
  const initial = await api.presentation(); if (!received && initial.ok) presentation = initial.value;
  replay = presentation.videoReplay ?? 0; retry = presentation.videoRetry ?? 0;
  await player.setSuspended(Boolean(presentation.paused));
  request = videoScene(state, presentation);
  await player.select(scenes.find(scene => scene.id === request) || scenes[0]);
  if (!player.current) { unsubscribe(); player.close(); throw new Error(player.error?.message || '视频未能解码。'); }
  const observer = new ResizeObserver(fit); observer.observe(host); fit();
  return {
    setBackendState(value) { state = value; update(); }, reportStatus,
    destroy() { if (destroyed) return; destroyed = true; unsubscribe(); observer.disconnect(); player.close(); host.replaceChildren(); },
  };
}
