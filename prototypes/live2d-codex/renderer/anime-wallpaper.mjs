import { VideoDeck } from '../../video-companion/video-deck.mjs';
import { AnimePlayer } from './anime-player.mjs';
import { animeCatalog, animeTarget } from './anime-catalog.mjs';

let attempt = 0;
export class AnimeWallpaper {
  static async prepare({ host, changed }) {
    const response = await fetch('app://local/assets/motion/anime/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('动漫视频尚未准备完整，请导入素材或选择原画姿态。');
    const catalog = animeCatalog(await response.json()), suffix = `?attempt=${performance.timeOrigin}-${++attempt}`;
    for (const clip of catalog.clips.values()) clip.src += suffix;
    catalog.window.src += suffix;
    const layer = new AnimeWallpaper({ host, catalog, changed });
    try {
      await Promise.all([
        layer.decks[0].prepare(catalog.clips.get('work-loop'), 0, layer.controller.signal),
        layer.rain.prepare(catalog.window, 0, layer.controller.signal),
        ...Object.entries(catalog.posters).map(async ([pose, src]) => {
          const image = new Image(); image.src = src + suffix; await image.decode(); layer.posters[pose] = image;
        }),
      ]);
      return layer;
    } catch (error) { layer.close(); throw error; }
  }
  constructor({ host, catalog, changed }) {
    Object.assign(this, { host, catalog, changed });
    this.controller = new AbortController(); this.posters = {}; this.active = false; this.closed = false;
    this.stage = document.createElement('div'); this.stage.className = 'wallpaper-anime'; this.stage.hidden = true;
    this.stage.setAttribute('aria-hidden', 'true'); host.append(this.stage);
    const video = className => {
      const element = document.createElement('video'); element.className = className;
      element.disablePictureInPicture = true; this.stage.append(element); return new VideoDeck(element);
    };
    this.decks = [video('anime-body'), video('anime-body')];
    this.rain = video('anime-window'); this.rain.element.loop = true;
    const [x, y, width, height] = catalog.window.placement;
    Object.assign(this.rain.element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    this.poster = document.createElement('div'); this.poster.className = 'anime-poster'; this.poster.hidden = true; this.stage.append(this.poster);
    this.player = new AnimePlayer({ decks: this.decks, catalog, changed: info => {
      if (!this.active) return;
      if (info.error) this.rain.pause();
      this.changed(this.reduced.matches && !info.error ? { ...info, phase: 'paused', state: this.target, typing: false } : info);
    } });
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.motionChanged = () => this.update(this.backend, this.presentation, this.hidden, this.idle);
    this.reduced.addEventListener('change', this.motionChanged);
    this.rain.element.addEventListener('error', () => { if (this.active) this.player.fail(new Error('窗雨图层未能继续播放。')); });
    this.observer = new ResizeObserver(() => this.fit()); this.observer.observe(host);
    this.rainTime = -1; this.rainProgress = performance.now();
    this.timer = setInterval(() => {
      if (!this.active || this.player.paused || this.player.error) { this.rainProgress = performance.now(); return; }
      if (this.rain.time !== this.rainTime) { this.rainTime = this.rain.time; this.rainProgress = performance.now(); }
      else if (performance.now() - this.rainProgress > 12000) this.player.fail(new Error('窗雨图层停止响应，请重试加载。'));
    }, 1000);
  }
  fit() {
    const [width, height] = this.catalog.canvas, scale = Math.max(this.host.clientWidth / width, this.host.clientHeight / height);
    Object.assign(this.stage.style, { width: `${width}px`, height: `${height}px`,
      transform: `translate(${(this.host.clientWidth - width * scale) / 2}px, ${(this.host.clientHeight - height * scale) / 2}px) scale(${scale})` });
  }
  activate(backend, presentation, hidden, idle) {
    this.active = true; this.stage.hidden = false; this.fit();
    // Events issued to the previous renderer must not replay after a switch.
    this.actionId = presentation.videoAction?.id;
    this.update(backend, presentation, hidden, idle); this.player.start();
  }
  update(backend = {}, presentation = {}, hidden = false, idle = 'work') {
    Object.assign(this, { backend, presentation, hidden, idle });
    if (!this.active || this.closed) return;
    const target = animeTarget(backend, presentation, idle), reduce = this.reduced.matches;
    const paused = !!presentation.paused || hidden || reduce;
    const interrupt = !!presentation.capturing || !!presentation.speaking || !!presentation.chatVisible
      || ['waiting', 'starting', 'working', 'stopping'].includes(backend.status) || !!backend.busy;
    const manualChanged = this.manualPose !== undefined && this.manualPose !== presentation.stills?.stillPose;
    this.manualPose = presentation.stills?.stillPose; this.target = target;
    this.player.setPaused(paused); this.player.setTarget(target, interrupt || manualChanged || reduce);
    const action = presentation.videoAction;
    if (action && action.id !== this.actionId) {
      this.actionId = action.id;
      if (!interrupt && !reduce && action.requestId === presentation.characterRequest) this.player.requestAction(action.action);
    }
    this.poster.hidden = !reduce;
    if (reduce) { this.poster.replaceChildren(this.posters[target]); this.changed({ ...this.player.snapshot(), phase: 'paused', state: target, typing: false }); }
    this.rain.show(!reduce);
    if (paused || this.player.error) this.rain.pause();
    else if (this.rain.element.paused) this.rain.play().catch(error => {
      if (!this.closed && !this.player.paused && error.name !== 'AbortError') this.player.fail(error);
    });
  }
  close() {
    if (this.closed) return; this.closed = true; this.active = false; this.controller.abort(); clearInterval(this.timer);
    this.reduced.removeEventListener('change', this.motionChanged); this.observer.disconnect();
    this.player.close(); this.rain.dispose(); this.stage.remove();
  }
}
