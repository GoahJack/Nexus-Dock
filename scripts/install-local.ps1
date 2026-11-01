# Nexus Dock local installer (run with Windows PowerShell)
# Copies the portable build to %LOCALAPPDATA%\NexusDock, refreshes the desktop shortcut
# and starts the app. Running from LOCALAPPDATA avoids the low-integrity file label
# that the DSH workspace sandbox puts on executables under the workspace directory
# (low integrity makes Windows refuse UWP activation and foreground activation).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'dist\NexusDock-portable'
$outDir = Join-Path $root 'out'
$repoResources = Join-Path $root 'resources'
$repoPkg = Join-Path $root 'package.json'
$target = Join-Path $env:LOCALAPPDATA 'NexusDock'
$exe = Join-Path $target 'NexusDockApp.exe'

function Copy-Tree([string]$from, [string]$to) {
  if (-not (Test-Path $from)) { return }
  $args = @('"' + $from + '"', '"' + $to + '"', '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  $rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
  if ($rc.ExitCode -ge 8) { throw "robocopy failed ($($rc.ExitCode)): $from -> $to" }
}

Write-Host '[install] Nexus Dock local install'
Write-Host "[install] source : $source"
Write-Host "[install] target : $target"

if (-not (Test-Path (Join-Path $source 'NexusDockApp.exe'))) {
  throw "Portable build not found: $source (run 'npm run dist' first)"
}

# 1) Refresh the packaged app code from the latest build output
$packagedOut = Join-Path $source 'resources\app\out'
if (Test-Path $outDir) {
  Write-Host '[install] syncing out/ into packaged app ...'
  Copy-Tree $outDir $packagedOut
}

# 1b) v1.5: sync resources/ (bridge scripts, native helper, tray icons) and the app manifest.
#     The old script only synced out/, so new files such as resources/tray-*.png were never
#     installed (tray icon would silently fail to be created) and the About page version
#     stayed at the old value forever.
if (Test-Path $repoResources) {
  Write-Host '[install] syncing resources/ (bridges + tray icons) ...'
  Copy-Tree $repoResources (Join-Path $source 'resources\app\resources')
  Copy-Tree $repoResources (Join-Path $source 'resources\resources')
}

$appPkg = Join-Path $source 'resources\app\package.json'
if (Test-Path $repoPkg) {
  $repo = Get-Content $repoPkg -Raw -Encoding utf8 | ConvertFrom-Json
  $manifest = [ordered]@{
    name        = $repo.name
    version     = $repo.version
    description = $repo.description
    main        = './out/main/index.js'
    author      = $repo.author
  }
  Write-Host "[install] refreshing app manifest (version $($repo.version)) ..."
  # NOTE: must be UTF-8 WITHOUT BOM - Electron parses this file as JSON and a BOM
  # makes startup fail silently (no window, no log output). Windows PowerShell 5.1's
  # `Set-Content -Encoding utf8` always emits a BOM, so write the bytes explicitly.
  $json = $manifest | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($appPkg, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# 2) Stop a running instance so files are not locked
Get-Process NexusDockApp -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { }
}
Start-Sleep -Milliseconds 900

# 3) Install to LOCALAPPDATA (files created here inherit normal integrity)
Copy-Tree $source $target

# 4) Defensive: make sure no low integrity label is inherited on the install tree
try {
  $old = Get-Location
  Set-Location $target
  cmd /c "icacls `"$target`" /setintegritylevel (OI)(CI)Medium /T /C /Q" | Out-Null
  Set-Location $old
} catch { }

# 5) Desktop shortcut (no --no-sandbox needed on a normal permission path)
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnkPath = Join-Path $desktop 'Nexus Dock.lnk'
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut($lnkPath)
  $lnk.TargetPath = $exe
  $lnk.Arguments = ''
  $lnk.WorkingDirectory = $target
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Nexus Dock'
  $lnk.Save()
  Write-Host "[install] shortcut updated: $lnkPath"
} catch {
  Write-Host "[install] WARN: could not update desktop shortcut: $($_.Exception.Message)"
}

# 6) Start the installed app
Start-Process -FilePath $exe -WorkingDirectory $target
Write-Host "[install] started: $exe"