import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { StillSequence } from '../prototypes/live2d-codex/renderer/still-sequence.mjs';
import characters from '../prototypes/live2d-codex/backend/character-profiles.cjs';
import stillSettings from '../prototypes/live2d-codex/backend/still-settings.cjs';
import { stillPose, createIdleCycle, idleDuration, stillActivity } from '../prototypes/live2d-codex/renderer/still-policy.mjs';
import { isCharacterImageRequest } from '../tools/qa/character-asset-probe.mjs';
import { puppetPose, puppetActivity, replyHasStarted, THINK_DELAY_MS } from '../prototypes/live2d-codex/renderer/puppet-state.mjs';
import { REPLY_THINKING_POSE } from '../prototypes/live2d-codex/renderer/pose-assets.mjs';

const source = (await readFile(new URL('../prototypes/live2d-codex/renderer/still-wallpaper.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, { reload = true, pose = 'work', legacyVideo = false, realistic = false, motionPreparation = {} } = {}) {
  let receive, release, waiting = true;
  const ready = [], reports = [], decisions = [], draws = [], requests = [], puppets = [], motions = [], events = new Map();
  const context = { drawImage(...args) { draws.push(args); }, createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} };
  const host = { dataset: {}, clientWidth: 1280, clientHeight: 800, append() {} };
  const initial = { character: 'female', characterRequest: 0, paused: false, stills: { stillPose: pose, ambienceEnabled: false, wallpaperMotion: realistic, animePlayback: legacyVideo ? 'video' : 'poses' } };
  const document = { hidden: false, createElement: () => ({ getContext: () => context, remove() {} }), addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} };
  const api = {
    onPresentation(fn) { receive = fn; return () => {}; }, presentation: async () => ({ ok: true, value: initial }),
    avatarAnchor() {}, ambientApplied() {}, ambientStatus() {}, renderReady(info) { reports.push(info); if(ready.at(-1)?.join(':')!==[info.character,info.pose].join(':')) ready.push([info.character, info.pose]); },
    commitWallpaper(info) { return info.requestId > 0 && waiting ? new Promise(resolve => { release = () => { waiting = false; resolve({ ok: true, value: true }); }; }) : Promise.resolve({ ok: true, value: true }); },
    finishWallpaper(info, accept) { decisions.push([info.character, accept]); return { ok: true, value: accept }; },
  };
  const runtime = vm.createContext({ StillSequence, characters, stillSettings, stillPose, puppetPose, puppetActivity, replyHasStarted, THINK_DELAY_MS, REPLY_THINKING_POSE, createIdleCycle, idleDuration, stillActivity, console, document,
    loadMotionCatalog: async () => ({ posters: { work: 'app://local/assets/motion/female/work.png' } }),
    MotionWallpaper: class {
      static async prepare() {
        await motionPreparation.wait;
        if (motionPreparation.error) throw new Error(motionPreparation.error);
        const layer = new this(); motions.push(layer); return layer;
      }
      ready = true; start() { this.started = true; } update() {} close() { this.closed = true; }
    },
    performance: { now: () => 0 }, setTimeout: () => 1, clearTimeout() {}, window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    Image: class { get naturalWidth() { return this.src.includes('female-v2-4k') ? 3840 : 1586; } get naturalHeight() { return this.src.includes('female-v2-4k') ? 2400 : 992; } decode() { requests.push(this.src); return Promise.resolve(); } },
    ResizeObserver: class { observe() {} disconnect() {} },
    AmbientPreview: class { update() { return { rain: 0, keys: 0 }; } enable() { return Promise.resolve(true); } close() {} },
    PuppetWallpaper: class {
      static async prepare() { const puppet = new this(); puppets.push(puppet); return puppet; }
      player = { contextLost: false }; pose = 'work'; fit() {} activate() { this.active = true; }
      update(pose, presentation, hidden) { if (!presentation.paused && !hidden) this.pose = pose; }
      close() { this.closed = true; }
    },
  });
  vm.runInContext(source, runtime);
  const app = await runtime.startStillWallpaper({ host, api }); t.after(() => app.destroy()); await tick();
  let current = initial;
  const present = patch => { current = { ...current, ...patch, stills: { ...current.stills, ...patch.stills } }; receive(current); };
  if(reload) { present({ character: 'female', characterRequest: 1 }); await tick(); }
  return { host, ready, reports, draws, requests, decisions, puppets, motions, present, app, release: () => release(), hide(value) { document.hidden = value; events.get('visibilitychange')(); } };
}

test('realistic decoder failure cannot commit or close the working original renderer', async t => {
  const preparation = { error: 'video decode failed' };
  const h = await fixture(t, { reload: false, motionPreparation: preparation });
  const committed = h.decisions.length;
  h.present({ characterRequest: 1, stills: { wallpaperMotion: true } }); await tick();
  assert.equal(h.decisions.length, committed); assert.equal(h.puppets[0].closed, undefined);
  assert.equal(h.host.dataset.rig, 'scene'); assert.equal(h.reports.at(-1).ready, false);
  preparation.error = ''; h.present({ characterRequest: 2 }); await tick(); h.release(); await tick();
  assert.equal(h.decisions.at(-1)[1], true); assert.equal(h.motions[0].started, true); assert.equal(h.puppets[0].closed, true);
});

for (const failure of ['video decode failed', 'initial play failed']) test(`saved realistic mode paints its poster after ${failure} on first launch and permits retry`, async t => {
  const preparation = { error: failure };
  const h = await fixture(t, { reload: false, realistic: true, motionPreparation: preparation });
  assert.equal(h.reports.at(-1).ready, false); assert.equal(h.reports.at(-1).wallpaperMotion, true);
  assert.match(h.requests[0], /motion\/female\/work\.png/);
  assert.ok(h.draws.length >= 2, 'the decoded poster is composed and painted into the visible canvas');
  assert.equal(h.decisions.length, 0); assert.equal(h.puppets.length, 0);
  preparation.error = ''; h.present({ characterRequest: 1 }); await tick(); h.release(); await tick();
  assert.equal(h.decisions.at(-1)[1], true); assert.equal(h.motions[0].started, true); assert.equal(h.host.dataset.rig, 'motion');
});

test('a decoded realistic candidate that fails while saving is discarded before commit', async t => {
  const h = await fixture(t, { reload: false });
  h.present({ characterRequest: 1, stills: { wallpaperMotion: true } }); await tick();
  h.motions[0].ready = false; h.release(); await tick();
  assert.equal(h.decisions.at(-1)[1], false); assert.equal(h.puppets[0].closed, undefined);
  assert.equal(h.motions[0].closed, true); assert.equal(h.motions[0].started, undefined);
});

test('a changed style request disposes its late decoded video without saving or playing it', async t => {
  const preparation = Promise.withResolvers();
  const h = await fixture(t, { reload: false, motionPreparation: { wait: preparation.promise } });
  h.present({ characterRequest: 1, stills: { wallpaperMotion: true } }); await tick();
  assert.equal(h.motions.length, 0); assert.equal(h.puppets[0].closed, undefined);
  h.present({ characterRequest: 2, stills: { wallpaperMotion: false } }); preparation.resolve(); await tick();
  assert.equal(h.motions[0].closed, true); assert.equal(h.motions[0].started, undefined);
  assert.equal(h.decisions.length, 1); h.release(); await tick();
  assert.equal(h.host.dataset.rig, 'scene');
});

test('wallpaper fault injection matches actual anime requests and only approved realistic poster routes', async t => {
  const h=await fixture(t);
  assert.ok(h.requests.length);
  for(const url of h.requests)assert.equal(isCharacterImageRequest(url,'anime'),true);
  assert.equal(isCharacterImageRequest('app://local/assets/motion/female/work.png?attempt=1','realistic'),true);
  for(const url of ['app://local/assets/stills/male/work.png','https://local/assets/stills/female-v2-4k/work.png','app://local/assets/ambience/rain.mp3'])for(const style of ['anime','realistic'])assert.equal(isCharacterImageRequest(url,style),false);
});

test('legacy anime video input loads original poses without requesting the withdrawn media', async t => {
  const h = await fixture(t, { reload: false, legacyVideo: true, pose: 'window' });
  assert.equal(h.reports.at(-1).ready, true); assert.equal(h.reports.at(-1).animePlayback, 'poses');
  assert.equal(h.reports.at(-1).model, 'rin-scene'); assert.equal(h.reports.at(-1).pose, 'window');
  assert.match(h.requests[0], /female-v2-4k\/attention\.png/);
  assert.equal(h.requests.some(url => url.includes('/motion/anime/')), false);
  assert.equal(h.decisions.at(-1)[1], true); assert.equal(h.puppets.length, 1); assert.equal(h.motions.length, 0);
});

test('anime states reuse one scene and preserve its full-size original loading fallback', async t => {
  const h=await fixture(t,{reload:false,pose:'cup'});
  const imageDraws=h.draws.filter(args=>args[0]?.src);
  assert.equal(imageDraws.length,1);
  assert.match(imageDraws[0][0].src,/stills\/female-v2-4k\/attention\.png/);
  assert.equal(imageDraws[0].length,3,'draw the full image, not a cropped head region');
  assert.equal(h.reports.at(-1).activity,'manual');
  assert.equal(h.reports.at(-1).model,'rin-scene');
  assert.equal(h.reports.at(-1).sourceWidth,3840);
  assert.equal(h.reports.at(-1).sourceHeight,2400);
  h.present({stills:{stillPose:'window'}});await tick();
  assert.equal(h.puppets.length,1);assert.equal(h.host.dataset.pose,'window');
  h.present({paused:true});assert.equal(h.reports.at(-1).activity,'paused');
  assert.equal(h.host.dataset.pose,'window');
});

test('GPU loss during commit preparation rejects the candidate without closing the healthy model', async t => {
  const h=await fixture(t);h.puppets[1].failed=true;h.puppets[1].player.contextLost=true;
  h.release();await tick();
  assert.deepEqual(h.decisions.at(-1),['female',false]);
  assert.equal(h.puppets[0].closed,undefined);assert.equal(h.puppets[1].closed,true);
  assert.equal(h.reports.at(-1).ready,false);assert.equal(h.host.dataset.rig,'scene');
});

test('a manual anime pose reports its effective wake activity and restores manual after conversation', async t => {
  const h = await fixture(t, { reload: false, pose: 'cup' });
  for (const [flag, activity] of [['chatVisible', 'chat'], ['capturing', 'capturing'], ['speaking', 'speaking']]) {
    h.present({ [flag]: true });
    assert.equal(h.reports.at(-1).pose, 'attention');
    assert.equal(h.reports.at(-1).activity, activity);
    h.present({ [flag]: false });
    assert.equal(h.reports.at(-1).pose, 'cup');
    assert.equal(h.reports.at(-1).activity, 'manual');
  }
  h.present({ paused: true, chatVisible: true });
  assert.equal(h.reports.at(-1).activity, 'paused');
  h.present({ paused: false });
  h.hide(true);
  assert.equal(h.reports.at(-1).activity, 'hidden');
});

for (const mode of ['paused', 'hidden']) test(`${mode} during preparation keeps the visible character; resume commits only the latest frame`, async t => {
  const h = await fixture(t);
  if (mode === 'paused') h.present({ paused: true }); else h.hide(true);
  h.release(); await tick();
  assert.equal(h.host.dataset.character, 'female'); assert.deepEqual(h.ready, [['female', 'work']]);
  assert.deepEqual(h.decisions.at(-1), ['female', false]);
  h.present({ stills: { stillPose: 'attention', ambienceEnabled: false } });
  if (mode === 'paused') h.present({ paused: false }); else h.hide(false);
  await tick(); assert.deepEqual(h.ready, [['female', 'work'], ['female', 'attention']]);
  assert.deepEqual(h.decisions.at(-1), ['female', true]);
});

test('a newer pose during model preparation applies to the retained and replacement rigs without another model load', async t => {
  const h = await fixture(t); h.present({ stills: { stillPose: 'attention', ambienceEnabled: false } });
  h.release(); await tick(); assert.deepEqual(h.ready, [['female', 'work'], ['female', 'attention']]);
  assert.deepEqual(h.decisions.slice(1), [['female', true]]);
  assert.equal(h.puppets.length,2);assert.ok(h.puppets[0].closed);assert.equal(h.puppets[1].pose,'attention');
});

test('closing during preparation cancels without accepting or painting the replacement', async t => {
  const h = await fixture(t); h.app.destroy(); h.release(); await tick();
  assert.deepEqual(h.ready, [['female', 'work']]); assert.deepEqual(h.decisions.at(-1), ['female', false]);
});
