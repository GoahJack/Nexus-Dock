import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron'
import { basename, extname } from 'node:path'
import {
  DEFAULT_MEDIA_STATE,
  IPC,
  windowLockSummary,
  withAllWindowsLocked,
  type AppCustomPatch,
  type AutoStartResult,
  type DeepPartial,
  type DockItem,
  type LocalTrack,
  type MediaAction,
  type MediaState,
  type PickIconResult,
  type Point,
  type Settings,
  type Size,
  type WindowTarget
} from '@shared/types'
import {
  addStartMenuItem,
  launchApp,
  pickAppFiles,
  pickCustomIcon,
  removeApp,
  reorderApps,
  scanStartMenu,
  updateAppCustom
} from './apps'
import { applyAutoStart } from './autostart'
import { extraWindowMenuItems, setOwnContentSize } from './extraWindows'
import { allowMediaFile } from './protocol'
import { getSettings, resetSettings, updateSettings } from './settingsStore'
import type { MediaHub } from './media/mediaHub'
import {
  broadcast,
  consumePendingAppEditor,
  getDockWindow,
  getSettingsWindow,
  isDockVisible,
  openSettingsWindow,
  requestAppEditor,
  setContentSize,
  setDockVisible,
  snapDockToEdge
} from './windowManager'

let hub: MediaHub | null = null
let localState: MediaState = { ...DEFAULT_MEDIA_STATE, source: 'local' }

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus', 'wma']

function sanitizePoint(point: Point | undefined): Point {
  return {
    x: Number.isFinite(point?.x) ? Number(point?.x) : 0,
    y: Number.isFinite(point?.y) ? Number(point?.y) : 0
  }
}

function showDockMenu(window: BrowserWindow | null): void {
  // 每次打开菜单都实时读取设置，保证 checkbox 状态与实际配置一致
  const settings = getSettings()
  const locks = windowLockSummary(settings)
  const menu = Menu.buildFromTemplate([
    { label: 'Dock 设置…', click: () => openSettingsWindow() },
    {
      label: '显示音乐卡片',
      type: 'checkbox',
      checked: settings.music.visible,
      click: (item) => {
        updateSettings({ music: { visible: item.checked } })
      }
    },
    {
      label: '显示桌面时钟',
      type: 'checkbox',
      checked: settings.clock.visible,
      click: (item) => {
        updateSettings({ clock: { visible: item.checked } })
      }
    },
    // v1.7：附加窗口（注册表驱动，当前为空 → 不产生菜单项）
    ...extraWindowMenuItems(),
    {
      // 总开关语义：所有窗口（内置 + 附加）全部锁定时勾选；勾选/取消即同时设置
      label: `锁定全部窗口位置（${locks.locked}/${locks.total}）`,
      type: 'checkbox',
      checked: locks.allLocked,
      click: (item) => {
        updateSettings(withAllWindowsLocked(getSettings(), item.checked))
      }
    },
    { type: 'separator' },
    { label: '隐藏 Dock（托盘可恢复）', click: () => setDockVisible(false) },
    { label: '重载 Dock', click: () => getDockWindow()?.webContents.reload() },
    { label: '退出 Nexus Dock', click: () => app.quit() }
  ])
  menu.popup(window ? { window } : {})
}

function showItemMenu(window: BrowserWindow | null, id: string): void {
  const item = getSettings().apps.find((a) => a.id === id)
  if (!item) return
  const hasCustom = !!(item.customName || item.customIcon)
  const menu = Menu.buildFromTemplate([
    {
      label: '打开',
      click: () => {
        void launchApp(id)
      }
    },
    {
      // v1.6：自定义显示名称与图标，直接跳转到设置「应用」页并打开该条目的编辑弹层
      label: '编辑名称与图标…',
      click: () => requestAppEditor(id)
    },
    {
      label: '恢复默认名称与图标',
      enabled: hasCustom,
      click: () => updateAppCustom(id, { customName: null, customIcon: null })
    },
    {
      label: '在资源管理器中显示',
      click: () => {
        shell.showItemInFolder(item.path)
      }
    },
    { type: 'separator' },
    {
      label: '从 Dock 移除',
      click: () => {
        removeApp(id)
      }
    },
    { label: 'Dock 设置…', click: () => openSettingsWindow() }
  ])
  menu.popup(window ? { window } : {})
}

function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, (): Settings => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: DeepPartial<Settings>): Settings => {
    const next = updateSettings(patch)
    if (!next.music.visible) {
      // 音乐卡片隐藏时暂停广播即可，窗口由 windowManager 负责隐藏
    }
    if (next.music.source === 'system' && hub) {
      broadcast(IPC.mediaUpdate, hub.getState())
    }
    return next
  })
  ipcMain.handle(IPC.settingsReset, (): Settings => {
    const next = resetSettings()
    if (hub) broadcast(IPC.mediaUpdate, hub.getState())
    return next
  })
}

function registerSystemIpc(): void {
  // 开机自启：写系统登录项 → 回读校验 → 把真实状态回写设置（设置页据此回滚开关）
  ipcMain.handle(IPC.systemSetAutoStart, (_event, enabled: boolean): AutoStartResult => {
    const result = applyAutoStart(!!enabled)
    if (getSettings().system.autoStart !== result.autoStart) {
      updateSettings({ system: { autoStart: result.autoStart } })
    }
    return result
  })
}

function registerAppIpc(): void {
  ipcMain.handle(IPC.appsList, (): DockItem[] => getSettings().apps)
  ipcMain.handle(IPC.appsLaunch, async (_event, id: string) => launchApp(id))
  ipcMain.handle(IPC.appsRemove, (_event, id: string): DockItem[] => removeApp(id))
  ipcMain.handle(IPC.appsAddByDialog, (): Promise<DockItem[]> => pickAppFiles())
  ipcMain.handle(IPC.appsReorder, (_event, ids: string[]): DockItem[] => reorderApps(ids))
  ipcMain.handle(IPC.appsScanStartMenu, (): Promise<DockItem[]> => scanStartMenu())
  ipcMain.handle(IPC.appsAddFromStartMenu, (_event, item: DockItem): DockItem[] => addStartMenuItem(item))
  // v1.6：自定义显示名称 / 图标
  ipcMain.handle(IPC.appsUpdateItem, (_event, id: string, patch: AppCustomPatch): DockItem[] =>
    updateAppCustom(id, patch ?? {})
  )
  ipcMain.handle(IPC.appsPickIcon, (): Promise<PickIconResult> => pickCustomIcon())
  ipcMain.handle(IPC.appsRequestEdit, (_event, id: string): void => requestAppEditor(id))
  ipcMain.handle(IPC.appsConsumeEditRequest, (): string | null => consumePendingAppEditor())
  ipcMain.handle(IPC.appsMenu, (event, id: string, point: Point): void => {
    sanitizePoint(point)
    showItemMenu(BrowserWindow.fromWebContents(event.sender), id)
  })
  ipcMain.handle(IPC.appsContextMenuDock, (event, point: Point): void => {
    sanitizePoint(point)
    showDockMenu(BrowserWindow.fromWebContents(event.sender))
  })
}

function registerWindowIpc(): void {
  ipcMain.on(IPC.windowSetContentSize, (event, target: WindowTarget, size: Size): void => {
    if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') return
    // v1.7：附加窗口优先按发送者归属路由（附加窗口渲染页可以复用既有 useContentSize 写法），
    // 未命中再走内置窗口的 target 路由。
    if (setOwnContentSize(event.sender.id, size)) return
    setContentSize(target, size)
  })
  // v1.7：附加窗口按 IPC 发送者定位窗口（渲染层不需要知道自己属于哪个 kind）
  ipcMain.on(IPC.windowSetOwnContentSize, (event, size: Size): void => {
    if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') return
    setOwnContentSize(event.sender.id, size)
  })
  ipcMain.on(IPC.windowOpenSettings, (): void => {
    openSettingsWindow()
  })
  ipcMain.on(IPC.windowCloseSettings, (): void => {
    const win = getSettingsWindow()
    win?.close()
  })
  ipcMain.on(IPC.windowMinimizeSettings, (): void => {
    getSettingsWindow()?.minimize()
  })
  ipcMain.on(IPC.windowQuit, (): void => {
    app.quit()
  })
  ipcMain.on(IPC.windowSetIgnoreMouse, (event, ignore: boolean): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(!!ignore, { forward: true })
  })
  ipcMain.handle(IPC.windowCapture, async (event, target: WindowTarget): Promise<string> => {
    // 按渲染页 URL 定位窗口：clock / music 可能由任意窗口触发截图（验收脚本用）
    const findByUrl = (segment: string): BrowserWindow | null =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(segment)) ?? null
    const win =
      target === 'settings'
        ? getSettingsWindow()
        : target === 'music'
          ? findByUrl('/music/')
          : target === 'clock'
            ? findByUrl('/clock/')
            : (BrowserWindow.fromWebContents(event.sender) ?? getDockWindow())
    if (!win) return ''
    const image = await win.webContents.capturePage()
    return image.isEmpty() ? '' : image.toDataURL()
  })

  /**
   * v1.5：补上契约里早已声明、但主进程一直没有 handler 的 `dock:snap`。
   * 旧版本 preload 暴露了 window.nexus.dock.snap()，任何调用都会 reject
   * 「No handler registered for 'dock:snap'」，属于死通道。
   */
  ipcMain.handle(IPC.dockSnap, (): boolean => {
    snapDockToEdge()
    return isDockVisible()
  })
}

function registerMediaIpc(): void {
  ipcMain.handle(IPC.mediaGetState, (): MediaState => {
    if (getSettings().music.source === 'local') return localState
    return hub?.getState() ?? DEFAULT_MEDIA_STATE
  })

  ipcMain.handle(IPC.mediaControl, async (_event, action: MediaAction, positionMs?: number) => {
    if (getSettings().music.source === 'local') return { ok: false }
    if (!hub) return { ok: false }
    return hub.control(action, positionMs)
  })

  ipcMain.handle(IPC.mediaPickFiles, async (): Promise<LocalTrack[]> => {
    const result = await dialog.showOpenDialog({
      title: '选择本地音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: AUDIO_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const tracks: LocalTrack[] = result.filePaths.map((filePath) => {
      allowMediaFile(filePath)
      return { path: filePath, title: basename(filePath, extname(filePath)) }
    })
    updateSettings({ music: { source: 'local' } })
    broadcast(IPC.mediaTracks, tracks)
    return tracks
  })

  ipcMain.on(IPC.mediaSetLocalState, (_event, state: MediaState): void => {
    if (!state || typeof state !== 'object') return
    localState = {
      ...DEFAULT_MEDIA_STATE,
      ...state,
      source: 'local',
      positionMs: Number(state.positionMs) || 0,
      durationMs: Number(state.durationMs) || 0,
      updatedAt: Date.now()
    }
    broadcast(IPC.mediaUpdate, localState)
  })
}

export function registerIpc(mediaHub: MediaHub): void {
  hub = mediaHub
  hub.onStateChange((state) => {
    if (getSettings().music.source === 'system') broadcast(IPC.mediaUpdate, state)
  })
  registerSettingsIpc()
  registerSystemIpc()
  registerAppIpc()
  registerWindowIpc()
  registerMediaIpc()
}

export function disposeIpc(): void {
  ipcMain.removeHandler(IPC.settingsGet)
  ipcMain.removeHandler(IPC.settingsUpdate)
  ipcMain.removeHandler(IPC.settingsReset)
  ipcMain.removeHandler(IPC.systemSetAutoStart)
  ipcMain.removeHandler(IPC.appsList)
  ipcMain.removeHandler(IPC.appsLaunch)
  ipcMain.removeHandler(IPC.appsRemove)
  ipcMain.removeHandler(IPC.appsAddByDialog)
  ipcMain.removeHandler(IPC.appsReorder)
  ipcMain.removeHandler(IPC.appsScanStartMenu)
  ipcMain.removeHandler(IPC.appsAddFromStartMenu)
  ipcMain.removeHandler(IPC.appsUpdateItem)
  ipcMain.removeHandler(IPC.appsPickIcon)
  ipcMain.removeHandler(IPC.appsRequestEdit)
  ipcMain.removeHandler(IPC.appsConsumeEditRequest)
  ipcMain.removeHandler(IPC.appsMenu)
  ipcMain.removeHandler(IPC.appsContextMenuDock)
  ipcMain.removeHandler(IPC.windowCapture)
  ipcMain.removeHandler(IPC.dockSnap)
  ipcMain.removeHandler(IPC.mediaGetState)
  ipcMain.removeHandler(IPC.mediaControl)
  ipcMain.removeHandler(IPC.mediaPickFiles)
  ipcMain.removeAllListeners(IPC.windowSetContentSize)
  ipcMain.removeAllListeners(IPC.windowSetOwnContentSize)
  ipcMain.removeAllListeners(IPC.windowOpenSettings)
  ipcMain.removeAllListeners(IPC.windowCloseSettings)
  ipcMain.removeAllListeners(IPC.windowMinimizeSettings)
  ipcMain.removeAllListeners(IPC.windowQuit)
  ipcMain.removeAllListeners(IPC.windowSetIgnoreMouse)
  ipcMain.removeAllListeners(IPC.mediaSetLocalState)
}
