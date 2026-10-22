import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from './durable-json.mjs';
import { validateWorkspace } from './workspace-store.mjs';

export async function validateDataDirectory(candidate) {
  const directory = await realpath(candidate);
  if (!(await stat(directory)).isDirectory()) throw new Error('请选择数据文件夹。');
  const workspace = await readJson(join(directory, 'workspaces.json'), validateWorkspace);
  if (!workspace) throw new Error('该目录没有工作台记录。');
  // Validate the old Codex location and each provider's isolated records before
  // changing the pointer. Never migrate by overwriting either directory.
  for (const provider of ['codex', 'claude', 'grok', 'opencode']) {
    const root = provider === 'codex' ? directory : join(directory, 'agents', provider);
    for (const name of provider === 'codex' ? ['session'] : ['session', 'index']) {
      const saved = await readJson(join(root, name + '.json'));
      if (saved === undefined) continue;
      if (saved.format !== 1 || provider !== 'codex' && saved.provider !== provider || name === 'session' && (typeof saved.cwd !== 'string' || !saved.cwd.trim()) || name === 'index' && (!saved.sessions || typeof saved.sessions !== 'object' || Array.isArray(saved.sessions))) throw new Error(`${provider} 的会话记录无效，未切换数据目录。`);
    }
  }
  return directory;
}

export async function selectDataDirectory(candidate, pointer, { io } = {}) {
  const directory = await validateDataDirectory(candidate);
  await writeJson(pointer, { format: 1, directory }, io);
  return directory;
}
