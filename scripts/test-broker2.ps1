$ErrorActionPreference = 'Continue'
$root = 'E:\AI WorkRegion\app_creator'
$outDir = "$root\scripts\out"
$testDir = "$outDir\broker-test4"
$log = "$outDir\broker-test4-result.log"
Get-Process nexus-broker,cmd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $testDir -Force | Out-Null
Remove-Item $log -ErrorAction SilentlyContinue
Start-Transcript -Path $log -Force | Out-Null
try {
  $argString = '--port 0 --user-data "' + $testDir + '" --log "' + $testDir + '\broker.log"'
  "argString=$argString"
  $p = Start-Process -FilePath "$root\resources\nexus-broker.exe" -ArgumentList $argString -PassThru -WindowStyle Hidden -RedirectStandardOutput "$testDir\broker.stdout.log" -RedirectStandardError "$testDir\broker.stderr.log"
  Start-Sleep -Seconds 2
  "broker pid=$($p.Id) exited=$($p.HasExited)"
  $jsonPath = "$testDir\broker.json"
  "json exists=$(Test-Path $jsonPath)"
  if (Test-Path $jsonPath) {
    $info = Get-Content $jsonPath -Raw | ConvertFrom-Json
    "port=$($info.port)"
    function SendB([string]$line) {
      $c = New-Object System.Net.Sockets.TcpClient
      $c.Connect('127.0.0.1', [int]$info.port)
      $s = $c.GetStream()
      $w = New-Object System.IO.StreamWriter($s, (New-Object System.Text.UTF8Encoding($false)))
      $w.AutoFlush = $true
      $r = New-Object System.IO.StreamReader($s)
      $w.WriteLine($line)
      $resp = $r.ReadLine()
      $c.Close()
      return $resp
    }
    function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
    function UnB64([string]$s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
    "PING -> $(SendB 'PING')"
    $il = SendB 'INTEGRITY'; "INTEGRITY -> $il $(if ($il.StartsWith('OK:')) { UnB64 $il.Substring(3) })"
    $procs = SendB 'PROCS'; if ($procs.StartsWith('OK:')) { "PROCS -> $((UnB64 $procs.Substring(3)).Split("`n").Count) names" }
    "LAUNCH cmd -> $(SendB ('LAUNCH ' + (B64 'C:\Windows\System32\cmd.exe')))"
    Start-Sleep -Seconds 2
    $f = SendB ('FOCUS ' + (B64 'cmd') + ' ' + (B64 '') + ' 2500'); "FOCUS cmd -> $f"
    if ($f.StartsWith('OK:')) { "focused title -> $(UnB64 $f.Substring(3))" }
    Start-Sleep -Milliseconds 400
    "FG -> $(& "$outDir\win-probe.exe" FG)"
    "CLOSEDIALOGS -> $(SendB 'CLOSEDIALOGS')"
    try { "SHUTDOWN -> $(SendB 'SHUTDOWN')" } catch { "shutdown ok" }
  }
  Start-Sleep -Milliseconds 800
  "broker alive after shutdown: $((Get-Process nexus-broker -ErrorAction SilentlyContinue).Count)"
  "--- broker log ---"
  Get-Content "$testDir\broker.log" -Encoding UTF8 -ErrorAction SilentlyContinue
} finally {
  Stop-Transcript | Out-Null
}
