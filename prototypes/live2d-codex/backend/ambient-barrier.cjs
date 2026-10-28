// Capture cannot open a microphone until the single wallpaper audio owner
// acknowledges that it has applied the new capture/duck state.
class AmbientBarrier {
  constructor({ publish, timeout = 2000 }) { this.publish = publish; this.timeout = timeout; this.revision = 0; this.pending = new Map(); this.stopped = false; }
  wait(required = true) {
    const revision = ++this.revision;
    if (!required || this.stopped) { this.publish(revision); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(revision); reject(new Error('壁纸环境音未能及时静音，已阻止本次语音操作。请重试；若仍失败，请重新启动应用。')); }, this.timeout);
      this.pending.set(revision, { resolve, reject, timer }); this.publish(revision);
    });
  }
  acknowledge(revision) {
    if (!Number.isSafeInteger(revision) || revision > this.revision) return;
    for (const [key, pending] of this.pending) if (key <= revision) { clearTimeout(pending.timer); pending.resolve(); this.pending.delete(key); }
  }
  // Only a confirmed renderer exit proves its audio sources have stopped.
  // A disabled preference or an unresponsive window is not such proof.
  stopOwner() { this.stopped = true; this.acknowledge(this.revision); }
  startOwner() { this.stopped = false; }
  close() { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('环境音窗口已关闭。')); } this.pending.clear(); }
}
module.exports = { AmbientBarrier };
