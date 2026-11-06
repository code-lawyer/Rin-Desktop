import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicPathIssue } from './public-path.mjs';

export const root = resolve(import.meta.dirname, '../..');

// Include new public files and omit working-tree deletions without traversing
// private data, dependencies, models or directory junctions.
export function checkProject(directory = root) {
  const files = [...new Set(execFileSync('git', ['-c', `safe.directory=${directory}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean))];
  const documents = files.filter(name => name.endsWith('.md') && existsSync(resolve(directory, name)) && !name.includes('/licenses/'));
  const problems = [];
  const check = (name, source) => {
    const issue = publicPathIssue(directory, name);
    if (issue) problems.push(`${source}: ${issue}`);
  };
  for (const name of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/build.md', 'docs/privacy.md', 'docs/licenses.md', 'docs/project-status.md', 'tools/release/TEST-ACCEPTANCE.md']) check(name, 'required documentation');
  let links = 0;
  for (const file of documents) {
    const content = readFileSync(resolve(directory, file), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      links++;
      try { check(relative(directory, resolve(directory, dirname(file), decodeURI(target.split('#')[0]))), file); }
      catch { problems.push(`${file}: invalid link ${target}`); }
    }
  }
  const packages = ['package.json', 'package-lock.json', 'prototypes/live2d-codex/package.json', 'prototypes/live2d-codex/package-lock.json'];
  const version = JSON.parse(readFileSync(resolve(directory, packages[0]), 'utf8')).version;
  for (const name of packages) {
    const manifest = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
    if (manifest.version !== version || (manifest.packages?.[''] && manifest.packages[''].version !== version)) problems.push(`${name}: version differs from ${version}`);
  }
  return { version, documents: documents.length, links, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = checkProject();
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length) process.exitCode = 1;
}
