import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';
import wallpaper from '../backend/wallpaper-host.cjs';

function fakeHost(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const children = [];
  const statuses = [];
  let canStart = true;
  const host = new wallpaper.WallpaperHost({ getNativeWindowHandle: () => Buffer.alloc(8) }, {
    canStart: () => canStart,
    launch() {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.commands = [];
      child.stdin.on('data', bytes => child.commands.push(String(bytes)));
      child.reply = (data) => child.stdout.write(JSON.stringify(data) + '\n');
      child.kill = t.mock.fn(() => child.emit('close', 1));
      children.push(child);
      return child;
    },
  });
  host.on('status', value => statuses.push(value));
  return { host, children, statuses, tick: milliseconds => t.mock.timers.tick(milliseconds), setCanStart: value => { canStart = value; } };
}

const attached = { ok: true, attached: true, occluded: false };

test('missing Explorer retires the helper and retries after it closes; a new helper can attach', t => {
  const { host, children, statuses, tick } = fakeHost(t);
  host.start();
  assert.equal(host.status.phase, 'loading');
  const [first] = children;
  first.reply({ ok: false, attached: false, error: 'desktop unavailable' });
  assert.equal(host.status.phase, 'error');
  assert.equal(host.status.error, 'desktop unavailable');
  assert.equal(host.status.attached, false);
  assert.deepEqual(first.commands, ['quit\n']);
  tick(2000);
  assert.equal(children.length, 1, 'no replacement before cleanup');
  first.emit('close', 0);
  tick(2000);
  assert.equal(children.length, 2);
  const [, second] = children;
  second.reply(attached);
  assert.equal(host.status.phase, 'ready');
  first.reply({ ok: false, attached: false, error: 'stale child' });
  assert.equal(host.status.phase, 'ready');
  tick(2000);
  assert.deepEqual(second.commands, ['ensure\n']);
  second.reply(attached);
  second.emit('close', 1);
  assert.equal(host.status.phase, 'error');
  tick(2000);
  assert.equal(children.length, 3, 'an established helper exiting is recoverable');
  assert.deepEqual(statuses.map(s => s.phase), ['loading', 'error', 'loading', 'ready', 'ready', 'error', 'loading']);
});

test('unresponsive helper closes within the timeout, retries are bounded, and explicit retry is available', t => {
  const { host, children, tick } = fakeHost(t);
  host.start();
  tick(15000);
  assert.match(host.status.error, /桌面层连接超时/);
  tick(2500);
  assert.equal(children[0].kill.mock.callCount(), 1);
  for (let n = 1; n <= 3; n++) {
    tick(2000);
    assert.equal(children.length, n + 1);
    children[n].reply({ ok: false, attached: false, error: 'desktop unavailable' });
    children[n].emit('close', 0);
  }
  tick(20000);
  assert.equal(children.length, 4, 'consecutive failures stop automatic starts');
  host.retry();
  assert.equal(children.length, 5);
  children[4].reply(attached);
  assert.equal(host.status.phase, 'ready');
});

test('quitting blocks new helpers; a cancelled quit resumes attachment and final close ignores late readiness', async t => {
  const { host, children, statuses, tick, setCanStart } = fakeHost(t);
  setCanStart(false);
  host.start();
  assert.equal(children.length, 0);
  setCanStart(true);
  host.retry();
  const [first] = children;
  first.emit('close', 1);
  setCanStart(false);
  tick(2000);
  host.retry();
  assert.equal(children.length, 1);
  setCanStart(true);
  host.retry();
  assert.equal(children.length, 2);
  const closed = host.close();
  children[1].reply(attached);
  children[1].emit('close', 0);
  await closed;
  assert.equal(host.status.phase, 'loading');
  assert.deepEqual(statuses.map(s => s.phase), ['loading', 'error', 'loading']);
});

test('desktop attachment fails independently of the tray, shortcuts, Agent and open workbench', async () => {
  const main = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  const start = main.indexOf("    if (!wallpaperMode && argument('visual')");
  const finish = main.indexOf('  }).catch(error => {', start);
  assert.ok(start >= 0 && finish > start);
  const calls = [];
  class FakeHost extends EventEmitter {
    start() { calls.push('start-attachment'); this.emit('status', { ok: false, phase: 'error', error: 'desktop unavailable' }); }
  }
  const context = vm.createContext({
    wallpaperMode: true, nativeWallpaper: true, wallpaperHost: undefined, closing: false, quitting: false,
    argument: key => key === 'show' ? 'workbench' : undefined, packaged: true, portable: {}, provider: 'codex',
    screen: { on() {} }, avatar: {
      isDestroyed: () => false, isVisible: () => false, setIgnoreMouseEvents() {},
      showInactive() { calls.push('show-unattached'); }, hide() {},
    },
    WallpaperHost: FakeHost, Tray: class { constructor() { calls.push('tray'); } setToolTip() {} setContextMenu() {} on() {} },
    icon() {}, agentName: () => 'Codex', Menu: { buildFromTemplate: () => ({}) }, tray: null, trayMenu: null,
    showChat() {}, showWorkbench() { calls.push('workbench'); }, sendInputAction() {}, stopSpeech() {},
    registerShortcuts() { calls.push('shortcuts'); }, speech: { configure() {} }, store: { data: { settings: {} } },
    toggleChat() {}, remote: { start() {} }, backend: { async connect() { calls.push('agent'); } },
    notifyWorkspace() {}, notifyPresentation() {}, console: { error() { calls.push('attachment-error'); } },
    POSES: [], manualPause: false,
  });
  const hostSource = main.slice(main.indexOf('function startWallpaperHost()'), main.indexOf('function switchAllowed()'));
  vm.runInContext(hostSource, context);
  await vm.runInContext('(async () => {\n' + main.slice(start, finish) + '\n})()', context);
  assert.deepEqual(calls, ['tray', 'shortcuts', 'start-attachment', 'attachment-error', 'agent', 'workbench']);
});
