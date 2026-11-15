import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../prototypes/live2d-codex/renderer/motion-wallpaper.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '') + '\nMotionWallpaper;';

for (const failure of ['', 'prepare', 'play', 'present']) test(`realistic preflight ${failure || 'success'} validates playback before handing over ownership`, async () => {
  const calls = [], elements = [], decks = [];
  const layerClass = vm.runInNewContext(source, {
    AbortController,
    document: { createElement: () => { const element = { setAttribute() {}, remove() { this.removed = true; } }; elements.push(element); return element; } },
    VideoDeck: class {
      constructor(element) { this.element = element; this.ready = true; decks.push(this); }
      async prepare() { calls.push('prepare'); if (failure === 'prepare') throw new Error('decode failed'); }
      async play() { calls.push('play'); if (failure === 'play') throw new Error('play failed'); }
      async present() { calls.push('present'); if (failure === 'present') throw new Error('no presentation frame'); }
      pause() { calls.push('pause'); }
      async seek(time) { calls.push(['seek', time]); }
    },
    MotionPlayer: class { close() { calls.push('close'); } },
  });
  const options = { host: { append() {} }, catalog: { clips: new Map([['work-loop', { id: 'work-loop' }]]) }, changed() {} };
  if (failure) {
    await assert.rejects(layerClass.prepare(options));
    assert.ok(elements.every(element => element.removed)); assert.equal(calls.at(-1), 'close');
  } else {
    const layer = await layerClass.prepare(options);
    assert.deepEqual(calls, ['prepare', 'play', 'present', 'pause', ['seek', 0]]);
    assert.equal(layer.ready, true); decks[0].ready = false; assert.equal(layer.ready, false);
    layer.close(); assert.equal(layer.controller.signal.aborted, true); assert.ok(elements.every(element => element.removed));
  }
});
