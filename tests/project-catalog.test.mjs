import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root, readCatalog, validateCatalog, readyTasks, renderProgress } from '../tools/project/catalog.mjs';
import { publicPathIssue } from '../tools/project/public-path.mjs';

test('project work is traceable and the dependency graph is valid', () => {
  assert.deepEqual(validateCatalog(readCatalog()), []);
});

test('a task cannot claim completion without evidence or finished dependencies', () => {
  const data = readCatalog(), task = data.ledger.tasks.find(item => item.id === 'FIX-01');
  task.status = 'verified'; task.evidence = []; task.dependsOn = ['FIX-02'];
  data.ledger.tasks.find(item => item.id === 'FIX-02').status = 'planned';
  const failures = validateCatalog(data);
  assert.ok(failures.some(value => value.includes('verified without evidence')));
  assert.ok(failures.some(value => value.includes('verified before dependency')));
});

test('dependency cycles and dropped historical requirements are rejected', () => {
  const data = readCatalog();
  data.ledger.tasks.find(item => item.id === 'ORG-01').dependsOn = ['ORG-03'];
  data.legacy.records = data.legacy.records.filter(item => item.legacyId !== 'R-36');
  const failures = validateCatalog(data);
  assert.ok(failures.some(value => value.includes('Dependency cycle')));
  assert.ok(failures.some(value => value.includes('Unmapped legacy item R-36')));
});

test('live Agent probes show help without credentials, SDK loading or fixture work', () => {
  for (const entry of ['claude-probe.mjs', 'acp-probe.mjs']) {
    const output = execFileSync(process.execPath, [join(root, 'tools/probes/cli-agents', entry), '--help'], {
      encoding: 'utf8', windowsHide: true,
      env: { ...process.env, PROBE_CLAUDE_BINARY: 'nonexistent-fixture.exe', PROBE_GROK_BINARY: 'nonexistent-fixture.exe', PROBE_OPENCODE_BINARY: 'nonexistent-fixture.exe' },
    });
    assert.match(output, /Default: help only/);
  }
});

test('progress follows task completion and dependency gates without stale priorities', () => {
  const data = readCatalog();
  data.ledger.tasks.find(task => task.id === 'ORG-04').status = 'verified';
  for (const id of ['FIX-01', 'FIX-02', 'FIX-03']) data.ledger.tasks.find(task => task.id === id).status = 'planned';
  assert.ok(readyTasks(data.ledger).some(task => task.id === 'FIX-01'));
  for (const id of ['FIX-01', 'FIX-02', 'FIX-03']) data.ledger.tasks.find(task => task.id === id).status = 'verified';
  const next = renderProgress(data).split('\n').find(line => line.startsWith('可开始的待施工项'));
  assert.doesNotMatch(next, /FIX-0[123]/);
  assert.ok(!readyTasks(data.ledger).some(task => task.status !== 'planned'));
});

test('public documentation rejects private directories and casing aliases', () => {
  for (const name of ['work', 'Work/qa', 'docs/history', 'docs/History/controller-v0.2/README.md', 'docs/Research', 'prototypes/Dots-Bridge', 'prototypes/live2d-codex/backend/Dots.mjs', 'prototypes/live2d-codex/node_modules', '..']) {
    assert.match(publicPathIssue(root, name), /private or external dependency/, name);
  }
  assert.equal(publicPathIssue(root, 'docs/development/README.md'), null);
});
