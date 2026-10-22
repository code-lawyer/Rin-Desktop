// Both windows describe the same physical microphone state. A BLE connection
// or stream acknowledgement is not evidence that audio packets have arrived.
export function remoteVoiceStatus(state = {}) {
  const active = ['starting','listening','transcribing'].includes(state.audio);
  const capture = state.capture;
  const duration = capture?.durationMs ? ` · 已收到 ${(capture.durationMs / 1000).toFixed(1)} 秒声音` : '';
  let text;
  if (active && capture?.stage === 'closing') text = `遥控器听写 · 正在结束收音…${duration}`;
  else if (state.audio === 'starting') text = capture?.stage === 'waiting-audio'
    ? '遥控器麦克风已打开，等待声音…' : '正在打开遥控器麦克风…';
  else if (state.audio === 'listening') text = `遥控器正在听写${duration} · 松开语音键完成`;
  else if (state.audio === 'transcribing') text = `遥控器听写 · 正在本地识别…${duration}`;
  else if (state.phase === 'connected') text = state.config?.buttons?.voice === 'none'
    ? '遥控器麦克风已停用，请在按钮功能中启用语音键。'
    : '遥控器麦克风已连接 · 按住语音键说话';
  else text = ['connecting','pairing'].includes(state.phase) ? '正在连接遥控器麦克风…' : '遥控器麦克风未连接';
  const result = !active && ['complete','failed','cancelled'].includes(capture?.stage) ? state.notice : '';
  const compact = capture?.stage === 'closing' ? '正在结束收音…' : state.audio === 'starting' ? capture?.stage === 'waiting-audio' ? '等待遥控器声音…' : '正在打开遥控器麦克风…' : state.audio === 'listening' ? `遥控器听写 ${((capture?.durationMs ?? 0) / 1000).toFixed(1)} 秒 · 松开完成` : state.audio === 'transcribing' ? '正在识别遥控器语音…' : text;
  return { active, text, compact, result: result || '' };
}
