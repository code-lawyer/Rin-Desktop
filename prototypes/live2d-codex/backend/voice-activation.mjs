// The resource installer owns cancellation; the app owns speech and settings.
export async function activateVoiceResource(id, signal, { speech, store, stopSpeech, isClosing, qwenDirectory, notifyWorkspace }) {
  const check = () => { signal.throwIfAborted(); if (isClosing()) throw new Error('应用正在退出。'); };
  check();
  if (id === 'asr') await speech.loadAsr();
  else {
    stopSpeech();
    const patch = { ttsEngine: id, ttsResident: true };
    if (id === 'qwen' && !speech.status().engines.qwen) patch.qwenRoot = qwenDirectory();
    await store.updateSettings(patch);
    check();
    await speech.configure(store.data.settings);
    if (speech.phase === 'error') throw new Error(speech.error);
  }
  check();
  notifyWorkspace();
}
