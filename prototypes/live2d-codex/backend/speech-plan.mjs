// Shared by the renderer and IPC boundary. Bump the version when voice/style
// generation changes so cached audio can never cross synthesis profiles.
export function speechProfile(settings = {}) {
  const engine = settings.ttsEngine ?? 'qwen';
  return JSON.stringify([2, engine, engine === 'qwen'
    ? [settings.qwenRoot ?? '', settings.qwenVoice ?? 'Serena']
    : [settings.voice ?? 3, settings.speed ?? 1]]);
}

export function speechText(markdown) {
  return String(markdown ?? '').replace(/```[\s\S]*?```/g, '，代码见屏幕。')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '链接见屏幕').replace(/[#*`_>|]/g, '').replace(/\r\n?/g, '\n').trim();
}

export function speechChunks(markdown, limit = 180) {
  const chars = Array.from(speechText(markdown)), parts = [];
  // Keep ordinary replies (including several sentences) in one context.
  // Long replies prefer paragraph, then sentence, clause and word boundaries.
  for (let start = 0; start < chars.length;) {
    let end = Math.min(start + limit, chars.length);
    if (end < chars.length) {
      for (const boundary of [/\n/u, /[。！？!?]/u, /[，,；;：:\s]/u]) {
        let found = false;
        for (let i = end - 1; i >= start + Math.floor(limit / 3); i--) {
          if (!boundary.test(chars[i])) continue;
          end = i + 1;
          while (end < start + limit && /[”’」』"]/.test(chars[end])) end++;
          found = true; break;
        }
        if (found) break;
      }
    }
    const part = chars.slice(start, end).join('');
    if (part.trim()) parts.push(part);
    start = end;
  }
  return parts;
}
