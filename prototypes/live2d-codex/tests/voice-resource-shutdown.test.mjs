import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VoiceResources } from '../backend/voice-resources.mjs';
import { ResidentSpeech } from '../backend/resident-speech.mjs';
import { activateVoiceResource } from '../backend/voice-activation.mjs';

// Exercise the application's real activation boundary with controllable I/O.
const manifest = JSON.parse(await readFile(new URL('../voice-resources.json', import.meta.url), 'utf8'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
for (const stage of ['saving', 'loading']) {
  test(`shutdown during ${stage} leaves no speech worker`, async () => {
    const saved = deferred(), entered = deferred(), loaded = deferred();
    let loads = 0, closed = 0;
    const speech = new ResidentSpeech('unused', { factory: () => ({
      load() { loads++; entered.resolve(); return loaded.promise; },
      async close() { closed++; loaded.reject(Error('closed')); }
    }) });
    const store = {
      data: { settings: {} },
      async updateSettings(patch) {
        this.data.settings = { ...this.data.settings, ...patch };
        if (stage === 'saving') { entered.resolve(); await saved.promise; }
      }
    };
    let closing = false;
    const activate = (id, signal) => activateVoiceResource(id, signal, {
      speech, store, stopSpeech() {}, notifyWorkspace() {}, isClosing: () => closing,
      qwenDirectory: () => resources.directory('qwen')
    });
    const resources = new VoiceResources(resolve('unused-shutdown-fixture'), manifest, { activate });
    const operation = resources.start('qwen', { existing: true });
    const rejected = assert.rejects(operation, /退出/);
    await entered.promise; closing = true;
    const resourceClose = resources.close(), earlySpeechClose = speech.close(); saved.resolve();
    await Promise.allSettled([resourceClose, earlySpeechClose]); await speech.close(); await rejected;
    assert.equal(resources.active, null); assert.equal(speech.worker, null); assert.equal(speech.phase, 'unloaded');
    assert.equal(loads, stage === 'saving' ? 0 : 1); assert.equal(closed, stage === 'saving' ? 0 : 1);
  });
}
