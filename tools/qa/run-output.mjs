import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';

export const qaRoot = resolve(import.meta.dirname, '../../work/qa');
export async function createRunDirectory(category, requested, base = qaRoot) {
  if (!/^[a-z][a-z0-9-]*$/.test(category)) throw new Error('Invalid run category');
  if (requested) {
    const output = resolve(requested), local = relative(resolve(base), output);
    if (!local || local === '..' || local.startsWith('..' + '/') || local.startsWith('..\\') || isAbsolute(local)) throw new Error('Output must be a new directory inside work/qa');
    await mkdir(resolve(output, '..'), { recursive: true });
    await mkdir(output); // EEXIST is intentional: never reuse a prior run.
    return output;
  }
  const parent = join(base, category); await mkdir(parent, { recursive: true });
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
