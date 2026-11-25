import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, delimiter, isAbsolute } from 'node:path';
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
export function acpAgentEnvironment(provider, env = process.env) {
  const copy = agentEnvironment(env);
  if (provider === 'grok') {
    for (const key of Object.keys(copy)) if (key.toUpperCase() === 'GROK_LOGIN_ENV') delete copy[key];
    copy.GROK_LOGIN_ENV = '0';
  }
  if (provider === 'antigravity') {
    const keys = Object.keys(copy);
    // A host started from inside another Antigravity run can inherit its
    // private server, credentials and temporary home. Connect to the local CLI instead.
    const nested = keys.some(key => /^(?:AGY_ACP_FORCE_FILE_STORAGE|ANTIGRAVITY_(?:AGENT|AGENTAPI_EXE|CONVERSATION_ID|CSRF_TOKEN|LS_ADDRESS|PROJECT_ID|TRAJECTORY_ID))$/i.test(key));
    for (const key of keys) {
      if (/^(?:ANTIGRAVITY_|AGY_ACP_FORCE_FILE_STORAGE$)/i.test(key) || nested && /^GEMINI_HOME$/i.test(key)) delete copy[key];
    }
  }
  return copy;
}
const pathDirectories = env => (env.PATH ?? env.Path ?? '').split(delimiter).map(v => v.replace(/^"|"$/g, '')).filter(isAbsolute);
const isFile = file => { try { return statSync(file).isFile(); } catch { return false; } };
const isNativeFile = file => isAbsolute(file) && (process.platform !== 'win32' || file.toLowerCase().endsWith('.exe')) && isFile(file);

function deepSeekNpmEntry(file) {
  if (process.platform !== 'win32' || !isAbsolute(file) || basename(file).toLowerCase() !== 'dsh.cmd' || !isFile(file)) return null;
  const shimDir = dirname(file);
  const modules = basename(shimDir).toLowerCase() === '.bin' ? dirname(shimDir) : join(shimDir, 'node_modules');
  const directory = join(modules, '@deepseek-ai', 'dsh');
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const entry = join(directory, 'lib', 'bin.js');
    if (manifest.name === '@deepseek-ai/dsh' && manifest.bin?.dsh === 'lib/bin.js' && isFile(entry)) return entry;
  } catch {}
  return null;
}

export function findAgent(id, env = process.env) {
  if (!catalog.isCliAgent(id)) throw new Error('未知 Agent。');
  const spec = catalog.AGENTS[id];
  const native = process.platform === 'win32' ? `${spec.binaryName}.exe` : spec.binaryName;
  const valid = file => isNativeFile(file) || id === 'deepseek' && !!deepSeekNpmEntry(file);
  if (env[spec.binaryEnv]) {
    const file = env[spec.binaryEnv];
    const target = id === 'deepseek' ? '已安装的 dsh.exe 或 npm 安装生成的 dsh.cmd' : `已安装的 ${spec.name} 原生可执行文件`;
    if (!valid(file)) throw new Error(`${spec.binaryEnv} 必须指向${target}的绝对路径。`);
    return resolve(file);
  }
  const dirs = pathDirectories(env);
  const home = env.USERPROFILE || env.HOME;
  if (home) dirs.push(join(home, '.local/bin'), join(home, `.${spec.binaryName}/bin`), join(home, 'scoop/shims'));
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft/WinGet/Links'));
  if (id === 'antigravity' && env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'agy', 'bin'));
  if (id === 'deepseek' && process.platform === 'win32' && env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  const names = id === 'deepseek' && process.platform === 'win32' ? [native, 'dsh.cmd'] : [native];
  const candidates = dirs.flatMap(dir => names.map(name => join(dir, name)));
  if (id === 'claude' && env.LOCALAPPDATA) {
    const packages = join(env.LOCALAPPDATA, 'Microsoft/WinGet/Packages');
    if (existsSync(packages)) for (const name of readdirSync(packages)) if (name.startsWith('Anthropic.ClaudeCode_')) candidates.push(join(packages, name, native));
  }
  const found = candidates.find(valid);
  if (!found) throw new Error(`未找到 ${spec.name}。${id === 'deepseek' ? '请先安装 Node.js 和 @deepseek-ai/dsh' : '请先安装原生 CLI'}，或设置 ${spec.binaryEnv} 为安装路径，再重连。`);
  return found;
}
export function agentCommand(id, env = process.env) {
  const binary = findAgent(id, env);
  if (id !== 'deepseek' || isNativeFile(binary)) return { binary, args: [] };
  // npm's Windows shim locates this package entry. Run the entry directly so
  // neither project paths nor user input ever pass through cmd.exe.
  const entry = deepSeekNpmEntry(binary);
  if (!entry) throw new Error('找不到 @deepseek-ai/dsh 的 npm 安装入口，请重新安装。');
  const dirs = [dirname(binary), ...pathDirectories(env)];
  if (env.ProgramFiles) dirs.push(join(env.ProgramFiles, 'nodejs'));
  const node = dirs.map(dir => join(dir, 'node.exe')).find(isNativeFile);
  if (!node) throw new Error('运行 DeepSeek Harness 需要 Node.js 24.9 或更新版本。');
  return { binary: node, args: [entry] };
}
export async function versionOf(binary, args = [], env = agentEnvironment()) {
  const result = await execute(binary, [...args, '--version'], { encoding: 'utf8', env, windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
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
