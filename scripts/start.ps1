# 启动已构建的应用（out/ 产物），用于验收与日常试用
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1 [-DebugPort 9222]
param(
  [int]$DebugPort = 0
)

$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $exe)) {
  throw "找不到 Electron 二进制，请先执行 npm install（必要时 node node_modules/electron/install.js）"
}

$argList = @('--no-sandbox')
if ($DebugPort -gt 0) { $argList += "--remote-debugging-port=$DebugPort" }
$argList += $root

Write-Host "[start] $exe $($argList -join ' ')"
$process = Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory $root -PassThru
Write-Host "[start] PID=$($process.Id)"
