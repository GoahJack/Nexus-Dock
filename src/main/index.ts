import { app } from 'electron'
import { IPC, hasOnlyOnDesktopWindow, type Settings } from '@shared/types'
import { cleanupErrorDialogs, hydrateIcons, probeEnvironment, startRunningMonitor, stopRunningMonitor } from './apps'
import { subscribeAutoStartSettings, syncAutoStartOnStartup } from './autostart'
import { createDesktopStateMonitor } from './desktopState'
import { setupMemoryReport } from './diagnostics'
import { disposeIpc, registerIpc } from './ipc'
import { createMediaHub } from './media/mediaHub'
import { flushSettings, getSettings, initSettings, subscribeSettings } from './settingsStore'
import { registerProtocolHandlers, registerSchemes } from './protocol'
import { disposeTray, setupTray } from './tray'
import {
  applyDesktopState,
  broadcast,
  destroyWindows,
  getDockWindow,
  openSettingsWindow,
  setupWindows
} from './windowManager'
import { setupUserDataDir } from './userData'

// 渲染层/预加载通过 process.env 读取打包状态（沙箱 preload 无法直接访问 app），
// 必须在创建任何窗口之前写入，子进程会继承该环境变量
process.env['NEXUS_PACKAGED'] = app.isPackaged ? '1' : '0'

// ─────────────────────── Chromium 轻量化开关（必须在 app ready 之前）───────────────────────
// 低配机 / GPU 内存异常场景：设置 NEXUS_LOW_END=1 可关闭硬件加速（默认不开启，
// 透明窗口与动效保持原观感）。
if (process.env['NEXUS_LOW_END'] === '1') {
  app.disableHardwareAcceleration()
  console.log('[main] NEXUS_LOW_END=1：已禁用硬件加速')
}
// 纯桌面工具不需要后台网络/组件更新/同步/崩溃上报：关掉可减少后台线程与网络抖动，
// 不影响渲染、透明窗口与动效（这些开关只影响 Chromium 的后台服务）。
for (const chromiumFlag of [
  'disable-background-networking',
  'disable-component-update',
  'disable-domain-reliability',
  'disable-sync',
  'disable-breakpad'
]) {
  app.commandLine.appendSwitch(chromiumFlag)
}

// 受限环境下 %APPDATA% 可能不可写，必须先确定可写的 userData 目录，
// 否则 Electron 连单实例锁都创建不了（表现为启动后立刻静默退出）
setupUserDataDir()

// 自定义协议必须在 app ready 之前注册
registerSchemes()

/**
 * SMTC 桥是常驻 powershell.exe（实测工作集约 100MB），
 * 只有「音乐卡片可见 + 来源=系统媒体」时才需要；否则完全不应启动。
 */
function needsMediaBridge(settings: Settings): boolean {
  return settings.music.visible && settings.music.source === 'system'
}

/**
 * 桌面状态桥用于「仅在桌面显示」（docs/window-conventions.md §2 C11）：
 * 任一悬浮窗口（含 v1.7 附加窗口）开启 onlyOnDesktop 时才需要运行；全关时零常驻。
 */
function needsDesktopStateBridge(settings: Settings): boolean {
  return hasOnlyOnDesktopWindow(settings)
}

let unsubscribeSettings: () => void = () => undefined
let unsubscribeAutoStart: () => void = () => undefined

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    openSettingsWindow()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.nexus.dock')
    // 渲染层/预加载通过 process.env 读取版本号（沙箱 preload 无法直接访问 app），
    // 必须在创建任何窗口之前写入，子进程会继承该环境变量
    process.env['NEXUS_VERSION'] = app.getVersion()
    const initialSettings = initSettings()
    // 开机自启以操作系统登录项为真源，启动时回写一次设置（开发模式不写系统）
    syncAutoStartOnStartup()
    registerProtocolHandlers()
    setupWindows()

    // 内存采样（仅在设置 NEXUS_MEM_REPORT 时启用，默认零成本）
    const stopMemoryReport = setupMemoryReport()

    // 音乐 Hub：SMTC 桥按需启动（音乐卡片关闭时不再常驻 PowerShell）
    const hub = createMediaHub()
    registerIpc(hub)
    hub.start({ bridgeEnabled: needsMediaBridge(initialSettings) })

    // 桌面状态桥：前台窗口最大化/全屏时自动隐藏 Dock；
    // 三窗口都没开「仅在桌面显示」时不启动（不浪费任何常驻进程）
    const desktopMonitor = createDesktopStateMonitor()
    desktopMonitor.onChange((state) => applyDesktopState(state))
    desktopMonitor.start({ enabled: needsDesktopStateBridge(initialSettings) })

    startRunningMonitor((running) => broadcast(IPC.appsRunning, running))
    // v1.5：tray 是唯一稳定的「找回入口」（Dock 关窗即退出、应用不进任务栏）。
    // 创建失败只记日志，不影响 Dock / 音乐卡片。
    setupTray()
    // v1.5：以下三件事各自会拉起 1–2 个 PowerShell（冷启动约 0.5–1s、60–100MB 工作集），
    // 与 Dock 首帧抢 CPU 造成启动卡顿；改为界面先出、再错峰执行。
    setTimeout(() => {
      void hydrateIcons()
    }, 1200)
    setTimeout(() => {
      void probeEnvironment()
      void cleanupErrorDialogs()
    }, 4000)

    // 桥进程按需启停的去抖定时器：设置页一次保存会触发多次 updateSettings，
    // 去抖避免「开→关→开」式抖动导致子进程反复 spawn/kill
    let bridgeSyncTimer: NodeJS.Timeout | null = null
    const scheduleBridgeSync = (delayMs = 500): void => {
      if (bridgeSyncTimer) clearTimeout(bridgeSyncTimer)
      bridgeSyncTimer = setTimeout(() => {
        bridgeSyncTimer = null
        // 用最新设置（而非触发时的快照），别让去抖窗口里的中间态生效
        const settings = getSettings()
        hub.setBridgeEnabled(needsMediaBridge(settings))
        desktopMonitor.setEnabled(needsDesktopStateBridge(settings))
      }, delayMs)
    }

    // 任何设置变更（含应用列表）都广播给所有窗口，保证四个窗口即时同步
    unsubscribeSettings = subscribeSettings((settings) => {
      broadcast(IPC.settingsChanged, settings)
      // 音乐卡片显隐/来源、「仅在桌面显示」变化 → 同步桥进程的启停
      scheduleBridgeSync()
    })
    // 设置中的开机自启开关变化 → 同步操作系统登录项（内部回读校验 + 防递归）
    unsubscribeAutoStart = subscribeAutoStartSettings()

    // Dock 是主窗口：关闭它等于退出应用
    getDockWindow()?.on('closed', () => {
      app.quit()
    })

    app.on('before-quit', () => {
      if (bridgeSyncTimer) {
        clearTimeout(bridgeSyncTimer)
        bridgeSyncTimer = null
      }
      stopMemoryReport()
      desktopMonitor.stop()
      unsubscribeSettings()
      unsubscribeAutoStart()
      disposeTray()
      hub.dispose()
      stopRunningMonitor()
      disposeIpc()
      flushSettings()
      destroyWindows()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  process.on('uncaughtException', (error) => {
    console.error('[main] 未捕获异常：', error)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[main] 未处理的 Promise 拒绝：', reason)
  })
}
