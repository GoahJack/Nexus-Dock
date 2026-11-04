# Nexus Dock - 桌面状态检测桥（Windows PowerShell 5.1）
#
# 注意（v1.4 轻量化）：常驻首选同目录下的原生助手 desktop-state.exe（.NET Framework + P/Invoke，
# 实测常驻约 14MB）。本 ps1 仅作回退：exe 缺失或无法启动时才使用（UIAutomation + PowerShell
# 宿主，常驻约 100MB）。两者 JSON Lines 协议完全一致。
#
# 用途：判断当前前台窗口是否最大化/全屏，用于「Dock 只在桌面时显示」。
# 实现：UI Automation（只加载程序集、不编译 C#，兼容受限令牌环境）
#
# 协议：stdout 每行一个 JSON（UTF-8 无 BOM）
#   {"type":"ready"}
#   {"type":"state","foregroundPid":1234,"maximized":false,"fullscreen":false,"desktop":true,"className":"Progman"}
# 只在状态变化时输出；默认每 800ms 采样一次（-IntervalMs 可调），异常继续运行。

param(
  [int]$IntervalMs = 800
)
if ($IntervalMs -lt 100) { $IntervalMs = 800 }
if ($IntervalMs -gt 5000) { $IntervalMs = 5000 }

$ErrorActionPreference = 'Continue'

$script:utf8 = New-Object System.Text.UTF8Encoding($false)
$script:outWriter = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $script:utf8)
$script:outWriter.AutoFlush = $true

function Write-Event {
  param([System.Collections.IDictionary]$Payload)
  try {
    $script:outWriter.WriteLine(($Payload | ConvertTo-Json -Compress -Depth 4))
    $script:outWriter.Flush()
  } catch { }
}

Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName System.Windows.Forms | Out-Null

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$screenBounds = $screen.Bounds
$workArea = $screen.WorkingArea

function Test-Covers {
  param($Rect, $Target, [int]$Tolerance = 6)
  if ($null -eq $Rect -or $Rect.IsEmpty) { return $false }
  try {
    return ($Rect.Left -le ($Target.Left + $Tolerance)) -and
           ($Rect.Top -le ($Target.Top + $Tolerance)) -and
           ($Rect.Right -ge ($Target.Right - $Tolerance)) -and
           ($Rect.Bottom -ge ($Target.Bottom - $Tolerance))
  } catch {
    return $false
  }
}

function Get-ForegroundState {
  $focused = $null
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  } catch { }

  if ($null -eq $focused) {
    return @{
      foregroundPid = 0
      maximized     = $false
      fullscreen    = $false
      desktop       = $true
      className     = ''
      title         = ''
      minimized     = $false
      visible       = $true
    }
  }

  # 从焦点控件向上走到顶层窗口（焦点常在输入框等子控件上，rect 会很小）
  $top = $focused
  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    for ($i = 0; $i -lt 12; $i++) {
      $parent = $walker.GetParent($top)
      if ($null -eq $parent) { break }
      if ($parent -eq $root) { break }
      $top = $parent
    }
  } catch { }

  $procId = 0
  $className = ''
  $title = ''
  $rect = $null
  try {
    $procId = [int]$top.Current.ProcessId
    $className = [string]$top.Current.ClassName
    $title = [string]$top.Current.Name
    $rect = $top.Current.BoundingRectangle
  } catch { }

  $isDesktop = ($className -in @('Progman', 'WorkerW', 'SysListView32', 'SHELLDLL_DefView')) -or ($procId -eq 0)

  # v1.7：Windows「显示桌面」会让前台窗口最小化/隐藏，但 GetForegroundWindow（UIA 焦点）仍可能是它。
  # 这里补 minimized / visible 两个判定：最小化或不可见的前台窗口不占据桌面，maximized/fullscreen 一律 false，
  # 否则 Dock 的「仅在桌面显示」会一直认为有窗口最大化而保持隐藏（本机实测的 bug）。
  $minimized = $false
  $visible = $true
  try { $visible = -not [bool]$top.Current.IsOffscreen } catch { }
  try {
    $windowPattern = $top.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $minimized = $windowPattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized
  } catch { }

  if ($minimized -or (-not $visible) -or $isDesktop) {
    $fullscreen = $false
    $maximized = $false
  } else {
    $fullscreen = (Test-Covers $rect $screenBounds 4)
    $maximized = (Test-Covers $rect $workArea 6) -and (-not $fullscreen)
  }

  return @{
    foregroundPid = $procId
    maximized     = [bool]$maximized
    fullscreen    = [bool]$fullscreen
    desktop       = [bool]$isDesktop
    className     = $className
    title         = $title
    minimized     = [bool]$minimized
    visible       = [bool]$visible
  }
}

Write-Event ([ordered]@{ type = 'ready' })

$last = ''
while ($true) {
  try {
    $state = Get-ForegroundState
    $json = $state | ConvertTo-Json -Compress
    if ($json -ne $last) {
      $last = $json
      $payload = [ordered]@{ type = 'state' }
      foreach ($key in $state.Keys) { $payload[$key] = $state[$key] }
      Write-Event $payload
    }
  } catch {
    try { Write-Event ([ordered]@{ type = 'error'; message = [string]$_.Exception.Message }) } catch { }
  }
  Start-Sleep -Milliseconds $IntervalMs
}
