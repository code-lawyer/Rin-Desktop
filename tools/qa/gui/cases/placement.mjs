// Real Electron regression; isolated storage and no inference.
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { waitForCondition } from '../../../../prototypes/live2d-codex/scripts/wait-for-condition.mjs';
import { createGuiContext } from '../context.mjs';
const context = await createGuiContext('placement');
const { out, project: repo } = context;
const app = await context.launch('avatar');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [], cases = [];
let fixtureNumber = 0;
const formattedReply = '已经收到你的任务。**我们可以继续这一次对话。**\n\n这里使用本机的 `Codex CLI`，消息和回复都在角色旁边显示。\n\n```text\ncodex app-server --listen stdio://\n```\n\n你可以继续追问，或查看 [连接说明](https://example.com/guide)。\n\n- 每次保留这一轮回复。\n- 长内容可以展开阅读。\n\n下一步告诉我你想完成的事就好。';
try {
  await app.firstWindow();
  for (let n = 0; app.windows().length < 2 && n < 80; n++) await pause(50);
  const avatar = app.windows().find(page => page.url().includes('view=avatar'));
  const bubble = app.windows().find(page => page.url().includes('view=chat'));
  if (!avatar || !bubble) throw new Error('Prototype windows did not initialize.');
  for (const page of [avatar, bubble]) page.on('pageerror', error => failures.push(`renderer: ${error.message}`));
  await avatar.locator('canvas').waitFor({ state: 'attached' }); await pause(900);
  await waitForCondition(() => bubble.evaluate(async () => (await window.companion.snapshot()).value?.connection === 'ready'), { timeout: 15_000, message: 'CLI did not become ready for placement verification' });
  await bubble.waitForFunction(() => !document.getElementById('send-button').disabled && document.getElementById('activity-line').hidden);
  if (await avatar.locator('#avatar-caption').count()) failures.push('duplicate avatar entry was not removed');
  await bubble.evaluate(() => window.companion.windowAction('show-chat')); await pause(250);
  async function inspect(name) {
    const windows = await app.evaluate(({ BrowserWindow, screen }) => {
      const avatar = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar'));
      const bubble = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=chat'));
      return { avatar: avatar.getContentBounds(), bubble: bubble.getContentBounds(), work: screen.getDisplayMatching(avatar.getBounds()).workArea };
    });
    const head = await avatar.evaluate(() => {
      const source = document.querySelector('canvas'), canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let top = canvas.height, bottom = -1, left = canvas.width, right = -1;
      for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) if (pixels[(y * canvas.width + x) * 4 + 3] > 24) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
      return { x: (left + right) / 2 / canvas.width * innerWidth, y: (top + (bottom - top) * .12) / canvas.height * document.getElementById('avatar-canvas').clientHeight, vw: innerWidth, vh: innerHeight };
    });
    const tip = await bubble.evaluate(() => {
      const tail = document.querySelector('.bubble-tail').getBoundingClientRect(), side = document.getElementById('chat-view').dataset.side;
      return { x: side === 'right' ? tail.right : tail.left, y: tail.top + tail.height / 2, vw: innerWidth, vh: innerHeight, side,
        alpha: Number(getComputedStyle(document.querySelector('.bubble-surface')).opacity) };
    });
    const absoluteHead = { x: windows.avatar.x + head.x * windows.avatar.width / head.vw, y: windows.avatar.y + head.y * windows.avatar.height / head.vh };
    const absoluteTip = { x: windows.bubble.x + tip.x * windows.bubble.width / tip.vw, y: windows.bubble.y + tip.y * windows.bubble.height / tip.vh };
    const gapY = Math.abs(absoluteHead.y - absoluteTip.y), gapX = Math.abs(absoluteHead.x - absoluteTip.x);
    const captionVisible = !!await avatar.locator('#avatar-caption').count();
    const result = { name, ...windows, absoluteHead, absoluteTip, gapY, gapX, alpha: tip.alpha, captionVisible };
    cases.push(result); console.log(JSON.stringify(result));
    if (gapY > 8 || gapX > 100) failures.push(`${name}: tail/head gap ${gapY.toFixed(1)}px vertically, ${gapX.toFixed(1)}px horizontally`);
    if (tip.alpha > .78 || tip.alpha < .45) failures.push(`${name}: bubble background alpha=${tip.alpha}, expected .45–.78`);
    if (captionVisible) failures.push(`${name}: avatar entry is visible while the dialogue is open`);
    const controls = await bubble.evaluate(() => {
      const card = document.getElementById('bubble-card').getBoundingClientRect(), composer = document.getElementById('composer').getBoundingClientRect(), reply = document.getElementById('messages').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.bubble-header button')].map(button => button.getBoundingClientRect());
      return { inside: composer.bottom <= card.bottom - 8 && composer.left >= card.left && composer.right <= card.right, separated: reply.bottom <= composer.top, headerFits: buttons.at(-1).right <= card.right, oneReply: document.querySelectorAll('#messages article:not([hidden])').length <= 1 };
    });
    for (const [check, ok] of Object.entries(controls)) if (!ok) failures.push(`${name}: layout check failed: ${check}`);
    return { windows, head, tip };
  }
  async function replyFixture(text, overrides = {}) {
    const state = (await bubble.evaluate(() => window.companion.snapshot())).value;
    // Send a local renderer fixture through the real state/update path, without a Codex task.
    const replyId = `fixture-reply-${++fixtureNumber}`;
    const { complete = true, ...stateOverrides } = overrides;
    state.messages = [{ id: 'fixture-user', role: 'user', turnId: 'fixture-turn', text: '测试气泡' }, { id: replyId, role: 'assistant', turnId: 'fixture-turn', text, complete, phase: 'final_answer' }];
    Object.assign(state, stateOverrides);
    await app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=chat')).webContents.send('companion:state', state);
    }, state);
    await bubble.waitForFunction(id => document.getElementById('current-message').dataset.messageId === id, replyId);
    await pause(350);
  }
  await inspect('initial');
  if (!process.argv.includes('--initial-only')) {
  await bubble.locator('#close-chat').click();
  if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=chat')).isVisible())) failures.push('close control did not hide the bubble');
  await avatar.screenshot({ path: resolve(out, 'collapsed.png'), omitBackground: true });
  await avatar.locator('#avatar-canvas').focus(); await avatar.keyboard.press('Enter'); await pause(250);
  await inspect('keyboard-reopen');
  await avatar.evaluate(() => { window.companion.beginMove({ x: 0, y: 0 }); window.companion.moveTo({ x: -100, y: -65 }); window.companion.endMove(); }); await pause(700);
  await inspect('after-drag');
  await replyFixture('用于测试长回复时气泡仍对准角色头部。\n'.repeat(80));
  const long = await inspect('long-reply');
  if (long.windows.bubble.height < 600) failures.push('long-reply fixture did not expand the actual window');
  await replyFixture('好');
  await inspect('short-after-long');
  await replyFixture(formattedReply);
  const markdown = await bubble.evaluate(() => ({ bold: document.querySelector('#reply-body strong')?.textContent, code: document.querySelector('#reply-body pre code')?.textContent, list: document.querySelectorAll('#reply-body li').length, links: document.querySelectorAll('#reply-body a').length }));
  if (markdown.bold !== '我们可以继续这一次对话。' || !markdown.code?.includes('app-server') || markdown.list !== 2 || markdown.links !== 1) failures.push('Markdown reply structure is incomplete');
  await bubble.screenshot({ path: resolve(out, 'formatted-reply.png'), omitBackground: true });
  await bubble.locator('#settings-button').click(); await pause(250);
  await inspect('settings-open');
  await bubble.screenshot({ path: resolve(out, 'settings.png'), omitBackground: true });
  await bubble.keyboard.press('Escape'); await pause(250);
  await bubble.locator('#reading-button').click();
  await bubble.waitForFunction(() => document.getElementById('chat-view').dataset.reading === 'true');
  await bubble.locator('#prompt').fill('保留这条未发送的追问');
  await bubble.screenshot({ path: resolve(out, 'reader.png') });
  await pause(250); await bubble.keyboard.press('Escape');
  await bubble.waitForFunction(() => document.getElementById('chat-view').dataset.reading === 'false'); await pause(350);
  await inspect('after-reading');
  if (await bubble.locator('#prompt').inputValue() !== '保留这条未发送的追问') failures.push('draft lost when returning from reading');
  await bubble.locator('#prompt').fill('');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).webContents.setZoomFactor(1.25); }); await pause(700);
  await inspect('zoom-125');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).webContents.setZoomFactor(1); }); await pause(700);
  await inspect('zoom-restored');
  const toLeft = await app.evaluate(({ BrowserWindow, screen }) => { const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).getBounds(); return screen.getDisplayMatching(b).workArea.x + 14 - b.x; });
  await avatar.evaluate(x => { window.companion.beginMove({ x: 0, y: 0 }); window.companion.moveTo({ x, y: 0 }); window.companion.endMove(); }, toLeft); await pause(250);
  const left = await inspect('near-left-edge');
  if (left.tip.side !== 'left') failures.push('tail did not switch sides near the left screen edge');
  const target = cases.find(c => c.name === 'after-drag').avatar;
  const from = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=avatar')).getBounds());
  await avatar.evaluate(delta => { window.companion.beginMove({ x: 0, y: 0 }); window.companion.moveTo(delta); window.companion.endMove(); }, { x: target.x - from.x, y: target.y - from.y }); await pause(250);
  await inspect('final');
  await replyFixture('正在整理结果。', { status: 'working', activity: '正在回复', complete: false });
  if (await bubble.locator('#stop-button').isHidden() || !await bubble.locator('#send-button').isDisabled()) failures.push('working controls do not reflect current task state');
  await bubble.screenshot({ path: resolve(out, 'working.png'), omitBackground: true });
  await replyFixture('这一步需要你确认。', { status: 'waiting', activity: '等待确认', approvals: [{ id: 'fixture-approval', kind: 'command', command: 'codex --version', reason: '界面状态测试，不执行命令。', cwd: repo, details: '' }] });
  await bubble.screenshot({ path: resolve(out, 'approval.png'), omitBackground: true });
  await replyFixture('可以继续这次对话。', { connection: 'error', status: 'error', error: '连接暂时中断。请重启桌面伙伴后继续。' });
  await bubble.screenshot({ path: resolve(out, 'error.png'), omitBackground: true });
  const unsafe = '<img src="https://example.com/probe.png" onerror="window.untrustedOutput=1">\n\n[危险链接](javascript:alert(1))\n\n```js\nconst unfinished = 1;';
  await replyFixture(unsafe);
  const safety = await bubble.evaluate(async () => ({ active: document.querySelectorAll('#reply-body img, #reply-body script, #reply-body iframe, #reply-body a[href^="javascript:"]').length, executed: !!window.untrustedOutput, incompleteCode: document.querySelector('#reply-body pre')?.textContent, refused: !(await window.companion.openLink('javascript:alert(1)')).ok }));
  if (safety.active || safety.executed || !safety.refused || !safety.incompleteCode?.includes('unfinished')) failures.push('safe Markdown or incomplete code fence regression');
  await replyFixture(formattedReply);
  await app.evaluate(({ shell }) => { shell._vibeOpened = []; shell.openExternal = async href => { shell._vibeOpened.push(href); }; });
  await bubble.locator('#reply-body a').click(); await pause(100);
  const opened = await app.evaluate(({ shell }) => shell._vibeOpened);
  if (opened[0] !== 'https://example.com/guide') failures.push('explicit web link activation did not reach the validated native handler');
  await inspect('formatted-final');
  }
  await bubble.locator('#reading-button').blur();
  await avatar.locator('#avatar-canvas').blur();
  await bubble.mouse.move(0, 0);
  await avatar.mouse.move(0, 0); await pause(100);
  const avatarPng = await avatar.screenshot({ path: resolve(out, 'avatar.png'), omitBackground: true });
  const bubblePng = await bubble.screenshot({ path: resolve(out, 'bubble.png'), omitBackground: true });
  const last = cases.at(-1), padding = 28;
  const origin = { x: Math.min(last.avatar.x, last.bubble.x) - padding, y: Math.min(last.avatar.y, last.bubble.y) - padding };
  const size = { width: Math.max(last.avatar.x + last.avatar.width, last.bubble.x + last.bubble.width) - origin.x + padding, height: Math.max(last.avatar.y + last.avatar.height, last.bubble.y + last.bubble.height) - origin.y + padding };
  const photo = (png, bounds, label) => `<img alt="${label}" src="data:image/png;base64,${png.toString('base64')}" style="left:${bounds.x - origin.x}px;top:${bounds.y - origin.y}px;width:${bounds.width}px;height:${bounds.height}px">`;
  // A controlled preview of the two real window captures at their native positions.
  // The checkerboard shows PNG transparency without capturing other desktop apps.
  const html = `<!doctype html><meta charset="utf-8"><title>真实窗口位置与透明度检查</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:repeating-conic-gradient(#b0beb7 0% 25%,#e1e5d9 0% 50%) 0 0/80px 80px}img{position:absolute;display:block}</style>${photo(avatarPng, last.avatar, '角色')}${photo(bubblePng, last.bubble, '对话气泡')}`;
  await writeFile(resolve(out, 'joint-preview.html'), html);
  const previewReady = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, { html, size }) => {
    const preview = new BrowserWindow({ show: true, width: size.width, height: size.height, useContentSize: true, frame: false, resizable: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await preview.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }, { html, size });
  const preview = await previewReady; await preview.locator('img').first().waitFor({ state: 'visible' });
  await preview.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await preview.screenshot({ path: resolve(out, 'joint-preview.png') });
  const renderedAlpha = await app.evaluate(({ nativeImage }, { png, width }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64')), size = image.getSize(), bitmap = image.toBitmap();
    const x = Math.round(30 * size.width / width), y = Math.round(100 * size.width / width);
    return bitmap[(y * size.width + x) * 4 + 3] / 255;
  }, { png: bubblePng.toString('base64'), width: last.bubble.width });
  if (renderedAlpha < .45 || renderedAlpha > .78) failures.push(`actual window PNG alpha=${renderedAlpha}, expected .45–.78`);
  const contrast = await bubble.evaluate(() => {
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const background = [246, 250, 253].map(v => v * .72), bg = luminance(background);
    const ratio = color => (bg + .05) / (luminance(color.match(/[\d.]+/g).slice(0, 3).map(Number)) + .05);
    return { body: ratio(getComputedStyle(document.getElementById('reply-body')).color), placeholder: ratio(getComputedStyle(document.getElementById('prompt'), '::placeholder').color) };
  });
  if (contrast.body < 4.5 || contrast.placeholder < 4.5) failures.push('body or placeholder contrast is below 4.5:1 on a black desktop');
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ cases, renderedAlpha, contrast, failures }, null, 2));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('PASS: real-window alignment and translucent background across all cases.');
} finally { await app.close(); }
