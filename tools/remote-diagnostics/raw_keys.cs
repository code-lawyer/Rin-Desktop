// Windows Raw Input observer. No hooks, injection, remapping or ordinary-key logging.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class RemoteKeys : Form {
    [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort Page, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] struct DeviceEntry { public IntPtr Device; public uint Type; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr raw, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder name, ref uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputDeviceList([Out] DeviceEntry[] devices, ref uint count, uint size);
    readonly string root;
    readonly StreamWriter events;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly Dictionary<IntPtr,bool> devices = new Dictionary<IntPtr,bool>();
    readonly HashSet<int> held = new HashSet<int>();
    readonly Dictionary<string,int> counts = new Dictionary<string,int>();
    readonly TextBox output = new TextBox();
    readonly Label status = new Label();
    readonly Timer timer = new Timer();
    int ignored, observed, targetCount, elapsed;
    const int MaximumSeconds = 600;

    RemoteKeys(string path) {
        root = path; Directory.CreateDirectory(root);
        events = new StreamWriter(Path.Combine(root,"keys.jsonl"), false, new UTF8Encoding(false)); events.AutoFlush=true;
        Text="RC003 按键与麦克风检测"; Width=770; Height=650; StartPosition=FormStartPosition.CenterScreen;
        Font=new Font("Microsoft YaHei UI",10); TopMost=true;
        Label instructions=new Label { Dock=DockStyle.Top,Height=140,Padding=new Padding(14),Text=
            "请保持此窗口在前台，按键不会发送给编程工具。\r\n"+
            "① 方向 上/下/左/右、OK、主页、菜单：分别短按 3 次。\r\n"+
            "② 返回、音量＋、音量－：分别短按 3 次（可能被 Windows 过滤）。\r\n"+
            "③ 显示语音就绪后，按住语音键，说：这是遥控器麦克风测试，一二三。\r\n"+
            "松开后再录一句；最后用电脑键盘轻按一次 Shift，检查来源隔离。"};
        output.Multiline=true; output.ReadOnly=true; output.ScrollBars=ScrollBars.Vertical; output.Dock=DockStyle.Fill;
        status.Dock=DockStyle.Bottom; status.Height=65; status.Padding=new Padding(10); status.Text="正在准备语音服务……";
        Button finish=new Button {Text="完成检测并关闭",Dock=DockStyle.Bottom,Height=42}; finish.Click += delegate { Close(); };
        Controls.Add(output); Controls.Add(instructions); Controls.Add(finish); Controls.Add(status);
        Shown += delegate {
            var registration=new RawDevice {Page=1,Usage=6,Flags=0x2100,Target=Handle};
            bool ready=RegisterRawInputDevices(new RawDevice[]{registration},1,(uint)Marshal.SizeOf(typeof(RawDevice)));
            uint n=0; uint size=(uint)Marshal.SizeOf(typeof(DeviceEntry)); GetRawInputDeviceList(null,ref n,size);
            if(n<1024) {var list=new DeviceEntry[n]; uint copied=GetRawInputDeviceList(list,ref n,size);
                if(copied!=UInt32.MaxValue) foreach(var item in list) if(item.Type==1 && IsTarget(item.Device)) targetCount++;
            }
            Record(new Dictionary<string,object>{{"event","ready"},{"registered",ready},{"targetKeyboardInterfaces",targetCount}});
            Append(ready ? "按键监听已开启，仅记录 VID 2717 / PID 32B8。" : "按键监听注册失败。");
            timer.Interval=1000; timer.Tick += Tick; timer.Start();
            File.WriteAllText(Path.Combine(root,"window-ready"),"ready");
        };
        FormClosed += delegate {
            timer.Stop(); File.WriteAllText(Path.Combine(root,"stop"),"stop");
            Record(new Dictionary<string,object>{{"event","summary"},{"observedRemoteEvents",observed},{"ignoredOtherDeviceEvents",ignored},{"heldKeysAtExit",held.Count},{"counts",counts},{"devicePathsPersisted",false}});
            events.Dispose();
        };
    }
    void Tick(object sender, EventArgs e) {
        elapsed++; if(elapsed>=MaximumSeconds){Close();return;}
        try {
            string path=Path.Combine(root,"status.json");
            if(File.Exists(path)) {var state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));
                status.Text=Convert.ToString(state["message"])+"\r\n遥控器事件："+observed+"；已忽略其他键盘事件："+ignored;
            }
        } catch(IOException) {} catch(ArgumentException) {} catch(KeyNotFoundException) {}
    }
    bool IsTarget(IntPtr device) {
        bool cached;if(devices.TryGetValue(device,out cached))return cached;
        uint size=0;GetRawInputDeviceInfo(device,0x20000007,null,ref size);
        bool match=false;
        if(size>0 && size<4096){var path=new StringBuilder((int)size+1);GetRawInputDeviceInfo(device,0x20000007,path,ref size);
            match=Regex.IsMatch(path.ToString(),@"VID[&_][0-9A-F]*2717.*PID[&_][0-9A-F]*32B8",RegexOptions.IgnoreCase);}
        if(devices.Count<1024)devices[device]=match;return match;
    }
    void Record(Dictionary<string,object> value){value["timeUtc"]=DateTime.UtcNow.ToString("o");events.WriteLine(json.Serialize(value));}
    void Append(string text){if(output.TextLength>20000)output.Clear();output.AppendText(text+Environment.NewLine);}
    protected override void WndProc(ref Message message){
        if(message.Msg==0x00fe){devices.Clear();held.Clear();}
        if(message.Msg==0x00ff){
            uint size=0;uint header=(uint)(IntPtr.Size==8?24:16);
            GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,header);
            if(size>=header+16 && size<4096){IntPtr data=Marshal.AllocHGlobal((int)size);
                try{
                    uint copied=GetRawInputData(message.LParam,0x10000003,data,ref size,header);
                    if(copied!=size || Marshal.ReadInt32(data)!=1){base.WndProc(ref message);return;}
                    IntPtr device=Marshal.ReadIntPtr(data,8);
                    if(!IsTarget(device)){ignored++;base.WndProc(ref message);return;}
                    int offset=(int)header;int flags=(ushort)Marshal.ReadInt16(data,offset+2);
                    int key=(ushort)Marshal.ReadInt16(data,offset+6);bool up=(flags&1)!=0;
                    bool repeat=!up && held.Contains(key);if(up)held.Remove(key);else held.Add(key);
                    string name=((Keys)key).ToString();string label=name+(up?" ↑":" ↓")+(repeat?" repeat":"");
                    string countKey=name+(up?":up":":down");if(!counts.ContainsKey(countKey))counts[countKey]=0;counts[countKey]++;
                    observed++;Record(new Dictionary<string,object>{{"event","key"},{"vkey",key},{"key",name},{"edge",up?"up":"down"},{"repeat",repeat}});
                    Append(DateTime.Now.ToString("HH:mm:ss.fff")+"  "+label);
                }finally{Marshal.FreeHGlobal(data);}
            }
        }
        base.WndProc(ref message);
    }
    [STAThread] static void Main(string[] args){if(args.Length!=1)return;Application.EnableVisualStyles();Application.Run(new RemoteKeys(Path.GetFullPath(args[0])));}
}
