// Source arbitration runs inside the application's UI thread, before Windows
// TranslateMessage/IME. No global hook, synthetic keyboard input or IPC timer.
// Ordinary keyboard MSGs pass unchanged. An unresolved source fails closed and
// disconnects the adapter; it must never turn a disabled remote key into Send.
const VIRTUAL_KEYS=new Set([8,13,27,36,37,38,39,40,93,116,166]);
const RESERVED_KEYS=new Set(['back','backspace','enter','escape','home','up','down','left','right','arrowup','arrowdown','arrowleft','arrowright','apps','contextmenu','f5','browserback']);
const remotePath=path=>/VID[&_][0-9A-F]*2717.*PID[&_][0-9A-F]*32B8/i.test(path);
const identity=event=>`${event.time}:${event.scan}:${event.extended?1:0}:${event.up?1:0}`;

class InputSources {
  constructor(){this.events=new Map();this.count=0;}
  add(event){
    const key=identity(event),queue=this.events.get(key)??[];queue.push(event);this.events.set(key,queue);this.count++;
    // Unpaired background/shortcut events are never reused for a later message.
    if(this.count>256){const first=this.events.keys().next().value;this.count-=this.events.get(first).length;this.events.delete(first);}
  }
  take(event){
    const key=identity(event),queue=this.events.get(key);if(!queue?.length)return;
    const source=queue.shift();this.count--;if(!queue.length)this.events.delete(key);return source;
  }
  clear(){this.events.clear();this.count=0;}
}

class RemoteInput {
  constructor({onError=()=>{}}={}){this.onError=onError;this.sources=new InputSources();this.devices=new Map();this.enabled=false;}
  setDevices(devices){this.devices=new Map((devices??[]).map(device=>[device.path.toLowerCase(),device.selected===true]));}
  attach(window){this.window=window;}
  initialize(){
    if(this.api)return;
    const koffi=require('koffi'),user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll'),imm=koffi.load('imm32.dll');
    const MSG=koffi.struct({hwnd:'void *',message:'uint32',wParam:'uintptr_t',lParam:'intptr_t',time:'uint32',x:'int32',y:'int32',private:'uint32'});
    const RID=koffi.struct({page:'uint16',usage:'uint16',flags:'uint32',target:'void *'});
    const hook=koffi.proto('intptr_t __stdcall RinGetMessage(int code, uintptr_t removed, void *message)');
    this.koffi=koffi;this.MSG=MSG;this.RID=RID;this.hookType=hook;
    this.api={
      thread:kernel.func('uint32 __stdcall GetCurrentThreadId()'),process:kernel.func('uint32 __stdcall GetCurrentProcessId()'),
      owner:user.func('uint32 __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32 *process)'),
      install:user.func('void * __stdcall SetWindowsHookExW(int type, void *callback, void *module, uint32 thread)'),
      uninstall:user.func('int __stdcall UnhookWindowsHookEx(void *hook)'),
      next:user.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t removed, void *message)'),
      register:user.func('RegisterRawInputDevices','int',[koffi.pointer(RID),'uint32','uint32']),
      registered:user.func('uint32 __stdcall GetRegisteredRawInputDevices(void *devices, _Inout_ uint32 *count, uint32 size)'),
      raw:user.func('uint32 __stdcall GetRawInputData(void *input, uint32 command, void *data, _Inout_ uint32 *size, uint32 header)'),
      name:user.func('uint32 __stdcall GetRawInputDeviceInfoW(void *device, uint32 command, void *data, _Inout_ uint32 *size)'),
      peek:user.func('PeekMessageW','int',[koffi.out(koffi.pointer(MSG)),'void *','uint32','uint32','uint32']),
      dispatch:user.func('DispatchMessageW','intptr_t',[koffi.pointer(MSG)]),
      quit:user.func('void __stdcall PostQuitMessage(int code)'),
      virtual:imm.func('uint32 __stdcall ImmGetVirtualKey(void *window)'),
      source:user.func('int __stdcall GetCurrentInputMessageSource(void *source)')
    };
  }
  start(){
    if(this.enabled)return;if(this.handle || this.ownsRegistration)throw new Error('上次按键组件尚未释放，请重新打开应用。');this.initialize();
    const {koffi,api,RID}=this,buffer=this.window.getNativeWindowHandle();
    this.hwnd=koffi.decode(buffer,'void *');
    const process=[0],thread=api.owner(this.hwnd,process);
    if(thread!==api.thread() || process[0]!==api.process())throw new Error('遥控器按键必须连接到应用自己的界面线程。');
    const count=[0];api.registered(null,count,koffi.sizeof(RID));
    if(count[0]>128)throw new Error('应用输入设备注册异常。');
    if(count[0]){
      const data=Buffer.alloc(count[0]*koffi.sizeof(RID));
      if(api.registered(data,count,koffi.sizeof(RID))===0xffffffff)throw new Error('无法读取应用输入设备状态。');
      this.previous=Array.from({length:count[0]},(_,i)=>koffi.decode(data,i*koffi.sizeof(RID),RID)).find(item=>item.page===1 && item.usage===6);
    }
    this.callback=koffi.register((code,removed,pointer)=>{
      try{if(this.enabled && code===0 && Number(removed)===1)this.message(pointer);}
      catch{const message=koffi.decode(pointer,this.MSG);if([0x100,0x101,0x104,0x105].includes(message.message)){message.message=0;koffi.encode(pointer,this.MSG,message);}this.fail();}
      return api.next(this.handle,code,removed,pointer);
    },koffi.pointer(this.hookType));
    this.handle=api.install(3,this.callback,null,thread);
    if(!this.handle){koffi.unregister(this.callback);this.callback=null;throw new Error('遥控器按键组件未能启动。');}
    if(!api.register({page:1,usage:6,flags:0x100,target:this.hwnd},1,koffi.sizeof(RID))){this.stop();throw new Error('遥控器按键设备未能注册。');}
    this.ownsRegistration=true;this.sources.clear();this.enabled=true;
  }
  readRaw(message){
    const {koffi,api}=this,header=koffi.sizeof('void *')===8?24:16,size=[0];
    api.raw(BigInt(message.lParam),0x10000003,null,size,header);
    if(size[0]<header+16 || size[0]>4096)return;
    const data=Buffer.alloc(size[0]);if(api.raw(BigInt(message.lParam),0x10000003,data,size,header)===0xffffffff || data.readUInt32LE(0)!==1)return;
    const vk=data.readUInt16LE(header+6);if(!VIRTUAL_KEYS.has(vk))return;
    // Background events have no legacy event in our queue; never pair them with
    // an event after the remote has brought the application to the foreground.
    if(Number(message.wParam)!==0)return;
    const device=koffi.decode(data,8,'void *');let selected=false;
    // Device-independent input has no physical RC003 identity. Its native
    // message is handled by the Windows origin check, never a Raw FIFO token.
    if(!device)return;
    {
      const length=[0];api.name(device,0x20000007,null,length);
      if(!length[0] || length[0]>4096)throw new Error('Missing input device');
      const name=Buffer.alloc(length[0]*2);if(api.name(device,0x20000007,name,length)===0xffffffff)throw new Error('Missing input device');
      const path=name.toString('utf16le').replace(/\0.*$/s,'').toLowerCase();selected=remotePath(path)?this.devices.get(path):false;
    }
    const flags=data.readUInt16LE(header+2);
    this.sources.add({time:message.time,scan:data.readUInt16LE(header),extended:!!(flags&2),up:!!(flags&1),selected});
  }
  message(pointer){
    const {koffi,api,MSG}=this,message=koffi.decode(pointer,MSG);
    if(message.message===0xff){this.readRaw(message);return;}
    if(![0x100,0x101,0x104,0x105].includes(message.message))return;
    const key=Number(message.wParam)===0xe5?api.virtual(message.hwnd):Number(message.wParam);
    if(!VIRTUAL_KEYS.has(key))return;
    const origin=Buffer.alloc(8);
    // Query before consuming any physical source or entering a nested message
    // drain; an injected event must not steal a same-tick hardware event.
    if(api.source(origin) && origin.readUInt32LE(4)===2)return;
    const flags=Number(BigInt(message.lParam)&0xffffffffn);
    const event={time:message.time,scan:(flags>>>16)&0xff,extended:!!(flags&0x1000000),up:!!(flags&0x80000000)};
    let source=this.sources.take(event);
    if(!source){
      // A range-filtered Windows message pump may request the legacy key first.
      // Drain already queued Raw Input synchronously, on this very same thread.
      // Nested hook callbacks read each RAWINPUT; dispatch preserves OS cleanup.
      const pending={};let count=0;
      while(count++<256 && api.peek(pending,null,0xff,0xff,1)){
        if(pending.message===0x12){api.quit(Number(pending.wParam));break;}
        api.dispatch(pending);
      }
      source=this.sources.take(event);
    }
    if(source?.selected===false)return; // untouched native MSG, including IME
    message.message=0;koffi.encode(pointer,MSG,message);
    if(!source || source.selected===undefined)this.fail();
  }
  fail(){if(this.failing)return;this.failing=true;setImmediate(()=>{this.failing=false;this.onError(new Error('遥控器按键来源暂时无法确认，连接已停止。请重新连接后再试。'));});}
  stop(){
    this.enabled=false;this.sources.clear();
    if(this.ownsRegistration && this.api.register(this.previous??{page:1,usage:6,flags:1,target:null},1,this.koffi.sizeof(this.RID))){this.ownsRegistration=false;this.previous=null;}
    if(this.handle){
      if(this.api.uninstall(this.handle)){this.handle=null;this.koffi.unregister(this.callback);this.callback=null;}
    }
  }
}
module.exports={RemoteInput,InputSources,RESERVED_KEYS,VIRTUAL_KEYS};
