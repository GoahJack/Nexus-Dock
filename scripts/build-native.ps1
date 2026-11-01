# Nexus Dock - 原生助手编译脚本（.NET Framework csc，C# 5 语法）
#
# 目前编译 resources/desktop-state.cs → resources/desktop-state.exe，
# 用于替代常驻 PowerShell + UIAutomation 的桌面状态检测桥（desktop-state.ps1）。
# 产物随 package.json 的 extraResources（整目录 resources/）一起打包，无需改打包配置。
#
# 用法（仓库任意位置均可执行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1 -Source <cs> -Output <exe>
param(
  [string]$Source = '',
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $repoRoot 'resources\desktop-state.cs' }
if (-not $Output) { $Output = Join-Path $repoRoot 'resources\desktop-state.exe' }
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
if (-not (Test-Path $Source)) { throw "source not found: $Source" }
# /target:winexe：无控制台黑窗（stdout 仍可被 Electron 以管道方式读取）
& $csc /nologo /target:winexe /optimize+ /platform:anycpu /out:"$Output" "$Source"
if ($LASTEXITCODE -ne 0) { throw "csc failed: $LASTEXITCODE" }
Write-Host "built: $Output ($((Get-Item $Output).Length) bytes)"
