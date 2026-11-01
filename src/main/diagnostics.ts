/**
 * 内存自测（v1.4 轻量化）：
 *
 * 默认零成本：只有设置了环境变量 NEXUS_MEM_REPORT（输出文件路径）时才启动采样。
 * 采样内容来自 Electron 官方 `app.getAppMetrics()`，是唯一可信的**进程级**归因来源
 * （主进程 / 渲染进程 / GPU / Utility），比在外部按 exe 名猜准确得多。
 *
 * 用法（开发与安装版都适用）：
 *   开发态：$env:NEXUS_MEM_REPORT = "D:\tmp\mem.jsonl"; $env:NEXUS_MEM_INTERVAL = "5000"
 *   安装版：在 %APPDATA%\nexus-dock 下新建空文件 mem-report.on（采样写入 logs\memory.jsonl）
 *
 * 每行一条 JSON：{ at, totalWorkingSetKB, totalPrivateKB, windows[], processes[] }
 * 进程的 workingSet 单位是 KB（Electron `MemoryInfo` 的既有约定）。
 */
import { app, BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Electron 进程类型：Browser=主进程，Tab=渲染进程，GPU/Utility=共享进程 */
export interface ProcessSample {
  pid: number
  type: string
  name: string
  serviceName?: string
  workingSetKB: number
  peakWorkingSetKB: number
  privateKB: number
  cpuPercent: number
}

export interface WindowSample {
  target: string
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

export interface MemorySample {
  at: number
  totalWorkingSetKB: number
  totalPrivateKB: number
  windows: WindowSample[]
  processes: ProcessSample[]
}

/** 从窗口 URL 反推窗口身份（dock / music / clock / settings），未知则回退为标题 */
function windowTarget(win: BrowserWindow): string {
  try {
    const url = win.webContents.getURL()
    for (const target of ['dock', 'music', 'clock', 'settings']) {
      if (url.includes(`/${target}/`)) return target
    }
    return url || '(blank)'
  } catch {
    return '(unknown)'
  }
}

function collect(): MemorySample {
  const metrics = app.getAppMetrics()
  const processes: ProcessSample[] = metrics.map((metric) => ({
    pid: metric.pid,
    type: String(metric.type),
    name: metric.name ?? '',
    serviceName: metric.serviceName,
    workingSetKB: metric.memory.workingSetSize,
    peakWorkingSetKB: metric.memory.peakWorkingSetSize,
    privateKB: metric.memory.privateBytes ?? 0,
    cpuPercent: metric.cpu.percentCPUUsage
  }))
  const windows: WindowSample[] = BrowserWindow.getAllWindows().map((win) => ({
    target: windowTarget(win),
    visible: win.isVisible(),
    bounds: win.getBounds()
  }))
  return {
    at: Date.now(),
    totalWorkingSetKB: processes.reduce((sum, item) => sum + item.workingSetKB, 0),
    totalPrivateKB: processes.reduce((sum, item) => sum + item.privateKB, 0),
    windows,
    processes
  }
}

/**
 * 启动采样；返回停止函数。未开启时返回空操作，不影响任何行为。
 *
 * 开启方式（任选其一）：
 * 1. 环境变量 `NEXUS_MEM_REPORT=<绝对路径>`（开发态推荐）；
 * 2. 在用户数据目录放一个标记文件 `mem-report.on`（安装版/从桌面快捷方式启动时使用，
 *    此时无法注入环境变量），采样写入 `<userData>/logs/memory.jsonl`。
 */
export function setupMemoryReport(): () => void {
  const fromEnv = process.env['NEXUS_MEM_REPORT']?.trim()
  const marker = join(app.getPath('userData'), 'mem-report.on')
  const file = fromEnv ? fromEnv : existsSync(marker) ? join(app.getPath('userData'), 'logs', 'memory.jsonl') : ''
  if (!file) return () => undefined

  const interval = Number(process.env['NEXUS_MEM_INTERVAL'] ?? 5000)
  const intervalMs = Number.isFinite(interval) && interval >= 1000 ? interval : 5000

  const write = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(collect())}\n`, 'utf8')
    } catch (error) {
      console.warn('[memory] 写入采样失败：', error)
    }
  }

  write()
  const timer = setInterval(write, intervalMs)
  // 采样定时器不应阻止进程退出
  timer.unref?.()
  console.log(`[memory] 内存采样已开启 → ${file}（每 ${intervalMs}ms）`)
  return () => clearInterval(timer)
}
