$ErrorActionPreference = 'Stop'
$root = 'E:\AI WorkRegion\app_creator'
$outDir = "$root\scripts\out"
$testDir = "$outDir\broker-test"
$brokerExe = "$root\resources\nexus-broker.exe"
$probe = "$outDir\win-probe.exe"

Get-Process nexus-broker -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process NexusDockApp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $testDir -Force | Out-Null

$p = Start-Process -FilePath $brokerExe -ArgumentList ("--port 0 --user-data `"$testDir`" --log `"$testDir\broker.log`"") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
"broker pid=$($p.Id) exited=$($p.HasExited)"
$info = Get-Content "$testDir\broker.json" -Raw | ConvertFrom-Json
"broker.json: $($info | ConvertTo-Json -Compress)"
$port = [int]$info.port

function Send-Broker([string]$line) {
  $client = New-Object System.Net.Sockets.TcpClient
  $client.Connect('127.0.0.1', $port)
  $stream = $client.GetStream()
  $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
  $writer.AutoFlush = $true
  $reader = New-Object System.IO.StreamReader($stream)
  $writer.WriteLine($line)
  $resp = $reader.ReadLine()
  $client.Close()
  return $resp
}
function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
function UnB64([string]$s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

"PING -> $(Send-Broker 'PING')"
$procsResp = Send-Broker 'PROCS'
"PROCS -> $($procsResp.Substring(0, [Math]::Min(40, $procsResp.Length)))... (len=$($procsResp.Length))"
if ($procsResp.StartsWith('OK:')) { $names = UnB64 $procsResp.Substring(3); "process count: $(($names -split "`n").Count)"; ($names -split "`n") | Where-Object { $_ -match 'calc|notepad|explorer|cmd|edge|weixin' } | Select-Object -First 8 }

"--- LAUNCH calc ---"
$r = Send-Broker ("LAUNCH " + (B64 'shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'))
"LAUNCH -> $r"
Start-Sleep -Seconds 3
"calc proc: $(Get-Process CalculatorApp -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)"
"--- FOCUS calc ---"
$f = Send-Broker ("FOCUS " + (B64 'CalculatorApp,ApplicationFrameHost') + " " + (B64 '璁＄畻鍣▅Calculator') + " 3000")
"FOCUS -> $f"
Start-Sleep -Milliseconds 500
"FG after focus: $(& $probe FG)"

"--- LAUNCH cmd ---"
$r2 = Send-Broker ("LAUNCH " + (B64 'C:\Windows\System32\cmd.exe'))
"LAUNCH -> $r2"
Start-Sleep -Seconds 2
$c = Send-Broker ("FOCUS " + (B64 'cmd') + " " + (B64 '') + " 2500")
"FOCUS -> $c"
Start-Sleep -Milliseconds 400
"FG after focus cmd: $(& $probe FG)"

"--- CLOSEDIALOGS ---"
"CLOSEDIALOGS -> $(Send-Broker 'CLOSEDIALOGS')"
"--- SHUTDOWN ---"
try { "SHUTDOWN -> $(Send-Broker 'SHUTDOWN')" } catch { "shutdown connection closed" }
Start-Sleep -Seconds 1
"broker proc after shutdown: $(Get-Process nexus-broker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)"
"--- broker.log ---"
Get-Content "$testDir\broker.log" -Encoding UTF8 -ErrorAction SilentlyContinue

