import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  isHorizontalEdge,
  SCREEN_MARGIN,
  type ClockConfig,
  type DockConfig,
  type DockEdge,
  type MusicConfig,
  type Settings,
  type Size,
  type WindowTarget
} from '@shared/types'
import { getSettings, subscribeSettings, updateSettings } from './settingsStore'
import type { DesktopState } from './desktopState'
import { logToFile } from './logger'

type Rect = { x: number; y: number; width: number; height: number }

const MARGIN = SCREEN_MARGIN
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const preloadPath = join(__dirname, '../preload/index.js')

let dockWin: BrowserWindow | null = null
let musicWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let clockWin: BrowserWindow | null = null

/** 上一次生效的设置（用于识别 snapToEdge 开关切换） */
let lastSettings: Settings | null = null
/** 桌面前台状态（最大化/全屏时隐藏 Dock） */
let lastDesktopState: DesktopState | null = null
/** v1.3：「仅在桌面显示」按窗口记录隐藏状态，Dock / 音乐卡片 / 时钟共用同一套桌面状态逻辑 */
const hiddenByDesktop: Record<'dock' | 'music' | 'clock', boolean> = {
  dock: false,
  music: false,
  clock: false
}

/** 渲染层量出的内容尺寸；窗口必须与内容等大，透明区域才不会变成「隐形点击区」 */
const contentSizes: Record<'dock' | 'music' | 'clock', Size> = {
  dock: { width: 640, height: 120 },
  music: { width: 340, height: 170 },
  // 时钟窗口的初始尺寸；实际由渲染层量出内容尺寸后通过 setContentSize 修正
  clock: { width: 240, height: 120 }
}

let applyingDock = false
let applyingMusic = false
let applyingClock = false
/**
 * 时钟窗口是否已收到渲染层首次内容尺寸回报。
 * 未回报前保持隐藏：初始 240×120 透明窗口若先显示，会有一块比内容大的「隐形点击区」。
 */
let clockContentSized = false
let dockMoveTimer: NodeJS.Timeout | null = null
let musicMoveTimer: NodeJS.Timeout | null = null
let clockMoveTimer: NodeJS.Timeout | null = null
let unsubscribers: Array<() => void> = []

/**
 * v1.5：用户通过托盘菜单 / Dock 右键菜单主动隐藏 Dock。
 * 与「仅在桌面显示」的临时隐藏分开记录，避免托盘开关与最大化检测互相覆盖。
 */
let dockHiddenByUser = false

/**
 * v1.5：渲染进程崩溃自愈的限流表。
 * `render-process-gone` 后 BrowserWindow 仍然「存活」（isDestroyed() 为 false），
 * 旧实现只打日志 → Dock/音乐卡片永久白屏、设置窗「点不开」。
 */
const rendererReloads = new Map<BrowserWindow, { count: number; firstAt: number }>()
const RENDERER_RELOAD_WINDOW_MS = 60_000
const RENDERER_RELOAD_MAX = 3
const RENDERER_RELOAD_SLOW_MS = 10_000

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/**
 * v1.5 窗口加固（纵深防御，非已知漏洞）：
 * 1) 只允许四个本地页面在自身 URL 内活动，任何导航一律拦截；
 * 2) 禁止 window.open / target=_blank 生成子窗口（子窗口会继承 preload → 暴露 window.nexus）；
 * 3) 禁止 <webview> 挂载。
 * 这样即使渲染层出现注入点，远程页面也拿不到 IPC 桥。
 */
function hardenWindow(win: BrowserWindow): void {
  const wc = win.webContents
  const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  wc.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl))
    if (allowed) return
    event.preventDefault()
    logToFile('main', `[security] 已阻止窗口导航：${url.slice(0, 200)}`)
  })
  wc.setWindowOpenHandler(({ url }) => {
    logToFile('main', `[security] 已阻止新窗口：${url.slice(0, 200)}`)
    return { action: 'deny' }
  })
  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
    logToFile('main', '[security] 已阻止 webview 挂载')
  })
}

/**
 * v1.5 渲染进程崩溃自愈：60 秒内最多重载 3 次；超过则退化为每 10 秒一次慢重载，
 * 既不会永久白屏，也不会陷入重载风暴。Dock 窗口不销毁（销毁等于退出应用）。
 */
function installRendererSelfHeal(win: BrowserWindow, target: WindowTarget): void {
  win.webContents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed() || details.reason === 'clean-exit') return
    logToFile('main', `[${target}] 渲染进程退出 reason=${details.reason} exitCode=${String(details.exitCode)}，开始自愈`)
    const now = Date.now()
    const entry = rendererReloads.get(win)
    const withinWindow = !!entry && now - entry.firstAt <= RENDERER_RELOAD_WINDOW_MS
    const count = withinWindow && entry ? entry.count + 1 : 1
    rendererReloads.set(win, { count, firstAt: withinWindow && entry ? entry.firstAt : now })
    if (count > RENDERER_RELOAD_MAX) {
      rendererReloads.delete(win)
      logToFile('main', `[${target}] 60s 内第 ${count} 次崩溃，改为 ${RENDERER_RELOAD_SLOW_MS}ms 后慢重载`)
      setTimeout(() => {
        if (win.isDestroyed()) return
        logToFile('main', `[${target}] 慢重载渲染层`)
        win.webContents.reload()
      }, RENDERER_RELOAD_SLOW_MS)
      return
    }
    try {
      win.webContents.reload()
    } catch (error) {
      logToFile('main', `[${target}] 自愈重载失败：${String(error)}`)
    }
  })
  win.on('closed', () => {
    rendererReloads.delete(win)
  })
}

function loadRenderer(win: BrowserWindow, page: WindowTarget): void {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}/index.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
  }
}

/* ------------------------------- Dock 窗口 ------------------------------- */

export function getDockWindow(): BrowserWindow | null {
  return dockWin && !dockWin.isDestroyed() ? dockWin : null
}

export function createDockWindow(): BrowserWindow {
  const existing = getDockWindow()
  if (existing) return existing
  const settings = getSettings()
  const windowsOptions = {
    width: contentSizes.dock.width,
    height: contentSizes.dock.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: !settings.lock.dock,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.dock.alwaysOnTop,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  }
  const win = new BrowserWindow(windowsOptions)
  dockWin = win
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(settings.dock.alwaysOnTop, 'pop-up-menu')
  applyDockMaterial(win)
  loadRenderer(win, 'dock')
  win.once('ready-to-show', () => {
    win.showInactive()
    applyDockLayout()
  })
  win.on('moved', () => {
    if (applyingDock) return
    // 位置锁定：忽略用户拖动产生的位置变更（程序化布局 applyDockLayout 不受影响）
    if (getSettings().lock.dock) return
    if (dockMoveTimer) clearTimeout(dockMoveTimer)
    dockMoveTimer = setTimeout(() => {
      dockMoveTimer = null
      const current = getDockWindow()
      if (!current) return
      if (getSettings().lock.dock) return
      if (getSettings().dock.snapToEdge) {
        snapDockToNearestEdge()
        return
      }
      // 自由定位：把当前窗口位置写回设置（不吸附）
      const bounds = current.getBounds()
      updateSettings({ dock: { freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
    }, 130)
  })
  win.on('closed', () => {
    dockWin = null
  })
  hardenWindow(win)
  installRendererSelfHeal(win, 'dock')
  return win
}

function applyDockMaterial(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  // 注意：Windows 11 上调用 setBackgroundMaterial('none') 可能让透明窗口变成黑底，
  // 因此只在用户显式开启亚克力时才设置材质；关闭时不要触碰该 API。
  if (!getSettings().dock.acrylic) return
  try {
    win.setBackgroundMaterial('acrylic')
  } catch (error) {
    console.warn('[dock] 亚克力材质设置失败：', error)
  }
}

/** 停靠边 + 沿边百分比 → 屏幕坐标；snapToEdge=false 时使用自由坐标 */
function computeDockBounds(dock: DockConfig, size: Size, area: Rect): Rect {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  let x: number
  let y: number

  if (!dock.snapToEdge) {
    // 自由定位：拖到哪停在哪；首次运行（freeX/freeY < 0）放在底部居中
    x = dock.freeX >= 0 ? dock.freeX : area.x + Math.round((area.width - width) / 2)
    y = dock.freeY >= 0 ? dock.freeY : area.y + area.height - height - MARGIN
  } else {
    const ratio = clamp(dock.alongPercent, 0, 100) / 100
    x = area.x + Math.round((area.width - width) * ratio)
    y = area.y + Math.round((area.height - height) * ratio)
    switch (dock.edge) {
      case 'bottom':
        y = area.y + area.height - height - MARGIN
        break
      case 'top':
        y = area.y + MARGIN
        break
      case 'left':
        x = area.x + MARGIN
        break
      case 'right':
        x = area.x + area.width - width - MARGIN
        break
    }
  }

  return {
    x: clamp(x, area.x, area.x + Math.max(0, area.width - width)),
    y: clamp(y, area.y, area.y + Math.max(0, area.height - height)),
    width,
    height
  }
}

export function applyDockLayout(): void {
  const win = getDockWindow()
  if (!win) return
  const dock = getSettings().dock
  const current = win.getBounds()
  const display = screen.getDisplayMatching(current)
  const next = computeDockBounds(dock, contentSizes.dock, display.workArea)
  if (
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  ) {
    return
  }
  applyingDock = true
  win.setBounds(next)
  setTimeout(() => {
    applyingDock = false
  }, 80)
}

/** 拖动结束后吸附到最近的屏幕边，并保留沿边位置 */
function snapDockToNearestEdge(): void {
  const win = getDockWindow()
  if (!win) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const distances: Record<DockEdge, number> = {
    top: Math.abs(centerY - area.y),
    bottom: Math.abs(area.y + area.height - centerY),
    left: Math.abs(centerX - area.x),
    right: Math.abs(area.x + area.width - centerX)
  }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) =>
    distances[candidate] < distances[best] ? candidate : best
  )
  const horizontal = isHorizontalEdge(edge)
  const rawPercent = horizontal
    ? area.width > bounds.width
      ? ((bounds.x - area.x) / (area.width - bounds.width)) * 100
      : 50
    : area.height > bounds.height
      ? ((bounds.y - area.y) / (area.height - bounds.height)) * 100
      : 50
  const alongPercent = Math.round(clamp(rawPercent, 0, 100) * 10) / 10
  const dock = getSettings().dock
  if (dock.edge === edge && Math.abs(dock.alongPercent - alongPercent) < 0.6) {
    applyDockLayout()
    return
  }
  // 写入设置后会通过 subscribeSettings → applyDockLayout 完成吸附
  updateSettings({ dock: { edge, alongPercent } })
}

/* ------------------------------ 音乐卡片窗口 ------------------------------ */

export function getMusicWindow(): BrowserWindow | null {
  return musicWin && !musicWin.isDestroyed() ? musicWin : null
}

export function createMusicWindow(): BrowserWindow {
  const existing = getMusicWindow()
  if (existing) return existing
  const settings = getSettings()
  const win = new BrowserWindow({
    width: contentSizes.music.width,
    height: contentSizes.music.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: !settings.lock.music,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.music.alwaysOnTop,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 轻量化：音乐卡片隐藏/被遮挡时恢复默认节流，不再全速渲染；
      // 进度插值在渲染层按 visibility 暂停并在重新可见时立即补一次（useMediaProgress）
      backgroundThrottling: true
    }
  })
  musicWin = win
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(settings.music.alwaysOnTop, 'floating')
  loadRenderer(win, 'music')
  win.once('ready-to-show', () => {
    win.showInactive()
    applyMusicLayout()
  })
  win.on('moved', () => {
    if (applyingMusic) return
    // 位置锁定：忽略用户拖动产生的位置变更（程序化布局不受影响）
    if (getSettings().lock.music) return
    if (musicMoveTimer) clearTimeout(musicMoveTimer)
    musicMoveTimer = setTimeout(() => {
      musicMoveTimer = null
      const current = getMusicWindow()
      if (!current) return
      if (getSettings().lock.music) return
      const music = getSettings().music
      if (music.snapToEdge) {
        // 吸附模式：拖动即脱离 Dock（snapMusicToNearestEdge 会写 anchor=free），松手吸附最近屏幕边
        snapMusicToNearestEdge()
        return
      }
      // 自由摆放模式：拖到哪停在哪，anchor 切 free 并把屏幕坐标写入设置
      const bounds = current.getBounds()
      updateSettings({ music: { anchor: 'free', freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
    }, 160)
  })
  win.on('closed', () => {
    musicWin = null
  })
  hardenWindow(win)
  installRendererSelfHeal(win, 'music')
  if (!settings.music.visible) win.hide()
  return win
}

function computeMusicBounds(music: MusicConfig, size: Size, area: Rect): Rect {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  const dock = getDockWindow()
  let x: number
  let y: number

  if (music.anchor === 'dock' && dock) {
    const dockBounds = dock.getBounds()
    const edge = getSettings().dock.edge
    x = dockBounds.x
    y = dockBounds.y - height - MARGIN
    if (edge === 'top') y = dockBounds.y + dockBounds.height + MARGIN
    if (edge === 'left') {
      x = dockBounds.x + dockBounds.width + MARGIN
      y = dockBounds.y
    }
    if (edge === 'right') {
      x = dockBounds.x - width - MARGIN
      y = dockBounds.y
    }
    // 越界时翻到另一侧
    if (x + width > area.x + area.width) x = area.x + area.width - width - MARGIN
    if (y < area.y) y = area.y + MARGIN
  } else if (!music.snapToEdge && music.freeX >= 0 && music.freeY >= 0) {
    // 自由摆放模式：优先使用上次拖拽固化的屏幕坐标，重启后精确还原
    x = music.freeX
    y = music.freeY
  } else {
    const ratio = clamp(music.alongPercent, 0, 100) / 100
    x = area.x + Math.round((area.width - width) * ratio)
    y = area.y + Math.round((area.height - height) * ratio)
    switch (music.edge) {
      case 'bottom':
        y = area.y + area.height - height - MARGIN
        break
      case 'top':
        y = area.y + MARGIN
        break
      case 'left':
        x = area.x + MARGIN
        break
      case 'right':
        x = area.x + area.width - width - MARGIN
        break
    }
  }

  return {
    x: clamp(x, area.x, area.x + Math.max(0, area.width - width)),
    y: clamp(y, area.y, area.y + Math.max(0, area.height - height)),
    width,
    height
  }
}

export function applyMusicLayout(): void {
  const win = getMusicWindow()
  if (!win) return
  const music = getSettings().music
  if (!music.visible) {
    if (win.isVisible()) win.hide()
    return
  }
  // 显示器选择：跟随 Dock 时用 Dock 所在屏；自由坐标模式按坐标就近匹配（重启后可还原到副屏）；
  // 其余情况按窗口当前所在屏
  const dock = getDockWindow()
  const area =
    music.anchor === 'dock' && dock
      ? screen.getDisplayMatching(dock.getBounds()).workArea
      : !music.snapToEdge && music.freeX >= 0 && music.freeY >= 0
        ? screen.getDisplayNearestPoint({
            x: Math.round(music.freeX + contentSizes.music.width / 2),
            y: Math.round(music.freeY + contentSizes.music.height / 2)
          }).workArea
        : screen.getDisplayMatching(win.getBounds()).workArea
  const next = computeMusicBounds(music, contentSizes.music, area)
  const current = win.getBounds()
  if (current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) {
    if (!win.isVisible()) win.showInactive()
    return
  }
  applyingMusic = true
  win.setBounds(next)
  if (!win.isVisible()) win.showInactive()
  setTimeout(() => {
    applyingMusic = false
  }, 80)
}

function snapMusicToNearestEdge(): void {
  const win = getMusicWindow()
  if (!win) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const distances: Record<DockEdge, number> = {
    top: Math.abs(centerY - area.y),
    bottom: Math.abs(area.y + area.height - centerY),
    left: Math.abs(centerX - area.x),
    right: Math.abs(area.x + area.width - centerX)
  }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) =>
    distances[candidate] < distances[best] ? candidate : best
  )
  const horizontal = isHorizontalEdge(edge)
  const percent = horizontal
    ? area.width > bounds.width
      ? ((bounds.x - area.x) / (area.width - bounds.width)) * 100
      : 50
    : area.height > bounds.height
      ? ((bounds.y - area.y) / (area.height - bounds.height)) * 100
      : 50
  const alongPercent = Math.round(clamp(percent, 0, 100) * 10) / 10
  updateSettings({ music: { edge, alongPercent, anchor: 'free' } })
}

/* ------------------------------- 时钟窗口 ------------------------------- */

export function getClockWindow(): BrowserWindow | null {
  return clockWin && !clockWin.isDestroyed() ? clockWin : null
}

export function createClockWindow(): BrowserWindow {
  const existing = getClockWindow()
  if (existing) return existing
  const settings = getSettings()
  // 新窗口需要重新等待渲染层回报内容尺寸后再显示
  clockContentSized = false
  // 透明无边框参数与音乐卡片保持一致，保证内容与窗口等大时无隐形点击区
  const win = new BrowserWindow({
    width: contentSizes.clock.width,
    height: contentSizes.clock.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: !settings.lock.clock,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.clock.alwaysOnTop,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 轻量化：时钟隐藏时恢复默认节流（渲染层同时按 document.visibilityState 跳过走时）
      backgroundThrottling: true
    }
  })
  clockWin = win
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(settings.clock.alwaysOnTop, 'floating')
  loadRenderer(win, 'clock')
  win.once('ready-to-show', () => {
    // 只做布局定位；真正显示要等渲染层回报内容尺寸（见 applyClockLayout 的 showClockIfReady），
    // 避免初始 240×120 透明窗口在内容更小时产生隐形点击区
    applyClockLayout()
  })
  win.on('moved', () => {
    if (applyingClock) return
    // 位置锁定：忽略用户拖动产生的位置变更（程序化布局不受影响）
    if (getSettings().lock.clock) return
    if (clockMoveTimer) clearTimeout(clockMoveTimer)
    clockMoveTimer = setTimeout(() => {
      clockMoveTimer = null
      const current = getClockWindow()
      if (!current) return
      if (getSettings().lock.clock) return
      const clock = getSettings().clock
      if (clock.snapToEdge) {
        // 吸附模式：松手后吸附到最近的屏幕边（只调整最近的一轴）
        snapClockToNearestEdge()
        return
      }
      // 自由摆放模式（v1.2）：拖到哪停在哪，把屏幕坐标写入设置，重启后精确还原
      const bounds = current.getBounds()
      updateSettings({ clock: { freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
    }, 150)
  })
  win.on('closed', () => {
    clockWin = null
  })
  hardenWindow(win)
  installRendererSelfHeal(win, 'clock')
  if (!settings.clock.visible) win.hide()
  return win
}

/** 时钟位置：freeX/freeY 均 >= 0 时使用坐标；否则主屏右上角（workArea + 12px 边距） */
function computeClockBounds(clock: ClockConfig, size: Size, area: Rect): Rect {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  const hasPosition = clock.freeX >= 0 && clock.freeY >= 0
  const x = hasPosition ? clock.freeX : area.x + area.width - width - MARGIN
  const y = hasPosition ? clock.freeY : area.y + MARGIN
  return {
    x: clamp(x, area.x, area.x + Math.max(0, area.width - width)),
    y: clamp(y, area.y, area.y + Math.max(0, area.height - height)),
    width,
    height
  }
}

/** 时钟窗口所在的显示器工作区：已定位按坐标就近匹配，未定位用主屏 */
function clockWorkArea(clock: ClockConfig): Rect {
  if (clock.freeX >= 0 && clock.freeY >= 0) {
    return screen.getDisplayNearestPoint({
      x: Math.round(clock.freeX + contentSizes.clock.width / 2),
      y: Math.round(clock.freeY + contentSizes.clock.height / 2)
    }).workArea
  }
  return screen.getPrimaryDisplay().workArea
}

export function applyClockLayout(): void {
  const win = getClockWindow()
  if (!win) return
  const clock = getSettings().clock
  if (!clock.visible) {
    if (win.isVisible()) win.hide()
    return
  }
  const next = computeClockBounds(clock, contentSizes.clock, clockWorkArea(clock))
  const current = win.getBounds()
  if (current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) {
    showClockIfReady(win)
    return
  }
  applyingClock = true
  win.setBounds(next)
  showClockIfReady(win)
  setTimeout(() => {
    applyingClock = false
  }, 80)
}

/** 收到首次内容尺寸回报后才允许显示，避免初始透明窗口产生隐形点击区（AC-13.5） */
function showClockIfReady(win: BrowserWindow): void {
  if (!clockContentSized || win.isVisible()) return
  win.showInactive()
}

/** 拖动结束后只吸附离得最近的一轴（12px 边距），另一轴保留用户拖动的位置并收敛到可见区域 */
function snapClockToNearestEdge(): void {
  const win = getClockWindow()
  if (!win) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const distances: Record<DockEdge, number> = {
    top: bounds.y - area.y,
    bottom: area.y + area.height - (bounds.y + bounds.height),
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width)
  }
  const edge = (Object.keys(distances) as DockEdge[]).reduce((best, candidate) =>
    distances[candidate] < distances[best] ? candidate : best
  )
  let x = bounds.x
  let y = bounds.y
  switch (edge) {
    case 'top':
      y = area.y + MARGIN
      break
    case 'bottom':
      y = area.y + area.height - bounds.height - MARGIN
      break
    case 'left':
      x = area.x + MARGIN
      break
    case 'right':
      x = area.x + area.width - bounds.width - MARGIN
      break
  }
  const freeX = Math.round(clamp(x, area.x, area.x + Math.max(0, area.width - bounds.width)))
  const freeY = Math.round(clamp(y, area.y, area.y + Math.max(0, area.height - bounds.height)))
  // 写入设置后经 subscribeSettings → applyClockLayout 完成吸附，程序化 setBounds 不会再次触发 moved 写回
  updateSettings({ clock: { freeX, freeY } })
}

/* ------------------------------- 设置窗口 ------------------------------- */

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWin && !settingsWin.isDestroyed() ? settingsWin : null
}

export function openSettingsWindow(): BrowserWindow {
  const existing = getSettingsWindow()
  if (existing) {
    // v1.5：渲染进程崩溃后窗口对象仍存活，旧的 show()+focus() 会聚焦一个死窗口
    // （用户表现为「设置打不开」）。检测到崩溃直接销毁重建。
    if (existing.webContents.isCrashed()) {
      logToFile('main', '[settings] 检测到渲染进程已崩溃，销毁并重建设置窗口')
      try {
        existing.destroy()
      } catch {
        /* 已销毁 */
      }
      settingsWin = null
    } else {
      if (!existing.isVisible()) existing.show()
      existing.show()
      existing.focus()
      return existing
    }
  }
  const win = new BrowserWindow({
    width: 580,
    height: 760,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    backgroundColor: '#14151a',
    roundedCorners: true,
    title: 'Nexus 设置',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  settingsWin = win
  win.setMenuBarVisibility(false)
  loadRenderer(win, 'settings')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    settingsWin = null
    // 窗口在消费请求前被关掉：丢弃待处理请求，避免下次打开设置时莫名弹出编辑弹层
    pendingEditAppId = null
  })
  hardenWindow(win)
  installRendererSelfHeal(win, 'settings')
  return win
}

/* ------------------------------ 公共能力 ------------------------------ */

/**
 * v1.6：Dock 右键菜单「编辑名称与图标…」的跨窗口定位。
 * 主进程记一条待处理请求：设置窗口还没创建 → 挂载后 consume 取走；
 * 设置窗口已存在 → 直接转发 apps:editRequest 事件，切到「应用」页并打开弹层。
 */
let pendingEditAppId: string | null = null

export function requestAppEditor(id: string): void {
  if (typeof id !== 'string' || id.length === 0) return
  const win = openSettingsWindow()
  // 已加载完成的窗口：直接转发事件（消费后清空待处理请求，避免下次手动打开设置时又弹出旧弹层）
  if (!win.webContents.isLoadingMainFrame()) {
    pendingEditAppId = null
    setTimeout(() => {
      if (win.isDestroyed()) return
      try {
        win.webContents.send(IPC.appsEditRequest, id)
      } catch (error) {
        logToFile('main', `[settings] 转发应用编辑请求失败：${String(error)}`)
      }
    }, 50)
    return
  }
  // 新窗口：只走「挂载后 consume」这一条路径，避免事件 + consume 双路径重复打开弹层
  pendingEditAppId = id
}

/** 设置窗口挂载时消费一次待处理的编辑请求（新开窗口的主要路径） */
export function consumePendingAppEditor(): string | null {
  const id = pendingEditAppId
  pendingEditAppId = null
  return id
}

export function setContentSize(target: WindowTarget, size: Size): void {
  if (target !== 'dock' && target !== 'music' && target !== 'clock') return
  let next: Size = { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) }
  if (target === 'dock') {
    // v1.5：图标数量/尺寸让内容超过工作区时，把窗口夹到工作区内（渲染层据此改为内部滚动）。
    // 旧实现只夹紧坐标、从不夹宽度 → Dock 会伸出屏幕，尾部图标与末端开关点不到。
    const display = screen.getDisplayMatching(getDockWindow()?.getBounds() ?? screen.getPrimaryDisplay().bounds)
    const maxWidth = Math.max(160, display.workArea.width - MARGIN * 2)
    const maxHeight = Math.max(96, display.workArea.height - MARGIN * 2)
    next = { width: Math.min(next.width, maxWidth), height: Math.min(next.height, maxHeight) }
  }
  const prev = contentSizes[target]
  if (prev.width === next.width && prev.height === next.height) {
    // 时钟首次回报的尺寸即使与初始值相同，也要触发一次布局以完成首次显示
    if (target === 'clock') {
      clockContentSized = true
      applyClockLayout()
    }
    return
  }
  contentSizes[target] = next
  if (target === 'dock') applyDockLayout()
  else if (target === 'music') applyMusicLayout()
  else {
    clockContentSized = true
    applyClockLayout()
  }
}

export function allWindows(): BrowserWindow[] {
  return [getDockWindow(), getMusicWindow(), getClockWindow(), getSettingsWindow()].filter(
    (win): win is BrowserWindow => win !== null
  )
}

/* ------------------------- Dock 显隐（托盘 / 右键菜单） ------------------------- */

/**
 * v1.5：显示或隐藏 Dock（不退出应用）。
 * 隐藏走 hide() 而不是关窗——Dock 窗口一旦 closed 就会触发整应用退出（index.ts 的主窗口语义）。
 */
export function setDockVisible(visible: boolean): void {
  dockHiddenByUser = !visible
  const win = getDockWindow()
  if (!win) return
  if (visible) {
    applyFloatingVisibility()
    applyDockLayout()
  } else {
    hiddenByDesktop.dock = false
    if (win.isVisible()) win.hide()
  }
  logToFile('main', `[dock] 用户${visible ? '显示' : '隐藏'}了 Dock`)
}

/** 当前 Dock 是否对用户可见（隐藏状态 + 「仅在桌面显示」都算不可见） */
export function isDockVisible(): boolean {
  const win = getDockWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return false
  return !dockHiddenByUser
}

/** v1.5：托盘菜单「吸附到最近屏幕边」——把自由摆放的 Dock 吸回最近的边 */
export function snapDockToEdge(): void {
  snapDockToNearestEdge()
}

export function broadcast(channel: string, payload?: unknown): void {
  for (const win of allWindows()) {
    if (win.webContents.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch (error) {
      console.warn('[broadcast] 发送失败', channel, error)
    }
  }
}

/** 位置锁定 → 同步三个悬浮窗的「可拖动」状态；设置窗口不受影响（AC-14.7） */
function applyLockState(settings: Settings): void {
  getDockWindow()?.setMovable(!settings.lock.dock)
  getMusicWindow()?.setMovable(!settings.lock.music)
  getClockWindow()?.setMovable(!settings.lock.clock)
}

function onSettingsChanged(settings: Settings): void {
  const dock = getDockWindow()
  const previous = lastSettings
  lastSettings = settings

  // 位置锁定：设置变更后立即生效（渲染层 data-locked 由 settings:changed 广播驱动）
  applyLockState(settings)

  if (dock) {
    dock.setAlwaysOnTop(settings.dock.alwaysOnTop, 'pop-up-menu')
    applyDockMaterial(dock)
  }

  // 用户把「吸附到边缘」打开：以当前位置反算最近边，避免跳回默认位置
  if (previous && !previous.dock.snapToEdge && settings.dock.snapToEdge) {
    snapDockToNearestEdge()
  } else if (previous && previous.dock.snapToEdge && !settings.dock.snapToEdge) {
    // 关闭吸附：把当前窗口位置固化到自由坐标
    if (dock) {
      const bounds = dock.getBounds()
      updateSettings({ dock: { freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
    }
  } else {
    applyDockLayout()
  }

  // 音乐卡片：置顶联动（v1.3 共性项）+ 显隐
  const musicWindowNow = getMusicWindow()
  if (musicWindowNow) musicWindowNow.setAlwaysOnTop(settings.music.alwaysOnTop, 'floating')
  if (settings.music.visible) {
    if (!getMusicWindow()) createMusicWindow()
    // 音乐吸附开关翻转：只在自由模式下换算坐标，避免打断「跟随 Dock」
    if (previous && !previous.music.snapToEdge && settings.music.snapToEdge && settings.music.anchor === 'free') {
      // 开启吸附：以当前位置反算最近边并吸附（不跳变）
      snapMusicToNearestEdge()
    } else if (
      previous &&
      previous.music.snapToEdge &&
      !settings.music.snapToEdge &&
      settings.music.anchor === 'free'
    ) {
      // 关闭吸附：把当前位置固化为自由坐标（不跳变）
      const win = getMusicWindow()
      if (win) {
        const bounds = win.getBounds()
        updateSettings({ music: { freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
      }
    } else {
      applyMusicLayout()
    }
  } else {
    const music = getMusicWindow()
    if (music && music.isVisible()) music.hide()
  }

  // 时钟：置顶联动 + 显隐（隐藏只 hide 不销毁，下次显示零成本）
  const clockWindow = getClockWindow()
  if (clockWindow) clockWindow.setAlwaysOnTop(settings.clock.alwaysOnTop, 'floating')
  if (settings.clock.visible) {
    if (!getClockWindow()) createClockWindow()
    // v1.2 吸附开关翻转：false→true 以当前位置反算最近边；true→false 固化当前坐标（均不跳变）
    if (previous && !previous.clock.snapToEdge && settings.clock.snapToEdge) {
      snapClockToNearestEdge()
    } else if (previous && previous.clock.snapToEdge && !settings.clock.snapToEdge) {
      const win = getClockWindow()
      if (win) {
        const bounds = win.getBounds()
        updateSettings({ clock: { freeX: Math.round(bounds.x), freeY: Math.round(bounds.y) } })
      }
    } else {
      applyClockLayout()
    }
  } else {
    const win = getClockWindow()
    if (win && win.isVisible()) win.hide()
  }

  applyFloatingVisibility()
}

/** 桌面前台状态变化（来自 desktop-state.ps1 桥） */
export function applyDesktopState(state: DesktopState): void {
  lastDesktopState = state
  applyFloatingVisibility()
}

/**
 * 「仅在桌面显示」（v1.3 起三窗口通用）：
 * 当前台窗口最大化/全屏（且不是本应用窗口）时，隐藏开启了 onlyOnDesktop 的悬浮窗口；
 * 回到桌面后自动恢复。用户主动隐藏的窗口（music.visible / clock.visible = false）不受影响。
 */
function applyFloatingVisibility(): void {
  const settings = getSettings()
  const state = lastDesktopState
  // v1.5 修复：desktop-state 桥给的 foregroundPid 是窗口所属线程的进程（渲染进程），
  // 永远不等于主进程 process.pid。改为比对本应用所有窗口的 OS 进程 id。
  const selfActive = state
    ? allWindows().some((win) => {
        try {
          return win.webContents.getOSProcessId() === state.foregroundPid
        } catch {
          return false
        }
      })
    : false
  const desktopBusy = !!state && !selfActive && (state.maximized || state.fullscreen)

  /** 统一的「让悬浮窗重新出现」路径：时钟必须等内容尺寸回报后才显示，避免隐形点击区 */
  const showFloating = (target: 'dock' | 'music' | 'clock', win: BrowserWindow): void => {
    if (target === 'clock') {
      applyClockLayout()
      showClockIfReady(win)
      return
    }
    win.showInactive()
    if (target === 'dock') applyDockLayout()
    else applyMusicLayout()
  }

  const entries: Array<{
    target: 'dock' | 'music' | 'clock'
    win: BrowserWindow | null
    onlyOnDesktop: boolean
    userVisible: boolean
  }> = [
    {
      target: 'dock',
      win: getDockWindow(),
      onlyOnDesktop: settings.dock.onlyOnDesktop,
      // v1.5：托盘「显示 Dock」开关（用户主动隐藏）优先于桌面状态
      userVisible: !dockHiddenByUser
    },
    {
      target: 'music',
      win: getMusicWindow(),
      onlyOnDesktop: settings.music.onlyOnDesktop,
      userVisible: settings.music.visible
    },
    {
      target: 'clock',
      win: getClockWindow(),
      onlyOnDesktop: settings.clock.onlyOnDesktop,
      userVisible: settings.clock.visible
    }
  ]

  for (const entry of entries) {
    const { target, win } = entry
    if (!win) continue
    if (!entry.userVisible) {
      // 用户主动隐藏：由各自显隐逻辑负责，这里只清掉桌面隐藏标记
      hiddenByDesktop[target] = false
      if (win.isVisible()) win.hide()
      continue
    }
    const shouldHide = entry.onlyOnDesktop && desktopBusy
    if (shouldHide === hiddenByDesktop[target]) {
      // 状态未变时兜底确保「应显示」的窗口可见（启动/重建/首次桌面状态到达等场景）
      if (!shouldHide && !win.isVisible()) showFloating(target, win)
      continue
    }
    hiddenByDesktop[target] = shouldHide
    if (shouldHide) {
      if (win.isVisible()) win.hide()
    } else {
      showFloating(target, win)
    }
  }
}

export function setupWindows(): void {
  lastSettings = getSettings()
  createDockWindow()
  if (getSettings().music.visible) createMusicWindow()
  if (getSettings().clock.visible) createClockWindow()
  // 重启后保持锁定状态（窗口构造参数已初始化，这里再统一兜底一次）
  applyLockState(getSettings())
  if (unsubscribers.length === 0) unsubscribers.push(subscribeSettings(onSettingsChanged))

  const relayout = (): void => {
    applyDockLayout()
    applyMusicLayout()
    applyClockLayout()
  }
  screen.on('display-metrics-changed', relayout)
  screen.on('display-added', relayout)
  screen.on('display-removed', relayout)
}

export function destroyWindows(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  if (dockWin && !dockWin.isDestroyed()) dockWin.destroy()
  if (musicWin && !musicWin.isDestroyed()) musicWin.destroy()
  if (clockWin && !clockWin.isDestroyed()) clockWin.destroy()
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy()
  dockWin = null
  musicWin = null
  clockWin = null
  settingsWin = null
  clockContentSized = false
}
