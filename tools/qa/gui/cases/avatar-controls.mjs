// Real Electron regression; isolated storage and no inference.
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createGuiContext } from '../context.mjs';
const context = await createGuiContext('avatar-controls');
const { storage, out } = context;
const launch = () => context.launch('avatar');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [], samples = [];
let app = await launch();
let processHandle = app.process();
try {
  await app.firstWindow(); for (let n = 0; app.windows().length < 2 && n < 80; n++) await pause(50);
  let avatar = app.windows().find(page => page.url().includes('view=avatar'));
  const bubble = app.windows().find(page => page.url().includes('view=chat'));
  await avatar.locator('canvas').waitFor({ state: 'attached' }); await pause(900);
  await bubble.waitForFunction(() => !document.getElementById('send-button').disabled);
  async function sample(name, expectedScale) {
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).getBounds());
    const preference = (await avatar.evaluate(() => window.companion.appearance())).value;
    samples.push({ name, bounds, scale: preference.scale });
    if (Math.abs(bounds.width - 300 * expectedScale) > 2 || Math.abs(bounds.height - 420 * expectedScale) > 2 || preference.scale !== expectedScale) failures.push(`${name}: explicit size did not match ${expectedScale}`);
  }
  if (await avatar.locator('#avatar-caption').count()) failures.push('duplicate entry still exists');
  await avatar.locator('#avatar-canvas').focus(); await avatar.keyboard.press('Enter'); await pause(250);
  await bubble.locator('#settings-button').click();
  const size = bubble.locator('#avatar-size'); await size.focus(); await size.press('End'); await pause(700);
  await sample('slider-150', 1.5);
  await size.press('Home'); await pause(700); await sample('slider-60', .6);
  for (let n = 0; n < 5; n++) { await bubble.evaluate(() => window.companion.avatarScale(1.25)); await bubble.evaluate(() => window.companion.avatarScale(1)); }
  await pause(700); await sample('repeated-size-reset', 1);
  await bubble.locator('#reset-avatar').click(); await pause(500); await sample('reset-position-and-size', 1);
  await size.evaluate(input => { input.value = '125'; input.dispatchEvent(new Event('input', { bubbles: true })); }); await pause(700);
  await sample('slider-125', 1.25);
  await bubble.mouse.move(0, 0); await bubble.screenshot({ path: resolve(out, 'size-settings.png'), omitBackground: true });
  // Inspect the native menu by replacing only its OS popup in this isolated process.
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = function () { globalThis.avatarControlMenu = this; }; });
  await avatar.locator('#avatar-drag').click({ button: 'right' }); await pause(150);
  const menu = await app.evaluate(() => globalThis.avatarControlMenu?.items.map(item => ({ label: item.label, choices: item.submenu?.items.map(choice => choice.label) })));
  if (!menu?.some(item => item.label === '退出桌面伙伴') || !menu?.some(item => item.label === '角色大小' && item.choices.includes('125%'))) failures.push('native character context menu is incomplete');
  const closing = app.waitForEvent('close');
  await app.evaluate(() => { setTimeout(() => globalThis.avatarControlMenu.items.find(item => item.label === '退出桌面伙伴').click(), 50); });
  await closing;
  const saved = JSON.parse(await readFile(resolve(storage, 'appearance.json'), 'utf8'));
  if (saved.scale !== 1.25 || !Number.isFinite(saved.position?.x) || !Number.isFinite(saved.position?.y)) failures.push('appearance was not saved on exit');
  const normalExit = processHandle.exitCode === 0;
  if (!normalExit) failures.push('native menu did not exit cleanly');
  app = await launch(); processHandle = app.process(); await app.firstWindow();
  for (let n = 0; app.windows().length < 2 && n < 80; n++) await pause(50);
  avatar = app.windows().find(page => page.url().includes('view=avatar'));
  await avatar.locator('canvas').waitFor({ state: 'attached' }); await pause(900);
  await sample('reopened-125', 1.25);
  const restored = samples.at(-1).bounds;
  if (Math.abs(restored.x - saved.position.x) > 1 || Math.abs(restored.y - saved.position.y) > 1) failures.push('character position did not survive reopening');
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ samples, menu, normalExit, failures }, null, 2));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('PASS: size slider, reset, repeated sizing, native context menu, clean exit, and reopening with saved appearance.');
} finally { if (processHandle.exitCode === null) await app.close(); }
