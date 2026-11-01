param(
  [string]$Exe = 'E:\AI WorkRegion\app_creator\dist\NexusDock-portable\NexusDockApp.exe',
  [int]$DebugPort = 9230,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Continue'
$outDir = 'E:\AI WorkRegion\app_creator\scripts\out'
$userData = Join-Path $env:APPDATA 'nexus-dock'
$launchLog = Join-Path $userData 'logs\launch.log'

Write-Host "=== integrity of this shell (should be Medium) ==="
whoami /groups | Select-String 'Mandatory Label'

Write-Host "=== stop existing NexusDockApp ==="
Get-Process NexusDockApp -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host "stopped pid=$($_.Id)" } catch { Write-Host "stop failed pid=$($_.Id): $_" }
}
Start-Sleep -Seconds 2

if (Test-Path $launchLog) {
  $marker = "[$(Get-Date -Format o)] ===== MEDIUM TEST START =====".Replace('T', ' ').Replace('Z', '')
  Add-Content -Path $launchLog -Value $marker -Encoding UTF8
}

Write-Host "=== start app with debug port $DebugPort ==="
$wd = Split-Path -Parent $Exe
Start-Process -FilePath $Exe -ArgumentList @('--no-sandbox', "--remote-debugging-port=$DebugPort") -WorkingDirectory $wd
Start-Sleep -Seconds 10

Write-Host "=== processes ==="
Get-Process NexusDockApp -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle, StartTime | Format-Table -AutoSize

Write-Host "=== CDP targets ==="
try {
  $json = (Invoke-WebRequest -Uri "http://127.0.0.1:$DebugPort/json" -UseBasicParsing -TimeoutSec 5).Content
  $json | Out-File -FilePath (Join-Path $outDir 'medium-cdp-targets.json') -Encoding UTF8
  Write-Host $json
} catch {
  Write-Host "CDP not reachable: $_"
}

Write-Host "=== launch.log tail ==="
if (Test-Path $launchLog) { Get-Content $launchLog -Encoding UTF8 -Tail 20 }

if (-not $KeepRunning) {
  Write-Host "=== stop app ==="
  Get-Process NexusDockApp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
