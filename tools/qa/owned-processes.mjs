import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
// No command lines or environment variables: identity is PID + creation time.
async function inventory() {
  if (process.platform !== 'win32') throw Error('This process-ownership check requires Windows');
  const command =
    "@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name} }) | ConvertTo-Json -Compress";
  const result = await execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}
export async function ownedProcessTree(pid) {
  return selectOwnedProcessTree(await inventory(), pid);
}
export function selectOwnedProcessTree(rows, pid) {
  const root = rows.find((row) => row.pid === pid);
  if (!root) return [];
  const owned = new Map([[pid, root]]);
  let changed;
  do {
    changed = false;
    for (const row of rows)
      if (!owned.has(row.pid) && owned.has(row.parent) && row.created >= owned.get(row.parent).created) {
        owned.set(row.pid, row);
        changed = true;
      }
  } while (changed);
  return [...owned.values()];
}
async function alive(owned) {
  const rows = await inventory();
  return owned.filter((item) => rows.some((row) => row.pid === item.pid && row.created === item.created));
}
export async function verifyProcessExit(owned, milliseconds = 8000) {
  const end = Date.now() + milliseconds;
  let remaining;
  do {
    remaining = await alive(owned);
    if (!remaining.length) return;
    await delay(300);
  } while (Date.now() < end);
  throw Error('Owned processes remain: ' + remaining.map((row) => `${row.name}:${row.pid}`).join(', '));
}
export async function terminateOwnedProcesses(owned) {
  // Recheck each identity immediately before a PID-scoped tree termination.
  // Never select processes by image name or kill unrelated same-name apps.
  for (const item of owned) {
    if (!(await alive([item])).length) continue;
    assert.ok(Number.isInteger(item.pid) && item.pid > 0 && item.pid !== process.pid);
    await execute('taskkill.exe', ['/PID', String(item.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10000,
    }).catch(() => {});
  }
  await verifyProcessExit(owned);
}
