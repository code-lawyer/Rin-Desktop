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
          '<meta charset="utf-8"><style>html,body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas><script type="module" src="/entry.js"></script>',
          { headers: { 'content-type': 'text/html' } }
        );
      if (path === '/entry.js') return net.fetch(pathToFileURL(join(output, 'entry.js')).href);
      if (/^\/assets\/[-a-zA-Z]+\.(png|json)$/.test(path))
        return net.fetch(
          pathToFileURL(join(root, 'prototypes/live2d-codex/assets/scene/rin', path.slice('/assets/'.length)))
            .href
        );
      return new Response('', { status: 404 });
    });
    const win = new BrowserWindow({
      show: false,
      width: 1586,
      height: 992,
      webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true },
    });
    const errors = [];
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) errors.push(e.message);
    });
    await win.loadURL('app://local/');
    const run = (s) => win.webContents.executeJavaScript(s);
    for (let i = 0; i < 100 && !(await run('!!window.preview')); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(await run('!!window.preview'), 'action renderer initialized');
    const cases = [
      ['neutral', { pose: 'attention', amount: 1 }],
      ['wave-half', { pose: 'attention', amount: 1, action: { id: 'wave', time: 0.85 } }],
      ['wave', { pose: 'attention', amount: 1, action: { id: 'wave', time: 2.5 } }],
      ['window-quarter', { pose: 'window', amount: 0.25 }],
      ['window-half', { pose: 'window', amount: 0.5 }],
      ['window', { pose: 'window', amount: 1 }],
      ['thinking', { pose: 'thinking', amount: 1 }],
      ['work', { pose: 'work', amount: 1 }],
      ...['reach', 'lift', 'sip'].map((name, i) => [
        name,
        { pose: 'cup', amount: 1, cup: { reach: 1, lift: i * 0.5, held: i > 0 } },
      ]),
      ['tilt', { pose: 'attention', amount: 1, action: { id: 'tilt', time: 1.3 } }],
      ['shake', { pose: 'attention', amount: 1, action: { id: 'shake', time: 0.55 } }],
    ];
    const states = {};
    for (const [name, frame] of cases) {
      const data = await run(`preview.render(0,{frame:${JSON.stringify(frame)},blink:0,breath:0,hair:0})`);
      writeFileSync(join(output, name + '.jpg'), Buffer.from(data, 'base64'));
      states[name] = await run('preview.player.rigState');
    }
    for (const [name, expression] of [
      ['blink', { blink: 1 }],
      ['half-blink', { blink: 0.5 }],
      ...[0.12, 0.2, 0.5, 0.85].map((mouth) => ['mouth-' + mouth, { mouth }]),
    ]) {
      const data = await run(
        `preview.render(0,{frame:{pose:'attention',amount:1},blink:0,breath:0,hair:0,${Object.entries(
          expression
        )
          .map(([k, v]) => k + ':' + v)
          .join(',')}})`
      );
      writeFileSync(join(output, name + '.jpg'), Buffer.from(data, 'base64'));
    }
    const invariants = await run(
      `(()=>{const gl=preview.player.gl,w=preview.canvas.width,h=preview.canvas.height;const pixels=()=>{const b=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};preview.render(0,{frame:{pose:'attention',amount:1},blink:0,breath:0,hair:0});const base=pixels();let fixedChanged=0,movingChanged=0;for(const frame of ${JSON.stringify(cases.map((c) => c[1]))}){preview.render(0,{frame,blink:.5,breath:2,hair:1});const next=pixels();for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((h-1-y)*w+x)*4;if(base[i]!==next[i]||base[i+1]!==next[i+1]||base[i+2]!==next[i+2]){movingChanged++;if(x<530||(y>710&&x>600&&x<1420))fixedChanged++;}}}return{fixedChanged,movingChanged,width:w,height:h,cases:${cases.length}};})()`
    );
    assert.equal(
      invariants.fixedChanged,
      0,
      'seat, legs and distant room stay pixel-stable across all actions'
    );
    assert.ok(invariants.movingChanged > 1000, 'actions visibly move rendered pixels');
    writeFileSync(
      join(output, 'result.json'),
      JSON.stringify({ invariants, errors, physicalDisplayAcceptance: false }, null, 2)
    );
    assert.deepEqual(errors, []);
    if (process.argv.includes('--stills')) {
      writeFileSync(join(output, 'states.json'), JSON.stringify(states, null, 2));
      win.destroy();
      app.exit(0);
      return;
    }
    mkdirSync(join(output, 'frames'));
    const changes = {
      0: "preview.motion.act('wave')",
      168: "preview.motion.request('window')",
      312: "preview.motion.request('attention');preview.motion.act('nod')",
      384: "preview.motion.act('shake')",
      456: "preview.motion.act('tilt')",
      528: "preview.motion.request('thinking')",
      672: "preview.motion.request('work')",
      816: "preview.motion.request('cup')",
      1080: "preview.motion.request('attention')",
    };
    for (let i = 0; i <= 1248; i++) {
      if (changes[i]) await run(changes[i]);
      const data = await run(`preview.render(${i / 24})`);
      writeFileSync(join(output, 'frames', String(i).padStart(4, '0') + '.jpg'), Buffer.from(data, 'base64'));
    }
    assert.deepEqual(errors, []);
    win.destroy();
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
