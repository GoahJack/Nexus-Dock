using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Nexus Dock 启动器（控制台子系统，避免 WinForms 初始化问题）
// 以 --no-sandbox 启动同目录 NexusDockApp.exe，并把过程写入 launcher.log。
internal static class Launcher
{
    private static void Main(string[] args)
    {
        string dir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
        string logPath = Path.Combine(dir, "launcher.log");
        var sb = new StringBuilder();
        sb.AppendLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] launcher start dir=" + dir);
        try
        {
            string app = Path.Combine(dir, "NexusDockApp.exe");
            sb.AppendLine("app=" + app + " exists=" + File.Exists(app));
            if (!File.Exists(app))
            {
                sb.AppendLine("ERROR: missing app exe");
                File.AppendAllText(logPath, sb.ToString(), Encoding.UTF8);
                return;
            }
            var psi = new ProcessStartInfo(app)
            {
                WorkingDirectory = dir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.Arguments = "--no-sandbox";
            foreach (string arg in args) { psi.Arguments += " " + arg; }
            sb.AppendLine("starting: " + psi.Arguments);
            Process p = Process.Start(psi);
            sb.AppendLine("pid=" + (p == null ? "null" : p.Id.ToString()));
        }
        catch (Exception ex)
        {
            sb.AppendLine("EXCEPTION: " + ex);
        }
        finally
        {
            try { File.AppendAllText(logPath, sb.ToString(), Encoding.UTF8); } catch { }
        }
    }
}
