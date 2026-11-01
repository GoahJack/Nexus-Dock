using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// Nexus Dock 校验辅助工具：读取前台窗口 / 顶层窗口 / 截屏
// 用法: win-probe.exe FG | WINS | SHOT <png路径>
internal static class WinProbe
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    private static string ProcName(uint pid)
    {
        try { return Process.GetProcessById((int)pid).ProcessName; }
        catch { return "?"; }
    }

    private static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    private static string WindowTitle(IntPtr hWnd)
    {
        int len = GetWindowTextLength(hWnd);
        if (len <= 0) return "";
        var sb = new StringBuilder(len + 2);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    private static string ForegroundJson()
    {
        IntPtr hWnd = GetForegroundWindow();
        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);
        return "{\"hwnd\":" + hWnd.ToInt64() + ",\"pid\":" + pid + ",\"proc\":\"" + Esc(ProcName(pid)) + "\",\"title\":\"" + Esc(WindowTitle(hWnd)) + "\"}";
    }

    private static string WindowsJson()
    {
        var items = new List<string>();
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            string title = WindowTitle(hWnd);
            if (title.Length == 0) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            RECT r;
            GetWindowRect(hWnd, out r);
            items.Add("{\"hwnd\":" + hWnd.ToInt64() + ",\"pid\":" + pid + ",\"proc\":\"" + Esc(ProcName(pid)) + "\",\"title\":\"" + Esc(title) + "\",\"min\":" + (IsIconic(hWnd) ? "true" : "false") + ",\"max\":" + (IsZoomed(hWnd) ? "true" : "false") + ",\"rect\":[" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "]}");
            return true;
        }, IntPtr.Zero);
        return "[" + string.Join(",", items.ToArray()) + "]";
    }

    private static void Screenshot(string path)
    {
        Rectangle bounds = SystemInformation.VirtualScreen;
        using (var bmp = new Bitmap(bounds.Width, bounds.Height))
        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
            bmp.Save(path, ImageFormat.Png);
        }
    }

    private static void Main(string[] args)
    {
        try
        {
            string cmd = args.Length > 0 ? args[0].ToUpperInvariant() : "FG";
            switch (cmd)
            {
                case "FG":
                    Console.WriteLine(ForegroundJson());
                    break;
                case "WINS":
                    Console.WriteLine(WindowsJson());
                    break;
                case "SHOT":
                    Screenshot(args.Length > 1 ? args[1] : "screenshot.png");
                    Console.WriteLine("{\"ok\":true}");
                    break;
                default:
                    Console.WriteLine("{\"error\":\"unknown command\"}");
                    break;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\":\"" + Esc(ex.Message) + "\"}");
        }
    }
}
