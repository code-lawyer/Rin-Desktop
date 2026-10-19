// A short local chime, independent of ASR/TTS. Each playback releases its audio
// context, including cancellation or a missing/blocked audio output device.
export function createCompletionSound(createContext = () => new AudioContext()) {
  const active = new Set();
  async function play() {
    const context = createContext();
    let finish, fail;
    const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const playback = { finish }; active.add(playback);
    const timeout = setTimeout(() => fail(new Error('提示音播放超时。')), 3000);
    Promise.resolve().then(() => context.resume()).then(() => {
      if (!active.has(playback)) return;
      const start = context.currentTime + 0.02;
      [659.25, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator(), envelope = context.createGain();
        const at = start + index * 0.19, duration = index ? 0.32 : 0.25;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(index ? 0.14 : 0.16, at + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(envelope); envelope.connect(context.destination);
        if (index === 1) oscillator.onended = finish;
        oscillator.start(at); oscillator.stop(at + duration + 0.015);
      });
    }).catch(fail);
    return done.finally(async () => {
      clearTimeout(timeout); active.delete(playback);
      if (context.state !== 'closed') await context.close();
    });
  }
  function stop() { for (const playback of active) playback.finish(); active.clear(); }
  return { play, stop };
}

export function installCompletionSound(api) {
  const sound = createCompletionSound();
  const dispose = api.onCompletionSound(event => {
    if (event?.action === 'stop') sound.stop();
    else if (event?.action === 'play') sound.play().catch(error => console.warn('[completion-sound]', error.message));
  });
  window.addEventListener('beforeunload', () => { dispose(); sound.stop(); });
}
