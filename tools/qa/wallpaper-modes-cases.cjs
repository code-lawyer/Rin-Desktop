const assert = require('node:assert/strict');

module.exports = async function ({wallpaper,chat,workbench,host,store,present,checks,js,until,delay,capture,notify,restore,withdrawnRequests,output}) {
  const rig = id => until(wallpaper, `${host}.dataset.rig==='${id}' && ${host}.dataset.loading==='false'`);
  const puppet = "document.querySelector('.wallpaper-puppet[data-active=true]')";
  const pose = id => until(wallpaper, `${host}.dataset.pose==='${id}' && ${puppet}?.dataset.actualPose==='${id}' && ${puppet}?.dataset.transitionPhase==='steady'`);
  const save = async patch => assert.equal((await js(workbench, `companion.saveSettings(${JSON.stringify(patch)})`)).ok, true);
  const control = async (action,value) => assert.equal((await js(workbench, `companion.wallpaperControl(${JSON.stringify(action)},${JSON.stringify(value)})`)).ok, true);
  wallpaper.webContents.setAudioMuted(true); chat.webContents.setAudioMuted(true);
  await until(workbench, "document.getElementById('still-previews').children.length===5");
  await js(workbench, "document.getElementById('settings-tab').click()");
  await rig('scene'); await pose('window');
  assert.equal(store.data.settings.animePlayback, 'poses');
  assert.equal(store.data.settings.qwenVoice, 'Vivian'); assert.equal(store.data.settings.voice, 48);
  assert.equal(store.draft({cwd:output,provider:'codex',threadId:null}), 'Preserve the rollback draft');
  assert.equal(store.data.projects.length, 1);
  assert.equal(await js(workbench, "document.querySelectorAll('[name=wallpaper-style]').length"), 2);
  assert.equal(await js(workbench, "document.querySelectorAll('#anime-playback,[data-video-action]').length"), 0);
  assert.deepEqual(withdrawnRequests, []);
  if (restore) {
    await delay(300); await capture(wallpaper, 'anime-poses-restored');
    checks.push('fresh process restores original anime pose, voices, project and draft with only two style options'); return;
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
  await delay(300);await capture(wallpaper,'anime-original');await capture(workbench,'two-wallpaper-options');
  await js(workbench, "document.querySelector('[name=wallpaper-style][value=realistic]').click()");
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
  assert.equal(store.data.settings.wallpaperMotion,false);assert.equal(store.data.settings.animePlayback,'poses');
  assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-anime,video').length"),0);
  assert.equal((await js(workbench,"companion.wallpaperControl('video-action','nod')")).ok,false);
  assert.deepEqual(withdrawnRequests,[]);
  checks.push('style return and legacy API requests use original poses; retired actions reject and no anime video media is requested');
};
