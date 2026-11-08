import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ActionMotion, ACTIONS, rigPose } from '../prototypes/live2d-codex/renderer/action-motion.mjs';
import { buildBodyMesh, bodyPoint } from '../prototypes/live2d-codex/renderer/rig-warp.mjs';
import { validateRig } from '../prototypes/live2d-codex/renderer/action-assets.mjs';

function advance(motion, seconds) {
  let frame;
  for (let t = 0; t < seconds; t += 1 / 60) frame = motion.step(1 / 60);
  return frame;
}

test('all single gestures run from every pose, then restore the selected pose', () => {
  for (const pose of ['work', 'thinking', 'window', 'attention', 'cup'])
    for (const action of ACTIONS) {
      const motion = new ActionMotion();
      motion.request(pose);
      advance(motion, 5);
      assert.equal(motion.act(action), true);
      const performed = new Set();
      for (let i = 0; i < 1500; i++) {
        const frame = motion.step(1 / 60);
        if (frame.action) performed.add(frame.action.id);
      }
      assert.ok(performed.has(action), `${pose}: ${action} must not silently disappear`);
      assert.equal(motion.pose, pose);
      assert.equal(motion.desired, pose);
      assert.equal(motion.action, null);
    }
});

test('interrupting each part of a drink returns the same cup before changing pose', () => {
  for (const elapsed of [2.0, 3.4, 4.5, 6.0, 7.5, 9.0]) {
    const motion = new ActionMotion();
    motion.request('cup');
    advance(motion, elapsed);
    motion.request('work');
    let last = rigPose(motion.snapshot()),
      seenHeld = last.cupHeld;
    for (let i = 0; i < 700; i++) {
      const frame = motion.step(1 / 60),
        state = rigPose(frame);
      seenHeld ||= state.cupHeld;
      const previous = last.cupHeld ? last.cupPosition : [1537, 718],
        current = state.cupHeld ? state.cupPosition : [1537, 718];
      assert.ok(
        Math.hypot(current[0] - previous[0], current[1] - previous[1]) < 7,
        'cup cannot teleport on interruption'
      );
      if (last.cupHeld && !state.cupHeld)
        assert.deepEqual(state.cupPosition, [1537, 718], 'release only on the table');
      if (frame.pose === 'work') assert.equal(state.cupHeld, false);
      last = state;
    }
    assert.equal(motion.pose, 'work');
    assert.equal(motion.cup.held, false);
  }
});

test('rapid selections have a bounded gesture queue and settle on the latest request', () => {
  const motion = new ActionMotion();
  motion.request('cup');
  advance(motion, 5);
  for (let i = 0; i < 50; i++) {
    motion.act(ACTIONS[i % 4]);
    motion.request(i % 2 ? 'window' : 'thinking');
    motion.step(1 / 60);
  }
  motion.request('work');
  advance(motion, 30);
  assert.equal(motion.pose, 'work');
  assert.equal(motion.action, null);
  assert.equal(motion.pending, null);
  assert.equal(motion.act('../invalid'), false);
});

test('reduced motion cancels gestures and places the cup on its table', () => {
  const motion = new ActionMotion();
  motion.request('cup');
  advance(motion, 5);
  motion.act('wave');
  const frame = motion.step(0.1, { reduced: true });
  assert.equal(frame.action, null);
  assert.equal(motion.pending, null);
  assert.equal(frame.cup.held, false);
  assert.deepEqual(rigPose(frame, { reduced: true }).cupPosition, [1537, 718]);
});

test('turning a palm never collapses the whole hand to a thin sliver', () => {
  for (const pose of ['work', 'thinking', 'cup'])
    for (let amount = 0; amount <= 1; amount += 0.002) {
      const state = rigPose({ pose, amount, cup: { reach: amount, lift: 0, held: false } });
      assert.ok(state.handTurn >= 0.4, pose + ' must retain visible palm thickness');
    }
  for (let time = 0; time <= 6.8; time += 0.01)
    assert.ok(rigPose({ pose: 'attention', amount: 1, action: { id: 'wave', time } }).handTurn >= 0.4);
});

test('the bounded head turn cannot fold the face mesh; seat contacts stay fixed', () => {
  const mesh = buildBodyMesh();
  for (const yaw of [-0.24, 0, 0.36, 0.72]) {
    for (let i = 0; i < mesh.length; i += 3) {
      const p = mesh.slice(i, i + 3).map(({ p, d }) => [p[0] + d[0] * yaw, p[1] + d[1] * yaw]);
      const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
      assert.ok(area > 0, `head mesh fold at ${JSON.stringify(p)} / ${yaw}`);
    }
    const state = rigPose({ pose: 'window', amount: 1 }, { time: 2, breath: 2, hair: 1 });
    assert.deepEqual(bodyPoint([1195, 680], state), [1195, 680]);
  }
});

test('rig data rejects duplicate layers, escaped names, invalid geometry and zero-length bones', async () => {
  const original = JSON.parse(
    await readFile(new URL('../prototypes/live2d-codex/assets/scene/rin/rig.json', import.meta.url), 'utf8')
  );
  validateRig(original);
  for (const change of [
    (r) => (r.layers[1] = r.layers[0]),
    (r) => (r.layers[0].name = '../secret'),
    (r) => (r.layers[0].rect[2] = Infinity),
    (r) =>
      (r.layers[0].bone = [
        [0, 0],
        [0, 0],
      ]),
  ]) {
    const rig = structuredClone(original);
    change(rig);
    assert.throws(() => validateRig(rig), /配置无效/);
  }
});

test('the production IPC rejects all retired skeletal gestures', async () => {
  const source = await readFile(new URL('../prototypes/live2d-codex/main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf("    handler('wallpaper:control'"),
    end = source.indexOf("    handler('wallpaper:commit'", start);
  let handler;
  const sent = [],
    workbench = { webContents: {} },
    avatar = { isDestroyed: () => false, webContents: { send: (...x) => sent.push(x) } };
  const context = vm.createContext({
    handler: (_name, fn) => {
      handler = fn;
    },
    workbench,
    avatar,
    wallpaperMode: true,
    wallpaperStatus: { phase: 'ready', wallpaperMotion: false },
    manualPause: false,
    workspaceSnapshot: () => ({}),
  });
  vm.runInContext(source.slice(start, end), context);
  assert.throws(() => handler({ sender: {} }, 'gesture', 'wave'));
  assert.throws(() => handler({ sender: workbench.webContents }, 'gesture', 'invalid'));
  context.manualPause = true;
  assert.throws(() => handler({ sender: workbench.webContents }, 'gesture', 'wave'));
  context.manualPause = false;
  context.wallpaperStatus.wallpaperMotion = true;
  assert.throws(() => handler({ sender: workbench.webContents }, 'gesture', 'wave'));
  context.wallpaperStatus.wallpaperMotion = false;
  for (const action of ['nod','shake','tilt','wave'])
    assert.throws(() => handler({ sender: workbench.webContents }, 'gesture', action), /已停用/);
  assert.deepEqual(sent, []);
});
