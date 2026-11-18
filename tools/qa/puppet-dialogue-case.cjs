const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function checkDialogue({
  wallpaper, chat, host, puppet, state, present, output, checks, js, until, delay, notify, sendPresentation,
  settings, synthesis, completeReply, replyNarration,
}) {
  const saved = { ...state };
  const push = patch => {
    Object.assign(state, patch);
    for (const win of [wallpaper, chat]) win.webContents.send('companion:state', state);
  };
  const answer = (turnId, text, complete = false, phase = 'final_answer') => [
    { id: turnId + '-user', role: 'user', turnId, text: '你好，Rin。', complete: true },
    { id: turnId + '-reply', role: 'assistant', turnId, text, phase, complete,
      turnStatus: complete ? 'completed' : 'inProgress' },
  ];
  const steady = pose => `${puppet}.dataset.actualPose==='${pose}' && ${puppet}.dataset.transitionPhase==='steady'`;
  await settings({ autoSpeak: true });
  notify();

  push({ status: 'starting', turnId: 'fast', messages: [] });
  await until(wallpaper, `${puppet}.dataset.pose==='attention'`);
  push({ status: 'working', messages: answer('fast', '我先看看。', false, 'commentary') });
  await delay(570);
  assert.equal(await js(wallpaper, steady('attention')), true, 'a prompt text reply skips the thinking pose');
  push({ status: 'idle', turnId: null });
  await until(wallpaper, steady('work'));

  let recording = true, video;
  if (process.argv.includes('--record-dialogue')) {
    const frames = join(output, 'dialogue-frames');
    mkdirSync(frames);
    video = (async () => {
      for (let i = 0; recording; i++) {
        const start = performance.now();
        const image = await wallpaper.webContents.capturePage();
        writeFileSync(join(frames, String(i).padStart(4, '0') + '.jpg'), image.toJPEG(88));
        await delay(Math.max(0, 1000 / 15 - (performance.now() - start)));
      }
    })();
    await delay(350);
  }
  try {
    const start = performance.now();
    push({ status: 'starting', messages: [] });
    await until(wallpaper, `${puppet}.dataset.pose==='attention'`);
    push({ status: 'working', turnId: 'slow' });
    await until(wallpaper, `${host}.dataset.activity==='thinking'`);
    const thinkingAt = performance.now() - start;
    assert.ok(thinkingAt >= 480 && thinkingAt < 900, `thinking cue at ${thinkingAt} ms`);
    await until(wallpaper, steady('reply-thinking'));
    writeFileSync(join(output, 'rin-reply-thinking.png'), (await wallpaper.webContents.capturePage()).toPNG());
    await delay(450);

    const gate = Promise.withResolvers();
    synthesis(gate.promise);
    const messages = answer('slow', '你好。很高兴见到你。', true);
    completeReply({ threadId: state.threadId, turnId: 'slow', text: messages[1].text });
    push({ status: 'idle', turnId: null, messages });
    await until(chat, "document.getElementById('playback-status').textContent.includes('稍后播放')");
    await delay(450);
    assert.equal(await js(wallpaper, steady('reply-thinking')), true, 'keeps the new thinking artwork while reply audio is prepared');
    gate.resolve();
    await until(wallpaper, `${host}.dataset.activity==='speaking'`);
    const speechAt = performance.now();
    await until(wallpaper, steady('attention'));
    const lookBackMs = performance.now() - speechAt;
    assert.ok(lookBackMs < 500, `looked back in ${lookBackMs} ms`);
    await until(wallpaper, `Number(${puppet}.dataset.mouth)>.1`);
    if (video) await delay(1200);
    await js(chat, "document.getElementById('stop-speech').click()");
    writeFileSync(join(output, 'dialogue-timing.json'), JSON.stringify({ thinkingAt, lookBackMs }, null, 2));
  } finally {
    recording = false;
    await video;
    synthesis(null);
  }
  await settings({ autoSpeak: false });
  present.chatVisible = true;
  notify();
  push({ status: 'working', turnId: 'manual', messages: [] });
  await until(wallpaper, steady('reply-thinking'));
  const manual = answer('manual', '这条消息由你点按朗读。', true);
  completeReply({ threadId: state.threadId, turnId: 'manual', text: manual[1].text });
  push({ status: 'idle', turnId: null, messages: manual });
  await until(wallpaper, `${host}.dataset.activity==='awaiting-narration'`);
  const manualAudio = Promise.withResolvers();
  synthesis(manualAudio.promise);
  await js(chat, "document.getElementById('replay-reply').click()");
  await until(chat, "document.getElementById('playback-status').textContent.includes('稍后播放')");
  assert.equal(await js(wallpaper, steady('reply-thinking')), true, 'manual narration stays on the thinking pose while preparing');
  manualAudio.resolve();
  await until(wallpaper, `${host}.dataset.activity==='speaking'`);
  await until(wallpaper, steady('attention'));
  await js(chat, "document.getElementById('stop-speech').click()");
  assert.equal(replyNarration.cue, null);
  synthesis(null);

  await settings({ autoSpeak: true });
  notify();
  push({ status: 'working', turnId: 'cancel', messages: [] });
  await until(wallpaper, steady('reply-thinking'));
  const cancelled = answer('cancel', '这条播报会被取消。', true);
  const cancelledAudio = Promise.withResolvers();
  synthesis(cancelledAudio.promise);
  completeReply({ threadId: state.threadId, turnId: 'cancel', text: cancelled[1].text });
  push({ status: 'idle', turnId: null, messages: cancelled });
  await until(chat, "document.getElementById('playback-status').textContent.includes('稍后播放')");
  await js(chat, "document.getElementById('stop-speech').click()");
  await until(wallpaper, steady('attention'));
  assert.equal(replyNarration.cue, null, 'cancelling preparation clears the production cue');
  cancelledAudio.resolve();
  synthesis(null);
  present.chatVisible = false;
  sendPresentation();
  push({ ...saved, turnId: null });
  await settings({ autoSpeak: false });
  notify();
  await until(wallpaper, steady('work'));
  checks.push('visible progress skips thinking; slow replies hold for automatic or manual playback, and a cancelled preparation clears its cue');
};
