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
    for (let i = 0; i < 200 && !(await run('!!window.preview')); i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(await run('!!window.preview'), 'pose renderer initialized');
    const poses = ['attention', 'cup', 'work', 'thinking', 'window'];
    async function capture(name, state) {
      const data = await run(`preview.render(0,${JSON.stringify(state)})`);
      writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'));
    }
    for (const pose of poses) {
      await capture(pose, { frame: { pose, opacity: 1 }, blink: 0, mouth: 0 });
      await capture(pose + '-closed', { frame: { pose, opacity: 1 }, blink: 1, mouth: 0 });
    }
    for (const opacity of [0.5, 0])
      await capture('cup-opacity-' + opacity, { frame: { pose: 'cup', opacity }, blink: 0 });
    for (const opacity of [0.25, 0.5, 0.75])
      await capture('cup-pixels-' + opacity, { frame: { pose: 'cup', opacity, effect: 'pixels' }, blink: 0 });
    for (const mouth of [0.12, 0.35, 0.7])
      await capture('attention-mouth-' + mouth, {
        frame: { pose: 'attention', opacity: 1 },
        mouth,
        blink: 0,
      });
    const invariants = await run(`(()=>{
    const w=preview.canvas.width,h=preview.canvas.height;
    const render=(pose,opacity=1,blink=0,mouth=0,gaze=[0,0],effect)=>{preview.render(0,{frame:{pose,opacity,effect},blink,mouth,gaze});return preview.pixels();};
    const empty=render('attention',0),base=render('attention');
    let fixedChanged=0,emptyChanged=0,bodyChanged=0,blendFailures=0,pixelEndpointChanges=0,pixelBackgroundChanges=0;const expressions={},bottomCoverage={},pixelDifferences={};
    for(const pose of ${JSON.stringify(poses)}){
      const full=render(pose),zero=render(pose,0,1,.7),half=render(pose,.5);
      const pixelFull=render(pose,1,0,0,[0,0],'pixels'),pixelZero=render(pose,0,1,.7,[0,0],'pixels'),pixelHalf=render(pose,.5,0,0,[0,0],'pixels');
      const face=preview.player.config.poses.find(p=>p.id===pose).face;
      const animated=render(pose,1,1,.7,[.45,.18]);let changed=0,pixelDifference=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=((h-1-y)*w+x)*4;
        for(let c=0;c<3;c++){
          if(zero[i+c]!==empty[i+c])emptyChanged++;
          if(pixelFull[i+c]!==full[i+c]||pixelZero[i+c]!==empty[i+c])pixelEndpointChanges++;
          if(x<530&&pixelHalf[i+c]!==empty[i+c])pixelBackgroundChanges++;
          if(Math.abs(pixelHalf[i+c]-half[i+c])>15)pixelDifference++;
          if(Math.abs(half[i+c]-(full[i+c]+empty[i+c])/2)>2)blendFailures++;
          if(x<530&&full[i+c]!==base[i+c])fixedChanged++;
          if(full[i+c]!==animated[i+c]){changed++;if(x<face[0]-2||x>face[0]+face[2]+2||y<face[1]-2||y>face[1]+face[3]+2)bodyChanged++;}
        }
      }
      expressions[pose]=changed;
      pixelDifferences[pose]=pixelDifference;
      // These authored poses have legs continuing beyond the lower frame edge.
      // Registration must not introduce a transparent horizontal cut there.
      const coverage=y=>{let count=0;for(let x=650;x<1100;x++){const i=((h-1-y)*w+x)*4;if(Math.max(...[0,1,2].map(c=>Math.abs(full[i+c]-empty[i+c])))>15)count++;}return count;};
      bottomCoverage[pose]={last:coverage(h-1),above:coverage(h-10)};
    }
    return {width:w,height:h,fixedChanged,emptyChanged,bodyChanged,blendFailures,pixelEndpointChanges,pixelBackgroundChanges,pixelDifferences,expressions,bottomCoverage,textures:preview.player.textures.size,glError:preview.player.gl.getError()};
  })()`);
    assert.equal(invariants.fixedChanged, 0, 'the fixed room never changes with a pose');
    assert.equal(invariants.emptyChanged, 0, 'every fully faded pose exposes the same empty scene');
    assert.equal(invariants.bodyChanged, 0, 'facial animation never moves any body or prop pixels');
    assert.equal(invariants.blendFailures, 0, 'a fading pose only changes opacity, never limb geometry');
    assert.equal(
      invariants.pixelEndpointChanges,
      0,
      'pixel transitions preserve exact original and empty endpoints',
    );
    assert.equal(invariants.pixelBackgroundChanges, 0, 'pixel transitions never affect the fixed room');
    for (const [pose, count] of Object.entries(invariants.pixelDifferences))
      assert.ok(count > 1000, pose + ' uses visible pixel reassembly rather than a plain fade');
    assert.equal(invariants.glError, 0);
    assert.equal(invariants.textures, 14);
    for (const [pose, changed] of Object.entries(invariants.expressions))
      assert.ok(changed > 100, pose + ' has visible facial animation');
    for (const [pose, edge] of Object.entries(invariants.bottomCoverage))
      assert.ok(
        edge.above > 100 && edge.last > edge.above * 0.9,
        pose + ' has no transparent cut across the lower canvas edge',
      );
    if (!process.argv.includes('--stills')) {
      mkdirSync(join(output, 'frames'));
      const changes = {
        72: 'attention',
        168: 'work',
        240: 'thinking',
        312: 'window',
        384: 'cup',
        456: 'thinking',
        459: 'window',
        462: 'attention',
      };
      let previous = 'cup';
      const transitions = [];
      for (let i = 0; i <= 528; i++) {
        if (changes[i]) await run(`preview.motion.request('${changes[i]}')`);
        const data = await run(`preview.render(${i / 24},{},'image/jpeg')`);
        const state = await run('preview.motion.snapshot()');
        if (state.pose !== previous) {
          assert.equal(state.opacity, 0);
          transitions.push({ frame: i, ...state });
          previous = state.pose;
        }
        writeFileSync(
          join(output, 'frames', String(i).padStart(4, '0') + '.jpg'),
          Buffer.from(data, 'base64'),
        );
      }
      writeFileSync(join(output, 'transitions.json'), JSON.stringify(transitions, null, 2));
      assert.equal(
        await run('preview.motion.snapshot().phase'),
        'steady',
        'rapid requests finish on the last pose',
      );
    }
    assert.deepEqual(errors, []);
    writeFileSync(
      join(output, 'result.json'),
      JSON.stringify({ invariants, errors, physicalDisplayAcceptance: false, artApproval: false }, null, 2),
    );
    win.destroy();
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
