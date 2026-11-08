import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Copying a link and writing through it can overwrite the source. Reject links
// before copying and again before writing; closed data must remain immutable.
export async function rejectDataLinks(directory) {
  assert.ok(!(await lstat(directory)).isSymbolicLink(), 'Data QA refuses linked source paths');
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink(), 'Data QA refuses links; inspect linked data manually');
    if (item.isDirectory()) await rejectDataLinks(join(directory, item.name));
  }
}
