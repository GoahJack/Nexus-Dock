// Nexus Dock - 桌面状态检测助手（原生 .NET Framework，替代 desktop-state.ps1）
//
// 目的：旧实现用 Windows PowerShell 5.1 宿主 + UIAutomation 程序集，
//       每个常驻进程工作集约 100MB；本助手只用 P/Invoke 读取前台窗口状态，
//       常驻工作集约 5-10MB，且不依赖 UIAutomation（对管理员窗口/受限令牌更稳）。
//
// 编译：scripts/build-native.ps1（csc 4.8 / C# 5 语法，/target:winexe 无黑窗）
//
// 协议（与 desktop-state.ps1 完全一致，JSON Lines，stdout UTF-8 无 BOM，逐行 flush）：
//   {"type":"ready"}
//   {"type":"state","foregroundPid":1234,"maximized":false,"fullscreen":false,"desktop":true,"className":"Progman","minimized":false,"visible":true}
//   {"type":"error","message":"..."}
//
// 判定规则（保持 ps1 语义）：以当前前台窗口所在显示器为基准，
//   desktop    = 没有前台窗口 / 前台是桌面外壳窗口（Progman、WorkerW、SysListView32、SHELLDLL_DefView）；
//   minimized  = 前台窗口被最小化（v1.7：Windows「显示桌面」的核心特征）；
//   visible    = 前台窗口可见（v1.7：显示桌面也可能直接隐藏窗口）；
//                minimized / 不可见时 maximized / fullscreen 一律按 false 上报（它不占据桌面）；
//   fullscreen = 窗口矩形覆盖整个显示器（容差 4px）；desktop 优先，fullscreen 时不重复报 maximized；
//   maximized  = 未全屏且（IsZoomed 或窗口矩形覆盖工作区，容差 6px）。
// 只在状态变化时输出；默认 800ms 采样一次。
//
// 参数：
//   --interval=<ms>  采样间隔（100..5000，默认 800）
//   --once           输出 ready + 一次 state 后退出（自测/诊断用）
//   --watch-stdin    监听 stdin，读到 EOF（父进程退出）即自发退出，避免孤儿常驻进程。
//                    Electron 侧总是带该参数；手工从终端诊断时不带，避免被终端 stdin 干扰。
//
// 孤儿进程保护：带 --watch-stdin 时，stdin 被父进程关闭（EOF）即立即退出。

using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace NexusDock
{
    internal static class DesktopStateAssistant
    {
        private const int DefaultIntervalMs = 800;
        private const int MinIntervalMs = 100;
        private const int MaxIntervalMs = 5000;

        // 覆盖判定容差（与 ps1 版一致）
        private const int ScreenTolerance = 4;
        private const int WorkAreaTolerance = 6;

        private const int StdInputHandle = -10;

        /* ------------------------------ Win32 互操作 ------------------------------ */

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MonitorInfo
        {
            public int cbSize;
            public Rect rcMonitor;
            public Rect rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out Rect lpRect);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

        [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfo lpmi);

        [DllImport("user32.dll")]
        private static extern bool SystemParametersInfo(uint uiAction, uint uiParam, out Rect pvParam, uint fWinIni);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll")]
        private static extern bool ReadFile(
            IntPtr hFile,
            byte[] lpBuffer,
            uint nNumberOfBytesToRead,
            out uint lpNumberOfBytesRead,
            IntPtr lpOverlapped);

        private const uint MonitorDefaultToNearest = 2;
        private const uint SpiGetWorkArea = 0x0030;
        private const int SmCxScreen = 0;
        private const int SmCyScreen = 1;

        /* --------------------------------- 数据模型 -------------------------------- */

        private sealed class DesktopState
        {
            public int ForegroundPid;
            public bool Maximized;
            public bool Fullscreen;
            public bool Desktop;
            public string ClassName = string.Empty;
            // v1.7：Windows「显示桌面」会让前台窗口最小化/隐藏，但它仍可能被
            // GetForegroundWindow() 返回；消费者必须能区分「占据桌面的前台窗口」与
            // 「已被最小化/隐藏的前台窗口」，否则 Dock 的「仅在桌面显示」永远不恢复。
            public bool Minimized;
            public bool Visible = true;
        }

        /* --------------------------------- 状态采样 -------------------------------- */

        private static DesktopState Probe()
        {
            DesktopState state = new DesktopState();

            IntPtr foreground = GetForegroundWindow();
            if (foreground == IntPtr.Zero)
            {
                // 没有前台窗口（切换桌面、UAC 安全桌面等）：按桌面处理，三窗口恢复显示
                state.Desktop = true;
                return state;
            }

            uint processId;
            GetWindowThreadProcessId(foreground, out processId);
            state.ForegroundPid = unchecked((int)processId);

            StringBuilder className = new StringBuilder(256);
            int length = GetClassName(foreground, className, className.Capacity);
            state.ClassName = length > 0 ? className.ToString(0, length) : string.Empty;

            state.Desktop = IsDesktopWindow(state.ClassName) || processId == 0;
            if (state.Desktop) return state;

            // v1.7：显示桌面 / 最小化窗口 —— 前台窗口句柄可能仍是它，但它已经不占据桌面。
            // 先判可见/最小化，再判 maximized/fullscreen，避免把「被最小化的最大化窗口」
            // 误报成「最大化窗口还占着桌面」（Dock 因此永远不出现）。
            state.Visible = IsWindowVisible(foreground);
            state.Minimized = IsIconic(foreground);
            if (state.Minimized || !state.Visible)
            {
                state.Maximized = false;
                state.Fullscreen = false;
                return state;
            }

            Rect windowRect;
            if (!GetWindowRect(foreground, out windowRect)) return state;

            Rect monitorRect;
            Rect workRect;
            if (!TryGetMonitorMetrics(foreground, out monitorRect, out workRect)) return state;

            // IsZoomed 优先：任务栏自动隐藏时工作区 == 全屏矩形，只靠矩形比对会把
            // 「最大化」误报成「全屏」（旧 ps1 在本机就是如此）。两者对 Dock 的显隐
            // 影响相同（消费者只做 maximized||fullscreen），但分开报更便于诊断。
            bool zoomed = IsZoomed(foreground);
            bool coversMonitor = Covers(windowRect, monitorRect, ScreenTolerance);
            state.Fullscreen = coversMonitor && !zoomed;
            state.Maximized = zoomed || (!state.Fullscreen && Covers(windowRect, workRect, WorkAreaTolerance));
            return state;
        }

        /// <summary>桌面外壳窗口类名（与 ps1 版一致）</summary>
        private static bool IsDesktopWindow(string className)
        {
            if (string.IsNullOrEmpty(className)) return false;
            return className == "Progman"
                || className == "WorkerW"
                || className == "SysListView32"
                || className == "SHELLDLL_DefView";
        }

        /// <summary>窗口矩形是否覆盖目标矩形（容差内）</summary>
        private static bool Covers(Rect rect, Rect target, int tolerance)
        {
            return rect.Left <= target.Left + tolerance
                && rect.Top <= target.Top + tolerance
                && rect.Right >= target.Right - tolerance
                && rect.Bottom >= target.Bottom - tolerance;
        }

        /// <summary>
        /// 取前台窗口所在显示器的工作区/全屏矩形；MonitorFromWindow 失败时回退主屏
        /// （GetSystemMetrics + SystemParametersInfo(SPI_GETWORKAREA)）。
        /// </summary>
        private static bool TryGetMonitorMetrics(IntPtr hwnd, out Rect monitorRect, out Rect workRect)
        {
            monitorRect = new Rect();
            workRect = new Rect();

            IntPtr monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
            if (monitor != IntPtr.Zero)
            {
                MonitorInfo info = new MonitorInfo();
                info.cbSize = Marshal.SizeOf(typeof(MonitorInfo));
                if (GetMonitorInfo(monitor, ref info))
                {
                    monitorRect = info.rcMonitor;
                    workRect = info.rcWork;
                    return true;
                }
            }

            int width = GetSystemMetrics(SmCxScreen);
            int height = GetSystemMetrics(SmCyScreen);
            if (width <= 0 || height <= 0) return false;

            Rect primary = new Rect();
            primary.Left = 0;
            primary.Top = 0;
            primary.Right = width;
            primary.Bottom = height;
            monitorRect = primary;

            Rect workArea;
            if (SystemParametersInfo(SpiGetWorkArea, 0, out workArea, 0)) workRect = workArea;
            else workRect = primary;
            return true;
        }

        /* --------------------------------- JSON 输出 -------------------------------- */

        private static string ToJson(DesktopState state)
        {
            StringBuilder builder = new StringBuilder(192);
            builder.Append("{\"type\":\"state\",\"foregroundPid\":");
            builder.Append(state.ForegroundPid.ToString(CultureInfo.InvariantCulture));
            builder.Append(",\"maximized\":");
            builder.Append(state.Maximized ? "true" : "false");
            builder.Append(",\"fullscreen\":");
            builder.Append(state.Fullscreen ? "true" : "false");
            builder.Append(",\"desktop\":");
            builder.Append(state.Desktop ? "true" : "false");
            builder.Append(",\"className\":\"");
            builder.Append(Escape(state.ClassName));
            builder.Append("\",\"minimized\":");
            builder.Append(state.Minimized ? "true" : "false");
            builder.Append(",\"visible\":");
            builder.Append(state.Visible ? "true" : "false");
            builder.Append("}");
            return builder.ToString();
        }

        private static string ToErrorJson(string message)
        {
            return "{\"type\":\"error\",\"message\":\"" + Escape(message ?? string.Empty) + "\"}";
        }

        private static string Escape(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            StringBuilder builder = new StringBuilder(value.Length + 8);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\b': builder.Append("\\b"); break;
                    case '\f': builder.Append("\\f"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < ' ' || c == '\u007f')
                        {
                            builder.Append("\\u");
                            builder.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }
            return builder.ToString();
        }

        /// <summary>UTF-8 无 BOM 的 stdout 写入器；没有可用 stdout 时退化为 Null（仍保持孤儿保护）</summary>
        private static TextWriter OpenStandardOutput()
        {
            try
            {
                Stream stream = Console.OpenStandardOutput();
                if (stream == null) return TextWriter.Null;
                UTF8Encoding encoding = new UTF8Encoding(false);
                StreamWriter writer = new StreamWriter(stream, encoding);
                writer.AutoFlush = true;
                return writer;
            }
            catch (Exception)
            {
                return TextWriter.Null;
            }
        }

        private static bool WriteLine(TextWriter writer, string line)
        {
            try
            {
                writer.WriteLine(line);
                writer.Flush();
                return true;
            }
            catch (IOException)
            {
                // 父进程已关闭管道
                return false;
            }
            catch (ObjectDisposedException)
            {
                return false;
            }
        }

        /* ------------------------------- 孤儿进程保护 ------------------------------- */

        /// <summary>
        /// 后台线程读 stdin：父进程（Electron 主进程）退出或关闭管道时会读到 EOF，此时立即退出。
        /// stdin 句柄不可用 / 读取失败时只停止监控，不影响正常轮询。
        /// </summary>
        private static void StartStdinWatchdog()
        {
            try
            {
                IntPtr handle = GetStdHandle(StdInputHandle);
                if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;

                Thread thread = new Thread(delegate()
                {
                    try
                    {
                        byte[] buffer = new byte[256];
                        while (true)
                        {
                            uint read;
                            bool ok = ReadFile(handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
                            if (!ok) return;
                            if (read == 0)
                            {
                                // stdin 关闭：父进程已不在，退出避免常驻孤儿
                                Environment.Exit(0);
                            }
                        }
                    }
                    catch (Exception)
                    {
                        // 读不到 stdin 不致命
                    }
                });
                thread.IsBackground = true;
                thread.Start();
            }
            catch (Exception)
            {
                // 忽略：没装看门狗也能正常工作
            }
        }

        /* ----------------------------------- 主流程 ---------------------------------- */

        private static int Main(string[] args)
        {
            int interval = DefaultIntervalMs;
            bool once = false;
            bool watchStdin = false;

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string arg = args[i];
                    if (arg == null) continue;
                    if (arg.StartsWith("--interval=", StringComparison.OrdinalIgnoreCase))
                    {
                        int parsed = 0;
                        string raw = arg.Substring("--interval=".Length);
                        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed)
                            && parsed >= MinIntervalMs
                            && parsed <= MaxIntervalMs)
                        {
                            interval = parsed;
                        }
                    }
                    else if (string.Equals(arg, "--once", StringComparison.OrdinalIgnoreCase))
                    {
                        once = true;
                    }
                    else if (string.Equals(arg, "--watch-stdin", StringComparison.OrdinalIgnoreCase))
                    {
                        watchStdin = true;
                    }
                }
            }

            TextWriter writer = OpenStandardOutput();
            if (!WriteLine(writer, "{\"type\":\"ready\"}")) return 0;

            if (watchStdin) StartStdinWatchdog();

            string last = null;
            while (true)
            {
                string json = null;
                try
                {
                    json = ToJson(Probe());
                }
                catch (Exception error)
                {
                    if (!WriteLine(writer, ToErrorJson(error.Message)))
                    {
                        if (once) return 0;
                    }
                }

                if (json != null && json != last)
                {
                    last = json;
                    if (!WriteLine(writer, json)) return 0;
                }

                if (once) return 0;
                Thread.Sleep(interval);
            }
        }
    }
}
