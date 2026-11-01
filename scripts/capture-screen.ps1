# 截取当前屏幕（用于验收截图）
# 用法： pwsh -NoProfile -File scripts/capture-screen.ps1 -Out docs\verification\dock.png
#        只截一块区域： -X 100 -Y 900 -W 800 -H 200
param(
  [string]$Out = "docs\verification\screen.png",
  [int]$X = -1,
  [int]$Y = -1,
  [int]$W = 0,
  [int]$H = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# 让进程 DPI 感知，否则 125%/150% 缩放下截取区域会错位
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
  [DpiHelper]::SetProcessDPIAware() | Out-Null
} catch { }

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($W -le 0) { $W = $screen.Width }
if ($H -le 0) { $H = $screen.Height }
if ($X -lt 0) { $X = $screen.X }
if ($Y -lt 0) { $Y = $screen.Y }

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Host "SAVED=$Out SIZE=${W}x${H} AT=$X,$Y"
