import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPrivateProjectPath } from '../project/public-path.mjs';

const root = resolve(import.meta.dirname, '../..');
const generatedOrPersonalFile = /(^|\/)(auth|session|workspaces|appearance|provider)\.json$|(^|\/)custom-agents\.json(?:\..*)?$|\.(wav|pcm|mp4|zip|7z|exe|dll|safetensors)$/i;
const secrets = [
  /sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{32,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /xai-[A-Za-z0-9_-]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
];
const normalizedText = value => value.replaceAll('\\\\', '\\').replaceAll('\\', '/').toLowerCase();

export async function auditPublic(directory, { staged = false, worktree = false } = {}) {
  if (staged && worktree) throw new Error('Choose --staged or --worktree, not both.');
  const git = (args, options) => execFileSync('git', ['-c', `safe.directory=${directory}`, ...args], { cwd: directory, windowsHide: true, ...options });
  const files = (...flags) => git(['ls-files', ...flags, '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const ignored = new Set(files('--cached', '--ignored', '--exclude-per-directory=.gitignore'));
  const index = new Map();
  if (staged) {
    for (const entry of files('--stage')) {
      const tab = entry.indexOf('\t');
      const [mode, oid, stage] = entry.slice(0, tab).split(' ');
      index.set(entry.slice(tab + 1), { mode, oid, stage });
    }
  }
  const names = staged ? index.keys() : new Set(files(...(worktree ? ['--cached'] : []), '--others', '--exclude-standard'));
  const privateLocations = [directory, process.env.USERPROFILE].filter(Boolean).map(normalizedText);
  const report = { staged, worktree, files: 0, bytes: 0, problems: [] };
  const problem = (file, reason) => report.problems.push({ file, reason });

  for (const name of names) {
    if (isPrivateProjectPath(name) || generatedOrPersonalFile.test(name) || ignored.has(name)) {
      problem(name, 'non-public path');
      continue;
    }
    let data;
    if (staged) {
      const { mode, oid, stage } = index.get(name);
      if (stage !== '0' || !['100644', '100755'].includes(mode)) {
        problem(name, 'index entry is not an ordinary file');
        continue;
      }
      data = git(['cat-file', 'blob', oid], { maxBuffer: 64 * 1024 * 1024 });
    } else {
      const path = join(directory, name);
      try {
        if (!(await lstat(path)).isFile()) {
          problem(name, 'workspace entry is not an ordinary file');
          continue;
        }
        data = await readFile(path);
      } catch (error) {
        if (worktree && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    report.files++;
    report.bytes += data.length;
    if (data.length > 20 * 1024 * 1024) problem(name, 'unexpected large source file');
    if (data.subarray(0, 8192).includes(0)) continue;
    const content = data.toString('utf8');
    if (secrets.some(pattern => pattern.test(content))) problem(name, 'secret pattern');
    const normalized = normalizedText(content);
    if (privateLocations.some(path => normalized.includes(path))) problem(name, 'private machine reference');
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await auditPublic(root, { staged: process.argv.includes('--staged'), worktree: process.argv.includes('--worktree') });
  console.log(JSON.stringify(report, null, 2));
  if (!report.files || report.problems.length) process.exitCode = 1;
}
