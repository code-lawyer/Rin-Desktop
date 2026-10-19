function wallpaperState(state = {}, presentation = {}) {
  const attention = state.connection === 'error' || state.status === 'waiting' || state.status === 'error';
  const working = ['starting', 'working', 'stopping'].includes(state.status);
  const looking = attention || (!working && !!presentation.chatVisible);
  return { pose: looking ? 'attention' : 'typing', typing: !looking, paused: !!presentation.paused };
}
module.exports = { wallpaperState };
