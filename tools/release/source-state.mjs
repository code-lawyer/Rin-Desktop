import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { auditPublic } from './audit-public.mjs';
import { checkedSourcePath, releaseGit } from './package-inputs.mjs';

function gitState(root) {
  return {
    head: releaseGit(root, ['rev-parse', 'HEAD']),
    dirty: Boolean(releaseGit(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'])),
  };
}

async function sourceFiles(root) {
  const names = releaseGit(root, ['ls-files', '--cached', '-z']).split('\0').filter(Boolean);
  const files = [];
  for (const file of [...new Set(names)].sort()) {
    try {
      const source = await checkedSourcePath(root, file);
      const sha256 = createHash('sha256').update(await readFile(source)).digest('hex');
      files.push({ file, sha256 });
    } catch (error) {
      // Exploratory builds may delete unrelated tracked files. For publishable
      // builds the cleanliness and final source checks also cover deletions.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

function checkClean(root, state, publishable) {
  if (!publishable) return;
  if (state.dirty) {
    throw new Error('Publishable builds require a clean Git checkout. Commit the audited source or use an exploratory build.');
  }
  const files = releaseGit(root, ['ls-files', '-v', '-z']);
  if (/(?:^|\0)[Sa-z] /.test(files)) {
    throw new Error('Publishable builds require an index without assume-unchanged or skip-worktree entries.');
  }
}

export async function captureSourceState(root, { build, version, channel, publishable }) {
  const start = gitState(root);
  checkClean(root, start, publishable);
  const scans = [{ worktree: true }];
  if (publishable) scans.push({ staged: true });
  for (const options of scans) {
    const report = await auditPublic(root, options);
    if (!report.files || report.problems.length) {
      const findings = report.problems.map(({ file, reason }) => `${file} (${reason})`);
      throw new Error(`Public source audit failed: ${findings.join(', ') || 'empty source set'}`);
    }
  }
  const files = await sourceFiles(root);
  const state = { format: 1, build, baseVersion: version, channel, publishable, createdAt: new Date().toISOString(), ...start, files };
  await verifySourceState(root, state, { rehash: false });
  return state;
}

export async function verifySourceState(root, expected, { rehash = true } = {}) {
  const live = gitState(root);
  checkClean(root, live, expected.publishable);
  if (live.head !== expected.head || live.dirty !== expected.dirty ||
      (rehash && JSON.stringify(await sourceFiles(root)) !== JSON.stringify(expected.files))) {
    throw new Error('The source checkout changed during packaging. Build again from a fresh output directory.');
  }
}
