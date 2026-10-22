import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRunDirectory, requireLiveRun } from '../run-output.mjs';

export async function createGuiContext(name) {
  requireLiveRun(`node tools/qa/gui/run.mjs --case=${name} --run [--output=work/qa/new-run]`, 'real Electron windows and the local CLI connection; these cases send no test prompts');
  const repo = resolve(import.meta.dirname, '../../..'), root = join(repo, 'prototypes/live2d-codex');
  const { _electron } = createRequire(join(root, 'package.json'))(process.env.VIBE_PLAYWRIGHT || 'playwright');
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  const out = await createRunDirectory(`gui-${name}`, output), storage = join(out, 'storage'), project = join(out, 'project');
  await mkdir(project);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'));
  const launch = (mode, extraArgs = [], packageRoot) => _electron.launch({
    executablePath: packageRoot ? resolve(packageRoot, 'VibeVoice.exe') : join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packageRoot ? [] : [root]), `--storage=${storage}`, `--project=${project}`, `--mode=${mode}`, '--shortcut=off', ...extraArgs],
    cwd: repo, env, timeout: 25000
  });
  console.log(`Run directory: ${out}`);
  return { root, repo, out, storage, project, launch };
}
