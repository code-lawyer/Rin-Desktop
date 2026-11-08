const { app, BrowserWindow, protocol, net } = require('electron');
const { join, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFileSync, mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..'),
  output = resolve(process.argv[2]);
if (!output.startsWith(join(root, 'work/qa') + sep)) throw Error('Use work/qa');
app.setPath('userData', join(output, 'profile'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app
  .whenReady()
  .then(async () => {
    protocol.handle('app', (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/')
        return new Response(
          '<meta charset="utf-8"><canvas id="stage"></canvas><canvas id="output"></canvas><script type="module" src="/entry.js"></script>',
          { headers: { 'content-type': 'text/html' } },
        );
      if (path === '/entry.js') return net.fetch(pathToFileURL(join(output, 'entry.js')).href);
      if (/^\/assets\/[-a-zA-Z]+\.(png|json)$/.test(path))
        return net.fetch(
          pathToFileURL(
            join(root, 'prototypes/live2d-codex/assets/scene/rin-poses', path.slice('/assets/'.length)),
          ).href,
        );
      return new Response('', { status: 404 });
    });
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 860,
      webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true },
    });
    const errors = [];
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) errors.push(e.message);
    });
    await win.loadURL('app://local/');
    const run = (source) => win.webContents.executeJavaScript(source);
    for (let i = 0; i < 200 && !(await run('!!window.audition')); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(await run('!!window.audition'), 'renderer ready');
    const options = await run('audition.options');
    for (const option of options) {
      const folder = join(output, option.id);
      mkdirSync(folder);
      let previous;
      for (let index = 0; index < 315; index++) {
        const value = await run(`audition.render('${option.id}',${index / 30})`);
        const presence = value.frame.presence ?? value.frame.opacity;
        assert.ok(presence >= 0 && presence <= 1);
        if (previous && previous.pose !== value.frame.pose)
          assert.ok(Math.min(previous.presence, presence) < 0.015, 'pose changes at a cleared boundary');
        previous = { ...value.frame, presence };
        writeFileSync(
          join(folder, String(index).padStart(4, '0') + '.jpg'),
          Buffer.from(value.jpeg, 'base64'),
        );
      }
      assert.equal(previous.pose, 'work');
      assert.equal(previous.presence, 1);
    }
    const health = await run('audition.health()');
    if (health.backend === 'WebGL2') assert.equal(health.glError, 0);
    else {
      assert.equal(health.contextLost, false);
      assert.equal(health.assets, 5);
    }
    assert.deepEqual(errors, []);
    writeFileSync(
      join(output, 'result.json'),
      JSON.stringify(
        {
          options,
          health,
          framesPerOption: 315,
          fps: 30,
          duration: 10.5,
          errors,
          productionDefaultsChanged: false,
        },
        null,
        2,
      ),
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
