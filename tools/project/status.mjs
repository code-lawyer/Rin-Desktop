import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectLaunch, launchPlan, projectRoot } from './start.mjs';
import { readCatalog, readyTasks } from './catalog.mjs';

const git = (...args) => {
  try { return execFileSync('git', ['-c', `safe.directory=${projectRoot}`, ...args], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim(); }
  catch { return null; }
};
function publicRemote(value) {
  if (!value) return null;
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return /^git@[\w.-]+:[\w./-]+$/.test(value) ? value : '[non-URL remote]'; }
}
const manifest = JSON.parse(readFileSync(join(projectRoot, 'tools/release/resource-manifest.json'), 'utf8'));
const expectedRepository = manifest.repository, remote = publicRemote(git('remote', 'get-url', 'origin'));
const head = git('rev-parse', 'HEAD'), trackedMain = git('rev-parse', 'refs/remotes/origin/main');
const dirty = git('status', '--porcelain'), launch = inspectLaunch(launchPlan());
const { ledger } = readCatalog();
const status = {
  root: projectRoot,
  source: { version: launch.version, entry: 'npm start', mode: launch.mode, storage: launch.storage, ready: launch.ready, problems: launch.problems },
  release: { version: manifest.version, repository: expectedRepository, url: `https://github.com/${expectedRepository}/releases/tag/v${manifest.version}` },
  git: {
    root: git('rev-parse', '--show-toplevel'), branch: git('branch', '--show-current'), head, origin: remote,
    upstream: git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'), trackedMain,
    headMatchesTrackedMain: !!head && head === trackedMain,
    originMatchesProject: remote === `https://github.com/${expectedRepository}.git` || remote === `https://github.com/${expectedRepository}` || remote === `git@github.com:${expectedRepository}.git`,
    workingTreeChanges: dirty === null ? null : dirty ? dirty.split('\n').length : 0,
    note: 'Local Git metadata only; no fetch, push or GitHub freshness claim.',
  },
  development: {
    handbook: 'docs/development/README.md', progress: 'docs/development/progress.md',
    tasks: ledger.tasks.length,
    counts: Object.fromEntries(Object.keys(ledger.statusMeaning).map(status => [status, ledger.tasks.filter(task => task.status === status).length])),
    readyTasks: readyTasks(ledger).map(task => task.id),
  },
  components: {
    desktop: 'prototypes/live2d-codex',
    remote: {
      sourcePresent: ['backend/remote-controller.mjs', 'backend/remote-input.cjs', 'native/rc003-helper.cs', 'renderer/remote-ui.mjs'].every(path => existsSync(join(projectRoot, 'prototypes/live2d-codex', path))),
      integration: Object.fromEntries(['REM-02', 'REM-03', 'REM-04', 'REM-06'].map(id => [id, ledger.tasks.find(task => task.id === id)?.status ?? 'unknown'])),
      hardwareAcceptance: ledger.tasks.find(task => task.id === 'REM-05')?.status ?? 'unknown',
    },
    remoteDiagnostics: { path: 'tools/remote-diagnostics', present: existsSync(join(projectRoot, 'tools/remote-diagnostics/session.mjs')), integratedIntoApp: false },
    privateDots: { path: 'prototypes/dots-bridge', present: existsSync(join(projectRoot, 'prototypes/dots-bridge/src/client.mjs')), includedInPublicRelease: false },
  },
};
if (process.argv.includes('--json')) console.log(JSON.stringify(status, null, 2));
else {
  console.log(`Rin Desktop project status
Source: ${status.source.version} (working tree) | Launch: npm start
Source readiness: ${launch.ready ? 'ready for launch' : 'setup required'}
Data: ${launch.storage}
Release baseline: ${manifest.version} | ${status.release.url}
Git branch: ${status.git.branch ?? 'unavailable'} | HEAD: ${head ?? 'unavailable'}
Origin: ${remote ?? 'not configured'}
Same GitHub project: ${status.git.originMatchesProject ? 'yes' : 'no / check origin'}
Upstream: ${status.git.upstream ?? 'not configured; a bare git push may need an explicit destination'}
Working-tree changes: ${status.git.workingTreeChanges ?? 'unavailable'}
Tracked origin/main matches HEAD: ${status.git.headMatchesTrackedMain}
${status.git.note}
RC003: ${status.components.remote.sourcePresent ? 'main-application source integrated' : 'application source incomplete'} | Hardware acceptance: ${status.components.remote.hardwareAcceptance}
Independent RC003 diagnostic: ${status.components.remoteDiagnostics.present ? 'retained' : 'not present'}
Dots: ${status.components.privateDots.present ? 'local private adapter present' : 'private adapter not present'}
Development handbook: ${status.development.handbook}
Task states: ${JSON.stringify(status.development.counts)}
Ready to start: ${status.development.readyTasks.join(', ') || 'see dependency gates'}
Current scope and next steps: docs/project-status.md`);
  for (const problem of launch.problems) console.log(`Setup: ${problem}`);
}
