// Own the draft target separately from the backend's in-flight thread creation.
export function createDraftSession({ request, getText, setText, error }) {
  let target, version = 0, loaded = false, dirty = false, baseline = '', reading;
  let applied = new Set(), cleared;
  // Keep the latest unsaved copy for each destination, even after navigating
  // away. A late acknowledgement can only discard the copy that it saved.
  const unsaved = new Map(), writes = new Map(), pending = new Set();
  const key = value => JSON.stringify([value?.provider ?? 'codex', value?.cwd, value?.threadId ?? null]);
  function write(destination, text, dictationIds = [...applied]) {
    const id = key(destination), copy = { target: { ...destination }, text, dictationIds };
    unsaved.set(id, copy); writes.set(id, (writes.get(id) ?? 0) + 1);
    const saving = (async () => {
      try { const result = await request(destination, text); if (result?.ok) { if (unsaved.get(id) === copy) unsaved.delete(id); return true; } error(result?.error || '草稿未能保存。'); }
      catch { error('草稿未能保存，请保持窗口打开后重试。'); }
      return false;
    })();
    pending.add(saving); saving.finally(() => pending.delete(saving));
    return saving;
  }
  function edited() { version++; dirty = true; cleared = null; }
  function canUndoClear() { return !!cleared && cleared.key === key(target) && !getText(); }
  async function clear() {
    const destination = key(target);
    await reading;
    if (destination !== key(target) || !getText()) return false;
    cleared = { key: destination, text: getText() };
    version++; dirty = true; setText('');
    await save(); return true;
  }
  async function undoClear() {
    if (!canUndoClear()) return false;
    const text = cleared.text;
    edited(); setText(text); await save(); return true;
  }
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
    cleared = null;
    const promoted = creatingThread && (target?.provider ?? 'codex') === (next.provider ?? 'codex') && target?.cwd === next.cwd && !target.threadId && !!next.threadId && (loaded || dirty || getText());
    if (promoted) {
      // Text typed while thread/start was pending belongs to this new thread,
      // never to the next unrelated "new conversation" slot.
      const previous = { ...target }, text = getText();
      const previousWrites = writes.get(key(previous)) ?? 0;
      target = { ...next }; loaded = true; dirty = true; baseline = text;
      // A failed destination write must leave the original draft recoverable.
      reading = write(next, text).then(async ok => {
        // A new draft may already occupy the original new-conversation slot.
        if (ok && key(target) !== key(previous) && (writes.get(key(previous)) ?? 0) === previousWrites) await write(previous, '');
      });
      return reading;
    }
    save(); target = { ...next }; loaded = false; dirty = false; baseline = ''; applied = new Set();
    const expected = ++version; setText('');
    const retained = unsaved.get(key(next));
    if (retained) {
      loaded = true; dirty = true; baseline = retained.text;
      applied = new Set(retained.dictationIds); setText(retained.text);
      reading = Promise.resolve();
      return reading;
    }
    reading = request(next).then(result => {
      if (result?.ok && expected === version && !getText()) {
        const snapshot=typeof result.value==='string'?{text:result.value}:result.value;
        loaded = true; baseline = snapshot.text; applied = new Set(snapshot.dictationIds ?? []); setText(snapshot.text);
      }
      else if (!result?.ok && expected === version) error(result?.error || '草稿未能读取。');
    }).catch(() => { if (expected === version) error('草稿未能读取，请稍后重试。'); });
  }
  async function appendExternal({ target: destination, text, id }) {
    if (key(destination) !== key(target)) return;
    await reading;
    if (key(destination) !== key(target) || applied.has(id)) return;
    // Main already saved the recognition. Preserve typing that has not reached
    // disk yet; never replace the user's current input with an older snapshot.
    applied.add(id);
    const current = getText(); setText(current + (current && !/\s$/.test(current) ? ' ' : '') + text);
    edited(); return save();
  }
  async function consume(submission) {
    await reading;
    if (![submission.target, submission.originalTarget].some(value => key(value) === key(target))) return;
    if (getText().trim() !== submission.text.trim()) return;
    setText(''); edited(); await save();
  }
  async function recover(submission) {
    await reading;
    if (key(submission.target) !== key(target)) return;
    const current = getText();
    if (current.trim() === submission.text.trim()) return;
    setText(submission.text + (current ? '\n\n' + current : '')); edited(); await save();
  }
  async function flush() {
    await reading;
    if (!target && getText()) throw new Error('草稿尚未绑定到对话，请先恢复连接并保存草稿后再退出。');
    await save();
    while (pending.size) await Promise.all([...pending]);
    // Failed saves can belong to a conversation the user has already left.
    // Retry each retained copy without replacing a newer edit or its target.
    for (const copy of [...unsaved.values()]) if (unsaved.get(key(copy.target)) === copy) await write(copy.target, copy.text, copy.dictationIds);
    while (pending.size) await Promise.all([...pending]);
    if (unsaved.size) throw new Error('仍有草稿未能保存，退出已取消。请保持窗口打开，检查磁盘空间或复制草稿后重试。');
  }
  return { save, restore, edited, appendExternal, consume, recover, clear, undoClear, canUndoClear, flush };
}
