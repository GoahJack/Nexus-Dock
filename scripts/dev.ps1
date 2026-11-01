# 开发模式启动脚本（Windows）
#
# 处理两个宿主环境问题：
# 1) 某些宿主（例如 DSH 本身是 Electron 应用）会注入 ELECTRON_RUN_AS_NODE=1，
#    此时 electron.exe 会以 Node 模式运行、拿不到 app/protocol，启动即崩溃 → 先清掉。
# 2) 沙箱受限环境（AppContainer / 低完整性令牌 / 无窗口站权限）下 Chromium 沙箱初始化失败，
#    应用会「静默退出」（连主进程 JS 都不执行）→ 开发态加 --no-sandbox。
#    普通桌面环境不需要，脚本里加了说明，可按需去掉。
$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[dev] ELECTRON_RUN_AS_NODE cleared"
Write-Host "[dev] starting electron-vite dev --watch (--noSandbox --remoteDebuggingPort 9224) ..."

& electron-vite dev --watch --noSandbox --remoteDebuggingPort 9224
exit $LASTEXITCODE
