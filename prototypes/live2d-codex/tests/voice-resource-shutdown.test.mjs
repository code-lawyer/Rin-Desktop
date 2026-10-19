import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VoiceResources } from '../backend/voice-resources.mjs';
import { ResidentSpeech } from '../backend/resident-speech.mjs';

// Exercise the application's real activation boundary with controllable I/O.
const main = (await readFile(new URL('../main.cjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const start = main.indexOf('async (id, signal) => {', main.indexOf('activate:'));
const end = main.indexOf('\n      }\n    });', start);
assert.ok(start >= 0 && end > start, 'Actual activate callback was not found');
const source = main.slice(start, end + '\n      }'.length);
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
    const context = { closing: false, speech, store, stopSpeech() {}, notifyWorkspace() {}, voiceResources: null };
    const activate = vm.runInNewContext(`(${source})`, context);
    const resources = context.voiceResources = new VoiceResources(resolve('unused-shutdown-fixture'), manifest, { activate });
    const operation = resources.start('qwen', { existing: true });
    const rejected = assert.rejects(operation, /退出/);
    await entered.promise; context.closing = true;
    const resourceClose = resources.close(), earlySpeechClose = speech.close(); saved.resolve();
    await Promise.allSettled([resourceClose, earlySpeechClose]); await speech.close(); await rejected;
    assert.equal(resources.active, null); assert.equal(speech.worker, null); assert.equal(speech.phase, 'unloaded');
    assert.equal(loads, stage === 'saving' ? 0 : 1); assert.equal(closed, stage === 'saving' ? 0 : 1);
  });
}
