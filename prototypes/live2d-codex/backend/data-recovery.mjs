import { cp, mkdir, readFile, rename, realpath, stat, open, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { validateWorkspace } from './workspace-store.mjs';

export async function recoverDataCopy(source, destination, { from = 'backup', run = false } = {}) {
  if (!['backup','pending'].includes(from)) throw new Error('请选择 backup 或 pending 恢复副本。');
  const input = await realpath(source);
  const requested = resolve(destination);
  const output = join(await realpath(dirname(requested)), basename(requested));
  if (output.toLowerCase() === input.toLowerCase() || output.toLowerCase().startsWith(input.toLowerCase() + sep)) throw new Error('恢复目录必须位于原目录之外。');
  try { await stat(output); throw new Error('恢复目录已存在；请选择全新的目录，不会覆盖已有内容。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const candidate = join(input, 'workspaces.json' + (from === 'backup' ? '.bak' : '.tmp'));
  const recovered = validateWorkspace(JSON.parse(await readFile(candidate, 'utf8')));
  const plan = { source: input, destination: output, from, projects: recovered.projects.length, drafts: Object.keys(recovered.drafts ?? {}).length, applied: false };
  if (!run) return plan;
  // Exclusive destination creation is the final race-safe no-overwrite gate.
  await mkdir(output);
  for (const name of await readdir(input)) await cp(join(input, name), join(output, name), { recursive: true, errorOnExist: true, force: false, dereference: false });
  const primary = join(output, 'workspaces.json');
  try { await rename(primary, join(output, 'workspaces.before-recovery-' + Date.now() + '.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Do not follow a copied .tmp symlink when creating the recovered primary.
  const handle = await open(primary, 'wx');
  try { await handle.writeFile(JSON.stringify(recovered, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  return { ...plan, applied: true };
}
