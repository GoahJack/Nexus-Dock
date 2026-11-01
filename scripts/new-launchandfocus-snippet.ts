function launchAndFocus(
  kind: 'appid' | 'path' | 'verify',
  target: string,
  hint: string,
  procName = ''
): Promise<{ found: boolean; title: string; activated: boolean; pid: number; output: string }> {
  const escape = (value: string): string => value.replace(/'/g, "''")
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NexusFg2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
} catch { }

function Get-Wins {
  $list = @()
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $all) {
      try {
        $name = [string]$w.Current.Name
        if (-not $name) { continue }
        $pwid = [int]$w.Current.ProcessId
        $pname = ''
        try { $pname = [string](Get-Process -Id $pwid -ErrorAction SilentlyContinue).ProcessName } catch { }
        $list += [pscustomobject]@{ Pid = $pwid; Name = $name; Hwnd = [int64]$w.Current.NativeWindowHandle; Proc = $pname }
      } catch { }
    }
  } catch { }
  return $list
}

$selfTitles = 'NexusDockApp|Nexus Dock|Nexus Music|Nexus 设置'
$badTitles = 'Application Error|应用程序无法正常启动|0xc0000142'

function Test-TargetWindow($w, $hint, $procName) {
  if ($w.Name -match $badTitles) { return $false }
  if ($w.Name -match $selfTitles) { return $false }
  if ($procName -and $w.Proc -and ($w.Proc -ieq $procName)) { return $true }
  if ($hint -and ($w.Name -match $hint)) { return $true }
  return $false
}

function Test-Foreground($w) {
  try {
    $fg = [NexusFg2]::GetForegroundWindow()
    if ([int64]$fg -eq [int64]$w.Hwnd) { return $true }
    $fgPid = [uint32]0
    [void][NexusFg2]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    if ([int]$fgPid -eq [int]$w.Pid) { return $true }
  } catch { }
  return $false
}

function Activate-Win($w) {
  for ($i = 0; $i -lt 3; $i++) {
    try {
      [void][NexusFg2]::AllowSetForegroundWindow($w.Pid)
      [void][NexusFg2]::ShowWindow([IntPtr]$w.Hwnd, 9)
      [void][NexusFg2]::BringWindowToTop([IntPtr]$w.Hwnd)
      [void][NexusFg2]::SetForegroundWindow([IntPtr]$w.Hwnd)
      Start-Sleep -Milliseconds 140
      if (Test-Foreground $w) { return $true }

      [NexusFg2]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [NexusFg2]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 90
      [void][NexusFg2]::SetForegroundWindow([IntPtr]$w.Hwnd)
      Start-Sleep -Milliseconds 140
      if (Test-Foreground $w) { return $true }

      try { [Microsoft.VisualBasic.Interaction]::AppActivate($w.Pid) } catch { }
      Start-Sleep -Milliseconds 160
      if (Test-Foreground $w) { return $true }

      [void][NexusFg2]::SwitchToThisWindow([IntPtr]$w.Hwnd, $true)
      Start-Sleep -Milliseconds 160
      if (Test-Foreground $w) { return $true }
    } catch { }
  }
  return $false
}

$kind = '${kind}'
$target = '${escape(target)}'
$hint = '${escape(hint)}'
$procName = '${escape(procName)}'

# 1) 已有窗口（含最小化）：先激活，避免启动第二个实例
$before = Get-Wins
$beforeKeys = @($before | ForEach-Object { "$($_.Pid)|$($_.Name)" })
foreach ($w in $before) {
  if (Test-TargetWindow $w $hint $procName) {
    $fgOk = Activate-Win $w
    [Console]::Out.Write('FOUND:' + $w.Name + '|fg=' + [int]$fgOk + '|pid=' + $w.Pid)
    exit 0
  }
}

# 2) 启动
if ($kind -eq 'appid' -or $kind -eq 'path') {
  try {
    $shell = New-Object -ComObject Shell.Application
    if ($kind -eq 'appid') {
      $shell.ShellExecute('shell:AppsFolder\' + $target)
    } else {
      $shell.ShellExecute($target)
    }
  } catch { }
}

# 3) 等待窗口出现（最多约 6 秒）
$found = $null
for ($i = 0; $i -lt 18; $i++) {
  Start-Sleep -Milliseconds 350
  $wins = Get-Wins
  foreach ($w in $wins) {
    if (Test-TargetWindow $w $hint $procName) { $found = $w; break }
  }
  if ($null -ne $found) { break }
}

if ($null -eq $found) {
  [Console]::Out.Write('NONE')
} else {
  $fgOk = Activate-Win $found
  [Console]::Out.Write('FOUND:' + $found.Name + '|fg=' + [int]$fgOk + '|pid=' + $found.Pid)
}
`
  return runPowerShell(script, 16000)
    .then((output) => {
      const match = /FOUND:([\s\S]*?)\|fg=([01])\|pid=(\d+)/i.exec(output)
      return {
        found: !!match,
        title: match ? match[1].trim() : '',
        activated: match ? match[2] === '1' : false,
        pid: match ? Number(match[3]) : 0,
        output
      }
    })
    .catch((error: unknown) => ({
      found: false,
      title: '',
      activated: false,
      pid: 0,
      output: String(error)
    }))
}

