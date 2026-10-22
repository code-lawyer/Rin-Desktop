import { EventEmitter } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
export async function buildRemoteHelper(source, directory) {
  source=resolve(source); directory=resolve(directory);
  if (process.platform !== 'win32') throw new Error('遥控器目前支持 Windows。');
  const hash=createHash('sha256').update(await readFile(source)).digest('hex').slice(0,16);
  const output=join(directory,`rc003-${hash}.exe`);
  try { await access(output); return output; } catch {}
  await mkdir(directory,{recursive:true});
  const windows=process.env.WINDIR || 'C:\\Windows', framework=join(windows,'Microsoft.NET','Framework64','v4.0.30319');
  const refs=['System.Runtime','System.ObjectModel','System.Runtime.InteropServices.WindowsRuntime'].map(x=>join(framework,x+'.dll'));
  refs.push(...['Windows.Foundation','Windows.Devices','Windows.Storage'].map(x=>join(windows,'System32','WinMetadata',x+'.winmd')));
  try { await exec(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+output,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...refs.map(x=>'/r:'+x),source],{windowsHide:true,timeout:30000,maxBuffer:65536}); }
  catch { throw new Error('遥控器组件未能准备，请确认 Windows 的 .NET Framework 4.8 可用，或重新安装应用。'); }
  return output;
}
const ERRORS={ NO_DEVICE:'没有找到这只遥控器，请重新搜索。', PAIR_FAILED:'配对未完成。请让遥控器进入配对状态，并确认 Windows 的配对提示。', CONNECT_FAILED:'遥控器未能连接。请唤醒遥控器，并关闭占用它的其他遥控工具后重试。', NO_SERVICE:'这只设备没有提供 RC003 语音服务。', SUBSCRIBE_FAILED:'无法接收遥控器的声音，请重新连接。', WRITE_FAILED:'遥控器没有响应，请重新连接。', TIMEOUT:'遥控器响应超时，请靠近电脑后重试。', RAW_FAILED:'无法读取遥控器按钮，请重启应用。' };
export class NativeRemote extends EventEmitter {
  constructor({root,storageDir,packaged=false}) { super(); Object.assign(this,{root,storageDir,packaged}); this.pending=new Map(); this.sequence=0; }
  async start() {
    if (this.child) return;
    if(this.closed)throw new Error('遥控器连接已取消。');
    const file=this.packaged ? join(this.root,'runtime','rc003-helper.exe') : await buildRemoteHelper(join(this.root,'native','rc003-helper.cs'),join(this.storageDir,'components'));
    if(this.closed)throw new Error('遥控器连接已取消。');
    const child=spawn(file,[],{windowsHide:true,stdio:['pipe','pipe','pipe']}); this.child=child;
    let buffer=''; child.stdout.setEncoding('utf8'); child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{
      buffer+=chunk; if(buffer.length>131072) return this.fail(new Error('遥控器组件数据异常。'));
      let index; while((index=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,index); buffer=buffer.slice(index+1);
        try { const message=JSON.parse(line);
          if(message.reply) { const item=this.pending.get(message.reply); if(item) { clearTimeout(item.timer); this.pending.delete(message.reply); message.ok ? item.resolve(message.value) : item.reject(new Error(ERRORS[message.code] || '遥控器操作未完成，请重试。')); } }
          else this.emit('event',message);
        } catch { this.fail(new Error('遥控器组件数据异常。')); return; }
      }
    });
    child.once('error',()=>this.fail(new Error('遥控器组件无法启动，请重新安装应用。')));
    child.once('exit',()=>{ if(this.child===child) { this.child=null; this.fail(new Error('遥控器连接已关闭。')); } });
    await this.request('hello');
  }
  request(command, data={}) {
    if (!this.child) return Promise.reject(new Error('遥控器尚未连接。'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>this.fail(new Error(ERRORS.TIMEOUT)),command==='connect'?35000:command==='scan'?20000:7000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,command,...data})+'\n');
    });
  }
  fail(error) {
    for(const item of this.pending.values()) {clearTimeout(item.timer);item.reject(error);} this.pending.clear();
    const child=this.child; this.child=null; child?.kill(); this.emit('lost',error);
  }
  async close() {
    this.closed=true;
    const child=this.child; if(!child) return;
    try { await this.request('disconnect'); } catch {}
    this.child=null; child.stdin.end();
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},1500); child.once('exit',()=>{clearTimeout(timer);resolve();});});
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('遥控器连接已关闭。'));} this.pending.clear();
  }
}
