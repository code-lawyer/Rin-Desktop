import { currentReply } from './current-reply.mjs';
import { speechProfile } from '../backend/speech-plan.mjs';
import { ReplyAudio } from './reply-audio.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';
export { speechChunks } from '../backend/speech-plan.mjs';
export function installSpeech({ api, state, insert, error, measure, isBusy = () => isTaskBusy(state()) }) {
  const $ = id => document.getElementById(id);
  let settings = {}, speech = {}, workspaceVersion = -1, stream, context, processor, source, chunks, sampleCount, timer, tick, recording = false, starting = false, recognizing = false, readRequested = false, operation = 0, playGeneration = 0, audioContext, audioSource, finishPlayback, narration, pendingCompletion;
  const seenCompletions = new Set();
  const label = text => { $('voice-status').textContent = text; $('voice-status').hidden = !text; measure(); };
  const target = () => JSON.stringify([state()?.provider,state()?.cwd,state()?.threadId]);
  const replyKey = (text = currentReply(state()?.messages).text) => {
    const reply = currentReply(state()?.messages);
    return JSON.stringify([target(),reply.turnId,reply.messageId,reply.key,text,speechProfile(settings)]);
  };
  const audio = new ReplyAudio({synthesize:(text,profile) => check(api.synthesize(text,profile)),cancel:() => api.stopSpeech(false),
    progress:value => { if (narration?.key === value.key) { narration.progress = value; showProgress(); } }});
  function showProgress() {
    if (!narration || narration.playing) return;
    const p = narration.progress, count = p ? ` · ${p.completed} / ${p.total} 段` : '';
    label(speech.phase === 'loading' ? '正在加载语音模型 · 完整语音准备好后播放' : `正在准备完整语音${count}${narration.playRequested ? ' · 完成后播放' : ' · 按朗读键可在完成后播放'}`);
    updateControls();
  }
  function valid(session) {
    const reply = currentReply(state()?.messages);
    return settings.ttsResident && speech.phase !== 'error' && !isBusy() && !recording && !starting && !recognizing && session.target === target()
      && session.profile === speechProfile(settings) && (session.preview || (reply.readable && reply.complete && session.key === replyKey()));
  }
  function updateControls() {
    const button = $('replay-reply'), reply = currentReply(state()?.messages);
    if (!settings.ttsResident || speech.phase === 'error') {
      button.textContent = '语音设置'; button.disabled = false;
      button.title = speech.error || '语音未加载 · 在工作台开启常驻后，可逐条朗读';
    } else {
      const ready = ['ready','loading'].includes(speech.phase) || !!narration;
      button.textContent = narration?.playing ? '正在朗读…' : narration?.playRequested ? '准备好后播放' : narration ? '准备好后朗读' : ({loading:'加载后朗读',unloading:'释放语音中…',stopping:'正在停止…',generating:'合成中…'})[speech.phase] || '朗读此条';
      button.disabled = !ready || !reply.text || !reply.readable || isBusy() || !!narration?.playRequested || recording || starting || recognizing;
      button.title = audio.has(replyKey()) ? '完整语音已就绪 · 再次朗读使用缓存' : narration ? '只需按一次，完整语音准备好后开始播放' : ready ? '完整生成当前回复后再连续播放' : '语音模型尚未就绪';
    }
  }
  function refresh() {
    if (narration && !valid(narration)) stopPlayback(false);
    if (narration?.modelReady && speech.phase === 'ready') { narration.modelReady(); narration.modelReady = null; }
    if (!audio.has(replyKey()) && $('voice-status').textContent === '完整语音已就绪 · 按朗读键播放') label('');
    if (pendingCompletion) {
      const pending = pendingCompletion, reply = currentReply(state()?.messages);
      if (pending.target !== target() || (pending.turnId && reply.turnId && pending.turnId !== reply.turnId) || recording || starting || recognizing) pendingCompletion = null;
      // Codex emits reply-completed just before its final state push. Keep the
      // event until that matching successful turn becomes readable and idle.
      else if (!isBusy() && reply.readable && pending.text === reply.text && speech.phase === 'ready') {
        pendingCompletion = null;
        speak(pending.text,{play:settings.autoSpeak === true}).catch(e => error(e.message));
      }
    }
    updateControls();
  }
  async function check(promise) { const r = await promise; if (!r?.ok) throw new Error(r?.error || '语音操作失败。'); return r.value; }
  function stopPlayback(wait = true) {
    playGeneration++; pendingCompletion = null; narration?.modelReady?.(); narration = null; readRequested = false;
    audioSource?.stop(); audioSource?.disconnect?.(); audioSource = null; finishPlayback?.(); finishPlayback = null;
    const drained = audio.cancel();
    $('stop-speech').hidden = true; if (!recording && !recognizing) label(''); updateControls();
    return wait ? drained : Promise.resolve();
  }
  async function speak(text, {play = true, preview = false} = {}) {
    if (recording || starting || recognizing) return;
    if (!settings.ttsResident || speech.phase === 'error') { api.windowAction('speech-settings'); return; }
    const key = preview ? JSON.stringify(['preview',target(),text,speechProfile(settings)]) : replyKey(text);
    if (narration?.key === key) { if (play) { narration.playRequested = true; showProgress(); } return narration.promise; }
    if (!['ready','loading','generating','stopping'].includes(speech.phase) || !text?.trim() || isBusy()) return;
    // Starting a background preparation must not invalidate a read hotkey
    // that is concurrently fetching its authoritative workspace snapshot.
    const stopped = narration || audioSource ? stopPlayback() : audio.drain, generation = playGeneration;
    const session = narration = {key,target:target(),text,profile:speechProfile(settings),playRequested:play,preview};
    $('stop-speech').hidden = false; showProgress();
    session.promise = (async () => {
      try {
        await stopped; if (generation !== playGeneration || !valid(session)) return;
        if (speech.phase === 'loading') await new Promise(resolve => { session.modelReady = resolve; });
        if (generation !== playGeneration || !valid(session)) return;
        const prepared = await audio.prepare(key,text,session.profile);
        if (generation !== playGeneration || !valid(session) || !session.playRequested) return;
        audioContext ??= new AudioContext(); await audioContext.resume();
        if (generation !== playGeneration || !valid(session)) return;
        const buffer = audioContext.createBuffer(1,prepared.samples.length,prepared.sampleRate); buffer.copyToChannel(prepared.samples,0);
        audioSource = audioContext.createBufferSource(); audioSource.buffer = buffer; audioSource.connect(audioContext.destination);
        session.playing = true; label('正在播报 · 可随时停止'); updateControls();
        await new Promise(resolve => { finishPlayback = resolve; audioSource.onended = resolve; audioSource.start(); });
        if (generation !== playGeneration) return;
        audioSource?.disconnect?.(); audioSource = null; finishPlayback = null;
      } catch(e) { if (generation === playGeneration && e.name !== 'AbortError') error(e.message); }
      finally { if (generation === playGeneration) { narration = null; $('stop-speech').hidden = true; label(!session.playRequested && audio.has(key) ? '完整语音已就绪 · 按朗读键播放' : ''); updateControls(); } }
    })();
    return session.promise;
  }
  function unavailable(message) { api.windowAction('show-chat'); error(message); }
  async function readReply() {
    if (readRequested || narration?.playRequested) return;
    const requestToken = {}; readRequested = requestToken; const generation = playGeneration;
    try {
      // A global hotkey can arrive before the renderer receives the latest
      // model-ready push. Check the authoritative snapshot for this request.
      workspace(await check(api.workspace()));
      if (generation !== playGeneration) return;
      if (recording || starting || recognizing) { unavailable('请先完成或取消听写，再朗读回复。'); return; }
      if (!settings.ttsResident || speech.phase === 'error') { api.windowAction('speech-settings'); return; }
      const reply = currentReply(state()?.messages);
      if (isBusy() || !reply.complete) { unavailable('请等这轮回复完整后再朗读。'); return; }
      if (!reply.text) { unavailable('当前没有可朗读的回复。'); return; }
      if (!reply.readable) { unavailable('本轮没有成功完成的最终回复，暂不能朗读。'); return; }
      if (!['ready','loading'].includes(speech.phase) && !narration) { unavailable('语音模型尚未就绪，请稍候再按朗读键。'); return; }
      await speak(reply.text);
    } finally { if (readRequested === requestToken) readRequested = false; }
  }
  async function releaseCapture() {
    clearTimeout(timer); clearInterval(tick); stream?.getTracks().forEach(t => t.stop()); stream = null; source?.disconnect(); processor?.disconnect(); processor = null; source = null;
    const c = context; context = null; if (c && c.state !== 'closed') await c.close();
    recording = false; starting = false; $('record-button').textContent = '听写'; $('record-button').setAttribute('aria-pressed','false'); $('cancel-recording').hidden = true;
  }
  async function cancel() { operation++; await releaseCapture(); recognizing = false; chunks = []; await api.capture(null); label('听写已取消'); }
  async function toggle() {
    if (starting || recognizing) return;
    if (recording) return finish();
    starting = true; const token = ++operation; const target = {cwd:state().cwd,threadId:state().threadId};
    try {
      // Stop audible playback immediately. Capture cancels backend synthesis
      // without waiting for a CPU model to finish its current native call.
      await stopPlayback(false); await check(api.capture(target)); if (token !== operation) return;
      label('正在打开麦克风…');
      const obtained = await navigator.mediaDevices.getUserMedia({audio:{...(settings.microphone?{deviceId:{exact:settings.microphone}}:{}),channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if (token !== operation) { obtained.getTracks().forEach(t => t.stop()); return; }
      stream = obtained; context = new AudioContext({sampleRate:16000}); await context.audioWorklet.addModule('app://local/renderer/pcm-worklet.js'); await context.resume();
      source = context.createMediaStreamSource(stream); processor = new AudioWorkletNode(context,'pcm-capture'); chunks = []; sampleCount = 0;
      const maxSamples = context.sampleRate * 60;
      processor.port.onmessage = e => { if (token === operation && e.data instanceof Float32Array && sampleCount < maxSamples) { const samples = e.data.slice(0,maxSamples - sampleCount); chunks.push(samples); sampleCount += samples.length; } };
      const silent = context.createGain(); silent.gain.value = 0; source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      recording = true; starting = false; $('record-button').textContent = '完成听写'; $('record-button').setAttribute('aria-pressed','true'); $('cancel-recording').hidden = false;
      const began = Date.now(); const update = () => label(`正在听写 · ${Math.floor((Date.now()-began)/1000)} 秒 / 60 秒`); update(); tick = setInterval(update,1000); timer = setTimeout(() => finish(),60000);
    } catch(e) { if (token === operation) { await releaseCapture(); await api.capture(null); label(''); error(e.name === 'NotAllowedError' ? '无法使用麦克风。请检查 Windows 隐私设置中是否允许桌面应用访问麦克风。' : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? '所选麦克风不可用，请在工作台选择其他设备。' : e.message); } }
    finally { if (token === operation) starting = false; }
  }
  async function finish() {
    if (!recording || recognizing) return; recognizing = true; const token = operation, sampleRate = context.sampleRate, target = {cwd:state().cwd,threadId:state().threadId};
    try {
      await new Promise(resolve => { const port = processor.port, old = port.onmessage; const timeout = setTimeout(resolve,300); port.onmessage = event => { if (event.data === 'flushed') { clearTimeout(timeout); resolve(); } else old(event); }; port.postMessage('flush'); });
      await releaseCapture(); const samples = new Float32Array(sampleCount); let offset = 0; for (const c of chunks) { samples.set(c,offset); offset += c.length; } chunks = [];
      label('正在本地识别…'); const result = await check(api.transcribe({samples,sampleRate}));
      if (token !== operation || target.cwd !== state().cwd || target.threadId !== state().threadId) return;
      if (result.text) { insert(result.text); label('已填入输入框 · 确认后发送'); } else label('没有识别到文字，请重试。');
    } catch(e) { if (token === operation) { error(e.message); label(''); } }
    finally { recognizing = false; await api.capture(null); }
  }
  $('record-button').onclick = () => toggle().catch(e => error(e.message)); $('cancel-recording').onclick = () => cancel();
  $('stop-speech').onclick = () => stopPlayback().catch(e => error(e.message));
  $('replay-reply').onclick = () => readReply().catch(e => error(e.message));
  api.onSpeech('cancel',() => cancel()); api.onSpeech('stop',() => stopPlayback(false));
  api.onSpeech('reply',reply => {
    if (!settings.ttsResident) return;
    if (reply.preview) { speak(reply.text,{preview:true}).catch(e => error(e.message)); return; }
    const current = currentReply(state()?.messages);
    if (!(settings.autoSpeak || settings.prepareSpeech) || reply.threadId !== state()?.threadId || (reply.turnId && current.turnId && reply.turnId !== current.turnId)) return;
    const key = JSON.stringify([target(),reply.turnId,reply.text,speechProfile(settings)]); if (seenCompletions.has(key)) return;
    seenCompletions.add(key); if (seenCompletions.size > 32) seenCompletions.delete(seenCompletions.values().next().value);
    pendingCompletion = {target:target(),text:reply.text,turnId:reply.turnId}; refresh();
  });
  function workspace(value) {
    if ((value.version ?? 0) < workspaceVersion) return;
    workspaceVersion = value.version ?? 0;
    const hadVoice = settings.ttsResident, oldProfile = speechProfile(settings), oldAuto = settings.autoSpeak, oldPrepare = settings.prepareSpeech;
    settings = value.settings; speech = value.speech ?? {};
    if (hadVoice && (!settings.ttsResident || oldProfile !== speechProfile(settings) || speech.phase === 'error')) { stopPlayback(false); audio.clear(); }
    else if ((oldAuto && !settings.autoSpeak) || (oldPrepare && !settings.prepareSpeech && !settings.autoSpeak && !narration?.playRequested)) stopPlayback(false);
    refresh();
  }
  api.onWorkspace(workspace); api.workspace().then(r => { if (r.ok) workspace(r.value); });
  window.addEventListener('beforeunload',() => { stream?.getTracks().forEach(t => t.stop()); api.capture(null); api.stopSpeech(); });
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && (recording || starting)) { event.stopImmediatePropagation(); event.preventDefault(); cancel(); } },true);
  return { isCapturing: () => recording || starting || recognizing, refresh,
    readReply: () => readReply().catch(e => error(e.message)), toggleCapture: () => toggle().catch(e => error(e.message)) };
}
