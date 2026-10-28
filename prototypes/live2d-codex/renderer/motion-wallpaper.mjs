import { VideoDeck } from '../../video-companion/video-deck.mjs';
import { MotionPlayer } from './motion-player.mjs';
import { motionCatalog, motionTarget } from './motion-catalog.mjs';

let mediaAttempt = 0;
export async function loadMotionCatalog() {
  const response = await fetch('app://local/assets/motion/female/manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('动态壁纸素材未能载入。');
  const catalog = motionCatalog(await response.json());
  // Explicit retry must not reuse a failed Chromium media cache entry.
  const attempt = `${performance.timeOrigin}-${++mediaAttempt}`;
  for (const clip of catalog.clips.values()) clip.src += `?attempt=${attempt}`;
  return catalog;
}

export class MotionWallpaper {
  constructor({ host, catalog, changed }) {
    this.elements = Array.from({ length: 2 }, () => {
      const element = document.createElement('video'); element.className = 'wallpaper-motion';
      element.setAttribute('aria-hidden', 'true'); element.disablePictureInPicture = true; host.append(element); return element;
    });
    this.player = new MotionPlayer({ decks: this.elements.map(element => new VideoDeck(element)), catalog, changed });
  }
  start(backend, presentation, hidden) { this.update(backend, presentation, hidden); this.player.start(); }
  update(backend, presentation, hidden) {
    this.player.setPaused(!!presentation.paused || hidden);
    this.player.setTarget(motionTarget(backend, presentation));
  }
  close() { this.player.close(); this.elements.forEach(element => element.remove()); }
}
