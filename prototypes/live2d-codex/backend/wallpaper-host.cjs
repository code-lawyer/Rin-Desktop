const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value < 1);
const ATTACH_TIMEOUT = 15000;
const POLL_INTERVAL = 2000;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;
const EXIT_GRACE = 2500;

// The helper only reparents our own HWND. It never changes the saved wallpaper.
class WallpaperHost extends EventEmitter {
  constructor(window, { launch = spawn, canStart = () => true } = {}) {
    super();
    this.window = window;
    this.launch = launch;
    this.canStart = canStart;
    this.status = { phase: 'loading', ok: false, attached: false };
    this.retries = 0;
    this.poseInputEnabled = false; this.poseInputRevision = 0;
  }
  publish(value) { this.status = value; this.emit('status', value); }
  start() {
    clearTimeout(this.retryTimer);
    if (this.attempt || this.closing || !this.canStart()) return;
    this.publish({ phase: 'loading', ok: false, attached: false });
    let child;
    try {
      const handle = this.window.getNativeWindowHandle();
      const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      child = this.launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../scripts/wallpaper-host.ps1'), '-WindowHandle', hwnd, '-OwnerProcess', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      this.failed(error.message);
      this.scheduleRestart();
      return;
    }
    const attempt = this.attempt = { child };
    child.stderr.on('data', data => { attempt.lastError = String(data).slice(0, 2000).trim(); });
    child.stdin.on('error', error => this.failAttempt(attempt, error.message));
    child.on('error', error => this.failAttempt(attempt, error.message));
    child.once('close', () => {
      clearTimeout(attempt.stopTimer);
      this.stopPolling(attempt);
      this.attempt = null;
      if (this.closing) return;
      if (!attempt.stopping) this.failed(attempt.lastError || '壁纸连接已关闭。');
      this.scheduleRestart();
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      buffer += data;
      for (let index; !attempt.stopping && this.attempt === attempt && (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value?.type === 'pose-click') {
          if (this.poseInputEnabled && value.revision === this.poseInputRevision && isPoint(value.down) && isPoint(value.up)) {
            this.emit('pose-click', [value.down, value.up]);
          }
        } else if (value?.type === 'pose-input-error') {
          console.warn('[wallpaper:pose-input]', value.error);
        } else if (typeof value?.ok === 'boolean') {
          if (!value.ok || value.attached !== true) {
            this.failAttempt(attempt, value.error || 'Windows 桌面层连接失败。');
            break;
          }
          clearTimeout(attempt.response);
          // An initial report can be followed by another immediate helper exit.
          // Restore the retry budget only after the attachment answers a poll.
          if (attempt.poll && attempt.response) this.retries = 0;
          attempt.response = null;
          attempt.poll ??= setInterval(() => this.ensure(), POLL_INTERVAL);
          this.publish({ ...value, phase: 'ready' });
        }
      }
    });
    this.awaitStatus(attempt);
  }
  failed(error) {
    this.publish({ phase: 'error', ok: false, attached: false, error: String(error).slice(0, 300) });
  }
  scheduleRestart() {
    if (this.closing || !this.canStart()) return;
    if (this.retryNow) { this.retryNow = false; this.start(); return; }
    if (this.retries >= MAX_RETRIES) return;
    this.retries++;
    this.retryTimer = setTimeout(() => this.start(), RETRY_DELAY);
  }
  retry() {
    if (this.closing || !this.canStart() || this.status.phase === 'ready' || (this.attempt && !this.attempt.stopping)) return;
    this.retries = 0;
    if (this.attempt) this.retryNow = true;
    else this.start();
  }
  awaitStatus(attempt) {
    attempt.response = setTimeout(() => this.failAttempt(attempt, 'Windows 桌面层连接超时。'), ATTACH_TIMEOUT);
  }
  ensure() {
    const attempt = this.attempt;
    if (!attempt || attempt.stopping || attempt.response || !this.canStart()) return;
    this.awaitStatus(attempt);
    this.command('ensure');
  }
  command(value) {
    const attempt = this.attempt;
    if (attempt && !attempt.stopping && attempt.child.stdin.writable) attempt.child.stdin.write(value + '\n');
  }
  failAttempt(attempt, error) {
    if (attempt !== this.attempt || attempt.stopping) return;
    this.stop(attempt);
    if (!this.closing) this.failed(error);
  }
  stopPolling(attempt) {
    clearInterval(attempt.poll);
    clearTimeout(attempt.response);
  }
  stop(attempt) {
    if (attempt.stopping) return;
    attempt.stopping = true;
    this.stopPolling(attempt);
    attempt.stopTimer = setTimeout(() => attempt.child.kill(), EXIT_GRACE);
    if (attempt.child.stdin.writable) attempt.child.stdin.end('quit\n');
  }
  setPoseInputEnabled(enabled) {
    if (this.poseInputEnabled === enabled) return;
    this.poseInputEnabled = enabled;
    this.command(`pose-input ${enabled ? 'on' : 'off'} ${++this.poseInputRevision}`);
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    clearTimeout(this.retryTimer);
    const attempt = this.attempt;
    if (!attempt) return Promise.resolve();
    this.closePromise = new Promise(resolve => {
      const timer = setTimeout(resolve, EXIT_GRACE + 1000);
      attempt.child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    this.stop(attempt);
    return this.closePromise;
  }
}
module.exports = { WallpaperHost };
