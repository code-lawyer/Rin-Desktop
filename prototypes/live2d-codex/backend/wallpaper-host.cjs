const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value < 1);

// The helper only reparents our own HWND. It never changes the saved wallpaper.
class WallpaperHost extends EventEmitter {
  constructor(window) {
    super(); this.window = window; this.status = { ok: false, attached: false };
    this.poseInputEnabled = false; this.poseInputRevision = 0;
  }
  start() {
    const handle = this.window.getNativeWindowHandle();
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../scripts/wallpaper-host.ps1'), '-WindowHandle', hwnd, '-OwnerProcess', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', data => { this.lastError = String(data).slice(0, 2000); });
    this.child.stdin.on('error', () => {});
    let buffer = '';
    this.child.stdout.on('data', data => {
      buffer += data;
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
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
          this.status = value; this.emit('status', value);
        }
      }
    });
    this.child.on('error', error => this.emit('status', this.status = { ok: false, error: error.message }));
    this.child.on('exit', () => { clearInterval(this.timer); if (!this.closing) this.emit('status', this.status = { ok: false, error: this.lastError || '壁纸连接已关闭，可从托盘重新启动。' }); });
    this.timer = setInterval(() => this.command('ensure'), 2000); this.timer.unref();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('status', ready); reject(new Error('Windows 桌面层连接超时。')); }, 15000);
      const ready = value => { clearTimeout(timer); this.off('status', ready); value.ok ? resolve(value) : reject(new Error(value.error || 'Windows 桌面层连接失败。')); };
      this.on('status', ready);
    });
  }
  command(value) { if (!this.child?.killed && this.child?.stdin.writable) this.child.stdin.write(value + '\n'); }
  setPoseInputEnabled(enabled) {
    if (this.poseInputEnabled === enabled) return;
    this.poseInputEnabled = enabled;
    this.command(`pose-input ${enabled ? 'on' : 'off'} ${++this.poseInputRevision}`);
  }
  async close() {
    this.closing = true; clearInterval(this.timer);
    if (!this.child || this.child.exitCode !== null) return;
    this.command('quit'); this.child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill(); resolve(); }, 2500); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}
module.exports = { WallpaperHost };
