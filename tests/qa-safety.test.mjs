import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectOwnedProcessTree } from '../tools/qa/owned-processes.mjs';
import { rejectDataLinks } from '../tools/qa/data-copy-safety.mjs';

test('process ownership excludes children created before a reused immediate parent PID', () => {
  const rows = [
    { pid: 10, parent: 1, created: '2026-01-01T00:00:00Z' },
    { pid: 20, parent: 10, created: '2026-01-01T00:10:00Z' },
    { pid: 30, parent: 20, created: '2026-01-01T00:05:00Z' },
    { pid: 40, parent: 20, created: '2026-01-01T00:11:00Z' },
    { pid: 50, parent: 30, created: '2026-01-01T00:12:00Z' },
  ];
  assert.deepEqual(
    selectOwnedProcessTree(rows, 10).map((row) => row.pid),
    [10, 20, 40],
  );
  assert.deepEqual(selectOwnedProcessTree(rows, 999), []);
});

test('data-copy safety refuses directory junctions before writing through a copied link', async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'rin-data-copy-safety-'));
  const source = join(output, 'source'),
    external = join(output, 'external'),
    linked = join(source, 'linked-records');
  t.after(async () => {
    await rm(linked, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  });
  await mkdir(source);
  await mkdir(external);
  const protectedFile = join(external, 'workspaces.json');
  await writeFile(protectedFile, 'original-private-data');
  await symlink(external, linked, 'junction');
  await assert.rejects(rejectDataLinks(source), /refuses links/);
  assert.equal(await readFile(protectedFile, 'utf8'), 'original-private-data');
  await assert.rejects(rejectDataLinks(linked), /linked source/);
});
