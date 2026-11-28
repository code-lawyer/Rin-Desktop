import { lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute, sep } from 'node:path';

export const qaRoot = resolve(import.meta.dirname, '../../work/qa');

async function ensureRunParent(directory) {
  await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (!(await lstat(directory)).isDirectory()) throw new Error('QA output parents must be ordinary directories without links.');
}

export async function createRunDirectory(category, requested, base = qaRoot) {
  if (!/^[a-z][a-z0-9-]*$/.test(category)) throw new Error('Invalid run category');
  base = resolve(base);
  const output = requested ? resolve(requested) : join(base, category);
  const local = relative(base, output);
  if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new Error('Output must be a new directory inside work/qa');

  if (base === qaRoot) await ensureRunParent(dirname(base));
  else await mkdir(dirname(base), { recursive: true });
  await ensureRunParent(base);
  let parent = base;
  const segments = local.split(sep);
  for (const segment of requested ? segments.slice(0, -1) : segments) {
    parent = join(parent, segment);
    await ensureRunParent(parent);
  }
  if (requested) {
    await mkdir(output); // EEXIST is intentional: never reuse a prior run.
    return output;
  }
  return mkdtemp(join(parent, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
}
export async function writeRunReport(directory, report) {
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
export function requireLiveRun(usage, effects, enabled = process.argv.includes('--run'), help = process.argv.includes('--help')) {
  if (enabled && !help) return;
  console.log(`${usage}\nDefault: help only. --run enables ${effects}. Each run writes a new directory under work/qa; existing evidence is never replaced.`);
  process.exit(0);
}
