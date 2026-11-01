@echo off
rem ============================================================
rem  Nexus Dock launcher (ASCII only: cmd.exe cannot parse UTF-8)
rem  Installs the portable build to %LOCALAPPDATA%\NexusDock and
rem  starts it there. Running from LOCALAPPDATA is required because
rem  executables inside the DSH workspace carry a Low integrity label,
rem  and Windows then refuses UWP app activation / foreground activation.
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

echo [INFO] Installing / refreshing Nexus Dock and starting it...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-local.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Nexus Dock failed to start.
  echo Tips:
  echo   1. Make sure the portable build exists: dist\NexusDock-portable
  echo   2. Rebuild with: npm run build
  echo   3. Logs: %%APPDATA%%\nexus-dock\logs\
  pause
  exit /b 1
)

echo [OK] Nexus Dock is running.
exit /b 0
