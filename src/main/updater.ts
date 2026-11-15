import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/types'
import { RELEASES_URL, type UpdateMode } from '@shared/updates'
import { flushSettings, getSettings, subscribeSettings } from './settingsStore'
import { UpdateController } from './updateController'

/** 固定 GitHub 公共 Release 源由 electron-builder 写入 app-update.yml；客户端不接受 URL 或令牌。 */
export function setupUpdater(broadcast: (channel: string, payload: unknown) => void): () => void {
  const mode: UpdateMode = !app.isPackaged ? 'development'
    : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable'
    : process.platform !== 'win32' || !existsSync(join(process.resourcesPath, 'app-update.yml')) ? 'unsupported'
    : 'installer'
  // electron-updater 是 CommonJS：默认导入后解构，兼容 electron-vite 的主进程构建。
  const engine = mode === 'installer' ? electronUpdater.autoUpdater : null
  if (engine) {
    engine.autoDownload = false // 由控制器遵循用户开关 / 手动下载动作。
    engine.autoInstallOnAppQuit = false
    engine.autoRunAppAfterInstall = true
    engine.allowPrerelease = false
    engine.allowDowngrade = false
    engine.disableWebInstaller = true
  }
  const controller = new UpdateController({
    engine,
    mode,
    currentVersion: app.getVersion(),
    automatic: getSettings().system.autoUpdate,
    beforeInstall: flushSettings,
    onChanged: state => broadcast(IPC.updateChanged, state)
  })
  const unsubscribe = subscribeSettings(settings => controller.setAutomatic(settings.system.autoUpdate))
  ipcMain.handle(IPC.updateGet, () => controller.getState())
  ipcMain.handle(IPC.updateCheck, () => controller.check())
  ipcMain.handle(IPC.updateDownload, () => controller.download())
  ipcMain.handle(IPC.updateInstall, () => controller.install())
  ipcMain.handle(IPC.updateOpenReleases, () => shell.openExternal(RELEASES_URL))
  return () => {
    unsubscribe()
    controller.dispose()
    for (const channel of [IPC.updateGet, IPC.updateCheck, IPC.updateDownload, IPC.updateInstall, IPC.updateOpenReleases]) ipcMain.removeHandler(channel)
  }
}
