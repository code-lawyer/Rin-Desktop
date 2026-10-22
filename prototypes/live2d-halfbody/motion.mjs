export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function blinkOpen(seconds) {
  if (seconds < 0 || seconds >= .24) return 1;
  if (seconds < .085) return 1 - seconds / .085;
  if (seconds < .115) return 0;
  return (seconds - .115) / .125;
}
export function speechOpening(samples) {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  return rms <= .012 ? 0 : clamp(Math.pow((rms - .012) * 7, .72));
}
export function approach(value, target, dt, seconds) {
  return value + (target - value) * (1 - Math.exp(-Math.max(0, dt) / seconds));
}
// Damped secondary movement: hold the hair root while the rig bends the tips.
export class HairSpring {
  value = 0;
  velocity = 0;
  update(target, dt) {
    let remaining = clamp(dt, 0, .1);
    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120);
      this.velocity += (28 * (clamp(target, -.85, .85) - this.value) - 6 * this.velocity) * step;
      this.value += this.velocity * step;
      remaining -= step;
    }
    return clamp(this.value, -1, 1);
  }
}
