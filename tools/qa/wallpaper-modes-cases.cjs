const assert = require('node:assert/strict');

module.exports = async function (fixture) {
  const { wallpaper, chat, workbench, host, store, present, checks, js, until, delay, capture, notify, restore, withdrawnRequests, output, failAsset } = fixture;
  const rig = id => until(wallpaper, `${host}.dataset.rig==='${id}' && ${host}.dataset.loading==='false'`);
  const puppet = "document.querySelector('.wallpaper-puppet[data-active=true]')";
  const pose = id => until(wallpaper, `${host}.dataset.pose==='${id}' && ${puppet}?.dataset.actualPose==='${id}' && ${puppet}?.dataset.transitionPhase==='steady'`);
  const save = async patch => assert.equal((await js(workbench, `companion.saveSettings(${JSON.stringify(patch)})`)).ok, true);
  const style = value => js(workbench, `document.querySelector('[name=wallpaper-style][value=${value}]').click()`);
  const selectedStyle = () => js(workbench, "document.querySelector('[name=wallpaper-style]:checked').value");
  const animeMale = () => until(wallpaper, `${host}.dataset.character==='anime-male' && ${host}.dataset.loading==='false'`);
  const control = async (action,value) => assert.equal((await js(workbench, `companion.wallpaperControl(${JSON.stringify(action)},${JSON.stringify(value)})`)).ok, true);
  wallpaper.webContents.setAudioMuted(true); chat.webContents.setAudioMuted(true);
  await until(workbench, "document.getElementById('still-previews').children.length===5");
  await js(workbench, "document.getElementById('settings-tab').click()");
  await rig('scene'); await pose('window');
  assert.equal(store.data.settings.animePlayback, 'poses');
  assert.equal(store.data.settings.qwenVoice, 'Vivian'); assert.equal(store.data.settings.voice, 48);
  assert.equal(store.draft({cwd:output,provider:'codex',threadId:null}), 'Preserve the rollback draft');
  assert.equal(store.data.projects.length, 1);
  assert.deepEqual(await js(workbench, "Array.from(document.querySelectorAll('[name=wallpaper-style]'), r => r.value)"), ['anime', 'anime-male', 'realistic']);
  assert.equal(await js(workbench, "document.querySelectorAll('#anime-playback,[data-video-action]').length"), 0);
  assert.deepEqual(withdrawnRequests, []);
  if (restore) {
    await animeMale(); assert.equal(await selectedStyle(), 'anime-male');
    await capture(wallpaper, 'anime-male-restored');
    checks.push('fresh process restores the selected male wallpaper, pinned pose, voices, project and draft'); return;
  }
  checks.push('legacy anime video settings load original poses with five pose choices and no video action controls');
  for (const id of ['work','cup','thinking','attention','window']) {
    await js(workbench, `document.querySelector('#still-previews [data-pose=${id}]').click()`);
    await pose(id);
  }
  checks.push('all five original anime poses render and settle through the production controls');
  present.chatVisible=true;notify();await pose('attention');present.chatVisible=false;notify();await pose('window');
  checks.push('conversation wakes attention and restores the pinned original pose');
  await control('pause',true);assert.equal(await js(wallpaper, `${host}.dataset.paused`),'true');
  await control('pause',false);
  await delay(300);await capture(wallpaper,'anime-original');await capture(workbench,'wallpaper-options');
  const savedEngine = store.data.settings.ttsEngine;
  await save({ttsEngine:'kokoro'});
  await js(workbench, `(() => {
    document.querySelector('[data-setting-target="playback-settings"]').click();
    const voice = document.getElementById('voice'); voice.value = '59';
    voice.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-setting-target="wallpaper-settings"]').click();
  })()`);
  const draftVoice = "document.getElementById('voice').value==='59' && !document.getElementById('save-settings').hidden";
  await style('realistic');
  await rig('motion');
  await until(workbench, "document.getElementById('still-previews').children.length===2");
  await until(wallpaper, "Array.from(document.querySelectorAll('video')).some(v=>!v.paused && v.currentTime>.1)");
  await control('pause',true);await delay(200);
  const stopped=await js(wallpaper,"Array.from(document.querySelectorAll('video'),v=>({time:v.currentTime,paused:v.paused}))");
  await delay(400);
  const later=await js(wallpaper,"Array.from(document.querySelectorAll('video'),v=>({time:v.currentTime,paused:v.paused}))");
  assert.ok(stopped.every(v=>v.paused));assert.deepEqual(later,stopped);
  await control('pause',false);
  await until(wallpaper,"Array.from(document.querySelectorAll('video')).some(v=>!v.paused)");
  await capture(wallpaper,'realistic-video');
  checks.push('realistic style decodes actual videos with two states; pause freezes playback and resume restarts it');
  await save({wallpaperMotion:false,animePlayback:'video',stillPose:'window'});await rig('scene');await pose('window');
  await until(workbench, "document.getElementById('still-previews').children.length===5");
  assert.equal(await js(workbench, draftVoice), true);
  assert.equal(store.data.settings.wallpaperMotion,false);assert.equal(store.data.settings.animePlayback,'poses');
  assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-anime,video').length"),0);
  assert.equal((await js(workbench,"companion.wallpaperControl('video-action','nod')")).ok,false);
  assert.deepEqual(withdrawnRequests,[]);
  checks.push('style return and legacy API requests use original poses; retired actions reject and no anime video media is requested');

  failAsset('/scene/rin-male-poses/cup-blink.png');
  await style('anime-male');
  await until(workbench, "!document.getElementById('retry-character').hidden");
  assert.equal(await selectedStyle(), 'anime');
  assert.equal(store.data.settings.character, 'female');
  assert.equal(await js(wallpaper, `${host}.dataset.character`), 'female');
  failAsset('');
  await js(workbench, "document.getElementById('retry-character').click()");
  await animeMale(); await pose('window');
  assert.equal(await selectedStyle(), 'anime-male');
  assert.equal(store.data.settings.qwenVoice, 'Vivian'); assert.equal(store.data.settings.voice, 48);
  assert.equal(await js(workbench, draftVoice), true);
  await js(workbench, "document.getElementById('save-settings').click()");
  await until(workbench, "document.getElementById('save-settings').hidden");
  assert.equal(store.data.settings.voice, 59);
  await save({voice:48,ttsEngine:savedEngine});
  checks.push('deferred Kokoro voice remains editable and saves after all three styles switch; pose choices track the committed style');
  checks.push('a failed male texture retains the accepted original female scene; Retry loads the male pack without changing either voice');

  for (const id of ['attention', 'cup', 'thinking', 'window', 'work']) {
    await js(workbench, `document.querySelector('#still-previews [data-pose=${id}]').click()`);
    await pose(id);
  }
  await until(workbench, "document.getElementById('still-status').textContent.includes('专注工作')");
  await capture(wallpaper, 'anime-male-work');
  checks.push('the male wallpaper renders all five original-art idle poses in the production window');

  await require('./puppet-dialogue-case.cjs')({ ...fixture, puppet, settings: save });
  await style('realistic'); await rig('motion');
  assert.equal(store.data.settings.character, 'female');
  await style('anime-male'); await animeMale();
  assert.equal(store.data.settings.wallpaperMotion, false);
  assert.equal(store.data.settings.qwenVoice, 'Vivian'); assert.equal(store.data.settings.voice, 48);
  await save({stillPose:'window'}); await pose('window');
  checks.push('both anime and realistic styles retain their own renderer when switching from and back to the male wallpaper');
};
