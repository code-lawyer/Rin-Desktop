import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RemoteKeys, remoteSettings } from './remote-config.mjs';
import { RemoteAudio, capabilities, GET_CAPS } from './remote-audio.mjs';

export class RemoteController extends EventEmitter {
  constructor({ createTransport, settings, save, begin, transcribe, deliver, end, action, prepareKeys=()=>{}, reconnectDelay=5000 }) {
    super(); Object.assign(this,{createTransport,save,begin,transcribe,deliver,end,action,prepareKeys,reconnectDelay});
    this.config=remoteSettings(settings); this.keys=new RemoteKeys(); this.generation=0;
    this.state={phase:'disconnected',audio:'idle',notice:'',devices:[],keysAvailable:false,lastButton:null,capture:null};
  }
  snapshot() { return structuredClone({...this.state,config:this.config}); }
  update(patch) { Object.assign(this.state,patch); this.emit('state',this.snapshot()); }
  async transport() {
    if(this.native) return this.native;
    const native=this.createTransport(); this.native=native;
    native.on('event',message=>{if(this.native===native)this.receive(message);});
    native.on('lost',error=>{if(this.native===native)this.lost(error.message);});
    try { await native.start(); } catch(error) {if(this.native===native)this.native=null;throw error;}
    return native;
  }
  async scan() {
    if(this.closed || this.suspended || this.disconnecting || this.busy || this.session) throw new Error('请先完成当前遥控器操作。');
    if(this.state.phase==='connected')throw new Error('如需更换遥控器，请先断开当前连接再搜索。');
    this.busy=true; this.update({scanning:true,notice:''});
    try { const native=await this.transport(); const devices=await native.request('scan'); this.update({devices}); return this.snapshot(); }
    catch(error) {this.update({notice:error.message});throw error;}
    finally {this.busy=false;this.update({scanning:false});}
  }
  async configure(patch) {
    if(this.session || this.busy) throw new Error('请先完成当前遥控器操作，再修改按钮。');
    const next=remoteSettings({...this.config,...patch,device:this.config.device,buttons:{...this.config.buttons,...patch.buttons}});
    await this.save(next); this.config=next; this.update({}); return this.snapshot();
  }
  async connect(id,{automatic=false}={}) {
    if(this.busy || this.disconnecting) throw new Error('正在处理遥控器连接，请稍候。');
    if(this.closed || this.suspended)throw new Error('遥控器连接已取消。');
    const selected=this.state.devices.find(d=>d.id===id) ?? (this.config.device?.id===id ? this.config.device : null);
    if(!selected) throw new Error('请先搜索并选择遥控器。');
    clearTimeout(this.retry); this.desired=true; this.busy=true;const generation=++this.generation;
    try {
      await this.cancel();if(generation!==this.generation || !this.desired || this.closed || this.suspended)return;
      this.keys.clear(); this.caps=null;this.blockedUntilRelease=false;
      this.update({phase:'connecting',notice:'',keysAvailable:false,lastButton:null,capture:null});
      const native=await this.transport(); if(generation!==this.generation)return;
      await native.request('connect',{deviceId:id,generation}); if(generation!==this.generation)return;
      // Capabilities arrive on the notification channel, often before write's reply.
      const ready=new Promise((resolve,reject)=>{this.ready={resolve,reject};this.readyTimer=setTimeout(()=>reject(new Error('遥控器语音没有响应，请重新连接。')),8000);});
      ready.catch(()=>{});
      await this.write(GET_CAPS); await ready; if(generation!==this.generation)return;
      const next=remoteSettings({...this.config,device:selected,autoConnect:automatic?this.config.autoConnect:true});
      await this.save(next); if(generation!==this.generation)return;
      this.prepareKeys();
      this.config=next; this.update({phase:'connected',notice:this.state.keysAvailable?'':'声音已连接，等待按钮就绪；请按一下遥控器方向键。'});
    } catch(error) {
      if(generation===this.generation){this.update({phase:'error',notice:error.message});this.scheduleReconnect();}
      if(!automatic)throw error;
    } finally {
      clearTimeout(this.readyTimer);this.ready=null;this.busy=false;
    }
    return this.snapshot();
  }
  write(data,generation=this.generation) { return this.native?.request('write',{generation,data:Buffer.from(data).toString('base64')}) ?? Promise.reject(new Error('遥控器已断开。')); }
  receive(message) {
    if(message.generation!==this.generation)return;
    try {
      if(message.type==='pairing')this.update({phase:'pairing'});
      else if(message.type==='keys'){this.emit('devices',message.devices??[]);this.update({keysAvailable:message.available===true});}
      else if(message.type==='key-reset'){this.keys.clear();if(this.session)this.cancel('遥控器按键连接已变化，本次听写已取消。');}
      else if(message.type==='disconnected')this.lost('遥控器已断开，正在等待重新连接。');
      else if(message.type==='key' && this.state.phase==='connected') {
        const button=this.keys.accept(message.key,message.edge);
        if(message.key==='F5' && message.edge==='up')this.release();
        if(button){
          this.emit('diagnostic',{event:'button',button,action:this.config.buttons[button]});
          this.update({lastButton:button,keysAvailable:true});
          if(button==='voice')this.startCapture('key');
          else {const action=this.config.buttons[button];if(action!=='none')Promise.resolve(this.action(action)).catch(error=>this.update({notice:error.message}));}
        }
      } else if(message.type==='control')this.control(Buffer.from(message.data,'base64'));
      else if(message.type==='audio' && this.session?.audio && !this.session.recognizing) {
        this.session.audio.feed(Buffer.from(message.data,'base64'));this.armSilence();
        if(this.state.audio!=='listening' || Date.now()-this.session.lastProgress>=250)this.captureUpdate(this.session,'receiving',{audio:'listening'});
      }
    } catch(error) {this.cancel(error.message,'failed');}
  }
  control(data) {
    if(!data.length) return;
    if(data[0]===0x0b){this.caps=capabilities(data);this.ready?.resolve();return;}
    if(this.state.phase!=='connected')return;
    if([0x08,0x10].includes(data[0])) this.startCapture('bluetooth');
    else if([0x04,0x11].includes(data[0])) {
      if(!this.session || this.session.recognizing)return;
      if(data.length<4 || data[2]!==this.caps?.codec || this.session.audio)throw new Error('遥控器音频开始信号异常，请松开重试。');
      this.session.streamId=data[3];this.session.audio=new RemoteAudio(this.caps.frameSize);
      this.captureUpdate(this.session,'waiting-audio',{audio:'starting'});this.armSilence();
    } else if(data[0]===0x0a && this.session?.audio) {
      if(data.length<7)throw new Error('遥控器音频同步异常。');this.session.audio.sync(data.readInt16BE(4),data[6]);
    } else if([0x00,0x13].includes(data[0]))this.release();
  }
  captureUpdate(session,stage,patch={}) {
    const capture={trigger:session.trigger,frames:0,durationMs:0,peak:0,...session.metrics,...session.audio?.snapshot(),stage};
    session.metrics=capture;session.lastProgress=Date.now();
    this.update({...patch,capture});
    if(session.loggedStage!==stage){
      session.loggedStage=stage;
      // Local diagnostics contain stages and signal statistics, never audio,
      // transcript text, device identifiers or ordinary keyboard input.
      this.emit('diagnostic',{event:'voice',...capture,...(patch.notice?{notice:patch.notice}:{})});
    }
  }
  async startCapture(trigger='bluetooth') {
    if(this.session || this.blockedUntilRelease || this.config.buttons.voice!=='dictate' || !this.caps || this.busy || this.closed || this.suspended || this.state.phase!=='connected')return;
    const session={generation:this.generation,id:randomUUID(),streamId:0,trigger};this.session=session;
    this.captureUpdate(session,'opening',{audio:'starting',notice:''});
    try {
      session.target=await this.begin(session.id);
      if(this.session!==session){this.end(session.id);return;}
      this.limit=setTimeout(()=>this.cancel('已达到 60 秒上限，本次听写已取消，请分段说话。','failed'),60000);
      this.armSilence();await this.write([0x0c,0]);
    } catch(error) {if(this.session===session)await this.cancel(error.message,'failed');}
  }
  armSilence() {
    clearTimeout(this.silence);this.silence=setTimeout(()=>{
      const received=this.session?.audio?.length>0;
      this.cancel(received?'遥控器声音传输中断，请松开语音键后重试。':'已请求遥控器麦克风，但没有收到声音。请松开语音键、重新连接后再试。','failed');
    },5000);
  }
  release() {
    this.blockedUntilRelease=false;
    if(!this.session || this.session.recognizing || this.releaseTimer)return;
    // Preserve the final notification packets, but release raw-key ownership now.
    this.keys.held.delete('voice');this.releaseTimer=setTimeout(()=>{this.releaseTimer=null;this.finish();},100);
  }
  clearCaptureTimers() {for(const name of ['limit','silence','releaseTimer']){clearTimeout(this[name]);this[name]=null;}}
  async finish() {
    const session=this.session;if(!session || session.recognizing)return;
    session.recognizing=true;this.clearCaptureTimers();this.captureUpdate(session,'closing');
    try {
      await this.write([0x0d,session.streamId]);
      if(this.session!==session)return;
      if(!session.audio)throw new Error('没有收到遥控器声音，请按住语音键说话后再松开。');
      const data=session.audio.finish();session.audio=null;
      this.captureUpdate(session,'recognizing',{audio:'transcribing'});
      const result=await this.transcribe(data);
      if(this.session!==session || session.generation!==this.generation)return;
      const text=typeof result==='string'?result:result?.text;
      if(!text?.trim())throw new Error('未识别到清晰的语音，请再试一次。');
      await this.deliver(session.target,text,session.id);
      if(this.session===session)this.captureUpdate(session,'complete',{notice:'已写入对话草稿，请确认后发送。'});
    } catch(error) {if(this.session===session)this.captureUpdate(session,'failed',{notice:error.message});}
    finally {if(this.session===session){this.session=null;this.end(session.id);this.update({audio:'idle'});}}
  }
  async cancel(notice='',stage='cancelled') {
    const session=this.session;this.session=null;this.clearCaptureTimers();
    const patch={audio:'idle',...(notice?{notice}:{})};
    if(session){this.blockedUntilRelease=!session.recognizing;this.captureUpdate(session,stage,patch);session.audio=null;this.end(session.id);}
    else this.update(patch);
    if(session){try{await this.write([0x0d,session.streamId],session.generation);}catch{}}
  }
  lost(notice) {
    const native=this.native;this.native=null;++this.generation;this.keys.clear();this.ready?.reject(new Error(notice));
    this.cancel(notice);native?.close().catch(()=>{});
    this.update({phase:'disconnected',keysAvailable:false,notice});this.scheduleReconnect();
  }
  scheduleReconnect() {
    clearTimeout(this.retry);
    if(this.desired && this.config.device && !this.closed && !this.suspended)this.retry=setTimeout(()=>{
      if(this.busy)return this.scheduleReconnect();
      this.connect(this.config.device.id,{automatic:true}).catch(()=>this.scheduleReconnect());
    },this.reconnectDelay);
  }
  async disconnect({forget=false}={}) {
    this.desired=false;clearTimeout(this.retry);++this.generation;
    if(this.disconnecting)await this.disconnecting;
    else {
      this.update({phase:'disconnecting'});this.keys.clear();this.ready?.reject(new Error('连接已取消。'));
      const cancelled=this.cancel(),native=this.native;this.native=null;
      this.disconnecting=(async()=>{await cancelled;await native?.close();})();
      try{await this.disconnecting;}finally{this.disconnecting=null;}
    }
    if(forget){const next=remoteSettings({...this.config,device:null,autoConnect:false});await this.save(next);this.config=next;}
    this.update({phase:'disconnected',keysAvailable:false,notice:''});return this.snapshot();
  }
  start() {if(this.config.autoConnect && this.config.device)this.connect(this.config.device.id,{automatic:true}).catch(()=>{});}
  suspend() {this.suspended=true;this.lost('电脑已休眠，唤醒后将重新连接遥控器。');}
  resume() {this.suspended=false;this.scheduleReconnect();}
  async close() {this.closed=true;await this.disconnect();}
}
