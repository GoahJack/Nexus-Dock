import { watchIslandWindow } from './islandProximity'
/**
 * 附加窗口管理器（v1.7 新增）。
 *
 * 「附加窗口」= 以后要新增的功能窗口（天气、便签…）。类型统一登记在
 * `src/shared/types.ts` 的 `EXTRA_WINDOW_KINDS` 注册表里，本文件只用注册表元数据
 * 创建/布局/显隐窗口，不写死任何具体功能窗口：
 *
 *   注册表一条 WindowKindSpec  →  这里自动：创建 BrowserWindow、加载 src/renderer/<page>/、
 *   内容尺寸自适应、拖拽落盘、吸附屏幕边、位置锁定、始终置顶、仅在桌面显示、
 *   托盘显隐入口、设置页共性项（设置页按注册表渲染）。
 *
 * 新增窗口时**不需要**改本文件；只有窗口独有的主进程行为（例如天气需要网络定时刷新）
 * 才需要另外接一条能力。v1.8 起注册表含「英语单词学习」（kind=wordstudy），
 * 本模块会自动创建/布局/显隐它；注册表为空时不会创建任何窗口。
 */
import { BrowserWindow, screen, type MenuItemConstructorOptions } from 'electron'
import {
  EXTRA_WINDOW_KINDS,
  SCREEN_MARGIN,
  findWindowKind,
  isHorizontalEdge,
  patchExtraWindows,
  type DockEdge,
  type ExtraWindowConfig,
  type Settings,
  type Size,
  type WindowKindSpec
} from '@shared/types'
import { logToFile } from './logger'
import { getSettings, updateSettings } from './settingsStore'
import {
  PRELOAD_PATH,
  clampNumber,
  guardAgainstMinimize,
  hardenWindow,
  installRendererSelfHeal,
  isShown,
  loadRenderer,
  showRestored
} from './windowUtils'

type Rect = { x: number; y: number; width: number; height: number }

const MARGIN = SCREEN_MARGIN
/** 默认位置（未定位且不吸附时）多个附加窗口的错开量 */
const DEFAULT_CASCADE_PX = 24

interface ExtraInstance {
  kind: string
  spec: WindowKindSpec
  win: BrowserWindow
  /** 渲染层量出的内容尺寸；窗口必须与内容等大，透明区域才不会变成点击区 */
  contentSize: Size
  /** 是否已收到渲染层首次内容尺寸回报（收到前不显示，避免初始透明窗口有隐形点击区） */
  sized: boolean
  /** 程序化 setBounds 守卫：避免 moved 事件把布局坐标又写回设置 */
  applying: boolean
  layoutVersion: number
  moveTimer: NodeJS.Timeout | null
  hiddenByDesktop: boolean
}

const instances = new Map<string, ExtraInstance>()

function log(message: string): void {
  logToFile('extra', message)
}

function configOf(settings: Settings, kind: string): ExtraWindowConfig | null {
  return settings.extraWindows.find((item) => item.kind === kind) ?? null
}

function getInstance(kind: string): ExtraInstance | null {
  const instance = instances.get(kind)
  if (!instance) return null
  if (instance.win.isDestroyed()) {
    instances.delete(kind)
    return null
  }
  return instance
}

/** 当前所有附加窗口（供 windowManager 的 allWindows / broadcast 使用） */
export function getExtraWindows(): BrowserWindow[] {
  return [...instances.values()].filter((instance) => !instance.win.isDestroyed()).map((instance) => instance.win)
}

export function getExtraWindowCount(): number {
  return getExtraWindows().length
}

/** 修改单个附加窗口配置（整体替换配置数组，主进程统一收敛） */
function patchExtraConfig(kind: string, patch: Partial<ExtraWindowConfig>): void {
  const settings = getSettings()
  const next = patchExtraWindows(settings, kind, patch)
  updateSettings({ extraWindows: next })
}

/* ------------------------------- 创建窗口 ------------------------------- */

function orderOf(kind: string): number {
  const index = EXTRA_WINDOW_KINDS.findIndex((spec) => spec.kind === kind)
  return index >= 0 ? index : 0
}

function createInstance(spec: WindowKindSpec, config: ExtraWindowConfig): ExtraInstance {
  const win = new BrowserWindow({
    width: spec.defaultSize.width,
    height: spec.defaultSize.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: !config.locked,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: config.alwaysOnTop,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 与音乐卡片/时钟一致：隐藏时恢复默认节流；渲染层在重新可见时补一次内容尺寸
      backgroundThrottling: true
    }
  })
  win.setMenuBarVisibility(false)
  win.setAlwaysOnTop(config.alwaysOnTop, 'floating')

  const instance: ExtraInstance = {
    kind: spec.kind,
    spec,
    win,
    contentSize: { ...spec.defaultSize },
    sized: false,
    applying: false,
    layoutVersion: 0,
    moveTimer: null,
    hiddenByDesktop: false
  }
  instances.set(spec.kind, instance)
  watchIslandWindow(win, () => configOf(getSettings(), spec.kind))

  loadRenderer(win, spec.page)

  win.once('ready-to-show', () => {
    // 只定位不显示：等渲染层回报内容尺寸后再 show（C7 尺寸自适应）
    applyExtraLayout(instance)
  })
  win.on('moved', () => {
    if (instance.applying) return
    const settings = getSettings()
    const latest = configOf(settings, spec.kind)
    // 位置锁定：忽略用户拖动产生的位置变更（程序化布局不受影响）
    if (!latest || latest.locked) return
    if (instance.moveTimer) clearTimeout(instance.moveTimer)
    instance.moveTimer = setTimeout(() => {
      instance.moveTimer = null
      const config = configOf(getSettings(), spec.kind)
      if (!config || config.locked) return
      if (config.snapToEdge) {
        snapExtraToNearestEdge(instance)
        return
      }
      const bounds = instance.win.getBounds()
      patchExtraConfig(spec.kind, {
        freeX: Math.round(bounds.x),
        freeY: Math.round(bounds.y)
      })
    }, 150)
  })
  win.on('closed', () => {
    instances.delete(spec.kind)
    log(`附加窗口已关闭 kind=${spec.kind}`)
  })

  hardenWindow(win)
  installRendererSelfHeal(win, `extra:${spec.kind}`)
  guardAgainstMinimize(win, `extra:${spec.kind}`, () => {
    const current = configOf(getSettings(), spec.kind)
    return !!current?.visible
  })

  if (!config.visible) win.hide()
  log(`附加窗口已创建 kind=${spec.kind} page=${spec.page}`)
  return instance
}

/* ------------------------------- 布局计算 ------------------------------- */

function workAreaOf(instance: ExtraInstance, config: ExtraWindowConfig): Rect {
  const { width, height } = instance.contentSize
  if (!config.snapToEdge && config.freeX >= 0 && config.freeY >= 0) {
    return screen.getDisplayNearestPoint({
      x: Math.round(config.freeX + width / 2),
      y: Math.round(config.freeY + height / 2)
    }).workArea
  }
  return screen.getDisplayMatching(instance.win.getBounds()).workArea
}

/** 附加窗口位置：吸附屏幕边（含 12px 边距） / 自由坐标 / 默认右上角级联 */
function computeExtraBounds(config: ExtraWindowConfig, size: Size, area: Rect, order: number): Rect {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  let x: number
  let y: number

  const hasPosition = !config.snapToEdge && config.freeX >= 0 && config.freeY >= 0
  if (hasPosition) {
    x = config.freeX
    y = config.freeY
  } else if (config.snapToEdge) {
    const ratio = clampNumber(config.alongPercent, 0, 100) / 100
    x = area.x + Math.round((area.width - width) * ratio)
    y = area.y + Math.round((area.height - height) * ratio)
    switch (config.edge) {
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
  } else {
    // 默认位置：主屏右上角，按注册顺序错开，避免多个附加窗口完全重叠
    x = area.x + area.width - width - MARGIN - order * DEFAULT_CASCADE_PX
    y = area.y + MARGIN + order * DEFAULT_CASCADE_PX
  }

  return {
    x: clampNumber(x, area.x, area.x + Math.max(0, area.width - width)),
    y: clampNumber(y, area.y, area.y + Math.max(0, area.height - height)),
    width,
    height
  }
}

/** 应用单个附加窗口的尺寸/位置/显隐（不显示未收到内容尺寸的窗口） */
function applyExtraLayout(instance: ExtraInstance): void {
  if (instance.win.isDestroyed()) return
  const config = configOf(getSettings(), instance.kind)
  if (!config || !config.visible) {
    if (instance.win.isVisible()) instance.win.hide()
    return
  }
  const area = workAreaOf(instance, config)
  const next = computeExtraBounds(config, instance.contentSize, area, orderOf(instance.kind))
  const current = instance.win.getBounds()
  const firstShow = instance.sized && !isShown(instance.win)

  if (
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  ) {
    if (firstShow) showRestored(instance.win)
    return
  }
  instance.applying = true
  const version = ++instance.layoutVersion
  instance.win.setBounds(next)
  if (firstShow) showRestored(instance.win)
  setTimeout(() => {
    if (version === instance.layoutVersion) instance.applying = false
  }, 80)
}

/** 拖动松手后吸附到最近屏幕边（保留沿边位置） */
function snapExtraToNearestEdge(instance: ExtraInstance): void {
  if (instance.win.isDestroyed()) return
  const bounds = instance.win.getBounds()
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
  const alongPercent = Math.round(clampNumber(percent, 0, 100) * 10) / 10
  patchExtraConfig(instance.kind, { edge, alongPercent })
}

/* ----------------------------- 对外生命周期 ----------------------------- */

/**
 * 按当前设置同步附加窗口：注册表里有配置 → 需要显示就创建/布局，不需要显示就隐藏；
 * 注册表里已不存在（或配置被去掉）的 kind → 销毁。设置变化与启动时调用。
 */
export function syncExtraWindows(settings: Settings): void {
  const desired = new Map(settings.extraWindows.map((config) => [config.kind, config]))
  // 1) 清理已不在注册表/配置里的窗口
  for (const kind of [...instances.keys()]) {
    if (!desired.has(kind)) destroyInstance(kind)
  }
  // 2) 按注册表创建 / 更新
  for (const config of settings.extraWindows) {
    const spec = findWindowKind(config.kind)
    if (!spec || spec.category !== 'extra') {
      // 只允许附加窗口走这条链路；内置窗口配置不会出现在 extraWindows 里
      continue
    }
    const existing = getInstance(config.kind)
    if (config.visible) {
      if (!existing) {
        createInstance(spec, config)
        continue
      }
      existing.win.setAlwaysOnTop(config.alwaysOnTop, 'floating')
      existing.win.setMovable(!config.locked)
      applyExtraLayout(existing)
    } else if (existing) {
      existing.hiddenByDesktop = false
      if (existing.win.isVisible()) existing.win.hide()
    }
  }
}

/** 屏幕分辨率/工作区变化后重新布局（windowManager 的 relayout 调用） */
export function applyExtraWindowsLayouts(): void {
  for (const instance of instances.values()) applyExtraLayout(instance)
}

/** 位置锁定联动（windowManager 的 applyLockState 调用） */
export function applyExtraLocks(settings: Settings): void {
  for (const instance of instances.values()) {
    const config = configOf(settings, instance.kind)
    instance.win.setMovable(!!config && !config.locked)
  }
}

/** 「仅在桌面显示」联动：桌面状态变化时调用（desktopBusy = 前台窗口最大化/全屏且非本应用） */
export function applyExtraDesktopVisibility(desktopBusy: boolean): void {
  const settings = getSettings()
  for (const instance of instances.values()) {
    const config = configOf(settings, instance.kind)
    if (!config) continue
    if (!config.visible) {
      instance.hiddenByDesktop = false
      if (instance.win.isVisible()) instance.win.hide()
      continue
    }
    const shouldHide = config.onlyOnDesktop && desktopBusy
    if (shouldHide === instance.hiddenByDesktop) {
      // 状态未变时兜底确保「应显示」的窗口可见（启动/重建/首次桌面状态到达等场景）
      if (!shouldHide && instance.sized && !isShown(instance.win)) showRestored(instance.win)
      continue
    }
    instance.hiddenByDesktop = shouldHide
    if (shouldHide) {
      if (instance.win.isVisible()) instance.win.hide()
    } else if (instance.sized) {
      showRestored(instance.win)
    }
  }
}

/**
 * 附加窗口渲染层上报内容尺寸（IPC `window:setOwnContentSize`，按发送者定位窗口）。
 * 返回 true 表示命中了某个附加窗口。
 */
export function setOwnContentSize(webContentsId: number, size: Size): boolean {
  for (const instance of instances.values()) {
    if (instance.win.isDestroyed() || instance.win.webContents.id !== webContentsId) continue
    const next = {
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height))
    }
    const firstReport = !instance.sized
    instance.sized = true
    if (instance.contentSize.width === next.width && instance.contentSize.height === next.height) {
      if (firstReport) applyExtraLayout(instance)
      return true
    }
    instance.contentSize = next
    applyExtraLayout(instance)
    return true
  }
  return false
}

/** 托盘菜单项：每个已注册附加窗口一个显隐勾选项（v1.8 起含英语单词学习） */
export function extraWindowMenuItems(): MenuItemConstructorOptions[] {
  return getSettings().extraWindows.map((config) => {
    const spec = findWindowKind(config.kind)
    return {
      label: `显示${spec?.label ?? config.kind}`,
      type: 'checkbox' as const,
      checked: config.visible,
      click: (item) => patchExtraConfig(config.kind, { visible: item.checked })
    }
  })
}

function destroyInstance(kind: string): void {
  const instance = instances.get(kind)
  if (!instance) return
  instances.delete(kind)
  if (instance.moveTimer) {
    clearTimeout(instance.moveTimer)
    instance.moveTimer = null
  }
  if (!instance.win.isDestroyed()) {
    try {
      instance.win.destroy()
    } catch {
      /* 已在销毁流程 */
    }
  }
  log(`附加窗口已销毁 kind=${kind}`)
}

/** 退出前销毁全部附加窗口 */
export function disposeExtraWindows(): void {
  for (const kind of [...instances.keys()]) destroyInstance(kind)
}
