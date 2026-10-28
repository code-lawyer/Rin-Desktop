// Explicitly invoked from the preview's verification button. Uses real HTML media decoding.
// No accounts, microphone, speech engine or external wallpaper host are involved.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function verifyVideoPlayback({ player, scenes, decks, signal, progress }) {
  const started = performance.now(), checks = [];
  const assert = (condition, message, details = {}) => { if (!condition) throw new Error(message); checks.push({ check: message, ...details }); };
  const alive = () => { if (signal.aborted) throw new DOMException('Verification cancelled', 'AbortError'); };
  const until = async (predicate, timeout = 10000) => {
    const deadline = performance.now() + timeout;
    while (!predicate()) { alive(); if (performance.now() > deadline) throw new Error('等待播放状态超时'); await delay(50); }
  };
  let samples = 0, missingVisibleFrame = 0, monitor;
  try {
    progress('正在检查连续 10 次自然循环，请保持预览可见。');
    await player.setPaused(false); await player.select(scenes[0]); alive();
    assert(player.current?.id === scenes[0].id && !player.error, 'First scene decoded');
    const initialLoops = player.loops;
    monitor = setInterval(() => {
      samples++;
      const visible = decks.filter(deck => deck.visible);
      if (visible.length !== 1 || !visible[0].ready || !visible[0].element.videoWidth) missingVisibleFrame++;
      progress(`连续循环 ${player.loops - initialLoops} / 10 · 已检查 ${samples} 次画面状态`);
    }, 100);
    await until(() => player.loops >= initialLoops + 10 || player.error, 190000);
    clearInterval(monitor);
    assert(!player.error && player.loops >= initialLoops + 10, 'Ten natural loops completed', { loops: player.loops - initialLoops });
    assert(missingVisibleFrame === 0, 'Decoded visible deck retained throughout loops', { samples, missingVisibleFrame });
    progress('正在检查暂停、切换、加载失败与重试。');
    await player.setPaused(true); const pausedTime = player.active.time; await delay(450); alive();
    assert(Math.abs(player.active.time - pausedTime) < .03, 'Pause freezes the video');
    await player.setSuspended(true); await player.setPaused(false); const hiddenTime = player.active.time; await delay(180);
    assert(Math.abs(player.active.time - hiddenTime) < .03, 'Suspension overrides manual resume');
    await player.setSuspended(false); await until(() => player.active.time > hiddenTime + .1);
    assert(true, 'Resume advances the video');
    for (const scene of scenes.slice(1)) {
      alive(); await player.select(scene);
      assert(player.current?.id === scene.id && !player.error, `Switch to ${scene.id}`);
      const loops = player.loops; await player.nearBoundary();
      await until(() => player.loops > loops || player.error);
      assert(!player.error && player.loops > loops, `Loop boundary for ${scene.id}`);
    }
    alive(); const previous = player.current, previousDeck = player.active;
    await player.select(scenes[0], { sourceOverride: '/media/missing-test-video.webm' });
    assert(Boolean(player.error) && player.current === previous && player.active === previousDeck && previousDeck.visible && previousDeck.element.paused, 'Failed load preserves the current paused frame');
    await player.retry();
    assert(!player.error && player.current.id === scenes[0].id, 'Retry recovers the requested scene');
    const pending = scenes.map(scene => player.select(scene)); await Promise.all(pending);
    assert(player.current.id === scenes.at(-1).id && !player.error, 'Rapid requests keep only the newest selection');
    await player.setPaused(true); await player.select(scenes[0], { entry: true });
    assert(player.manualPaused && player.active.element.paused && player.active.time < .1, 'Entry selection respects manual pause');
    await player.setPaused(false); await until(() => player.active.time > .2);
    assert(true, 'Entry playback resumes from the beginning');
    const history = player.snapshot().history;
    return { status: 'passed', durationSeconds: Math.round((performance.now() - started) / 1000), checks, naturalLoopCount: 10, frameStateSamples: samples, missingVisibleFrame, maxHandoffMs: Math.max(...history.filter(item => item.latencyMs !== undefined).map(item => item.latencyMs)), playbackQuality: decks.map(deck => ({ total: deck.element.getVideoPlaybackQuality?.().totalVideoFrames ?? null, dropped: deck.element.getVideoPlaybackQuality?.().droppedVideoFrames ?? null })), history };
  } catch (error) { return { status: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message, durationSeconds: Math.round((performance.now() - started) / 1000), checks, history: player.snapshot().history }; }
  finally { clearInterval(monitor); }
}
