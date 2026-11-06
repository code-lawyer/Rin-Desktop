import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the production navigation handlers with controlled IPC timing.
// No Agent, account, filesystem project or Electron process is opened here.
const source = await readFile(new URL('../renderer/workbench.js', import.meta.url), 'utf8');
const navigation = source.slice(source.indexOf('async function selectProject('), source.indexOf('function renderThreads('));
function fixture() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, children: [], value: '', setAttribute() {}, replaceChildren(...children) { this.children = children; } });
    return elements.get(id);
  };
  const calls = [], requests = [];
  const context = vm.createContext({
    $, node: (tag, text) => ({ tag, text }), renderProjects() {}, updateActivity() {}, renderThreads() {},
    workspace: { projects: [{ id: 'a', name: 'Project A', cwd: 'C:/A' }, { id: 'b', name: 'Project B', cwd: 'C:/B' }] },
    current: { provider: 'codex', connection: 'ready', cwd: 'C:/A' }, projectId: 'a',
    selected: { id: 'old-thread' }, threads: [{ id: 'old-thread' }], listCursor: 'old-list-cursor', historyCursor: 'old-history-cursor', listVersion: 0, historyVersion: 0,
    api: { listThreads(...args) { calls.push(args); return new Promise((resolve, reject) => requests.push({ resolve, reject })); } },
    run: promise => promise,
  });
  vm.runInContext('function available() { return current.connection === "ready"; }\n' + navigation, context);
  return { context, $, calls, requests };
}

test('switching projects while offline clears the previous conversation and pagination', async () => {
  const { context, $, calls } = fixture();
  $('threads').replaceChildren({ text: 'Project A conversation' });
  $('history').replaceChildren({ text: 'Project A history' });
  context.current.connection = 'error';
  await context.selectProject('b');
  assert.equal($('project-title').textContent, 'Project B');
  assert.equal(context.threads.length, 0);
  assert.equal($('threads').children.some(child => child.text === 'Project A conversation'), false);
  assert.equal($('history').children.length, 0);
  assert.equal(context.listCursor, null); assert.equal(context.historyCursor, null);
  assert.equal($('more-threads').hidden, true); assert.equal($('more-history').hidden, true);
  assert.equal(context.selected, null); assert.equal(calls.length, 0);
});

for (const fails of [false, true]) test(`an old list ${fails ? 'failure' : 'response'} cannot repaint after an offline round trip`, async () => {
  const { context, $, requests } = fixture();
  const old = context.refreshThreads();
  context.current.connection = 'error';
  await context.selectProject('b'); await context.selectProject('a');
  const visible = JSON.stringify($('threads').children);
  if (fails) requests[0].reject(new Error('old request failed'));
  else requests[0].resolve({ data: [{ id: 'stale-thread' }], nextCursor: 'stale-cursor' });
  await old;
  assert.equal(context.threads.length, 0); assert.equal(context.listCursor, null);
  assert.equal(JSON.stringify($('threads').children), visible);
});

test('a new project hides old pagination while loading and accepts only its own cursor', async () => {
  const { context, $, calls, requests } = fixture();
  const pending = context.selectProject('b');
  assert.equal($('more-threads').hidden, true); assert.equal(context.listCursor, null);
  assert.deepEqual(calls[0], ['b', null, '', 'codex']);
  requests[0].resolve({ data: [{ id: 'b-thread' }], nextCursor: 'b-cursor' }); await pending;
  assert.equal(context.threads[0].id, 'b-thread'); assert.equal(context.listCursor, 'b-cursor');
  const more = context.refreshThreads(true);
  assert.equal(calls[1][1], 'b-cursor');
  requests[1].resolve({ data: [{ id: 'b-thread-2' }], nextCursor: null }); await more;
  assert.equal(context.threads.length, 2);
});
