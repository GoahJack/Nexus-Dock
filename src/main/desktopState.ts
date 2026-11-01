/**
 * 桌面状态桥（v1.4 轻量化）：
 *
 * 「仅在桌面显示」（docs/window-conventions.md §2 C11）需要知道当前前台窗口是否最大化/全屏。
 *
 * v1.4 之前：常驻 `powershell.exe -File desktop-state.ps1`，脚本加载 UIAutomation 程序集，
 * 每个进程工作集约 100MB。v1.4 起优先使用原生助手 `resources/desktop-state.exe`
 * （.NET Framework + P/Invoke，实测常驻约 14MB），找不到可执行文件时回退到 ps1（行为不退化）。
 *
 * 协议（两种实现完全一致，JSON Lines / stdout UTF-8 无 BOM）：
 *   {"type":"ready"}
 *   {"type":"state","foregroundPid":1234,"maximized":false,"fullscreen":false,"desktop":true,"className":"Progman"}
 *   {"type":"error","message":"..."}
 *
 * 生命周期：
 * - start({ enabled }) 只负责登记；是否真正拉起子进程由 enabled 决定；
 * - setEnabled(false) 会杀掉子进程并清定时器（「仅在桌面显示」三窗口全关时零常驻）；
 * - setEnabled(true) 立即重新拉起，并保留指数退避重启（1s→2s→5s 上限）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export interface DesktopState {
  /** 前台窗口所属进程 ID；0 表示没有前台窗口 */
  foregroundPid: number
  maximized: boolean
  fullscreen: boolean
  desktop: boolean
  className: string
}

export interface DesktopStateMonitor {
  /**
   * 启动监控。默认立即拉起子进程；传 `{ enabled: false }` 时只登记不启动，
   * 等后续 setEnabled(true) 再拉起（避免「仅在桌面显示」全关时白起进程）。
   */
  start(options?: { enabled?: boolean }): void
  /** 按需启停：false → 杀子进程 + 清定时器；true → 立即重新拉起 */
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  /** 永久停止（应用退出时调用），之后不再重启 */
  stop(): void
  get(): DesktopState | null
  onChange(cb: (state: DesktopState) => void): () => void
}

interface MonitorOptions {
  /** 判断某个状态是否应当显示 Dock（由 windowManager 注入，避免循环依赖） */
  onEvaluate?: () => void
}

/** 默认采样间隔：桌面状态感知 800ms 足够（v1.4 从 400ms 放宽，进一步降 CPU） */
const DEFAULT_POLL_INTERVAL_MS = 800
/** 子进程稳定运行超过该时长后，退避时长复位（避免偶发退出耗尽退避） */
const STABLE_RUNTIME_MS = 30_000
const MIN_RESTART_DELAY_MS = 1000
const MAX_RESTART_DELAY_MS = 5000

interface BridgeTarget {
  kind: 'exe' | 'ps1'
  path: string
}

/** 原生助手候选路径：环境变量 → app/resources → out/main/../../resources → 打包 resources */
function exeCandidates(): string[] {
  const candidates: string[] = []
  const fromEnv = process.env['NEXUS_DESKTOP_EXE']
  if (fromEnv && fromEnv.trim().length > 0) candidates.push(fromEnv.trim())
  try {
    candidates.push(join(app.getAppPath(), 'resources', 'desktop-state.exe'))
  } catch {
    /* ignore */
  }
  candidates.push(join(__dirname, '../../resources/desktop-state.exe'))
  try {
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'resources', 'desktop-state.exe'))
      candidates.push(join(process.resourcesPath, 'desktop-state.exe'))
    }
  } catch {
    /* ignore */
  }
  return candidates
}

/** 回退脚本候选路径（与 native 版同样的查找顺序） */
function scriptCandidates(): string[] {
  const candidates: string[] = []
  const fromEnv = process.env['NEXUS_DESKTOP_SCRIPT']
  if (fromEnv && fromEnv.trim().length > 0) candidates.push(fromEnv.trim())
  try {
    candidates.push(join(app.getAppPath(), 'resources', 'desktop-state.ps1'))
  } catch {
    /* ignore */
  }
  candidates.push(join(__dirname, '../../resources/desktop-state.ps1'))
  try {
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'resources', 'desktop-state.ps1'))
      candidates.push(join(process.resourcesPath, 'desktop-state.ps1'))
    }
  } catch {
    /* ignore */
  }
  return candidates
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

/** 采样间隔（允许环境变量覆盖，便于验证/压测；默认 800ms） */
function pollIntervalMs(): number {
  const raw = Number(process.env['NEXUS_DESKTOP_INTERVAL'])
  if (Number.isFinite(raw) && raw >= 100 && raw <= 5000) return Math.round(raw)
  return DEFAULT_POLL_INTERVAL_MS
}

/** 子进程可能拿不到完整环境变量（TEMP/APPDATA/ProgramData 为空会导致 ps1 里的路径失效） */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TEMP: process.env['TEMP'] || tmpdir(),
    TMP: process.env['TMP'] || tmpdir(),
    ProgramData: process.env['ProgramData'] || 'C:\\ProgramData'
  }
  try {
    env.APPDATA = process.env['APPDATA'] || app.getPath('appData')
    env.LOCALAPPDATA = process.env['LOCALAPPDATA'] || app.getPath('appData')
  } catch {
    /* app 尚未 ready 时忽略 */
  }
  return env
}

function log(message: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'desktop.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {
    /* 日志失败不影响功能 */
  }
}

export function createDesktopStateMonitor(options: MonitorOptions = {}): DesktopStateMonitor {
  let child: ChildProcess | null = null
  let disposed = false
  let enabled = true
  /** 原生助手启动失败过一次 → 后续固定回退 ps1，避免无限重试 */
  let preferScript = false
  let timer: NodeJS.Timeout | null = null
  let restartDelay = MIN_RESTART_DELAY_MS
  let spawnedAt = 0
  let state: DesktopState | null = null
  const listeners = new Set<(state: DesktopState) => void>()

  const emit = (next: DesktopState): void => {
    state = next
    for (const listener of listeners) {
      try {
        listener(next)
      } catch (error) {
        log(`监听器异常: ${String(error)}`)
      }
    }
    options.onEvaluate?.()
  }

  const clearRestartTimer = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const scheduleRestart = (): void => {
    if (disposed || !enabled) return
    if (timer) return
    // 稳定运行过一段时间的进程偶发退出 → 退避复位，避免长期运行后重启越来越慢
    if (spawnedAt > 0 && Date.now() - spawnedAt > STABLE_RUNTIME_MS) {
      restartDelay = MIN_RESTART_DELAY_MS
    }
    const delay = restartDelay
    restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS)
    timer = setTimeout(() => {
      timer = null
      spawnBridge()
    }, delay)
  }

  const resolveTarget = (): BridgeTarget | null => {
    if (!preferScript) {
      const exe = firstExisting(exeCandidates())
      if (exe) return { kind: 'exe', path: exe }
    }
    const script = firstExisting(scriptCandidates())
    if (script) return { kind: 'ps1', path: script }
    return null
  }

  const killChild = (): void => {
    const current = child
    child = null
    spawnedAt = 0
    if (!current) return
    try {
      current.kill()
    } catch {
      /* ignore */
    }
  }

  const handleLine = (line: string): void => {
    const text = line.trim()
    if (!text) return
    try {
      const message = JSON.parse(text) as { type: string; message?: string } & Partial<DesktopState>
      if (message.type === 'state') {
        emit({
          foregroundPid: Number(message.foregroundPid) || 0,
          maximized: !!message.maximized,
          fullscreen: !!message.fullscreen,
          desktop: !!message.desktop,
          className: String(message.className ?? '')
        })
      } else if (message.type === 'error') {
        log(`桌面状态桥错误: ${message.message ?? ''}`)
      }
    } catch {
      /* 忽略无法解析的行 */
    }
  }

  const handleGone = (proc: ChildProcess): void => {
    if (child !== proc) return
    child = null
    if (disposed || !enabled) return
    log(`桌面状态桥退出，${restartDelay}ms 后重启`)
    scheduleRestart()
  }

  const spawnBridge = (): void => {
    if (disposed || !enabled || child) return

    const target = resolveTarget()
    if (!target) {
      // 既没有 exe 也没有 ps1：保持旧行为不再无限重试（避免刷日志），
      // 但 setEnabled 再次切换或下次设置变更时仍会重试。
      log('找不到 desktop-state.exe / desktop-state.ps1，跳过桌面状态检测')
      return
    }

    const interval = pollIntervalMs()
    try {
      const proc =
        target.kind === 'exe'
          ? spawn(target.path, [`--interval=${interval}`, '--watch-stdin'], {
              windowsHide: true,
              env: childEnv()
            })
          : spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                target.path,
                '-IntervalMs',
                String(interval)
              ],
              { windowsHide: true, env: childEnv() }
            )

      child = proc
      spawnedAt = Date.now()
      let buffer = ''
      proc.stdout?.setEncoding('utf8')
      proc.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
        // 防御：异常超长行直接丢弃，避免内存增长
        if (buffer.length > 64 * 1024) buffer = ''
      })
      proc.stderr?.setEncoding('utf8')
      proc.stderr?.on('data', (chunk: string) => {
        const text = String(chunk).trim()
        if (text) log(`stderr: ${text.slice(0, 300)}`)
      })
      proc.on('error', (error) => {
        log(`启动失败: ${String(error)}`)
        if (target.kind === 'exe') {
          // 原生助手被策略/杀软拦截等情况：下次重试用 ps1，保证桌面状态检测不失效
          preferScript = true
          log('原生桌面状态助手无法启动，回退 desktop-state.ps1')
        }
        handleGone(proc)
      })
      proc.on('exit', (code) => {
        if (disposed || !enabled) {
          if (child === proc) child = null
          return
        }
        log(`桌面状态桥退出 code=${String(code)}`)
        handleGone(proc)
      })
      log(`桌面状态桥已启动 kind=${target.kind} pid=${String(proc.pid)} interval=${interval}ms`)
    } catch (error) {
      log(`异常: ${String(error)}`)
      if (target.kind === 'exe') preferScript = true
      scheduleRestart()
    }
  }

  return {
    start(startOptions: { enabled?: boolean } = {}): void {
      if (disposed) return
      if (startOptions.enabled === false) {
        enabled = false
        return
      }
      enabled = true
      spawnBridge()
    },
    setEnabled(next: boolean): void {
      if (disposed || next === enabled) return
      enabled = next
      if (next) {
        restartDelay = MIN_RESTART_DELAY_MS
        spawnBridge()
      } else {
        clearRestartTimer()
        killChild()
      }
    },
    isEnabled(): boolean {
      return enabled && !disposed
    },
    stop(): void {
      disposed = true
      enabled = false
      clearRestartTimer()
      killChild()
    },
    get(): DesktopState | null {
      return state
    },
    onChange(cb: (state: DesktopState) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}
