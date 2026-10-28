import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, openSync, closeSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import stills from '../../prototypes/live2d-codex/backend/still-settings.cjs';

export const projectRoot = resolve(import.meta.dirname, '../..');
const providers = new Set(['codex', 'claude', 'grok', 'opencode', 'dots']);
const pathOptions = new Set(['storage', 'project', 'qwen-root']);
const supportedOptions = new Set(['mode', 'provider', ...pathOptions, 'debug-port', 'shortcut', 'show', 'visual', 'wallpaper']);

// All source entry points use this plan. Release binaries are never candidates.
export function launchPlan(args = [], root = projectRoot) {
  root = resolve(root);
  const appRoot = join(root, 'prototypes/live2d-codex');
  const options = new Map(), forwarded = [];
  let check = false, background = false;
  for (const arg of args) {
    if (arg === '--check') { check = true; continue; }
    if (arg === '--background') { background = true; continue; }
    if (arg === '--help') continue;
    const match = /^--([a-z][a-z-]*)=(.*)$/.exec(arg);
    if (!match || !match[2]) throw new Error(`Invalid argument: ${arg}. Use --name=value; see npm start -- --help.`);
    const [, key, value] = match;
    if (!supportedOptions.has(key)) throw new Error(`Unknown option: --${key}`);
    if (options.has(key)) throw new Error(`Duplicate option: --${key}`);
    options.set(key, value);
    forwarded.push(pathOptions.has(key) ? `--${key}=${resolve(root, value)}` : arg);
  }
  const mode = options.get('mode') ?? 'wallpaper';
  if (!['wallpaper', 'avatar'].includes(mode)) throw new Error('Mode must be wallpaper or avatar.');
  if (options.has('wallpaper') && (options.get('wallpaper') !== 'artwork' || mode !== 'wallpaper')) throw new Error('Video wallpaper is retired. Use --wallpaper=artwork in wallpaper mode.');
  const provider = options.get('provider');
  if (provider && !providers.has(provider)) throw new Error(`Unknown provider: ${provider}`);
  if (!options.has('mode')) forwarded.unshift('--mode=wallpaper');
  return {
    source: 'working-tree', root, appRoot, mode,
    provider: provider ?? 'saved selection (Codex on first launch)',
    storage: resolve(root, options.get('storage') ?? 'work/runtime/avatar'),
    check, background, args: [appRoot, ...forwarded], buildScript: join(appRoot, 'scripts/build.mjs'),
  };
}

export function inspectLaunch(plan, { platform = process.platform, nodeVersion = process.versions.node, env = process.env } = {}) {
  const problems = [], appRequire = createRequire(join(plan.appRoot, 'package.json'));
  let version = null, electron = null;
  if (platform !== 'win32') problems.push('Rin Desktop currently requires Windows x64.');
  if (Number(nodeVersion.split('.')[0]) < 24) problems.push('Node.js 24 or newer is required.');
  try {
    const app = JSON.parse(readFileSync(join(plan.appRoot, 'package.json'), 'utf8'));
    const root = JSON.parse(readFileSync(join(plan.root, 'package.json'), 'utf8'));
    version = app.version;
    if (root.version !== app.version) problems.push('Root and desktop package versions differ.');
  } catch { problems.push('Cannot read the root and desktop package manifests.'); }
  try { appRequire.resolve('esbuild'); }
  catch { problems.push('Build dependencies are missing. Run npm --prefix prototypes/live2d-codex ci.'); }
  try {
    // Requiring Electron can run its installer when the binary is missing.
    // Status and --check must only inspect the installed package metadata.
    const electronRoot = dirname(appRequire.resolve('electron/package.json'));
    const pathFile = join(electronRoot, 'path.txt');
    const executable = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : '';
    if (!executable && !env.ELECTRON_OVERRIDE_DIST_PATH) throw new Error('missing executable path');
    electron = join(env.ELECTRON_OVERRIDE_DIST_PATH || join(electronRoot, 'dist'), executable || 'electron');
    if (!statSync(electron).isFile()) throw new Error('missing executable');
  } catch { electron = null; problems.push('Electron is unavailable. Run npm --prefix prototypes/live2d-codex ci without ELECTRON_SKIP_BINARY_DOWNLOAD.'); }
  const resources = ['vendor/live2dcubismcore.min.js'];
  if (plan.mode === 'avatar') resources.push('assets/hiyori/Hiyori.model3.json');
  else {
    for (const pose of stills.POSES) resources.push(`assets/stills/female-v2-4k/${pose}.png`);
    for (const pose of ['work','attention']) resources.push(`assets/stills/male/${pose}.png`);
    resources.push('assets/ambience/light-rain.ogg', 'assets/ambience/soft-keyboard.ogg');
  }
  const missing = resources.filter(name => !existsSync(join(plan.appRoot, name)));
  if (missing.length) problems.push(`Missing visual resources: ${missing.join(', ')}. Wallpaper resources: npm run resources. Hiyori is a local-only legacy asset.`);
  if (existsSync(join(plan.appRoot, 'portable.json'))) problems.push('The source directory contains portable.json; use a clean source tree, not a release overlay.');
  if (plan.provider === 'dots' && (!existsSync(join(plan.root, 'prototypes/dots-bridge/src/client.mjs')) || !existsSync(join(plan.appRoot, 'backend/dots.mjs')))) problems.push('The private Dots adapter is not present in this checkout. Use a CLI provider.');
  const adapter = { claude: 'claude-agent.mjs', grok: 'acp-agent.mjs', opencode: 'acp-agent.mjs' }[plan.provider];
  if (adapter && !existsSync(join(plan.appRoot, 'backend', adapter))) problems.push(`The ${plan.provider} adapter is not present in this source version.`);
  return { ...plan, version, nodeVersion, electron, ready: problems.length === 0, problems };
}

export function electronEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
}

export async function buildAndLaunch(plan) {
  // Build errors must reach the calling CMD/PowerShell entry before it exits.
  execFileSync(process.execPath, [plan.buildScript], { cwd: plan.appRoot, windowsHide: true, stdio: 'inherit' });
  const handles = [];
  let child;
  try {
    if (plan.background) {
      const directory = join(plan.root, 'work/runtime/launcher');
      mkdirSync(directory, { recursive: true });
      const prefix = join(directory, `app-${Date.now()}-${process.pid}`);
      handles.push(openSync(`${prefix}.log`, 'a'));
      handles.push(openSync(`${prefix}.error.log`, 'a'));
      console.log(`Application logs: ${prefix}.log and ${prefix}.error.log`);
    }
    child = spawn(plan.electron, plan.args, {
      cwd: plan.root, env: electronEnvironment(), windowsHide: true,
      detached: plan.background,
      // Direct file handles let the app outlive the hidden launcher without
      // keeping PowerShell's redirected output pipes open.
      stdio: plan.background ? ['ignore', ...handles] : 'inherit',
    });
  } finally { for (const handle of handles) closeSync(handle); }
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    if (plan.background) child.once('spawn', () => { child.unref(); resolveExit(0); });
    else child.once('exit', code => resolveExit(code ?? 1));
  });
}

export async function start(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(`Rin Desktop source launcher
  npm start                               Build and launch the current source
  npm start -- --check                     Inspect only; no build, app, model or network
  npm start -- --provider=codex            Select a provider explicitly
  npm run start:avatar                     Legacy local Hiyori mode
  npm run start:dots                       Private Dots mode, when locally present
  npm start -- --storage="path with spaces" --project="project path"

The default is wallpaper mode and the saved provider. Source data stays in
work/runtime/avatar unless --storage is supplied. Paths are relative to the
repository root. Installed releases keep their own normal Start-menu entry.
Use npm run status to inspect the repository and release relationship.`);
    return 0;
  }
  const plan = inspectLaunch(launchPlan(args));
  if (plan.check) { console.log(JSON.stringify(plan, null, 2)); return plan.ready ? 0 : 1; }
  if (!plan.ready) throw new Error(plan.problems.join('\n'));
  console.log(`[Rin Desktop ${plan.version}] working-tree source; mode=${plan.mode}; provider=${plan.provider}`);
  console.log(`Application: ${plan.appRoot}\nData: ${plan.storage}`);
  return buildAndLaunch(plan);
}

export async function main(args) {
  try { process.exitCode = await start(args); }
  catch (error) { console.error(`[Rin launcher] ${error.message}`); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
