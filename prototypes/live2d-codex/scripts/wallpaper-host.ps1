param([long]$WindowHandle, [int]$OwnerProcess)
$ErrorActionPreference = 'Stop'
# Implements Win32 desktop parenting for our own process only. Desktop behavior
# was checked against Lively's public raised-desktop documentation; no registry
# wallpaper settings, Explorer windows, or other applications are modified.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WallpaperDesktop {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor,Work; public uint Flags; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c,string t);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string t);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p,IntPtr l);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetParent(IntPtr c,IntPtr p);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetStyle(IntPtr h,int n);
  [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)] static extern IntPtr SetStyle(IntPtr h,int n,IntPtr v);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h,uint key,byte alpha,uint flags);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int t,uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h,ref Point p);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint f);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr m,ref MonitorInfo i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
  static IntPtr own,parent,icons,oldParent; static long style,extended; static uint owner; static bool saved,raised;
  static MonitorInfo monitor;
  public static string ClassOf(IntPtr h) { var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
  static void CheckOwn() { uint p; GetWindowThreadProcessId(own,out p); if(!IsWindow(own)||p!=owner) throw new Exception("The wallpaper window is no longer owned by this app."); }
  public static void Start(long hwnd,int pid) {
    own=new IntPtr(hwnd); owner=(uint)pid; CheckOwn();
    SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(own));
    oldParent=GetParent(own); style=GetStyle(own,-16).ToInt64(); extended=GetStyle(own,-20).ToInt64(); saved=true;
    Attach();
  }
  static void Attach() {
    CheckOwn(); var prog=FindWindow("Progman",null); if(prog==IntPtr.Zero) throw new Exception("Windows desktop is unavailable.");
    IntPtr ignored; SendMessageTimeout(prog,0x052C,new IntPtr(13),new IntPtr(1),2,1000,out ignored);
    raised=(GetStyle(prog,-20).ToInt64()&0x00200000L)!=0;
    icons=FindWindowEx(prog,IntPtr.Zero,"SHELLDLL_DefView",null); parent=IntPtr.Zero;
    if(raised && icons!=IntPtr.Zero) parent=prog;
    else EnumWindows(delegate(IntPtr h,IntPtr unused) {
      var view=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);
      if(view!=IntPtr.Zero) { var behind=FindWindowEx(IntPtr.Zero,h,"WorkerW",null); if(behind!=IntPtr.Zero){parent=behind; icons=view; return false;} }
      return true;
    },IntPtr.Zero);
    if(parent==IntPtr.Zero) throw new Exception("No desktop wallpaper layer was found.");
    monitor=new MonitorInfo(); monitor.Size=Marshal.SizeOf(typeof(MonitorInfo)); GetMonitorInfo(MonitorFromWindow(own,1),ref monitor);
    // A reparented resizable Electron window otherwise retains a native sizing
    // border, reducing the canvas by several pixels at 150% display scaling.
    SetStyle(own,-16,new IntPtr((style&~0x80CF0000L)|0x40000000L));
    SetStyle(own,-20,new IntPtr((extended&~0x00040000L)|0x08000080L|(raised?0x00080000L:0)));
    if(raised) SetLayeredWindowAttributes(own,0,255,2);
    SetParent(own,parent); if(GetParent(own)!=parent) throw new Exception("Windows refused to attach the wallpaper window.");
    Place(); ShowWindow(own,4);
  }
  static void Place() {
    GetMonitorInfo(MonitorFromWindow(own,1),ref monitor);
    var p=new Point(); p.X=monitor.Monitor.Left; p.Y=monitor.Monitor.Top; ScreenToClient(parent,ref p);
    if(!SetWindowPos(own,raised?icons:new IntPtr(1),p.X,p.Y,monitor.Monitor.Right-monitor.Monitor.Left,monitor.Monitor.Bottom-monitor.Monitor.Top,0x0030)) throw new Exception("Could not size the desktop wallpaper.");
  }
  public static bool Ensure() { CheckOwn(); if(!IsWindow(parent)||GetParent(own)!=parent) Attach(); else Place(); return true; }
  public static bool Covered() {
    var h=GetForegroundWindow(); if(h==IntPtr.Zero||IsIconic(h)) return false;
    uint p; GetWindowThreadProcessId(h,out p); if(p==owner) return false;
    var c=ClassOf(h); if(c=="Progman"||c=="WorkerW"||c=="Shell_TrayWnd") return false;
    Rect r; if(!GetWindowRect(h,out r)) return false;
    return r.Left<=monitor.Work.Left+2 && r.Top<=monitor.Work.Top+2 && r.Right>=monitor.Work.Right-2 && r.Bottom>=monitor.Work.Bottom-2;
  }
  public static string ParentClass() { return ClassOf(parent); }
  public static long ParentHandle() { return parent.ToInt64(); }
  public static bool IsRaised() { return raised; }
  public static Rect Bounds() { Rect r; GetWindowRect(own,out r); return r; }
  public static void Close() {
    if(!saved || !IsWindow(own)) return;
    CheckOwn(); ShowWindow(own,0); SetParent(own,oldParent); SetStyle(own,-16,new IntPtr(style)); SetStyle(own,-20,new IntPtr(extended)); saved=false;
  }
}
'@
function Write-WallpaperStatus {
    $bounds=[WallpaperDesktop]::Bounds()
    [Console]::Out.WriteLine((@{ ok=$true; attached=$true; raised=[WallpaperDesktop]::IsRaised(); parentClass=[WallpaperDesktop]::ParentClass(); parentHandle=[WallpaperDesktop]::ParentHandle(); occluded=[WallpaperDesktop]::Covered(); bounds=@{x=$bounds.Left;y=$bounds.Top;width=$bounds.Right-$bounds.Left;height=$bounds.Bottom-$bounds.Top} } | ConvertTo-Json -Compress))
}
try {
    [WallpaperDesktop]::Start($WindowHandle,$OwnerProcess)
    Write-WallpaperStatus
    while ($null -ne ($commandLine=[Console]::In.ReadLine())) {
        if ($commandLine -eq 'quit') { break }
        if ($commandLine -eq 'ensure') { [WallpaperDesktop]::Ensure() | Out-Null; Write-WallpaperStatus }
    }
}
catch { [Console]::Out.WriteLine((@{ok=$false;attached=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
finally { [WallpaperDesktop]::Close() }
