import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectPage } from './cdp.mjs';
import { closeChild } from '../../prototypes/live2d-codex/backend/agent-process.mjs';
import { ownedProcessTree, verifyProcessExit, terminateOwnedProcesses } from './owned-processes.mjs';

// A real packaged app, with its own storage, project and loopback debug port.
// Never attaches this test wallpaper to the user's desktop or claims hotkeys.
export async function packagedSession({
  directory,
  output,
  storage = join(output, 'data'),
  project = output,
  provider = 'codex',
  env = {},
  extraArgs = [],
  wallpaperReady = true,
  allowReleasePackage = false,
}) {
  const root = resolve(import.meta.dirname, '../..');
  const inside = relative(join(root, 'work/qa'), resolve(output));
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Use a private QA run');
  const portable = JSON.parse(await readFile(join(directory, 'resources/app/portable.json'), 'utf8'));
  if (!allowReleasePackage)
    assert.equal(portable.testBuild?.channel, 'internal-test', 'Use an isolated test package');
  const isolatedStorage = relative(resolve(output), resolve(storage));
  assert.ok(
    isolatedStorage && !isolatedStorage.startsWith('..') && !isAbsolute(isolatedStorage),
    'Runtime storage must be inside this new QA output',
  );
  const server = createServer();
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  const environment = { ...process.env, VIBE_CODEX_BINARY: join(output, 'unavailable-codex.exe'), ...env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    join(directory, 'VibeVoice.exe'),
    [
      `--storage=${storage}`,
      `--project=${project}`,
      `--provider=${provider}`,
      '--visual=hidden',
      '--shortcut=off',
      `--debug-port=${port}`,
      ...extraArgs,
    ],
    { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '',
    workspace,
    wallpaper,
    chat,
    exit;
  const errors = [];
  child.stdout.on('data', (bytes) => {
    logs += bytes;
  });
  child.stderr.on('data', (bytes) => {
    logs += bytes;
  });
  const exited = new Promise((done) => {
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      done(exit);
    });
    child.once('error', (error) => {
      exit = { error: error.message };
      done(exit);
    });
  });
  async function until(read, label, milliseconds = 30000) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      if (exit) throw Error(`App exited while waiting for ${label}: ${JSON.stringify(exit)}`);
      if (await read()) return;
      await delay(100);
    }
    throw Error('Timed out: ' + label);
  }
  async function close() {
    let timer,
      owned = [],
      inventoryError;
    try {
      try {
        if (!exit) owned = await ownedProcessTree(child.pid);
      } catch (error) {
        inventoryError = error;
      }
      if (!exit && workspace) await workspace.evaluate("companion.windowAction('quit')").catch(() => {});
      if (!exit)
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('App did not exit normally')), 15000);
          }),
        ]);
      assert.equal(exit?.code, 0, 'packaged main exits normally');
      if (inventoryError)
        throw new Error(
          'App exited, but child-process cleanup cannot be verified: ' + inventoryError.message,
        );
      await verifyProcessExit(owned);
      await writeFile(
        join(output, `process-exit-${child.pid}.json`),
        JSON.stringify({ owned, allExited: true }, null, 2),
      );
    } finally {
      clearTimeout(timer);
      workspace?.close();
      wallpaper?.close();
      chat?.close();
      try {
        if (!exit) await closeChild(child);
        if (owned.length) await terminateOwnedProcesses(owned);
      } finally {
        await writeFile(join(output, `application-${child.pid || 'failed'}.log`), logs);
      }
    }
  }
  try {
    let pages;
    await until(async () => {
      try {
        pages = await (
          await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
        ).json();
        return ['workbench.html', 'view=wallpaper', 'view=chat'].every((part) =>
          pages.some((page) => page.url.includes(part)),
        );
      } catch {
        return false;
      }
    }, 'application windows');
    workspace = await connectPage(
      pages.find((page) => page.url.includes('workbench.html')),
      port,
    );
    wallpaper = await connectPage(
      pages.find((page) => page.url.includes('view=wallpaper')),
      port,
    );
    chat = await connectPage(
      pages.find((page) => page.url.includes('view=chat')),
      port,
    );
    for (const [name, page] of [
      ['workspace', workspace],
      ['wallpaper', wallpaper],
      ['chat', chat],
    ]) {
      page.on('Runtime.exceptionThrown', (value) =>
        errors.push({ window: name, error: value.exceptionDetails.text }),
      );
      await page.send('Runtime.enable');
    }
    await wallpaper.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    wallpaper.on('Page.screencastFrame', ({ sessionId }) =>
      wallpaper.send('Page.screencastFrameAck', { sessionId }).catch(() => {}),
    );
    await wallpaper.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 1,
      maxWidth: 160,
      maxHeight: 100,
      everyNthFrame: 2,
    });
    if (wallpaperReady)
      await until(
        async () => (await workspace.evaluate('companion.workspace()'))?.value?.wallpaper?.phase === 'ready',
        'ready wallpaper',
      );
    return { child, workspace, wallpaper, chat, until, close, errors, storage, project, portable };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
