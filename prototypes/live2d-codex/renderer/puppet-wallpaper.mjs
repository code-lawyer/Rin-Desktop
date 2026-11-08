import { PosePlayer } from './pose-player.mjs';
import { PoseDissolve } from './pose-dissolve.mjs';
import { blinkAt } from './scene-motion.mjs';

const ROOT = 'app://local/assets/scene/rin-poses/';

// Whole authored poses dissolve into pixels over one fixed room. Facial details stay local to
// each pose; preparing a replacement retains the currently accepted scene.
export class PuppetWallpaper {
  static async prepare({ host, changed, activityChanged }) {
    const scene = new PuppetWallpaper({ host, changed, activityChanged });
    try {
      await scene.load();
      return scene;
    } catch (error) {
      scene.close();
      throw error;
    }
  }
  constructor({ host, changed, activityChanged }) {
    this.host = host;
    this.changed = changed;
    this.closed = false;
    this.active = false;
    this.activityChanged = activityChanged;
    this.typing = false;
    this.pose = 'work';
    this.speaking = false;
    this.level = 0;
    this.mouth = 0;
    this.transition = new PoseDissolve(this.pose);
    this.received = -Infinity;
    this.revision = -1;
    this.time = 0;
    this.raf = 0;
    this.gaze = [0, 0];
    this.abort = new AbortController();
    this.element = document.createElement('div');
    this.element.className = 'wallpaper-puppet';
    this.scene = document.createElement('div');
    this.scene.className = 'rin-scene';
    this.fallback = new Image();
    this.fallback.className = 'rin-character rin-fallback';
    this.fallback.alt = '';
    this.fallback.setAttribute('aria-hidden', 'true');
    this.fallback.src = ROOT + 'scene.png';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rin-character';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.scene.append(this.fallback, this.canvas);
    this.element.append(this.scene);
    host.append(this.element);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.onReduced = () => this.updateLoop();
    this.reduced.addEventListener('change', this.onReduced);
    try {
      this.player = new PosePlayer(this.canvas, {
        lost: () => {
          if (this.closed) return;
          this.failed = true;
          this.typing = false;
          this.mouth = this.level = 0;
          this.frame = { pose: 'attention', opacity: 1, phase: 'steady' };
          this.element.dataset.actualPose = 'attention';
          this.element.dataset.poseAmount = '1';
          this.element.dataset.transitionPhase = 'steady';
          this.element.dataset.mouth = '0';
          this.stop();
          this.canvas.hidden = true;
          this.fallback.hidden = false;
          if (this.active) {
            this.changed?.(new Error('角色绘图已中断，已保留完整原画。请重试加载。'));
            this.activityChanged?.();
          }
        },
      });
    } catch (error) {
      this.close();
      throw error;
    }
    this.tick = (now) => {
      this.raf = 0;
      if (!this.running()) return;
      // The wallpaper needs at most 30 paints/s; speech uses the audio clock.
      if (this.last == null || now - this.last >= 1000 / 30 - 1) {
        const dt = this.last == null ? 0 : Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.time += dt;
        this.draw(dt);
      }
      this.raf = requestAnimationFrame(this.tick);
    };
  }
  async load() {
    let timer;
    try {
      await Promise.race([
        Promise.all([this.fallback.decode(), this.player.load(ROOT, this.abort.signal)]),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('角色素材加载超时，请重试。');
            this.abort.abort(error);
            reject(error);
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.closed || this.player.contextLost) throw new Error('动态原画未能完成绘制。');
    this.fit();
    this.draw(0);
    this.fallback.hidden = true;
  }
  fit() {
    this.player?.resize(this.host.clientWidth, this.host.clientHeight);
  }
  activate() {
    this.active = true;
    this.element.dataset.active = 'true';
    this.fit();
  }
  visible() {
    return !this.closed && this.active && !this.paused && !this.hidden && !this.failed;
  }
  running() {
    return this.visible() && (!this.reduced.matches || this.speaking);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = null;
  }
  updateLoop() {
    if (!this.running()) {
      this.stop();
      if (this.visible() && this.reduced.matches) {
        this.gaze = [0, 0];
        this.draw(0);
      }
    } else if (!this.raf) {
      this.last = null;
      this.raf = requestAnimationFrame(this.tick);
    }
  }
  draw(dt) {
    const target = this.speaking && performance.now() - this.received < 240 ? this.level : 0;
    this.mouth += (target - this.mouth) * Math.min(1, dt * 22);
    if (target === 0 && this.mouth < 0.005) this.mouth = 0;
    const frame = this.transition.step(dt, { reduced: this.reduced.matches });
    this.frame = frame;
    this.gaze = this.reduced.matches
      ? [0, 0]
      : [Math.sin(this.time * 0.31) * 0.45, Math.sin(this.time * 0.23) * 0.18];
    this.player.render({
      blink: this.reduced.matches ? 0 : blinkAt(this.time),
      mouth: frame.pose === 'attention' ? this.mouth : 0,
      frame,
      gaze: this.gaze,
    });
    this.element.dataset.mouth = (frame.pose === 'attention' ? this.mouth : 0).toFixed(3);
    this.element.dataset.actualPose = frame.pose;
    this.element.dataset.poseAmount = frame.opacity.toFixed(3);
    this.element.dataset.transitionPhase = frame.phase;
    this.element.dataset.cupStage = frame.pose === 'cup' ? 'held' : 'table';
    const typing = frame.pose === 'work' && frame.phase === 'steady' && !this.reduced.matches;
    this.typing = typing;
    const status = JSON.stringify([frame.pose, this.transitioning(), typing, frame.phase]);
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      if (this.active) this.activityChanged?.();
    }
  }
  update(pose, presentation, hidden) {
    if (this.closed) return;
    this.speaking = !!presentation.speaking;
    this.paused = !!presentation.paused;
    this.hidden = hidden;
    if (!this.speaking) {
      this.level = 0;
      this.mouth = 0;
      this.received = -Infinity;
    }
    if (!this.paused && !hidden) {
      this.pose = pose;
      this.transition.request(pose);
    }
    this.element.dataset.pose = this.pose;
    this.updateLoop();
  }
  receiveMouth(value) {
    if (
      !this.speaking ||
      !value ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < this.revision ||
      !Number.isFinite(value.level) ||
      value.level < 0 ||
      value.level > 1
    )
      return;
    this.revision = value.revision;
    this.level = value.level;
    this.received = performance.now();
  }
  transitioning() {
    return !this.failed && (this.frame?.pose !== this.pose || this.frame?.phase !== 'steady');
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.abort.abort();
    this.reduced?.removeEventListener('change', this.onReduced);
    this.player?.dispose();
    this.fallback.src = '';
    this.element.remove();
  }
}
