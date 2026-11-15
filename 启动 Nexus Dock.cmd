@echo off
rem ============================================================
rem  Nexus Dock launcher (ASCII only: cmd.exe cannot parse UTF-8)
rem  Opens the current version's per-user NSIS setup wizard.
rem  Build it first with npm run dist:installer.
rem ============================================================
setlocal
cd /d "%~dp0"

rem Clear variables some host shells inject (Electron would run as plain Node)
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_ENABLE_LOGGING="

if not exist "%~dp0scripts\install-local.ps1" (
  echo [ERROR] scripts\install-local.ps1 not found.
  pause
  exit /b 1
)

echo [INFO] Opening Nexus Dock setup...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Nexus Dock setup did not complete.
  echo Tips:
  echo   1. Build the installer: npm run dist:installer
  echo   2. Exit the old portable app before installing.
  echo   3. Logs: %%APPDATA%%\nexus-dock\logs\
  pause
  exit /b 1
)

echo [OK] Nexus Dock setup completed.
exit /b 0
