import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { StillSequence } from '../prototypes/live2d-codex/renderer/still-sequence.mjs';
import characters from '../prototypes/live2d-codex/backend/character-profiles.cjs';
import stillSettings from '../prototypes/live2d-codex/backend/still-settings.cjs';
import { stillPose, createIdleCycle, idleDuration, stillActivity } from '../prototypes/live2d-codex/renderer/still-policy.mjs';

const source = (await readFile(new URL('../prototypes/live2d-codex/renderer/still-wallpaper.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, { switchMale = true, pose = 'work' } = {}) {
  let receive, release, waiting = true;
  const ready = [], reports = [], decisions = [], draws = [], events = new Map();
  const context = { drawImage(...args) { draws.push(args); }, createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} };
  const host = { dataset: {}, clientWidth: 1280, clientHeight: 800, append() {} };
  const initial = { character: 'female', characterRequest: 0, paused: false, stills: { stillPose: pose, ambienceEnabled: false } };
  const document = { hidden: false, createElement: () => ({ getContext: () => context, remove() {} }), addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} };
  const api = {
    onPresentation(fn) { receive = fn; return () => {}; }, presentation: async () => ({ ok: true, value: initial }),
    avatarAnchor() {}, ambientApplied() {}, ambientStatus() {}, renderReady(info) { reports.push(info); if(ready.at(-1)?.join(':')!==[info.character,info.pose].join(':')) ready.push([info.character, info.pose]); },
    commitWallpaper(info) { return info.requestId > 0 && waiting ? new Promise(resolve => { release = () => { waiting = false; resolve({ ok: true, value: true }); }; }) : Promise.resolve({ ok: true, value: true }); },
    finishWallpaper(info, accept) { decisions.push([info.character, accept]); return { ok: true, value: accept }; },
  };
  const runtime = vm.createContext({ StillSequence, characters, stillSettings, stillPose, createIdleCycle, idleDuration, stillActivity, console, document,
    performance: { now: () => 0 }, setTimeout: () => 1, clearTimeout() {}, window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    Image: class { get naturalWidth() { return this.src.includes('female-v2-4k') ? 3840 : 1586; } get naturalHeight() { return this.src.includes('female-v2-4k') ? 2400 : 992; } decode() { return Promise.resolve(); } },
    ResizeObserver: class { observe() {} disconnect() {} },
    AmbientPreview: class { update() { return { rain: 0, keys: 0 }; } enable() { return Promise.resolve(true); } close() {} },
  });
  vm.runInContext(source, runtime);
  const app = await runtime.startStillWallpaper({ host, api }); t.after(() => app.destroy()); await tick();
  let current = initial;
  const present = patch => { current = { ...current, ...patch }; receive(current); };
  if(switchMale) { present({ character: 'male', characterRequest: 1 }); await tick(); }
  return { host, ready, reports, draws, decisions, present, app, release: () => release(), hide(value) { document.hidden = value; events.get('visibilitychange')(); } };
}

test('female frames preserve the entire new pose and report manual/pause state without loading the old work body', async t => {
  const h=await fixture(t,{switchMale:false,pose:'cup'});
  const imageDraws=h.draws.filter(args=>args[0]?.src);
  assert.equal(imageDraws.length,1);
  assert.match(imageDraws[0][0].src,/stills\/female-v2-4k\/cup\.png/);
  assert.equal(imageDraws[0].length,3,'draw the full image, not a cropped head region');
  assert.equal(h.reports.at(-1).activity,'manual');
  assert.equal(h.reports.at(-1).sourceWidth,3840);
  assert.equal(h.reports.at(-1).sourceHeight,2400);
  h.present({paused:true});assert.equal(h.reports.at(-1).activity,'paused');
  assert.equal(h.host.dataset.pose,'cup');
});

for (const mode of ['paused', 'hidden']) test(`${mode} during preparation keeps the visible character; resume commits only the latest frame`, async t => {
  const h = await fixture(t);
  if (mode === 'paused') h.present({ paused: true }); else h.hide(true);
  h.release(); await tick();
  assert.equal(h.host.dataset.character, 'female'); assert.deepEqual(h.ready, [['female', 'work']]);
  assert.deepEqual(h.decisions.at(-1), ['male', false]);
  h.present({ stills: { stillPose: 'attention', ambienceEnabled: false } });
  if (mode === 'paused') h.present({ paused: false }); else h.hide(false);
  await tick(); assert.deepEqual(h.ready, [['female', 'work'], ['male', 'attention']]);
  assert.deepEqual(h.decisions.at(-1), ['male', true]);
});

test('a newer pose during preparation never paints the obsolete pose', async t => {
  const h = await fixture(t); h.present({ stills: { stillPose: 'attention', ambienceEnabled: false } });
  h.release(); await tick(); assert.deepEqual(h.ready, [['female', 'work'], ['male', 'attention']]);
  assert.deepEqual(h.decisions.slice(1), [['male', false], ['male', true]]);
});

test('closing during preparation cancels without accepting or painting the replacement', async t => {
  const h = await fixture(t); h.app.destroy(); h.release(); await tick();
  assert.deepEqual(h.ready, [['female', 'work']]); assert.deepEqual(h.decisions.at(-1), ['male', false]);
});
