import { POSE_IDS } from './pose-assets.mjs';

export const POSE_TRANSITION = Object.freeze({ fadeOut: 1.1, hold: 0.1, fadeIn: 1.6 });
const CONVERSATION_TRANSITION = Object.freeze({ fadeOut: 0.08, hold: 0, fadeIn: 0.16 });

// One visible pose at a time. No skeletal interpolation or two-pose overlap.
export class PoseDissolve {
  constructor(
    pose = 'attention',
    { fadeOut = POSE_TRANSITION.fadeOut, hold = POSE_TRANSITION.hold, fadeIn = POSE_TRANSITION.fadeIn } = {},
  ) {
    if (
      !POSE_IDS.includes(pose) ||
      !Number.isFinite(fadeOut) ||
      fadeOut <= 0 ||
      !Number.isFinite(hold) ||
      hold < 0 ||
      !Number.isFinite(fadeIn) ||
      fadeIn <= 0
    )
      throw new Error('Invalid pose transition');
    this.pose = this.target = pose;
    this.level = 1;
    this.phase = 'steady';
    this.normal = { fadeOut, hold, fadeIn };
    this.timing = this.normal;
    this.holdRemaining = 0;
  }
  request(pose, quick = false) {
    if (!POSE_IDS.includes(pose)) throw new Error('Unknown pose');
    if (quick || pose !== this.target) {
      this.timing = quick ? CONVERSATION_TRANSITION : this.normal;
      if (quick) this.holdRemaining = 0;
    }
    this.target = pose;
    if (this.phase === 'hold') {
      // Invisible already: replace only the pending painting, without restarting the gap.
      this.pose = pose;
      return;
    }
    if (pose === this.pose && this.phase === 'out') this.phase = 'in';
    else if (pose !== this.pose && this.phase !== 'out') this.phase = 'out';
  }
  step(dt, { reduced = false } = {}) {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    if (reduced) {
      this.pose = this.target;
      this.level = 1;
      this.phase = 'steady';
      this.holdRemaining = 0;
    } else if (this.phase === 'out') {
      const remaining = this.level * this.timing.fadeOut;
      this.level = Math.max(0, this.level - dt / this.timing.fadeOut);
      if (this.level < 1e-9) {
        this.level = 0;
        this.pose = this.target;
        this.holdRemaining = Math.max(0, this.timing.hold - Math.max(0, dt - remaining));
        this.phase = this.holdRemaining > 1e-9 ? 'hold' : 'in';
      }
    } else {
      if (this.phase === 'hold') {
        const used = Math.min(dt, this.holdRemaining);
        this.holdRemaining -= used;
        dt -= used;
        if (this.holdRemaining < 1e-9) this.phase = 'in';
      }
      if (this.phase === 'in') {
        this.level = Math.min(1, this.level + dt / this.timing.fadeIn);
        if (this.level > 1 - 1e-9) {
          this.level = 1;
          this.phase = 'steady';
        }
      }
    }
    return this.snapshot();
  }
  snapshot() {
    const opacity = 0.5 - 0.5 * Math.cos(Math.PI * this.level);
    return {
      pose: this.pose,
      target: this.target,
      opacity,
      phase: this.phase,
      amount: opacity,
      effect: this.timing === CONVERSATION_TRANSITION ? 'fade' : 'pixels',
    };
  }
}
