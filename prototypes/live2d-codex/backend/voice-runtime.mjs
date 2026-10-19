import { spawn, execFile } from 'node:child_process';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// A bounded child-process lifetime also covers cancellation during native setup.
export function runResourceCommand(executable, args, signal, { spawnProcess = spawn, killTree, timeoutMs = 30 * 60_000, abortMs = 10_000, env, cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const child = spawnProcess(executable, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'], env, cwd });
    let settled = false, deadline, stopping, stdout = '', diagnostics = '';
    child.stdout?.on('data', bytes => { stdout = (stdout + bytes).slice(-16000); });
    child.stderr?.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-2000); });
    const finish = error => { if (settled) return; settled = true; clearTimeout(watchdog); clearTimeout(deadline); signal.removeEventListener('abort', abort); error ? reject(error) : resolvePromise(stdout); };
    const stop = reason => {
      if (stopping || settled) return; stopping = reason;
      deadline = setTimeout(() => { const error = new Error('语音准备进程未能退出。请在任务管理器中结束该进程，再重启应用。'); error.resourceProcessStillRunning = true; finish(error); }, abortMs);
      if (killTree) killTree(child);
      else if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill();
    };
    const abort = () => stop(signal.reason);
    const watchdog = setTimeout(() => stop(new Error('语音运行环境准备超时，请检查网络后重试。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    child.once('error', finish);
    child.once('close', code => {
      if (stopping || signal.aborted) finish(stopping || signal.reason);
      else if (code === 0) finish();
      else finish(new Error(code === 3010 ? '微软运行库需要重启 Windows。重启后重试，已下载文件会复用。' : `语音运行环境准备失败（${code}）。${diagnostics.replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g,'https://***@').slice(-1200)}`));
    });
  });
}

// Explorer launches do not inherit terminal proxy variables. Reuse the desktop
// network choice for upstream Python/package downloads without changing Windows.
export async function upstreamProxyEnvironment(resolveProxy, environment = process.env) {
  if (Object.entries(environment).some(([key,value]) => /^(https?|all)_proxy$/i.test(key) && value)) return {};
  const first = (await resolveProxy('https://pypi.org/simple')).split(';')[0].trim();
  if (!first || first === 'DIRECT') return {};
  const match = /^(PROXY|HTTPS|SOCKS5?)\s+(\S+)$/i.exec(first);
  if (!match) throw new Error('系统代理类型不受语音环境下载器支持，请设置 HTTPS_PROXY 后重试。');
  const protocol = match[1].toUpperCase() === 'PROXY' ? 'http:' : match[1].toUpperCase() === 'HTTPS' ? 'https:' : 'socks5h:';
  const url = new URL(`${protocol}//${match[2]}`);
  if (!url.hostname || !/:\d+$/.test(match[2]) || url.username || url.password || url.pathname && url.pathname !== '/') throw new Error('系统代理地址无效。');
  return { HTTPS_PROXY:url.href, HTTP_PROXY:url.href };
}

export async function prepareQwenRuntime(pack, cache, destination, signal, onStage, { run = runResourceCommand, environment = {} } = {}) {
  const env = { ...process.env, ...environment };
  for (const key of Object.keys(env)) if (/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA_PREFIX|ELECTRON_RUN_AS_NODE)/i.test(key)) delete env[key];
  Object.assign(env, { UV_CACHE_DIR:join(cache,'runtime-cache'), UV_PYTHON_INSTALL_DIR:join(cache,'runtime-python'), UV_PYTHON_BIN_DIR:join(cache,'runtime-bin'), PYTHONUTF8:'1', PYTHONNOUSERSITE:'1' });
  env.TEMP = env.TMP = join(cache,'runtime-temp'); await mkdir(env.TEMP,{recursive:true});
  const system = join(process.env.SystemRoot || 'C:/Windows','System32');
  const powershell = join(system,'WindowsPowerShell/v1.0/powershell.exe');
  const ps = value => `'${value.replaceAll("'", "''")}'`;
  onStage('检查语音运行环境');
  const runtime = await run(powershell,['-NoProfile','-NonInteractive','-Command',`$p=${ps(join(system,'msvcp140.dll'))}; if(Test-Path -LiteralPath $p){$v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($p);if($v.FileMajorPart -gt 14 -or ($v.FileMajorPart -eq 14 -and $v.FileMinorPart -ge 44)){'ok'}}`],signal,{env});
  if(runtime.trim()!=='ok') {
    onStage('安装微软语音运行库，请处理 Windows 授权提示',false);
    await run(powershell,['-NoProfile','-NonInteractive','-Command',`try {$p=Start-Process -FilePath ${ps(join(cache,'bootstrap/VC_redist.x64.exe'))} -ArgumentList '/install','/passive','/norestart' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if($p.ExitCode -eq 1638){exit 0};exit $p.ExitCode}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`],signal,{env});
  }
  onStage('准备独立 Python 环境');
  const toolDir = join(cache,'uv-tool'); await mkdir(toolDir,{recursive:true});
  await run(join(system,'tar.exe'),['-xf',join(cache,'bootstrap/uv.zip'),'-C',toolDir],signal,{env});
  const uv=join(toolDir,'uv.exe');
  await run(uv,['--no-config','--no-progress','python','install',pack.runtime.python,'--no-bin','--no-registry'],signal,{env});
  const python = resolve((await run(uv,['--no-config','python','find','--managed-python',pack.runtime.python],signal,{env})).trim());
  if(!python.startsWith(resolve(cache,'runtime-python')+sep)||basename(python).toLowerCase()!=='python.exe')throw new Error('Python 上游安装路径无效。');
  await cp(dirname(python),join(destination,'python'),{recursive:true}); signal.throwIfAborted();
  onStage('从上游安装 Qwen 运行依赖，首次准备可能需要几分钟');
  const target = join(destination,'python/python.exe');
  await run(uv,['--no-config','--no-progress','pip','sync','--python',target,'--no-python-downloads','--break-system-packages','--require-hashes','--link-mode','copy','--index-url','https://pypi.org/simple','--extra-index-url','https://download.pytorch.org/whl/cu128','--index-strategy','unsafe-best-match','--build-constraints',fileURLToPath(new URL('./qwen-build-constraints.txt',import.meta.url)),fileURLToPath(new URL('./qwen-requirements.txt',import.meta.url))],signal,{env});
  onStage('检查 Qwen 运行环境');
  await run(target,['-I','-c','import torch, numpy; from qwen_tts import Qwen3TTSModel; print("QWEN_RUNTIME_READY")'],signal,{env,timeoutMs:180000});
  await writeFile(join(destination,'.runtime-ready.json'),JSON.stringify({python:pack.runtime.python,uv:pack.runtime.uvVersion,source:'upstream'}));
}
