const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');

// The helper only reparents our own HWND. It never changes the saved wallpaper.
class WallpaperHost extends EventEmitter {
  constructor(window) {
    super(); this.window = window; this.status = { ok: false, attached: false };
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
        try { this.status = JSON.parse(line); this.emit('status', this.status); } catch { /* Ignore PowerShell startup noise. */ }
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
  async close() {
    this.closing = true; clearInterval(this.timer);
    if (!this.child || this.child.exitCode !== null) return;
    this.command('quit'); this.child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { this.child.kill(); resolve(); }, 2500); this.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}
module.exports = { WallpaperHost };
