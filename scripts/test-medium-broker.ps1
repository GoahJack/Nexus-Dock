$ErrorActionPreference = 'Continue'
$root = 'E:\AI WorkRegion\app_creator'
$outDir = "$root\scripts\out"
$tempDir = "$env:LOCALAPPDATA\Temp\nexus-medium-test"
$log = "$outDir\medium-broker-test.log"
Remove-Item $log -ErrorAction SilentlyContinue
Start-Transcript -Path $log -Force | Out-Null
try {
  Get-Process nexus-broker,broker-copy,CalculatorApp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  Copy-Item "$root\resources\nexus-broker.exe" "$tempDir\broker-copy.exe" -Force
  $probe = "$outDir\il-probe.exe"
  $p = Start-Process -FilePath "$tempDir\broker-copy.exe" -ArgumentList ('--port 0 --user-data "' + $tempDir + '\data" --log "' + $tempDir + '\data\broker.log"') -PassThru -WindowStyle Hidden -RedirectStandardOutput "$tempDir\o.log" -RedirectStandardError "$tempDir\e.log"
  Start-Sleep -Seconds 2
  "broker pid=$($p.Id) IL=$(& $probe $p.Id)"
  $info = Get-Content "$tempDir\data\broker.json" -Raw | ConvertFrom-Json
  function SendB([string]$line) {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', [int]$info.port)
    $s = $c.GetStream()
    $w = New-Object System.IO.StreamWriter($s, (New-Object System.Text.UTF8Encoding($false))); $w.AutoFlush = $true
    $r = New-Object System.IO.StreamReader($s)
    $w.WriteLine($line)
    $resp = $r.ReadLine()
    $c.Close()
    return $resp
  }
  function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
  $launch = SendB ('LAUNCH ' + (B64 'shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'))
  "LAUNCH calc -> $launch"
  Start-Sleep -Seconds 5
  "CalculatorApp procs: $((Get-Process CalculatorApp -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ',')"
  "ApplicationFrameHost procs: $((Get-Process ApplicationFrameHost -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ',')"
  $focus = SendB ('FOCUS ' + (B64 'CalculatorApp,ApplicationFrameHost') + ' ' + (B64 '计算器|Calculator') + ' 3000')
  "FOCUS calc -> $focus"
  Start-Sleep -Milliseconds 600
  "FG -> $(& "$outDir\win-probe.exe" FG)"
  # 启动记事本（UWP）对照
  $launch2 = SendB ('LAUNCH ' + (B64 'shell:AppsFolder\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'))
  "LAUNCH notepad -> $launch2"
  Start-Sleep -Seconds 5
  "Notepad procs: $((Get-Process Notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ',')"
  # ms-settings
  $launch3 = SendB ('LAUNCH ' + (B64 'ms-settings:'))
  "LAUNCH ms-settings -> $launch3"
  Start-Sleep -Seconds 4
  "SystemSettings procs: $((Get-Process SystemSettings -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ',')"
  try { SendB 'SHUTDOWN' | Out-Null } catch {}
  "--- broker.log ---"
  Get-Content "$tempDir\data\broker.log" -Encoding UTF8 -ErrorAction SilentlyContinue
} finally {
  Stop-Transcript | Out-Null
}
