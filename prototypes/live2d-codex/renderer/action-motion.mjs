export const ACTIONS = Object.freeze(['nod', 'shake', 'tilt', 'wave']);
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
export const mix = (a, b, t) => a + (b - a) * t;
export const mixPoint = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
export const rotate = (p, origin, angle) => {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    x = p[0] - origin[0],
    y = p[1] - origin[1];
  return [origin[0] + c * x - s * y, origin[1] + s * x + c * y];
};
const approach = (a, b, amount) => (a < b ? Math.min(b, a + amount) : Math.max(b, a - amount));
export class ActionMotion {
  constructor() {
    this.pose = 'attention';
    this.desired = 'attention';
    this.amount = 0;
    this.cup = { stage: 'rest', reach: 0, lift: 0, held: false, elapsed: 0 };
    this.action = null;
    this.pending = null;
    this.elapsed = 0;
  }
  request(pose) {
    this.desired = ['work', 'cup', 'thinking', 'window', 'attention'].includes(pose) ? pose : 'attention';
  }
  act(id) {
    if (!ACTIONS.includes(id)) return false;
    this.pending = id;
    return true;
  }
  step(dt, { reduced = false } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.elapsed += dt;
    const targetPose = this.pending || this.action ? 'attention' : this.desired;
    if (this.pose === 'cup') this.stepCup(dt, targetPose !== 'cup');
    const cupBusy = this.pose === 'cup' && (this.cup.reach > 0 || this.cup.lift > 0);
    const leaving = this.pose !== targetPose;
    this.amount = approach(this.amount, leaving ? 0 : 1, dt / (leaving ? 0.85 : 1.15));
    if (leaving && this.amount === 0 && !cupBusy) {
      this.pose = targetPose;
      this.cup = {
        stage: this.pose === 'cup' ? 'reach' : 'rest',
        reach: 0,
        lift: 0,
        held: false,
        elapsed: 0,
      };
    }
    if (this.action) {
      this.action.time += dt;
      const duration = this.action.id === 'wave' ? 6.8 : this.action.id === 'tilt' ? 2.6 : 1.8;
      if (this.action.time >= duration) this.action = null;
    }
    if (!this.action && this.pending && this.pose === 'attention' && this.amount === 1) {
      this.action = { id: this.pending, time: 0 };
      this.pending = null;
    }
    if (reduced) {
      this.pose = this.desired;
      this.amount = 1;
      this.action = null;
      this.pending = null;
      this.cup = { stage: 'rest', reach: 0, lift: 0, held: false, elapsed: 0 };
    }
    return this.snapshot();
  }
  stepCup(dt, leaving) {
    const c = this.cup;
    if (leaving) {
      if (c.stage === 'reach') c.stage = 'return';
      if (c.stage === 'lift' || c.stage === 'sip') c.stage = 'lower';
    }
    c.elapsed += dt;
    const next = (stage) => {
      c.stage = stage;
      c.elapsed = 0;
    };
    if (c.stage === 'reach') {
      c.reach = approach(c.reach, 1, dt / 1.8);
      if (c.reach === 1) {
        c.held = true;
        next('lift');
      }
    } else if (c.stage === 'lift') {
      c.lift = approach(c.lift, 1, dt / 2.3);
      if (c.lift === 1) next('sip');
    } else if (c.stage === 'sip') {
      if (c.elapsed >= 1.8) next('lower');
    } else if (c.stage === 'lower') {
      c.lift = approach(c.lift, 0, dt / 2.3);
      if (c.lift === 0) {
        c.held = false;
        next('return');
      }
    } else if (c.stage === 'return') {
      c.reach = approach(c.reach, 0, dt / 1.8);
      if (c.reach === 0) next('rest');
    } else if (c.stage === 'rest' && !leaving && c.elapsed >= 3.5) next('reach');
  }
  snapshot() {
    return {
      pose: this.pose,
      amount: smooth(this.amount),
      cup: { ...this.cup },
      action: this.action ? { ...this.action } : null,
      time: this.elapsed,
    };
  }
}

// Interpolate elbow position, then forearm and hand angles. A raised hand
// follows an arc around its elbow instead of shrinking through the torso.
export function blendChain(a, b, t) {
  const s = mixPoint(a[0], b[0], t),
    e = mixPoint(a[1], b[1], t);
  const segment = (i, origin) => {
    const av = [a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]],
      bv = [b[i][0] - b[i - 1][0], b[i][1] - b[i - 1][1]];
    const aa = Math.atan2(av[1], av[0]),
      ba = Math.atan2(bv[1], bv[0]);
    let delta = ba - aa;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const angle = aa + delta * t,
      length = mix(Math.hypot(...av), Math.hypot(...bv), t);
    return [origin[0] + Math.cos(angle) * length, origin[1] + Math.sin(angle) * length];
  };
  const w = segment(2, e),
    f = segment(3, w);
  return [s, e, w, f];
}

export const REST_NEAR = [
  [1332, 368],
  [1300, 558],
  [1196, 628],
  [1134, 650],
];
export const REST_FAR = [
  [1066, 383],
  [1050, 546],
  [1093, 634],
  [1145, 674],
];
const WAVE = [
  [1332, 368],
  [1340, 533],
  [1328, 391],
  [1350, 325],
];
const CHIN = [
  [1332, 368],
  [1264, 514],
  [1208, 344],
  [1230, 284],
];
const WORK_NEAR = [
  [1332, 368],
  [1280, 579],
  [1124, 569],
  [1010, 549],
];
const WORK_FAR = [
  [1066, 383],
  [1031, 520],
  [986, 539],
  [938, 539],
];

export function rigPose(
  frame,
  { time = 0, blink = 0, mouth = 0, breath = 0, hair = 0, reduced = false } = {}
) {
  const {
    pose = 'attention',
    amount = 0,
    action = null,
    cup = { reach: 0, lift: 0, held: false },
  } = frame || {};
  let near = REST_NEAR.map((p) => [...p]),
    far = REST_FAR.map((p) => [...p]),
    nearHand = 'hand',
    farHand = 'farHand',
    nearFore = 'waveFore',
    handTurn = 1;
  let yaw = pose === 'window' ? 0.72 * amount : 0,
    pitch = pose === 'work' ? 0.2 * amount : 0,
    roll = 0,
    spine = pose === 'work' ? -0.025 * amount : 0;
  let cupPosition = [1537, 718],
    cupAngle = 0,
    cupHand = null;
  if (pose === 'work') {
    near = blendChain(REST_NEAR, WORK_NEAR, amount);
    far = blendChain(REST_FAR, WORK_FAR, amount);
    if (amount > 0.24) {
      nearHand = 'typeNear';
      farHand = 'typeFar';
    }
    handTurn = 1 - 0.35 * Math.exp(-Math.pow((amount - 0.24) / 0.09, 2));
    if (amount > 0.98 && !reduced) {
      near[2][1] += Math.sin(time * 9.4) * 1.0;
      near[3][1] += Math.sin(time * 14.8) * 1.5;
      far[2][1] += Math.sin(time * 12.2 + 0.8) * 0.8;
      far[3][1] += Math.sin(time * 15.9 + 2) * 1.3;
    }
  } else if (pose === 'thinking') {
    near = blendChain(REST_NEAR, CHIN, amount);
    nearHand = amount > 0.24 ? 'chinHand' : 'hand';
    nearFore = 'chinFore';
    handTurn = 1 - 0.35 * Math.exp(-Math.pow((amount - 0.24) / 0.09, 2));
  } else if (pose === 'cup') {
    const reach = smooth(cup.reach),
      lift = smooth(cup.lift),
      lean = reach * (1 - lift);
    spine = 0.18 * lean;
    cupPosition = mixPoint([1537, 718], [1178, 314], lift);
    cupPosition[0] -= Math.sin(lift * Math.PI) * 25;
    const grip = [cupPosition[0] + 22, cupPosition[1] + 22],
      angle = (1 - lift) * Math.PI;
    // A fixed point on the palm stays on the mug while the wrist turns.
    const handWrist = rotate([grip[0] + 35, grip[1] + 71], grip, angle);
    const handTip = rotate([grip[0] - 7, grip[1] - 7], grip, angle);
    const elbow = mixPoint([1460, 580], [1304, 535], lift);
    const target = [[1332, 368], elbow, handWrist, handTip];
    near = blendChain(REST_NEAR, target, reach);
    nearHand = reach > 0.24 ? 'cupHand' : 'hand';
    nearFore = 'drinkFore';
    handTurn = 1 - 0.35 * Math.exp(-Math.pow((reach - 0.24) / 0.09, 2));
  }
  if (action) {
    const t = action.time;
    if (action.id === 'wave' && pose !== 'cup' && pose !== 'thinking') {
      const lift = smooth(t < 1.7 ? t / 1.7 : t > 5 ? (6.8 - t) / 1.8 : 1),
        w = t > 1.7 && t < 5 ? Math.sin((t - 1.7) * Math.PI * 2.3) * 0.1 : 0;
      const target = WAVE.map((p) => [...p]);
      target[2] = rotate(target[2], target[1], w);
      target[3] = rotate(target[3], target[1], w);
      near = blendChain(near, target, lift);
      nearHand = lift > 0.24 ? 'waveHand' : nearHand;
      nearFore = 'waveFore';
      handTurn = 1 - 0.35 * Math.exp(-Math.pow((lift - 0.24) / 0.1, 2));
    } else if (action.id === 'nod')
      pitch += Math.sin((t / 1.8) * Math.PI * 4) * Math.sin(Math.PI * clamp(t / 1.8)) * 0.15;
    else if (action.id === 'shake')
      yaw += Math.sin((t / 1.8) * Math.PI * 4) * Math.sin(Math.PI * clamp(t / 1.8)) * 0.3;
    else if (action.id === 'tilt') roll += Math.sin(Math.PI * clamp(t / 2.6)) * 0.12;
  }
  yaw = clamp(yaw, -0.24, 0.72);
  return {
    near,
    far,
    nearHand,
    farHand,
    nearFore,
    handTurn,
    yaw,
    pitch,
    roll,
    spine,
    cupPosition,
    cupAngle,
    cupHand,
    cupHeld: !!cup.held,
    cupLift: smooth(cup.lift || 0),
    blink,
    mouth,
    breath: breath * 0.42,
    hair: hair * 0.42,
    time,
    reduced,
    pose,
    amount,
  };
}
