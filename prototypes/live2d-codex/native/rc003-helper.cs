// Owned, hidden Windows transport. JSON lines only; never writes audio/device logs.
// No keyboard hooks or injection: Raw Input is accepted only for the selected
// Bluetooth container and the RC003 vendor/product. Ordinary keyboards pass on.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Windows.Foundation;
using Windows.Devices.Enumeration;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

class RemoteWindow : Form {
    static readonly object OutputLock = new object();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly string[] ContainerProperties = { "System.Devices.ContainerId", "System.Devices.Aep.ContainerId" };
    static readonly Guid ServiceId = new Guid("ab5e0001-5a21-4f05-bc7d-af01f617b664");
    static Guid Characteristic(int n) { return new Guid("ab5e000"+n+"-5a21-4f05-bc7d-af01f617b664"); }
    readonly SemaphoreSlim Commands = new SemaphoreSlim(1,1);
    readonly Dictionary<IntPtr,bool> RawDevices = new Dictionary<IntPtr,bool>();
    readonly Dictionary<IntPtr,string> RawPaths = new Dictionary<IntPtr,string>();
    readonly Dictionary<IntPtr,uint> RawKinds = new Dictionary<IntPtr,uint>();
    readonly Dictionary<IntPtr,IntPtr> HidDescriptors = new Dictionary<IntPtr,IntPtr>();
    readonly Dictionary<string,HashSet<string>> ConsumerHeld = new Dictionary<string,HashSet<string>>();
    BluetoothLEDevice device;
    GattDeviceService service;
    GattSession connection;
    GattCharacteristic tx, control, audio;
    string container;
    int generation;
    bool exiting;

    [STAThread] static void Main(string[] args) {
        Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
        if(args.Contains("--self-check")) { Emit(new {ready=true,protocol=1}); return; }
        if(args.Contains("--self-test-input")) {
            var down=ConsumerKeys(new ushort[]{0xe9,0x1234});var up=ConsumerKeys(new ushort[0]);
            if(!down.SetEquals(new[]{"VolumeUp"}) || ConsumerChanges(down,down).Count!=0 || ConsumerChanges(down,up).Single().Value!="up" || !ConsumerKeys(new ushort[]{0xea}).SetEquals(new[]{"VolumeDown"})) throw new Exception("CONSUMER_TEST_FAILED");
            Emit(new {consumerEdges=true,unknownUsagesIgnored=true,repeatsSuppressed=true,deviceAccess=false}); return;
        }
        Application.Run(new RemoteWindow());
    }
    public RemoteWindow() {
        ShowInTaskbar=false; FormBorderStyle=FormBorderStyle.FixedToolWindow;
        Opacity=0; Width=1; Height=1;
        var windowHandle=Handle;
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        Task.Run(async delegate {
            string line;
            while ((line=await Console.In.ReadLineAsync())!=null) {
                if(line.Length>8192) break;
                try { var request=Json.Deserialize<Dictionary<string,object>>(line); BeginInvoke(new Action(async delegate { await Command(request); })); }
                catch { break; }
            }
            if(!IsDisposed) BeginInvoke(new Action(async delegate { exiting=true; await Disconnect(); Application.Exit(); }));
        });
    }
    static void Emit(object value) { lock(OutputLock) { try { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } catch {} } }
    // Explicit completion avoids a build dependency on the Windows SDK's merged Windows.winmd.
    static async Task<T> Wait<T>(IAsyncOperation<T> operation) {
        var completion=new TaskCompletionSource<T>();
        operation.Completed=(op,status)=>{ try { completion.TrySetResult(op.GetResults()); } catch(Exception e) { completion.TrySetException(e); } };
        if(await Task.WhenAny(completion.Task,Task.Delay(15000))!=completion.Task) { operation.Cancel(); throw new Exception("TIMEOUT"); }
        try { return await completion.Task; } finally { operation.Close(); }
    }
    async Task Command(Dictionary<string,object> request) {
        int id=Convert.ToInt32(request["id"]);
        await Commands.WaitAsync();
        string failure=null;
        try {
            if(exiting) throw new Exception("NO_DEVICE");
            object result=null;
            switch((string)request["command"]) {
                case "hello": result=new {protocol=1}; break;
                case "scan": result=await Scan(); break;
                case "connect": await Connect((string)request["deviceId"],Convert.ToInt32(request["generation"])); break;
                case "write":
                    if(tx==null || Convert.ToInt32(request["generation"])!=generation) throw new Exception("NO_DEVICE");
                    var data=Convert.FromBase64String((string)request["data"]);
                    if(data.Length>32) throw new Exception("WRITE_FAILED");
                    await Write(data); break;
                case "disconnect": await Disconnect(); break;
                default: throw new Exception("NO_DEVICE");
            }
            Emit(new {reply=id,ok=true,value=result});
        } catch(Exception error) {
            failure=Regex.IsMatch(error.Message,"^[A-Z_]{3,30}$")?error.Message:"CONNECT_FAILED";
        }
        if(failure!=null) {
            if((string)request["command"]=="connect") await Disconnect();
            Emit(new {reply=id,ok=false,code=failure});
        }
        Commands.Release();
    }
    static bool Supported(DeviceInformation info) {
        return Regex.IsMatch(info.Name??"",@"RC003|小米.*遥控|Xiaomi.*(Remote|RC003)",RegexOptions.IgnoreCase);
    }
    async Task<object> Scan() {
        var candidates=new Dictionary<string,DeviceInformation>();
        var watcher=DeviceInformation.CreateWatcher(BluetoothLEDevice.GetDeviceSelector(),ContainerProperties,DeviceInformationKind.AssociationEndpoint);
        var scanLock=new object();
        watcher.Added+=(sender,info)=>{lock(scanLock){if(candidates.Count<256) candidates[info.Id]=info;}};
        watcher.Updated+=(sender,info)=>{lock(scanLock){DeviceInformation existing;if(candidates.TryGetValue(info.Id,out existing))existing.Update(info);}};
        watcher.Start();
        try { await Task.Delay(8000); }
        finally { watcher.Stop(); }
        lock(scanLock) return candidates.Values.Where(Supported).Select(info=>new {id=info.Id,name=info.Name,paired=info.Pairing.IsPaired}).Take(50).ToArray();
    }
    static new string Container(DeviceInformation info) {
        foreach(var key in ContainerProperties) {object value; if(info.Properties.TryGetValue(key,out value) && value!=null && value.ToString()!=Guid.Empty.ToString())return value.ToString().ToLowerInvariant();}
        return null;
    }
    async Task Connect(string id,int nextGeneration) {
        await Disconnect(); generation=nextGeneration;
        var info=await Wait(DeviceInformation.CreateFromIdAsync(id,ContainerProperties,DeviceInformationKind.AssociationEndpoint));
        if(info==null || !Supported(info))throw new Exception("NO_DEVICE");
        if(!info.Pairing.IsPaired) {
            Emit(new {type="pairing",generation=generation});
            var paired=await Wait(info.Pairing.PairAsync());
            if(paired.Status!=DevicePairingResultStatus.Paired && paired.Status!=DevicePairingResultStatus.AlreadyPaired)throw new Exception("PAIR_FAILED");
        }
        device=await Wait(BluetoothLEDevice.FromIdAsync(id));
        if(device==null)throw new Exception("CONNECT_FAILED");
        connection=await Wait(GattSession.FromDeviceIdAsync(device.BluetoothDeviceId));
        if(connection!=null && connection.CanMaintainConnection)connection.MaintainConnection=true;
        container=Container(info);
        if(container==null) { var details=await Wait(DeviceInformation.CreateFromIdAsync(device.DeviceInformation.Id,ContainerProperties));container=Container(details); }
        device.ConnectionStatusChanged+=ConnectionChanged;
        var services=await Wait(device.GetGattServicesForUuidAsync(ServiceId,BluetoothCacheMode.Uncached));
        if(services.Status!=GattCommunicationStatus.Success || services.Services.Count!=1)throw new Exception("NO_SERVICE");
        service=services.Services[0];
        var chars=await Wait(service.GetCharacteristicsAsync(BluetoothCacheMode.Uncached));
        if(chars.Status!=GattCommunicationStatus.Success)throw new Exception("NO_SERVICE");
        tx=chars.Characteristics.FirstOrDefault(c=>c.Uuid==Characteristic(2));
        audio=chars.Characteristics.FirstOrDefault(c=>c.Uuid==Characteristic(3));
        control=chars.Characteristics.FirstOrDefault(c=>c.Uuid==Characteristic(4));
        if(tx==null || audio==null || control==null)throw new Exception("NO_SERVICE");
        control.ValueChanged+=ControlChanged; audio.ValueChanged+=AudioChanged;
        foreach(var c in new[]{control,audio}) {
            var status=await Wait(c.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify));
            if(status!=GattCommunicationStatus.Success)throw new Exception("SUBSCRIBE_FAILED");
        }
        var registration=new[]{new RAWINPUTDEVICE{usagePage=1,usage=6,flags=0x2100,target=Handle},new RAWINPUTDEVICE{usagePage=0x0c,usage=1,flags=0x2100,target=Handle}};
        if(!RegisterRawInputDevices(registration,(uint)registration.Length,(uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))throw new Exception("RAW_FAILED");
        await IdentifyDevices();
        EmitKeys();
    }
    void ConnectionChanged(BluetoothLEDevice sender,object args) {
        if(sender==device && sender.ConnectionStatus==BluetoothConnectionStatus.Disconnected) Emit(new {type="disconnected",generation=generation});
    }
    void ControlChanged(GattCharacteristic sender,GattValueChangedEventArgs args) { if(sender==control)Notification("control",args); }
    void AudioChanged(GattCharacteristic sender,GattValueChangedEventArgs args) { if(sender==audio)Notification("audio",args); }
    void Notification(string type,GattValueChangedEventArgs args) {
        if(args.CharacteristicValue.Length>512)return;
        using(var reader=DataReader.FromBuffer(args.CharacteristicValue)) {var bytes=new byte[reader.UnconsumedBufferLength];reader.ReadBytes(bytes);Emit(new {type=type,generation=generation,data=Convert.ToBase64String(bytes)});}
    }
    async Task Write(byte[] bytes) {
        using(var writer=new DataWriter()) {
            writer.WriteBytes(bytes);
            var option=(tx.CharacteristicProperties&GattCharacteristicProperties.Write)!=0?GattWriteOption.WriteWithResponse:GattWriteOption.WriteWithoutResponse;
            if(await Wait(tx.WriteValueAsync(writer.DetachBuffer(),option))!=GattCommunicationStatus.Success)throw new Exception("WRITE_FAILED");
        }
    }
    async Task Disconnect() {
        // The application closes a known stream before disconnect; also send a
        // best effort generic close for pipe loss/parent exit.
        if(tx!=null) {try {await Task.WhenAny(Write(new byte[]{0x0d,0}),Task.Delay(700));} catch {}}
        if(control!=null) control.ValueChanged-=ControlChanged;
        if(audio!=null) audio.ValueChanged-=AudioChanged;
        var oldDevice=device; if(oldDevice!=null)oldDevice.ConnectionStatusChanged-=ConnectionChanged;
        device=null; tx=null;control=null;audio=null;container=null;RawDevices.Clear();RawPaths.Clear();RawKinds.Clear();ConsumerHeld.Clear();
        foreach(var descriptor in HidDescriptors.Values)Marshal.FreeHGlobal(descriptor);
        HidDescriptors.Clear();
        if(service!=null){service.Dispose();service=null;}
        if(connection!=null){connection.MaintainConnection=false;connection.Dispose();connection=null;}
        if(oldDevice!=null)oldDevice.Dispose();
    }
    async Task IdentifyDevices() {
        uint count=0,size=(uint)Marshal.SizeOf(typeof(RAWINPUTDEVICELIST));
        GetRawInputDeviceList(null,ref count,size); if(count>1024)return;
        var list=new RAWINPUTDEVICELIST[count];
        if(GetRawInputDeviceList(list,ref count,size)==UInt32.MaxValue)return;
        foreach(var item in list) if(item.type==1 || item.type==2) await Identify(item.device,item.type);
    }
    async Task Identify(IntPtr handle,uint kind) {
        if(RawDevices.ContainsKey(handle))return;
        uint count=0;GetRawInputDeviceInfo(handle,0x20000007,null,ref count);if(count==0 || count>4096)return;
        var name=new StringBuilder((int)count);GetRawInputDeviceInfo(handle,0x20000007,name,ref count);
        if(!Regex.IsMatch(name.ToString(),@"VID[&_][0-9A-F]*2717.*PID[&_][0-9A-F]*32B8",RegexOptions.IgnoreCase)){RawDevices[handle]=false;return;}
        int token=generation;string selected=container;if(selected==null)return;
        try {var details=await Wait(DeviceInformation.CreateFromIdAsync(name.ToString(),ContainerProperties,DeviceInformationKind.DeviceInterface)); if(token==generation && container==selected && details!=null && Container(details)!=null){RawDevices[handle]=Container(details)==selected;RawPaths[handle]=name.ToString();RawKinds[handle]=kind;EmitKeys();}} catch {}
    }
    void EmitKeys() {
        Emit(new {type="keys",generation=generation,available=RawKinds.Any(pair=>pair.Value==1 && RawDevices[pair.Key]),devices=RawPaths.Select(pair=>new {path=pair.Value,selected=RawDevices[pair.Key]}).ToArray()});
    }
    // Consumer controls are a separate HID collection, not RAWKEYBOARD keys.
    // Use its descriptor rather than assuming a vendor report byte layout.
    static HashSet<string> ConsumerKeys(IEnumerable<ushort> usages) {
        return new HashSet<string>(usages.Where(value=>value==0xe9 || value==0xea).Select(value=>value==0xe9?"VolumeUp":"VolumeDown"));
    }
    static List<KeyValuePair<string,string>> ConsumerChanges(HashSet<string> previous,HashSet<string> current) {
        var changes=new List<KeyValuePair<string,string>>();
        foreach(var key in previous.Except(current))changes.Add(new KeyValuePair<string,string>(key,"up"));
        foreach(var key in current.Except(previous))changes.Add(new KeyValuePair<string,string>(key,"down"));
        return changes;
    }
    void ReadConsumer(IntPtr handle,IntPtr data,int header,uint size) {
        if(size<header+8)return;
        int length=Marshal.ReadInt32(data,header),count=Marshal.ReadInt32(data,header+4);
        if(length<1 || length>512 || count<1 || count>64 || (long)length*count>size-header-8)return;
        IntPtr descriptor;
        if(!HidDescriptors.TryGetValue(handle,out descriptor)) {
            uint bytes=0;GetRawInputDeviceBuffer(handle,0x20000005,IntPtr.Zero,ref bytes);
            if(bytes==0 || bytes>65536)return;
            descriptor=Marshal.AllocHGlobal((int)bytes);
            if(GetRawInputDeviceBuffer(handle,0x20000005,descriptor,ref bytes)==UInt32.MaxValue){Marshal.FreeHGlobal(descriptor);return;}
            HidDescriptors[handle]=descriptor;
        }
        uint maximum=HidP_MaxUsageListLength(0,0x0c,descriptor);
        if(maximum==0 || maximum>256)return;
        for(int i=0;i<count;i++) {
            IntPtr report=IntPtr.Add(data,header+8+i*length);
            var usages=new ushort[maximum];uint used=maximum;
            if(HidP_GetUsages(0,0x0c,0,usages,ref used,descriptor,report,(uint)length)!=0x110000 || used>maximum)continue;
            string identity=handle.ToString()+":"+Marshal.ReadByte(report);HashSet<string> previous;
            if(!ConsumerHeld.TryGetValue(identity,out previous))previous=new HashSet<string>();
            var current=ConsumerKeys(usages.Take((int)used));
            foreach(var edge in ConsumerChanges(previous,current))Emit(new {type="key",generation=generation,key=edge.Key,edge=edge.Value});
            ConsumerHeld[identity]=current;
        }
    }
    protected override void WndProc(ref Message message) {
        if(message.Msg==0x00fe) {
            bool owned;bool selected=RawDevices.TryGetValue(message.LParam,out owned) && owned;
            RawDevices.Remove(message.LParam);RawPaths.Remove(message.LParam);
            RawKinds.Remove(message.LParam);IntPtr descriptor;
            if(HidDescriptors.TryGetValue(message.LParam,out descriptor)){Marshal.FreeHGlobal(descriptor);HidDescriptors.Remove(message.LParam);}
            string removedPrefix=message.LParam.ToString()+":";
            foreach(var key in ConsumerHeld.Keys.Where(key=>key.StartsWith(removedPrefix)).ToArray())ConsumerHeld.Remove(key);
            if(selected)Emit(new {type="key-reset",generation=generation});
            if(device!=null) BeginInvoke(new Action(async delegate {await IdentifyDevices(); EmitKeys();}));
        }
        if(message.Msg==0x00ff && device!=null) {
            uint header=(uint)(IntPtr.Size==8?24:16), size=0;
            GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,header);
            if(size>=header+8 && size<4096) {
                IntPtr data=Marshal.AllocHGlobal((int)size);
                try {
                    if(GetRawInputData(message.LParam,0x10000003,data,ref size,header)!=UInt32.MaxValue) {
                        uint kind=(uint)Marshal.ReadInt32(data);
                        IntPtr handle=Marshal.ReadIntPtr(data,8);bool allowed;
                        if(RawDevices.TryGetValue(handle,out allowed) && allowed) {
                          if(kind==2)ReadConsumer(handle,data,(int)header,size);
                          else if(kind==1 && size>=header+16) {
                            int flags=Marshal.ReadInt16(data,(int)header+2),key=Marshal.ReadInt16(data,(int)header+6);
                            Emit(new {type="key",generation=generation,key=((Keys)key).ToString(),edge=(flags&1)!=0?"up":"down"});
                          }
                        } else if((kind==1 || kind==2) && !RawDevices.ContainsKey(handle)) BeginInvoke(new Action(async delegate {await Identify(handle,kind);}));
                    }
                } finally {Marshal.FreeHGlobal(data);}
            }
        }
        base.WndProc(ref message);
    }

    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE {public ushort usagePage,usage;public uint flags;public IntPtr target;}
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICELIST {public IntPtr device;public uint type;}
    [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices,uint count,uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input,uint command,IntPtr data,ref uint size,uint header);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr device,uint command,StringBuilder data,ref uint size);
    [DllImport("user32.dll",EntryPoint="GetRawInputDeviceInfoW")] static extern uint GetRawInputDeviceBuffer(IntPtr device,uint command,IntPtr data,ref uint size);
    [DllImport("hid.dll")] static extern uint HidP_MaxUsageListLength(int reportType,ushort page,IntPtr descriptor);
    [DllImport("hid.dll")] static extern int HidP_GetUsages(int reportType,ushort page,ushort collection,[Out] ushort[] usages,ref uint count,IntPtr descriptor,IntPtr report,uint length);
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([In,Out] RAWINPUTDEVICELIST[] devices,ref uint count,uint size);
}
