// The wallpaper follows the same completed turn that the chat can narrate.
function createReplyNarration(publish, deliver) {
  let cue = null;
  function set(next) {
    if (cue?.turnId === next?.turnId && cue?.mode === next?.mode) return;
    cue = next;
    publish();
  }
  return {
    get cue() { return cue; },
    complete(reply, { available, autoSpeak, prepareSpeech }) {
      if (!available || !reply.turnId) return;
      set({ turnId: reply.turnId, mode: autoSpeak ? 'automatic' : 'manual' });
      if (autoSpeak || prepareSpeech) deliver({ ...reply, automatic: !!autoSpeak });
    },
    settle(turnId) {
      if (cue && cue.turnId === turnId) set(null);
    },
    clear() { set(null); },
  };
}

module.exports = { createReplyNarration };
