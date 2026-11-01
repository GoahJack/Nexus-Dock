# Nexus Dock 内存探针（v1.4 轻量化验收工具）
#
# 用途：以「安装版 + 指定启动参数/环境变量」启动应用，稳定后采集
#   1) Electron 进程级内存（应用内 app.getAppMetrics() 采样，权威归因）
#   2) 应用拉起的桥进程内存（desktop-state.exe / powershell），用「启动前后 PID 差集」归因，
#      避免把机器上其它 PowerShell 噪声算进本应用
#
# 前置：%APPDATA%\nexus-dock\mem-report.on 标记文件由本脚本自动创建；
#       应用必须经 explorer 转发启动（沙箱内直接 Start-Process 的 GUI 子进程会被回收）。
#
# 用法：
#   powershell -File scripts/mem-probe.ps1 -Label baseline
#   powershell -File scripts/mem-probe.ps1 -Label low-end -EnvPairs 'NEXUS_LOW_END=1'
param(
  [string]$Label = 'default',
  # 注意：不要命名为 $Args —— 它是 PowerShell 自动变量，传参会失效
  [string[]]$LaunchArgs = @(),
  [string[]]$EnvPairs = @(),
  [int]$WarmupSec = 18,
  [string]$OutFile = 'scripts/out/mem-probe.jsonl'
)

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'NexusDock'
$exe = Join-Path $dir 'NexusDockApp.exe'
$report = Join-Path $env:APPDATA 'nexus-dock\logs\memory.jsonl'
$marker = Join-Path $env:APPDATA 'nexus-dock\mem-report.on'

if (-not (Test-Path $exe)) { throw "installed exe not found: $exe" }
New-Item -ItemType File -Path $marker -Force | Out-Null

# 1) 停掉现有实例，等单实例锁释放
Get-Process NexusDockApp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process desktop-state -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Remove-Item $report -ErrorAction SilentlyContinue

# 2) 记录启动前的桥类进程 PID（用于差集归因）
$bridgeNames = @('desktop-state', 'powershell')
$before = @{}
foreach ($name in $bridgeNames) {
  foreach ($proc in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) { $before[$proc.Id] = $true }
}

# 3) 经 explorer 转发启动；需要环境变量时用 LOCALAPPDATA 下的 .cmd 包装（.lnk 无法带环境变量）
$launcher = Join-Path $dir 'nexus-probe.cmd'
$envLines = ($EnvPairs | ForEach-Object { "set `"$_`"" }) -join "`r`n"
$argText = ($LaunchArgs -join ' ')
@"
@echo off
cd /d "%~dp0"
$envLines
start "" "%~dp0NexusDockApp.exe" $argText
"@ | Set-Content -Path $launcher -Encoding ASCII

$startedAt = Get-Date
Start-Process -FilePath 'explorer.exe' -ArgumentList $launcher
Start-Sleep -Seconds $WarmupSec

# 4) 采集
$dockProcs = @(Get-Process NexusDockApp -ErrorAction SilentlyContinue)
if ($dockProcs.Count -eq 0) { throw "app did not start (label=$Label)" }

$sample = $null
if (Test-Path $report) {
  $sample = Get-Content $report | Select-Object -Last 1 | ConvertFrom-Json
}

# 只统计「启动前不存在」的桥进程
$bridge = @()
foreach ($name in $bridgeNames) {
  foreach ($proc in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
    if (-not $before.ContainsKey($proc.Id)) {
      $bridge += [pscustomobject]@{ name = $proc.ProcessName; pid = $proc.Id; wsMB = [math]::Round($proc.WorkingSet64 / 1MB, 1) }
    }
  }
}
$bridgeWS = ($bridge | Measure-Object wsMB -Sum).Sum
if ($null -eq $bridgeWS) { $bridgeWS = 0 }

$result = [ordered]@{
  label                = $Label
  args                 = ($LaunchArgs -join ' ')
  env                  = ($EnvPairs -join ' ')
  at                   = (Get-Date -Format 'o')
  electronProcessCount = $dockProcs.Count
  electronWorkingSetMB = [math]::Round(($dockProcs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1)
  bridgeProcesses      = $bridge
  bridgeWorkingSetMB   = [math]::Round($bridgeWS, 1)
  totalWorkingSetMB    = [math]::Round((($dockProcs | Measure-Object WorkingSet64 -Sum).Sum / 1MB) + $bridgeWS, 1)
  processes            = if ($sample) { $sample.processes } else { @() }
  windows              = if ($sample) { $sample.windows } else { @() }
}

$json = $result | ConvertTo-Json -Depth 6 -Compress
Add-Content -Path $OutFile -Value $json -Encoding UTF8

Write-Host "=== $Label ==="
Write-Host ("electron : {0} procs, {1} MB WS" -f $result.electronProcessCount, $result.electronWorkingSetMB)
Write-Host ("bridges  : {0} procs, {1} MB WS  [{2}]" -f $bridge.Count, $result.bridgeWorkingSetMB, (($bridge | ForEach-Object { "$($_.name)#$($_.pid)=$($_.wsMB)MB" }) -join ', '))
Write-Host ("TOTAL    : {0} MB WS" -f $result.totalWorkingSetMB)
if ($sample) {
  $sample.processes |
    Sort-Object workingSetKB -Descending |
    ForEach-Object {
      [pscustomobject]@{
        type    = $_.type
        service = $_.serviceName
        WS_MB   = [math]::Round($_.workingSetKB / 1024, 1)
        Private = [math]::Round($_.privateKB / 1024, 1)
      }
    } | Format-Table -AutoSize | Out-String | Write-Host
}
