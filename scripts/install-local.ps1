# Launch the same per-user NSIS installer used by automatic updates.
# The installer owns file replacement, shortcuts and uninstall registration.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$installer = Join-Path $root "dist\NexusDock-$($package.version)-setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Installer not found: $installer. Run 'npm run dist:installer' first."
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Write-Host "[install] Opening the Nexus Dock $($package.version) setup wizard."
Write-Host '[install] Exit a running portable/legacy instance before completing setup.'
# This is an interactive wizard the user needs to see; do not hide its window.
$process = Start-Process -FilePath $installer -WorkingDirectory $root -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Setup did not complete (exit $($process.ExitCode))."
}
Write-Host '[install] Setup completed. User settings and word bank are retained.'
