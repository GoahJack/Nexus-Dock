/**
 * 系统托盘（v1.5 新增）。
 *
 * 为什么需要：Dock 是主窗口，关掉它等于退出应用，而应用本身 skipTaskbar（任务栏无图标）。
 * 一旦窗口异常（例如设置窗跑到屏幕外、Dock 被「仅在桌面显示」隐掉），旧版本用户没有任何
 * 找回入口，只能杀进程（操作指南 FAQ Q6 就建议删 settings.json）。托盘提供稳定的退出/找回路径：
 *   单击 = 显示/隐藏 Dock，双击 = 打开设置，右键 = 完整菜单。
 *
 * 菜单每次打开前重建，选项状态直接读当前设置，不做本地缓存（避免与设置页不同步）。
 */
import { Menu, Tray, app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { applyAutoStart } from './autostart'
import { logToFile } from './logger'
import { getSettings, subscribeSettings, updateSettings } from './settingsStore'
import {
  getDockWindow,
  isDockVisible,
  openSettingsWindow,
  setDockVisible,
  snapDockToEdge
} from './windowManager'

let tray: Tray | null = null
let unsubscribeSettings: (() => void) | null = null

/** 托盘图标候选路径：打包 resources → out/main/../../resources → 开发态仓库 resources */
function trayIconCandidates(fileName: string): string[] {
  const candidates: string[] = []
  try {
    candidates.push(join(app.getAppPath(), 'resources', fileName))
  } catch {
    /* app 可能尚未 ready */
  }
  candidates.push(join(__dirname, '../../resources', fileName))
  try {
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'resources', fileName))
      candidates.push(join(process.resourcesPath, fileName))
    }
  } catch {
    /* 忽略 */
  }
  return candidates
}

function findTrayIcon(fileName: string): string | null {
  for (const candidate of trayIconCandidates(fileName)) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

/**
 * 托盘图标：基础 16px + 2x/3x 表示，避免高 DPI 缩放下模糊。
 * 图标缺失时返回 null（调用方跳过托盘，绝不因为图标问题让应用启动失败）。
 */
function buildTrayImage(): Electron.NativeImage | null {
  const base = findTrayIcon('tray-16.png')
  if (!base) return null
  const image = nativeImage.createFromPath(base)
  if (image.isEmpty()) return null
  for (const [fileName, scaleFactor] of [
    ['tray-24.png', 1.5],
    ['tray-32.png', 2],
    ['tray-64.png', 4]
  ] as const) {
    const path = findTrayIcon(fileName)
    if (!path) continue
    try {
      const representation = nativeImage.createFromPath(path)
      if (!representation.isEmpty()) image.addRepresentation({ scaleFactor, buffer: representation.toPNG() })
    } catch {
      /* 单个表示失败不影响基础图标 */
    }
  }
  return image
}

function buildTrayMenu(): Menu {
  const settings = getSettings()
  const dockWindow = getDockWindow()
  const dockVisible = isDockVisible()
  const allLocked = settings.lock.dock && settings.lock.music && settings.lock.clock

  return Menu.buildFromTemplate([
    { label: '打开 Nexus 设置…', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: dockVisible ? '隐藏 Dock' : '显示 Dock',
      enabled: !!dockWindow,
      click: () => setDockVisible(!isDockVisible())
    },
    {
      label: '吸附到最近屏幕边',
      enabled: !!dockWindow,
      click: () => snapDockToEdge()
    },
    {
      label: '重新加载 Dock',
      enabled: !!dockWindow,
      click: () => getDockWindow()?.webContents.reload()
    },
    { type: 'separator' },
    {
      label: '显示音乐卡片',
      type: 'checkbox',
      checked: settings.music.visible,
      click: (item) => updateSettings({ music: { visible: item.checked } })
    },
    {
      label: '显示桌面时钟',
      type: 'checkbox',
      checked: settings.clock.visible,
      click: (item) => updateSettings({ clock: { visible: item.checked } })
    },
    { type: 'separator' },
    {
      label: '锁定全部窗口位置',
      type: 'checkbox',
      checked: allLocked,
      click: (item) =>
        updateSettings({ lock: { dock: item.checked, music: item.checked, clock: item.checked } })
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: settings.system.autoStart,
      // 与设置页一致：仅安装版可写系统登录项；开发态禁用并说明原因
      enabled: app.isPackaged,
      click: (item) => {
        const result = applyAutoStart(item.checked)
        if (!result.ok) {
          logToFile('main', `[tray] 开机自启切换失败（${result.reason ?? '未知'}），回读状态 ${result.autoStart}`)
        }
      }
    },
    { type: 'separator' },
    { label: `Nexus Dock v${app.getVersion()}`, enabled: false },
    { label: '退出 Nexus Dock', click: () => app.quit() }
  ])
}

/** 重建右键菜单（设置变化时刷新勾选态；菜单在每次显示前也会重建，双保险） */
function refreshMenu(): void {
  if (!tray) return
  try {
    tray.setContextMenu(buildTrayMenu())
  } catch (error) {
    logToFile('main', `[tray] 刷新菜单失败：${String(error)}`)
  }
}

/** 创建托盘图标；失败只记日志，不阻塞应用启动 */
export function setupTray(): void {
  if (tray) return
  const image = buildTrayImage()
  if (!image) {
    logToFile('main', '[tray] 未找到托盘图标资源（resources/tray-16.png），跳过托盘创建')
    return
  }
  try {
    tray = new Tray(image)
  } catch (error) {
    tray = null
    logToFile('main', `[tray] 托盘创建失败：${String(error)}`)
    return
  }
  tray.setToolTip('Nexus Dock — 单击显示/隐藏 Dock，双击打开设置')
  refreshMenu()
  // Windows：单击切换 Dock 显隐，双击打开设置（右键菜单由 setContextMenu 自动弹出）
  tray.on('click', () => setDockVisible(!isDockVisible()))
  tray.on('double-click', () => openSettingsWindow())
  tray.on('balloon-click', () => openSettingsWindow())
  if (!unsubscribeSettings) unsubscribeSettings = subscribeSettings(() => refreshMenu())
  logToFile('main', '[tray] 托盘图标已创建')
}

/** 退出前销毁托盘并取消设置订阅 */
export function disposeTray(): void {
  if (unsubscribeSettings) {
    unsubscribeSettings()
    unsubscribeSettings = null
  }
  if (tray) {
    try {
      tray.destroy()
    } catch {
      /* 已销毁 */
    }
    tray = null
  }
}
