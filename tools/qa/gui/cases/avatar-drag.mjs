// Real Electron regression; isolated storage and no inference.
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createGuiContext } from '../context.mjs';
const context = await createGuiContext('avatar-drag');
const { out } = context;
const app = await context.launch('avatar');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [], samples = [];
try {
  await app.firstWindow();
  for (let n = 0; app.windows().length < 2 && n < 80; n++) await pause(50);
  const avatar = app.windows().find(page => page.url().includes('view=avatar'));
  await avatar.locator('canvas').waitFor({ state: 'attached' }); await pause(900);
  async function geometry(name) {
    const native = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')); return { bounds: w.getBounds(), content: w.getContentBounds() }; });
    const rendered = await avatar.evaluate(() => {
      const source = document.querySelector('canvas'), host = document.getElementById('avatar-canvas').getBoundingClientRect(), scratch = document.createElement('canvas');
      scratch.width = source.width; scratch.height = source.height; const ctx = scratch.getContext('2d'); ctx.drawImage(source, 0, 0);
      const rgba = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
      let top = scratch.height, bottom = -1;
      for (let y = 0; y < scratch.height; y += 2) for (let x = 0; x < scratch.width; x += 2) if (rgba[(y * scratch.width + x) * 4 + 3] > 40) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return { viewport: { width: innerWidth, height: innerHeight }, host: { width: host.width, height: host.height }, figureHeightCss: (bottom - top) / scratch.height * host.height };
    });
    const result = { name, ...native, ...rendered, figureHeight: rendered.figureHeightCss * native.content.height / rendered.viewport.height };
    samples.push(result); console.log(JSON.stringify(result)); return result;
  }
  const initial = await geometry('initial');
  for (let round = 0; round < 4; round++) {
    const handle = await avatar.locator('#avatar-drag').boundingBox();
    const start = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).getContentBounds());
    const viewport = await avatar.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const pointer = { x: start.x + (handle.x + handle.width / 2) * start.width / viewport.width, y: start.y + (handle.y + handle.height / 2) * start.height / viewport.height };
    await avatar.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await avatar.mouse.down();
    for (let step = 1; step <= 16; step++) {
      // Keep a straight screen-space trajectory while the native window moves.
      const current = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).getContentBounds());
      await avatar.mouse.move((pointer.x - step * 4 - current.x) * viewport.width / current.width, (pointer.y - step * 2 - current.y) * viewport.height / current.height);
      await pause(20);
    }
    await avatar.mouse.up();
    await pause(500);
    const next = await geometry(`drag-${round + 1}`);
    if (Math.abs(next.bounds.width - initial.bounds.width) > 2 || Math.abs(next.bounds.height - initial.bounds.height) > 2) failures.push(`${next.name}: native window changed size during move`);
    if (next.figureHeight > initial.figureHeight * 1.06) failures.push(`${next.name}: visible character grew ${Math.round(next.figureHeight / initial.figureHeight * 100 - 100)}% during move`);
    if (Math.abs(next.bounds.x - (start.x - 64)) > 2 || Math.abs(next.bounds.y - (start.y - 32)) > 2) failures.push(`${next.name}: drag did not follow the screen pointer`);
    if (process.argv.includes('--one-drag')) break;
  }
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ samples, failures }, null, 2));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('PASS: repeated real-handle dragging preserves native and rendered character size.');
} finally { await app.close(); }
