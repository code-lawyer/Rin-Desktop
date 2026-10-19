// Authored press/hold/release beats with reading pauses. A perpetual sine wave
// makes a photographic hand patch look like vibration, even at small amplitudes.
const beats = [
  [.25,'left',.46,.45], [.82,'right',.44,.5], [1.36,'left',.48,.4],
  [1.94,'right',.46,.52], [2.55,'left',.42,.38],
  [4.3,'right',.46,.48], [4.92,'left',.45,.42], [5.53,'right',.5,.46],
  [6.2,'left',.43,.36],
];
const smooth = t => t * t * (3 - 2 * t);
export function typingMotion(seconds) {
  const phase = ((seconds % 9.8) + 9.8) % 9.8, values = { left:0, right:0 };
  for (const [start, hand, duration, strength] of beats) {
    const t = (phase - start) / duration;
    if (t <= 0 || t >= 1) continue;
    const amount = t < .3 ? smooth(t / .3) : t < .42 ? 1 : 1 - smooth((t - .42) / .58);
    values[hand] = Math.max(values[hand], amount * strength);
  }
  return values;
}
