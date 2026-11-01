using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// 启动原语对照测试：UWP 的 IApplicationActivationManager / ShellExecute / explorer 代理
internal static class LaunchTest
{
    [ComImport]
    [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager
    {
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, int options, out uint processId);
        int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.IUnknown)] object itemArray,
            [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.IUnknown)] object itemArray, out uint processId);
    }

    [ComImport]
    [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    private class ApplicationActivationManager { }

    private static void Report(string label, Action action)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            action();
            Console.WriteLine(label + " => OK in " + sw.ElapsedMilliseconds + "ms");
        }
        catch (Exception ex)
        {
            Console.WriteLine(label + " => ERR(" + sw.ElapsedMilliseconds + "ms) " + ex.GetType().Name + ": " + ex.Message);
            if (ex.InnerException != null) Console.WriteLine("    inner: " + ex.InnerException.Message);
        }
    }

    private static void Main()
    {
        // A) IApplicationActivationManager 激活计算器
        Report("A ActivateApplication(calc)", delegate
        {
            var mgr = (IApplicationActivationManager)new ApplicationActivationManager();
            uint pid;
            int hr = mgr.ActivateApplication("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", null, 0, out pid);
            if (hr < 0) throw new COMException("ActivateApplication failed hr=0x" + hr.ToString("x8"), hr);
            Console.WriteLine("    calc pid=" + pid);
        });
        Thread.Sleep(2500);

        // B) ms-settings: 通过 UseShellExecute
        Report("B Process.Start(ms-settings:)", delegate
        {
            var psi = new ProcessStartInfo("ms-settings:") { UseShellExecute = true };
            Process.Start(psi);
        });
        Thread.Sleep(2500);

        // C) explorer 代理 shell:AppsFolder 记事本
        Report("C Process.Start(explorer.exe shell:AppsFolder notepad)", delegate
        {
            var psi = new ProcessStartInfo("explorer.exe") { UseShellExecute = true, Arguments = "shell:AppsFolder\\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" };
            Process.Start(psi);
        });
        Thread.Sleep(2500);

        // D) explorer 代理 ms-settings:
        Report("D Process.Start(explorer.exe ms-settings:)", delegate
        {
            var psi = new ProcessStartInfo("explorer.exe") { UseShellExecute = true, Arguments = "ms-settings:" };
            Process.Start(psi);
        });
        Thread.Sleep(2500);
    }
}
