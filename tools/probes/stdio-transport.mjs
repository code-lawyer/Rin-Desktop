import { spawn } from 'node:child_process';
import { RpcClient, JsonLineDecoder } from './rpc-client.mjs';

export function accountOnlyEnvironment(source = process.env) {
  const env = { ...source };
  const excluded = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY']);
  for (const name of Object.keys(env)) if (excluded.has(name.toUpperCase())) delete env[name];
  return env;
}

export function startStdio({ executable = 'codex', cwd, env = accountOnlyEnvironment() } = {}) {
  const child = spawn(executable, ['app-server', '--stdio', '-c', 'forced_login_method="chatgpt"'], {
    cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderrBytes = 0;
  const rpc = new RpcClient(message => {
    if (child.stdin.destroyed) throw new Error('RPC stdin closed');
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  const decoder = new JsonLineDecoder(message => rpc.receive(message));
  child.stdout.on('data', chunk => {
    try { decoder.push(chunk); } catch (error) { rpc.fail(error); child.kill(); }
  });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  child.stdin.on('error', error => rpc.fail(error));
  child.on('error', error => rpc.fail(error));
  child.on('exit', code => rpc.fail(new Error(`RPC process exited: ${code}`)));
  return {
    rpc, child, diagnostics: () => ({ stderrBytes }),
    async close() {
      rpc.fail(new Error('Probe finished'));
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2000);
      await exit; clearTimeout(timer);
    }
  };
}

export async function initialize(rpc, name = 'vibe_voice_probe') {
  const result = await rpc.request('initialize', {
    clientInfo: { name, title: 'Vibe Voice stage-zero probe', version: '0.0.1' }
  });
  rpc.notify('initialized'); return result;
}
