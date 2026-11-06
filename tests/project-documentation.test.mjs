import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, checkProject } from '../tools/project/check-project.mjs';
import { publicPathIssue } from '../tools/project/public-path.mjs';

test('live Agent probes show help without credentials, SDK loading or fixture work', () => {
  for (const entry of ['claude-probe.mjs', 'acp-probe.mjs']) {
    const output = execFileSync(process.execPath, [join(root, 'tools/probes/cli-agents', entry), '--help'], {
      encoding: 'utf8', windowsHide: true,
      env: { ...process.env, PROBE_CLAUDE_BINARY: 'nonexistent-fixture.exe', PROBE_GROK_BINARY: 'nonexistent-fixture.exe', PROBE_OPENCODE_BINARY: 'nonexistent-fixture.exe' },
    });
    assert.match(output, /Default: help only/);
  }
});

test('public documentation rejects private directories and casing aliases', () => {
  for (const name of ['work', 'Work/qa', 'docs/history', 'docs/History/controller-v0.2/README.md', 'docs/Research', 'prototypes/Dots-Bridge', 'prototypes/live2d-codex/backend/Dots.mjs', 'prototypes/live2d-codex/node_modules', '..']) {
    assert.match(publicPathIssue(root, name), /private or external dependency/, name);
  }
  assert.equal(publicPathIssue(root, 'docs/build.md'), null);
});

test('project check includes new docs, ignores deleted files, and detects broken links and version drift', t => {
  const directory = mkdtempSync(join(tmpdir(), 'rin-docs-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, text) => { const parts = path.split('/'); parts.pop(); mkdirSync(join(directory, ...parts), { recursive: true }); writeFileSync(join(directory, path), text); };
  execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
  for (const name of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/build.md', 'docs/privacy.md', 'docs/licenses.md', 'docs/project-status.md', 'tools/release/TEST-ACCEPTANCE.md']) write(name, '# Guide\n');
  for (const name of ['package.json', 'package-lock.json', 'prototypes/live2d-codex/package.json', 'prototypes/live2d-codex/package-lock.json']) write(name, JSON.stringify({ version: '0.6.2' }));
  write('deleted.md', '# Removed\n');
  execFileSync('git', ['-C', directory, 'add', 'deleted.md'], { windowsHide: true });
  rmSync(join(directory, 'deleted.md'));
  assert.deepEqual(checkProject(directory).problems, []);
  write('docs/new.md', '[broken](missing.md)\n[invalid](%xy.md)\n[private](../work)\n');
  write('prototypes/live2d-codex/package.json', JSON.stringify({ version: '0.5.0' }));
  const report = checkProject(directory);
  assert.equal(report.documents, 9);
  assert.equal(report.links, 3);
  assert.equal(report.problems.length, 4);
  assert.ok(report.problems.some(value => value.includes('missing')));
  assert.ok(report.problems.some(value => value.includes('invalid link')));
  assert.ok(report.problems.some(value => value.includes('private or external')));
  assert.ok(report.problems.some(value => value.includes('version differs')));
});
