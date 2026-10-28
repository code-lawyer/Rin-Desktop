import * as fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Callers serialize writes. Keep the previous committed bytes for recovery;
// a failed write must never be published to the caller's in-memory state.
async function stageJson(file, value, io) {
  const text = JSON.stringify(value, null, 2) + '\n';
  await io.mkdir(dirname(file), { recursive: true });
  async function stage(path, bytes) {
    const handle = await io.open(path, 'w');
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  }
  let previous;
  try { previous = await io.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== undefined) {
    // Refuse to replace corrupt records, including an externally damaged file.
    JSON.parse(previous.toString('utf8'));
    await stage(file + '.bak.tmp', previous);
    await io.rename(file + '.bak.tmp', file + '.bak');
  }
  await stage(file + '.tmp', text);
}

export async function writeJson(file, value, io = fs) {
  await stageJson(file, value, io);
  await io.rename(file + '.tmp', file);
}

// Character paint has a synchronous final acknowledgement: all file creation,
// serialization, backup and flushing finish first; only the atomic rename is
// left for that acknowledgement. The caller retains its transaction queue.
export async function prepareJson(file, value, io = fs) {
  await stageJson(file, value, io);
  return {
    commit: () => (io.renameSync ?? renameSync)(file + '.tmp', file),
    discard: async () => { try { await io.unlink(file + '.tmp'); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
  };
}

export async function readJson(file, validate = value => value, io = fs) {
  let text;
  try { text = await io.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A missing primary alongside recovery files is not an empty installation.
    for (const suffix of ['.tmp', '.bak']) {
      try { await io.stat(file + suffix); }
      catch (missing) { if (missing.code === 'ENOENT') continue; throw missing; }
      throw new Error('主记录缺失，发现恢复副本；原文件已保留，请先恢复数据。');
    }
    return undefined;
  }
  return validate(JSON.parse(text));
}
