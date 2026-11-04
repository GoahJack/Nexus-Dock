/**
 * 窗口通用工具（v1.7 从 windowManager 抽取）。
 *
 * 目的：Dock / 音乐卡片 / 桌面时钟 / 附加窗口 / 设置窗口共用同一套
 * 「安全加固 + 渲染进程自愈 + 加载页面 + 显隐」实现，避免每个窗口各写一份。
 *
 * v1.7「显示桌面」修复的两个核心工具也在这里：
 * - isShown()：Electron 的 isVisible() 对最小化窗口返回 true（Windows 最小化不清 WS_VISIBLE），
 *   所以「可见」必须同时判断 !isMinimized()，否则窗口被 shell 最小化后会被误判为「已显示」。
 * - guardAgainstMinimize()：Windows「显示桌面」由 shell 直接 SW_MINIMIZE 顶层窗口，Chromium
 *   不会给应用任何设置变更；旧实现只在桌面状态变化时评估可见性，窗口一旦被最小化就永远不回来。
 */
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { logToFile } from './logger'

export const IS_DEV = !!process.env['ELECTRON_RENDERER_URL']
export const PRELOAD_PATH = join(__dirname, '../preload/index.js')

const RENDERER_RELOAD_WINDOW_MS = 60_000
const RENDERER_RELOAD_MAX = 3
const RENDERER_RELOAD_SLOW_MS = 10_000

/**
 * 渲染进程崩溃自愈的限流表。
 * `render-process-gone` 后 BrowserWindow 仍然「存活」（isDestroyed() 为 false），
 * 旧实现只打日志 → Dock/音乐卡片永久白屏、设置窗「点不开」。
 */
const rendererReloads = new Map<BrowserWindow, { count: number; firstAt: number }>()

/** 数值夹紧（窗口坐标/尺寸/百分比共用） */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 窗口「真的对用户可见」= 未被销毁 + OS 可见 + 未最小化（见文件头注释） */
export function isShown(win: BrowserWindow): boolean {
  if (win.isDestroyed() || !win.isVisible()) return false
  return !win.isMinimized()
}

/**
 * 恢复并显示窗口（不抢焦点）。
 * 最小化窗口必须先 restore 再 showInactive：直接 showInactive 不会取消最小化。
 */
export function showRestored(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) {
    try {
      win.restore()
    } catch {
      /* 窗口可能正处于销毁流程 */
    }
  }
  if (!win.isVisible()) win.showInactive()
}

/**
 * 「显示桌面」兜底：shell 最小化窗口时自行恢复。
 *
 * 只在用户没有主动隐藏窗口时恢复（shouldShow 由调用方按「用户可见意图」给：
 * Dock 看托盘隐藏标记，音乐/时钟/附加窗口看各自 visible 配置）。
 * 「仅在桌面显示」的策略性隐藏不在这里处理——那种情况下窗口本来就处于 hide() 状态，
 * shell 不会最小化它；恢复后下一次桌面状态变化仍会由 applyFloatingVisibility 统一决策。
 *
 * 为什么不是「最小化后 60ms 恢复一次」：Windows 的最小化/还原带 DWM 动画，外部
 * SW_MINIMIZE 的生效时刻可能晚于第一次 restore，只试一次会偶发「恢复后又被压回去」。
 * 这里在多个时间点重试，直到窗口确实不再最小化（正常场景第一个时间点就成功，后续空跑）。
 */
export function guardAgainstMinimize(win: BrowserWindow, label: string, shouldShow: () => boolean): void {
  win.on('minimize', () => {
    let logged = false
    for (const delay of [60, 250, 600, 1200]) {
      setTimeout(() => {
        if (win.isDestroyed() || !win.isMinimized() || !shouldShow()) return
        showRestored(win)
        if (!logged) {
          logged = true
          logToFile('main', `[${label}] 窗口被系统最小化（如「显示桌面」），已自动恢复显示`)
        }
      }, delay)
    }
  })
}

/**
 * 窗口加固（纵深防御，非已知漏洞）：
 * 1) 只允许本地页面在自身 URL 内活动，任何导航一律拦截；
 * 2) 禁止 window.open / target=_blank 生成子窗口（子窗口会继承 preload → 暴露 window.nexus）；
 * 3) 禁止 <webview> 挂载。
 * 这样即使渲染层出现注入点，远程页面也拿不到 IPC 桥。
 */
export function hardenWindow(win: BrowserWindow): void {
  const wc = win.webContents
  const devUrl = IS_DEV ? process.env['ELECTRON_RENDERER_URL'] : undefined
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
 * 渲染进程崩溃自愈：60 秒内最多重载 3 次；超过则退化为每 10 秒一次慢重载，
 * 既不会永久白屏，也不会陷入重载风暴。Dock 窗口不销毁（销毁等于退出应用）。
 */
export function installRendererSelfHeal(win: BrowserWindow, label: string): void {
  win.webContents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed() || details.reason === 'clean-exit') return
    logToFile('main', `[${label}] 渲染进程退出 reason=${details.reason} exitCode=${String(details.exitCode)}，开始自愈`)
    const now = Date.now()
    const entry = rendererReloads.get(win)
    const withinWindow = !!entry && now - entry.firstAt <= RENDERER_RELOAD_WINDOW_MS
    const count = withinWindow && entry ? entry.count + 1 : 1
    rendererReloads.set(win, { count, firstAt: withinWindow && entry ? entry.firstAt : now })
    if (count > RENDERER_RELOAD_MAX) {
      rendererReloads.delete(win)
      logToFile('main', `[${label}] 60s 内第 ${count} 次崩溃，改为 ${RENDERER_RELOAD_SLOW_MS}ms 后慢重载`)
      setTimeout(() => {
        if (win.isDestroyed()) return
        logToFile('main', `[${label}] 慢重载渲染层`)
        win.webContents.reload()
      }, RENDERER_RELOAD_SLOW_MS)
      return
    }
    try {
      win.webContents.reload()
    } catch (error) {
      logToFile('main', `[${label}] 自愈重载失败：${String(error)}`)
    }
  })
  win.on('closed', () => {
    rendererReloads.delete(win)
  })
}

/** 加载渲染页（page = src/renderer 下的目录名，如 dock / music / clock / 附加窗口的 page） */
export function loadRenderer(win: BrowserWindow, page: string): void {
  if (IS_DEV && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}/index.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
  }
}
