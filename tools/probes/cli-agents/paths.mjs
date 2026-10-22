import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireLiveRun as requireRun } from '../../qa/run-output.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../../..');
export const outputRoot = join(repositoryRoot, 'work/qa/cli-agents');
const appRequire = createRequire(join(repositoryRoot, 'prototypes/live2d-codex/package.json'));

export function requireLiveRun(usage) {
  requireRun(usage, 'native CLI account use, test prompts and scripted approvals inside a new fixture. See tools/probes/cli-agents/README.md');
}

export const appDependency = name => import(pathToFileURL(appRequire.resolve(name)).href);
