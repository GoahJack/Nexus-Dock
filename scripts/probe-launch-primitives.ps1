$ErrorActionPreference = 'Continue'
$probe = 'E:\AI WorkRegion\app_creator\scripts\out\win-probe.exe'

function Snapshot($label) {
  Start-Sleep -Seconds 3
  $wins = & $probe WINS | ConvertFrom-Json
  $procs = Get-Process | Where-Object { $_.ProcessName -match 'CalculatorApp|Notepad|mspaint|PaintApp|SystemSettings|ApplicationFrameHost|cmd' } | Select-Object -ExpandProperty ProcessName -Unique
  $uwpWins = $wins | Where-Object { $_.title -match '计算器|记事本|画图|设置|Calculator|Notepad|Paint|Settings' } | Select-Object pid, title
  Write-Host "--- $label ---"
  Write-Host ("processes: " + ($procs -join ', '))
  Write-Host ("windows: " + (($uwpWins | ForEach-Object { "$($_.pid):$($_.title)" }) -join ' | '))
}

Write-Host '=== A: Start-Process shell:AppsFolder Calculator ==='
try { Start-Process -FilePath 'shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'; 'started ok' } catch { "ERR: $_" }
Snapshot 'A-calc'

Write-Host '=== B: explorer.exe shell:AppsFolder Notepad ==='
try { Start-Process -FilePath explorer.exe -ArgumentList 'shell:AppsFolder\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App'; 'started ok' } catch { "ERR: $_" }
Snapshot 'B-notepad'

Write-Host '=== C: COM Shell.Application ShellExecute Paint ==='
try { $sh = New-Object -ComObject Shell.Application; $sh.ShellExecute('shell:AppsFolder\Microsoft.Paint_8wekyb3d8bbwe!App'); 'called ok' } catch { "ERR: $_" }
Snapshot 'C-paint'

Write-Host '=== D: Start-Process ms-settings: ==='
try { Start-Process -FilePath 'ms-settings:'; 'started ok' } catch { "ERR: $_" }
Snapshot 'D-settings'

Write-Host '=== E: COM Shell.Application ShellExecute ms-settings: ==='
try { $sh2 = New-Object -ComObject Shell.Application; $sh2.ShellExecute('ms-settings:'); 'called ok' } catch { "ERR: $_" }
Snapshot 'E-settings-com'

Write-Host '=== F: explorer.exe C:\Users\Public ==='
try { Start-Process -FilePath explorer.exe -ArgumentList 'C:\Users\Public'; 'started ok' } catch { "ERR: $_" }
Snapshot 'F-explorer-public'

Write-Host '=== G: cmd.exe via Start-Process ==='
try { Start-Process -FilePath 'C:\Windows\System32\cmd.exe'; 'started ok' } catch { "ERR: $_" }
Snapshot 'G-cmd'
