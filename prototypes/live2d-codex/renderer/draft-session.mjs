// Own the draft target separately from the backend's in-flight thread creation.
export function createDraftSession({ request, getText, setText, error }) {
  let target, version = 0, loaded = false, dirty = false, baseline = '';
  const key = value => JSON.stringify([value?.provider ?? 'codex', value?.cwd, value?.threadId ?? null]);
  async function write(destination, text) {
    try { const result = await request(destination, text); if (result?.ok) return true; error(result?.error || '草稿未能保存。'); }
    catch { error('草稿未能保存，请保持窗口打开后重试。'); }
    return false;
  }
  function edited() { version++; dirty = true; }
  function save() {
    const text = getText();
    // An empty input while a read is pending is a placeholder, not a deletion.
    if (!target || (!loaded && !dirty && !text) || (loaded && !dirty && text === baseline)) return;
    const destination = { ...target }, expected = ++version;
    loaded = true; dirty = false; baseline = text;
    return write(destination, text).then(ok => { if (!ok && expected === version) dirty = true; });
  }
  function restore(next, { creatingThread = false } = {}) {
    if (key(next) === key(target)) return;
    const promoted = creatingThread && (target?.provider ?? 'codex') === (next.provider ?? 'codex') && target?.cwd === next.cwd && !target.threadId && !!next.threadId && (loaded || dirty || getText());
    if (promoted) {
      // Text typed while thread/start was pending belongs to this new thread,
      // never to the next unrelated "new conversation" slot.
      write({ ...target }, ''); target = { ...next }; dirty = true; save(); return;
    }
    save(); target = { ...next }; loaded = false; dirty = false; baseline = '';
    const expected = ++version; setText('');
    request(next).then(result => {
      if (result?.ok && expected === version && !getText()) { loaded = true; baseline = result.value; setText(result.value); }
      else if (!result?.ok && expected === version) error(result?.error || '草稿未能读取。');
    }).catch(() => { if (expected === version) error('草稿未能读取，请稍后重试。'); });
  }
  return { save, restore, edited };
}
