import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';

// Callers serialize writes. Keep the previous committed bytes for recovery;
// a failed write must never be published to the caller's in-memory state.
export async function writeJson(file, value, io = fs) {
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
  await io.rename(file + '.tmp', file);
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
