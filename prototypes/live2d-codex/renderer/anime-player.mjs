import { MotionPlayer } from './motion-player.mjs';

const actions = Object.freeze({ nod: 'attention-nod', wave: 'attention-wave', sip: 'cup-sip' });
// Every decision starts at the authored end pose of the visible clip.
// Attention and cup have no direct bridge, so both routes go through work.
export class AnimePlayer extends MotionPlayer {
  next() {
    if (!this.current) return 'work-loop';
    const state = this.current.to, action = actions[this.action];
    const target = action ? this.catalog.clips.get(action).from : this.target;
    if (state !== target) return `${state}-${state === 'work' || target === 'work' ? target : 'work'}`;
    return action || `${state}-loop`;
  }
  didStart(clip) { if (clip.id === actions[this.action]) this.action = null; }
  requestAction(action) {
    if (!Object.hasOwn(actions, action)) throw new Error('未知的视频动作。');
    if (this.closed || this.error) return;
    this.action = action; this.prepare();
  }
  setTarget(value, interrupt = false) {
    if (!['work', 'attention', 'cup'].includes(value)) throw new Error('未知的动漫陪伴状态。');
    if (this.closed) return;
    const changed = this.target !== value || (interrupt && this.action);
    this.target = value; if (interrupt) this.action = null;
    if (changed) { this.emit(); this.prepare(); }
  }
}
