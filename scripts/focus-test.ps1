$ErrorActionPreference = 'Continue'
$probe = 'E:\AI WorkRegion\app_creator\scripts\out\win-probe.exe'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NxFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
}
"@

function Get-FgInfo {
  $out = & $probe FG | ConvertFrom-Json
  return "pid=$($out.pid) proc=$($out.proc) title=$($out.title)"
}

$wins = & $probe WINS | ConvertFrom-Json
$target = $wins | Where-Object { $_.title -match 'Microsoft.*Edge' } | Select-Object -First 1
if (-not $target) { Write-Host 'NO EDGE WINDOW; available:'; $wins | Select-Object pid,proc,title | Format-Table -AutoSize; exit 1 }
Write-Host "TARGET pid=$($target.pid) title=$($target.title) min=$($target.min) hwnd=$($target.hwnd)"
Write-Host "BEFORE fg: $(Get-FgInfo)"

$hwnd = [IntPtr]$target.hwnd
$fgHwnd = [NxFocus]::GetForegroundWindow()
$fgPid = [uint32]0
$fgThread = [NxFocus]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid)
$myThread = [NxFocus]::GetCurrentThreadId()
Write-Host "foreground thread=$fgThread my thread=$myThread"

# 方法1：AttachThreadInput + ShowWindow(RESTORE) + SetForegroundWindow
$attached = [NxFocus]::AttachThreadInput($myThread, $fgThread, $true)
Write-Host "AttachThreadInput=$attached"
[NxFocus]::ShowWindow($hwnd, 9) | Out-Null
[NxFocus]::BringWindowToTop($hwnd) | Out-Null
$r1 = [NxFocus]::SetForegroundWindow($hwnd)
[NxFocus]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
Start-Sleep -Milliseconds 400
Write-Host "SetForegroundWindow=$r1 ; AFTER1 fg: $(Get-FgInfo)"

# 方法2：最小化后再恢复
if ($fgHwnd -ne $hwnd) {
  [NxFocus]::ShowWindow($hwnd, 6) | Out-Null
  Start-Sleep -Milliseconds 250
  [NxFocus]::ShowWindow($hwnd, 9) | Out-Null
  Start-Sleep -Milliseconds 400
  Write-Host "AFTER2 fg: $(Get-FgInfo)"
}

# 方法3：ALT 键 + SetForegroundWindow
if ([NxFocus]::GetForegroundWindow() -ne $hwnd) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  try { [Microsoft.VisualBasic.Interaction]::AppActivate($target.pid) } catch { Write-Host "AppActivate ERR: $_" }
  Start-Sleep -Milliseconds 500
  Write-Host "AFTER3 fg: $(Get-FgInfo)"
}

if ([NxFocus]::GetForegroundWindow() -eq $hwnd) { Write-Host 'FOCUS_OK' } else { Write-Host 'FOCUS_FAILED' }
