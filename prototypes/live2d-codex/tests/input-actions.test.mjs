import test from 'node:test';
import assert from 'node:assert/strict';
import actions from '../backend/input-actions.cjs';
const { INPUT_ACTIONS, DEFAULT_SHORTCUTS, DEFAULT_REMOTE_KEYS, registerInputActions } = actions;
function fixture() {
  const callbacks = new Map(), calls = [];
  const native = { unregisterAll: () => callbacks.clear(), register: (key, action) => { callbacks.set(key, action); return true; } };
  const handlers = Object.fromEntries(Object.keys(INPUT_ACTIONS).map(id => [id, () => calls.push(id)]));
  return { native, handlers, callbacks, calls };
}
test('keyboard actions remain available with no remote and every action supports an independent remote binding', () => {
  const f = fixture();
  const settings = { shortcuts: DEFAULT_SHORTCUTS, remoteEnabled: false, remoteKeys: DEFAULT_REMOTE_KEYS };
  assert.deepEqual(registerInputActions(f.native, settings, f.handlers), []);
  for (const callback of f.callbacks.values()) callback();
  assert.deepEqual(f.calls.sort(), Object.keys(INPUT_ACTIONS).sort());
  assert.equal(f.callbacks.has('F8'), false);
  settings.remoteEnabled = true;
  settings.remoteKeys = Object.fromEntries(Object.keys(INPUT_ACTIONS).map((id, i) => [id, `F${13+i}`]));
  registerInputActions(f.native, settings, f.handlers); f.calls.length = 0;
  for (const key of Object.values(settings.remoteKeys)) f.callbacks.get(key)();
  assert.deepEqual(f.calls.sort(), Object.keys(INPUT_ACTIONS).sort());
});
test('conflicting aliases do not register competing actions and key learning suspends all bindings', () => {
  const f = fixture(), settings = { shortcuts: { readReply: 'Ctrl+Alt+R', send: 'Alt+Control+R' }, remoteEnabled: true, remoteKeys: { readReply: 'Control+Alt+R' } };
  const errors = registerInputActions(f.native, settings, f.handlers);
  assert.equal(errors.length, 1); assert.match(errors[0], /两个操作/); assert.equal(f.callbacks.size, 1);
  assert.deepEqual(registerInputActions(f.native, settings, f.handlers, { suspended: true }), []); assert.equal(f.callbacks.size, 0);
});
test('held-key repeat streams and the binding-capture key cannot repeatedly trigger recording or speech', () => {
  const f = fixture(); let time = 0;
  registerInputActions(f.native, { shortcuts: { record:'F8' }, remoteEnabled:false }, f.handlers, { now: () => time, resumeAt:1200 });
  f.callbacks.get('F8')(); time = 500; f.callbacks.get('F8')(); assert.equal(f.calls.length, 0);
  time = 2000; f.callbacks.get('F8')();
  for (time = 3000; time < 7000; time += 100) f.callbacks.get('F8')();
  assert.deepEqual(f.calls, ['record']);
  time = 8500; f.callbacks.get('F8')(); assert.deepEqual(f.calls, ['record','record']);
});
test('occupied or invalid native shortcuts are reported without disabling unrelated actions', () => {
  const f = fixture(), register = f.native.register;
  f.native.register = (key, handler) => key === 'F8' ? false : key === 'broken' ? (() => { throw Error('invalid'); })() : register(key, handler);
  const errors = registerInputActions(f.native, { shortcuts:{record:'F8',send:'broken',readReply:'F10'},remoteEnabled:false }, f.handlers);
  assert.equal(errors.length,2); f.callbacks.get('F10')(); assert.deepEqual(f.calls,['readReply']);
});

test('RC003 reserves conflicting global hotkeys including combinations and retains unrelated shortcuts', () => {
  const f=fixture(),settings={shortcuts:{send:'Ctrl+Alt+Enter',chat:'Return',record:'Ctrl+Alt+V'},remoteEnabled:true,remoteKeys:{readReply:'F5'}};
  const errors=registerInputActions(f.native,settings,f.handlers,{reserved:new Set(['enter','f5'])});
  assert.equal(errors.length,3);assert.deepEqual([...f.callbacks.keys()],['Ctrl+Alt+V']);
  registerInputActions(f.native,settings,f.handlers);assert.equal(f.callbacks.has('Return'),true);assert.equal(f.callbacks.has('F5'),true);
});
