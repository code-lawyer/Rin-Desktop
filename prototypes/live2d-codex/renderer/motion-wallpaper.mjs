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
  static async prepare(options) {
    const layer = new MotionWallpaper(options), first = layer.decks[0];
    try {
      await first.prepare(options.catalog.clips.get('work-loop'), 0, layer.controller.signal);
      await first.play();
      await first.present(layer.controller.signal, () => false);
      first.pause(); await first.seek(0, layer.controller.signal);
      return layer;
    } catch (error) { layer.close(); throw error; }
  }
  constructor({ host, catalog, changed }) {
    this.controller = new AbortController(); this.closed = false;
    this.elements = Array.from({ length: 2 }, () => {
      const element = document.createElement('video'); element.className = 'wallpaper-motion';
      element.setAttribute('aria-hidden', 'true'); element.disablePictureInPicture = true; host.append(element); return element;
    });
    this.decks = this.elements.map(element => new VideoDeck(element));
    this.player = new MotionPlayer({ decks: this.decks, catalog, changed });
  }
  get ready() { return !this.closed && this.decks[0].ready && !this.player.error; }
  start(backend, presentation, hidden) { this.update(backend, presentation, hidden); this.player.start(); }
  update(backend, presentation, hidden) {
    this.player.setPaused(!!presentation.paused || hidden);
    this.player.setTarget(motionTarget(backend, presentation));
  }
  close() { if (this.closed) return; this.closed = true; this.controller.abort(); this.player.close(); this.elements.forEach(element => element.remove()); }
}
