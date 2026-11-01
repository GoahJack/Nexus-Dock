using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

// 读取指定进程令牌的完整性级别（RID）
internal static class IlProbe
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr h);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int ret);

    private static string RidToName(int rid)
    {
        if (rid >= 0x4000) return "System";
        if (rid >= 0x3000) return "High";
        if (rid >= 0x2000) return "Medium";
        if (rid >= 0x1000) return "Low";
        return "Untrusted";
    }

    private static void Main(string[] args)
    {
        int pid;
        if (args.Length > 0 && int.TryParse(args[0], out pid)) { }
        else pid = Process.GetCurrentProcess().Id;

        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero)
        {
            Console.WriteLine("{\"pid\":" + pid + ",\"error\":\"OpenProcess " + Marshal.GetLastWin32Error() + "\"}");
            return;
        }
        try
        {
            IntPtr token;
            if (!OpenProcessToken(h, 0x0008, out token))
            {
                Console.WriteLine("{\"pid\":" + pid + ",\"error\":\"OpenProcessToken " + Marshal.GetLastWin32Error() + "\"}");
                return;
            }
            try
            {
                IntPtr buf = Marshal.AllocHGlobal(128);
                try
                {
                    int ret;
                    if (!GetTokenInformation(token, 25, buf, 128, out ret))
                    {
                        Console.WriteLine("{\"pid\":" + pid + ",\"error\":\"GetTokenInformation " + Marshal.GetLastWin32Error() + "\"}");
                        return;
                    }
                    IntPtr sid = Marshal.ReadIntPtr(buf, 0);
                    byte subCount = Marshal.ReadByte(sid, 1);
                    int rid = Marshal.ReadInt32(sid, 8 + (subCount - 1) * 4);
                    string name = "";
                    try { name = Process.GetProcessById(pid).ProcessName; } catch { name = "?"; }
                    Console.WriteLine("{\"pid\":" + pid + ",\"proc\":\"" + name + "\",\"rid\":" + rid + ",\"il\":\"" + RidToName(rid) + "\"}");
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(h); }
    }
}
