using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using Accessibility;

public sealed class WallpaperPoseInput : IDisposable {
  const int MouseHook = 14, LeftDown = 0x0201, LeftUp = 0x0202,
    RightDown = 0x0204, RightUp = 0x0205, RefreshHook = 0x8001, Quit = 0x0012;
  const int SwapButton = 23, DragWidth = 68, DragHeight = 69, ListRole = 0x21, ChildSelf = 0;
  const uint MenuOrMoveMode = 0x1e;
  static readonly IntPtr PerMonitorDpiV2 = new IntPtr(-4);
  delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);

  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect {
    public int Left, Top, Right, Bottom;
    public bool Contains(Point p) { return p.X >= Left && p.X < Right && p.Y >= Top && p.Y < Bottom; }
  }
  [StructLayout(LayoutKind.Sequential)] struct HookData {
    public Point Point;
    public uint MouseData, Flags, Time;
    public UIntPtr Extra;
  }
  [StructLayout(LayoutKind.Sequential)] struct Message {
    public IntPtr Window;
    public uint Id;
    public UIntPtr WParam;
    public IntPtr LParam;
    public uint Time;
    public Point Point;
    public uint Private;
  }
  [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo {
    public uint Size, Flags;
    public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
    public Rect CaretRect;
  }

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message msg, IntPtr window, uint min, uint max, uint flags);
  [DllImport("user32.dll")] static extern int GetMessage(out Message msg, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, int msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPhysicalPoint(Point point);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr window);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int metric);
  [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int metric, uint dpi);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromPoint(Point point,
    [MarshalAs(UnmanagedType.Interface)] out IAccessible element, [MarshalAs(UnmanagedType.Struct)] out object child);
  [DllImport("oleacc.dll")] static extern int WindowFromAccessibleObject(IAccessible element, out IntPtr window);

  sealed class DesktopTarget {
    public IntPtr Wallpaper, Parent, IconView, List;
    public Rect Bounds;
    public int Revision;
  }
  sealed class Press {
    public DesktopTarget Target;
    public IntPtr Window;
    public Point Point;
    public uint Time;
    public int Release, DragX, DragY;
  }
  sealed class Click {
    public Press Down;
    public Point Up;
    public int Received;
  }

  readonly BlockingCollection<Click> pending = new BlockingCollection<Click>(4);
  readonly HookProc callback;
  readonly Thread hookThread;
  volatile DesktopTarget target;
  volatile uint hookThreadId;
  volatile bool closing;
  IntPtr hook;
  Press press;

  public WallpaperPoseInput() {
    callback = Track;
    hookThread = new Thread(Pump) { IsBackground = true, Name = "Wallpaper primary mouse input" };
    hookThread.Start();
    new Thread(CheckClicks) { IsBackground = true, Name = "Wallpaper desktop icon hit testing" }.Start();
  }

  public void Enable(long wallpaper, long parent, long iconView, int revision, int left, int top, int right, int bottom) {
    var next = new DesktopTarget {
      Wallpaper = new IntPtr(wallpaper), Parent = new IntPtr(parent), IconView = new IntPtr(iconView), Revision = revision,
      Bounds = new Rect { Left = left, Top = top, Right = right, Bottom = bottom }
    };
    if (next.IconView != IntPtr.Zero) next.List = FindWindowEx(next.IconView, IntPtr.Zero, "SysListView32", null);
    var last = target;
    if (last != null && last.Parent == next.Parent && last.IconView == next.IconView &&
        last.List == next.List && last.Revision == revision && last.Bounds.Equals(next.Bounds)) return;
    target = next;
    if (hookThreadId != 0) PostThreadMessage(hookThreadId, RefreshHook, IntPtr.Zero, IntPtr.Zero);
  }

  public void Disable() {
    target = null;
    if (hookThreadId != 0) PostThreadMessage(hookThreadId, RefreshHook, IntPtr.Zero, IntPtr.Zero);
  }

  void Pump() {
    Message message;
    PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
    hookThreadId = GetCurrentThreadId();
    try {
      if (closing) return;
      UpdateHook();
      while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
        if (message.Id == RefreshHook) UpdateHook();
      }
    } finally {
      if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
      hookThreadId = 0;
    }
  }

  void UpdateHook() {
    press = null;
    if (target == null && hook != IntPtr.Zero) {
      UnhookWindowsHookEx(hook);
      hook = IntPtr.Zero;
    } else if (target != null && hook == IntPtr.Zero) {
      hook = SetWindowsHookEx(MouseHook, callback, GetModuleHandle(null), 0);
      if (hook == IntPtr.Zero) Console.Out.WriteLine("{\"type\":\"pose-input-error\",\"error\":\"Windows mouse observation unavailable.\"}");
    }
  }

  IntPtr Track(int code, IntPtr message, IntPtr data) {
    try {
      var current = target;
      int kind = message.ToInt32();
      if (code == 0 && current != null && (press != null || kind == LeftDown || kind == RightDown)) {
        TrackButton(current, kind, (HookData)Marshal.PtrToStructure(data, typeof(HookData)));
      }
    } catch (Exception) {
      press = null;
    }
    // Keep every original Windows mouse event, including those that change a pose.
    return CallNextHookEx(IntPtr.Zero, code, message, data);
  }

  void TrackButton(DesktopTarget current, int kind, HookData input) {
    if (kind == LeftDown || kind == RightDown) {
      press = null;
      bool reversed = GetSystemMetrics(SwapButton) != 0;
      if (kind != (reversed ? RightDown : LeftDown)) return;
      if (GetParent(current.Wallpaper) != current.Parent || !IsWindowVisible(current.Wallpaper) ||
          !current.Bounds.Contains(input.Point)) return;
      var window = DesktopWindowAt(current, input.Point);
      if (window == IntPtr.Zero) return;
      uint dpi = GetDpiForWindow(current.Wallpaper);
      press = new Press {
        Target = current, Window = window, Point = input.Point, Time = input.Time,
        Release = reversed ? RightUp : LeftUp,
        DragX = Math.Max(1, GetSystemMetricsForDpi(DragWidth, dpi)),
        DragY = Math.Max(1, GetSystemMetricsForDpi(DragHeight, dpi))
      };
      return;
    }
    var down = press;
    if (down == null) return;
    if (down.Target != current || input.Time - down.Time > GetDoubleClickTime() ||
        Math.Abs(input.Point.X - down.Point.X) >= down.DragX || Math.Abs(input.Point.Y - down.Point.Y) >= down.DragY) {
      press = null;
      return;
    }
    if (kind != down.Release) return;
    press = null;
    if (current.Bounds.Contains(input.Point) && DesktopWindowAt(current, input.Point) == down.Window) {
      pending.TryAdd(new Click { Down = down, Up = input.Point, Received = Environment.TickCount });
    }
  }

  static IntPtr DesktopWindowAt(DesktopTarget current, Point point) {
    // User32 can enter a low-level hook in the target window's DPI context.
    // MSLLHOOKSTRUCT still gives physical pixels, so set the context here.
    var previousDpi = SetThreadDpiAwarenessContext(PerMonitorDpiV2);
    if (previousDpi == IntPtr.Zero) return IntPtr.Zero;
    try {
      var window = WindowFromPhysicalPoint(point);
      if (window == IntPtr.Zero) return IntPtr.Zero;
      var gui = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
      if (!GetGUIThreadInfo(0, ref gui) || (gui.Flags & MenuOrMoveMode) != 0 ||
          (gui.Capture != IntPtr.Zero && gui.Capture != current.List)) return IntPtr.Zero;
      if (IsWindowVisible(current.List)) return window == current.List ? window : IntPtr.Zero;
      if (current.List == IntPtr.Zero && IsWindowVisible(current.IconView)) return IntPtr.Zero;
      return window == current.Parent || window == current.IconView || window == current.Wallpaper ||
        IsChild(current.Wallpaper, window) ? window : IntPtr.Zero;
    } finally {
      SetThreadDpiAwarenessContext(previousDpi);
    }
  }

  void CheckClicks() {
    SetThreadDpiAwarenessContext(PerMonitorDpiV2);
    foreach (var click in pending.GetConsumingEnumerable()) {
      var down = click.Down;
      var current = down.Target;
      try {
        var bounds = current.Bounds;
        if (target != current || GetParent(current.Wallpaper) != current.Parent ||
            WindowFromPhysicalPoint(down.Point) != down.Window || WindowFromPhysicalPoint(click.Up) != down.Window) continue;
        if (down.Window == current.List && (!BlankDesktopList(down.Window, down.Point) ||
            !BlankDesktopList(down.Window, click.Up))) continue;
        if (target != current || unchecked(Environment.TickCount - click.Received) > 500) continue;
        Console.Out.WriteLine(string.Format(CultureInfo.InvariantCulture,
          "{{\"type\":\"pose-click\",\"revision\":{0},\"down\":[{1},{2}],\"up\":[{3},{4}]}}", current.Revision,
          (down.Point.X - bounds.Left) / (double)(bounds.Right - bounds.Left),
          (down.Point.Y - bounds.Top) / (double)(bounds.Bottom - bounds.Top),
          (click.Up.X - bounds.Left) / (double)(bounds.Right - bounds.Left),
          (click.Up.Y - bounds.Top) / (double)(bounds.Bottom - bounds.Top)));
      } catch (Exception) { /* Ignore uncertain desktop hits. The Windows input was already passed through. */ }
    }
  }

  static bool BlankDesktopList(IntPtr expected, Point point) {
    IAccessible element;
    object child;
    if (AccessibleObjectFromPoint(point, out element, out child) != 0 || element == null) return false;
    try {
      IntPtr owner;
      return Equals(child, ChildSelf) && Equals(element.get_accRole(child), ListRole) &&
        WindowFromAccessibleObject(element, out owner) == 0 && owner == expected;
    } finally {
      Marshal.ReleaseComObject(element);
    }
  }

  public void Dispose() {
    closing = true;
    target = null;
    if (hookThreadId != 0) PostThreadMessage(hookThreadId, Quit, IntPtr.Zero, IntPtr.Zero);
    pending.CompleteAdding();
    hookThread.Join(500);
  }
}
