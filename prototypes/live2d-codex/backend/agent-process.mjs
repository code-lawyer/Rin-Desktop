import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, delimiter, isAbsolute } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import catalog from './agent-catalog.cjs';

const execute = promisify(execFile);
export function safeError(error) {
  let text = String(error?.message ?? error);
  for (const [name, value] of Object.entries(process.env)) if (/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && value?.length >= 8) text = text.replaceAll(value, '[REDACTED]');
  return text.replace(/(?:sk-ant-|sk-|xai-)[\w-]{8,}/g, '[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 3000);
}
export async function deadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(`${label}超时，请重新连接后恢复会话。`); error.code = 'TIMEOUT'; reject(error); }, milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export function agentEnvironment(env = process.env) {
  const copy = { ...env };
  for (const key of Object.keys(copy)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete copy[key];
  return copy;
}
export function findAgent(id, env = process.env) {
  const spec = catalog.AGENTS[id];
  if (!spec) throw new Error('未知 Agent。');
  const native = process.platform === 'win32' ? `${id}.exe` : id;
  const valid = file => { try { return statSync(file).isFile() && (process.platform !== 'win32' || file.toLowerCase().endsWith('.exe')); } catch { return false; } };
  if (env[spec.binaryEnv]) {
    const file = env[spec.binaryEnv];
    if (!isAbsolute(file) || !valid(file)) throw new Error(`${spec.binaryEnv} 必须指向已安装的 ${spec.name} 原生可执行文件的绝对路径。`);
    return resolve(file);
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).map(v => v.replace(/^"|"$/g, '')).filter(Boolean);
  const home = env.USERPROFILE || env.HOME;
  if (home) dirs.push(join(home, '.local/bin'), join(home, `.${id}/bin`), join(home, 'scoop/shims'));
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft/WinGet/Links'));
  const candidates = dirs.map(dir => join(dir, native));
  if (id === 'claude' && env.LOCALAPPDATA) {
    const packages = join(env.LOCALAPPDATA, 'Microsoft/WinGet/Packages');
    if (existsSync(packages)) for (const name of readdirSync(packages)) if (name.startsWith('Anthropic.ClaudeCode_')) candidates.push(join(packages, name, native));
  }
  const found = candidates.find(valid);
  if (!found) throw new Error(`未找到 ${spec.name}。请自行安装${id === 'opencode' ? ' OpenCode V2' : '原生 CLI'}，或设置 ${spec.binaryEnv} 为程序绝对路径，再重连。`);
  return found;
}
export async function versionOf(binary) {
  const result = await execute(binary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
  return result.stdout.trim().slice(0, 200);
}
export function spawnAgent(binary, args, cwd, env = agentEnvironment()) {
  return spawn(binary, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
}
export async function closeChild(child, grace = 2500) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  child.stdin?.end();
  try { await deadline(exited, grace, 'CLI 退出'); return; } catch {}
  // Only terminate the child process tree owned by this connection.
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(() => {});
    else child.kill('SIGKILL');
  }
  await deadline(exited, 1500, 'CLI 退出').catch(() => {});
}
