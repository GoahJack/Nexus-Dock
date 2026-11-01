/**
 * SMTC 桥：常驻 powershell.exe 子进程，读取 Windows 系统媒体会话（SMTC）。
 *
 * 协议见 resources/smtc-bridge.ps1（JSON Lines）：
 *   {"type":"ready"} / {"type":"media", ...} / {"type":"error","message":"..."}
 * stdin 每行一条命令：playpause | next | prev | seek:<毫秒>
 *
 * 设计要点：
 * - 子进程异常退出 → 指数退避重启（1s/2s/3s，最多 5 次），不影响 Dock；
 * - 封面 PNG 落盘后读成 data URL（再次读取走内存缓存），读取失败降级为空封面；
 * - stderr / 桥错误事件写 userData/logs/media.log（写入失败静默）。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { DEFAULT_MEDIA_STATE, type MediaAction, type MediaState, type PlaybackStatus } from '@shared/types'

export interface SmtcBridge {
  start(): void
  stop(): void
  control(action: MediaAction, positionMs?: number): Promise<boolean>
  getState(): MediaState
  on(event: 'state', cb: (s: MediaState) => void): void
}

interface RawMediaEvent {
  type?: string
  status?: unknown
  title?: unknown
  artist?: unknown
  album?: unknown
  durationMs?: unknown
  positionMs?: unknown
  canNext?: unknown
  canPrev?: unknown
  appId?: unknown
  artPath?: unknown
}

const MAX_RESTARTS = 5
// AC-5.4 要求桥进程异常退出后 ≤3s 内恢复；指数退避 1s/2s/3s（上限 3s）
const MAX_RESTART_DELAY = 3000
const ART_CACHE_LIMIT = 24

let logDirReady = false

/** 写入 userData/logs/media.log；任何失败都静默（日志不能影响音乐功能） */
function mediaLog(message: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    if (!logDirReady) {
      fs.mkdirSync(dir, { recursive: true })
      logDirReady = true
    }
    fs.appendFile(path.join(dir, 'media.log'), `[${new Date().toISOString()}] ${message}\n`, () => {
      /* 忽略写入失败 */
    })
  } catch {
    /* 忽略 */
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function asStatus(value: unknown): PlaybackStatus {
  if (value === 'playing' || value === 'paused' || value === 'stopped') return value
  return 'stopped'
}

/** 脚本路径解析：环境变量 → app.getAppPath()/resources → out/main/../../resources → 打包 resources */
function scriptCandidates(): string[] {
  const candidates: string[] = []
  const fromEnv = process.env['NEXUS_SMTC_SCRIPT']
  if (fromEnv && fromEnv.trim().length > 0) candidates.push(fromEnv.trim())
  try {
    candidates.push(path.join(app.getAppPath(), 'resources', 'smtc-bridge.ps1'))
  } catch {
    /* app 可能尚未就绪 */
  }
  try {
    candidates.push(path.join(__dirname, '../../resources', 'smtc-bridge.ps1'))
  } catch {
    /* 忽略 */
  }
  try {
    candidates.push(path.join(process.resourcesPath, 'resources', 'smtc-bridge.ps1'))
    candidates.push(path.join(process.resourcesPath, 'smtc-bridge.ps1'))
  } catch {
    /* 忽略 */
  }
  return candidates
}

function resolveScriptPath(): string | null {
  for (const candidate of scriptCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* 下一个候选 */
    }
  }
  return null
}

class SmtcBridgeImpl extends EventEmitter implements SmtcBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempts = 0
  private started = false
  private stopping = false
  private spawnedAt = 0
  private state: MediaState = { ...DEFAULT_MEDIA_STATE }
  private artCache = new Map<string, string>()
  private artToken = 0
  private pendingArtPath: string | null = null

  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false
    this.restartAttempts = 0
    this.spawnBridge()
  }

  stop(): void {
    this.started = false
    this.stopping = true
    this.artToken++
    this.pendingArtPath = null
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    if (child) {
      try {
        child.stdin.end()
      } catch {
        /* 进程可能已退出 */
      }
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
    }
  }

  async control(action: MediaAction, positionMs?: number): Promise<boolean> {
    const child = this.child
    if (!this.started || !child || child.stdin.destroyed) return false
    const command = action === 'seek' ? `seek:${Math.max(0, Math.round(positionMs ?? 0))}` : action
    return new Promise<boolean>((resolve) => {
      try {
        child.stdin.write(`${command}\n`, (error) => {
          if (error) {
            mediaLog(`命令写入失败（${command}）: ${error.message}`)
            resolve(false)
            return
          }
          resolve(true)
        })
      } catch (error) {
        mediaLog(`命令写入异常（${command}）: ${errorText(error)}`)
        resolve(false)
      }
    })
  }

  getState(): MediaState {
    return { ...this.state }
  }

  /* ------------------------------ 子进程生命周期 ------------------------------ */

  private spawnBridge(): void {
    if (!this.started || this.stopping) return
    const scriptPath = resolveScriptPath()
    if (!scriptPath) {
      mediaLog('未找到 resources/smtc-bridge.ps1，SMTC 桥无法启动')
      this.scheduleRestart()
      return
    }
    try {
      // 显式补全环境变量：部分启动方式下子进程拿不到 TEMP/APPDATA，
      // 会导致封面目录退化成相对路径 "nexus-dock" 并报访问被拒绝。
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
        APPDATA: app.getPath('appData'),
        LOCALAPPDATA: process.env['LOCALAPPDATA'] || app.getPath('appData'),
        ProgramData: process.env['ProgramData'] || 'C:\\ProgramData'
      }
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        env: childEnv
      })
      this.child = child
      this.spawnedAt = Date.now()
      this.wireChild(child)
      mediaLog(`SMTC 桥已启动 pid=${String(child.pid)} script=${scriptPath}`)
    } catch (error) {
      mediaLog(`SMTC 桥启动失败: ${errorText(error)}`)
      this.scheduleRestart()
    }
  }

  private wireChild(child: ChildProcessWithoutNullStreams): void {
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.trim().length > 0) this.handleLine(line)
        newline = buffer.indexOf('\n')
      }
      // 防御：异常超长行（脚本失控）直接丢弃，避免内存增长
      if (buffer.length > 256 * 1024) buffer = ''
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim().length > 0) mediaLog(`[stderr] ${line.trim()}`)
      }
    })

    child.on('error', (error) => {
      mediaLog(`SMTC 桥进程错误: ${error.message}`)
      this.handleChildGone(child)
    })
    child.on('exit', (code, signal) => {
      mediaLog(`SMTC 桥退出 code=${String(code)} signal=${String(signal)}`)
      this.handleChildGone(child)
    })
    child.stdin.on('error', (error: Error) => {
      mediaLog(`SMTC stdin 错误: ${error.message}`)
    })
  }

  private handleChildGone(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    if (this.stopping || !this.started) return
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (!this.started || this.stopping || this.restartTimer) return
    if (this.restartAttempts >= MAX_RESTARTS) {
      mediaLog('SMTC 桥重启次数已达上限（5 次），停止重试')
      return
    }
    const delay = Math.min(1000 * 2 ** this.restartAttempts, MAX_RESTART_DELAY)
    this.restartAttempts++
    mediaLog(`SMTC 桥将在 ${delay}ms 后重启（第 ${this.restartAttempts}/${MAX_RESTARTS} 次）`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnBridge()
    }, delay)
  }

  /* --------------------------------- 协议解析 -------------------------------- */

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      mediaLog(`无法解析桥输出: ${line.slice(0, 200)}`)
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const event = parsed as { type?: unknown; message?: unknown }
    if (event.type === 'ready') {
      mediaLog('SMTC 桥就绪')
      // 稳定运行 30s 后清零重启计数，避免「长期运行偶发退出」耗尽重试次数
      if (Date.now() - this.spawnedAt > 30_000) this.restartAttempts = 0
      return
    }
    if (event.type === 'error') {
      mediaLog(`SMTC 桥错误: ${typeof event.message === 'string' ? event.message : 'unknown'}`)
      return
    }
    if (event.type === 'media') {
      this.handleMedia(parsed as RawMediaEvent)
    }
  }

  private handleMedia(raw: RawMediaEvent): void {
    const status = asStatus(raw.status)
    const title = typeof raw.title === 'string' ? raw.title : ''
    const artist = typeof raw.artist === 'string' ? raw.artist : ''
    const album = typeof raw.album === 'string' ? raw.album : ''
    const trackChanged = title !== this.state.title || artist !== this.state.artist
    let artUrl = this.state.artUrl

    if (typeof raw.artPath === 'string') {
      if (raw.artPath.length === 0) {
        artUrl = ''
        this.cancelPendingArt()
      } else {
        const cached = this.artCache.get(raw.artPath)
        if (cached) {
          artUrl = cached
          this.cancelPendingArt()
        } else {
          artUrl = ''
          this.readArtwork(raw.artPath)
        }
      }
    } else if (trackChanged || (status === 'stopped' && title.length === 0)) {
      // 桥只在封面变化时下发 artPath；切歌但没有新封面时必须主动清空，避免残留旧封面
      artUrl = ''
      this.cancelPendingArt()
    }

    this.state = {
      source: 'system',
      status,
      title,
      artist,
      album,
      artUrl,
      positionMs: asCount(raw.positionMs),
      durationMs: asCount(raw.durationMs),
      canNext: raw.canNext === true,
      canPrev: raw.canPrev === true,
      appId: typeof raw.appId === 'string' ? raw.appId : '',
      updatedAt: Date.now()
    }
    this.emit('state', this.getState())
  }

  private cancelPendingArt(): void {
    this.artToken++
    this.pendingArtPath = null
  }

  /** 读取封面 PNG → data URL；token 防止旧曲目的异步读取覆盖新曲目封面 */
  private readArtwork(artPath: string): void {
    const token = ++this.artToken
    this.pendingArtPath = artPath
    fs.readFile(artPath, (error, data) => {
      if (error) {
        mediaLog(`封面读取失败（${artPath}）: ${error.message}`)
        if (token === this.artToken) this.pendingArtPath = null
        return
      }
      if (data.length === 0) {
        if (token === this.artToken) this.pendingArtPath = null
        return
      }
      const url = `data:image/png;base64,${data.toString('base64')}`
      if (this.artCache.size >= ART_CACHE_LIMIT) this.artCache.clear()
      this.artCache.set(artPath, url)
      if (token !== this.artToken) return
      this.pendingArtPath = null
      this.state = { ...this.state, artUrl: url, updatedAt: Date.now() }
      this.emit('state', this.getState())
    })
  }
}

export function createSmtcBridge(): SmtcBridge {
  return new SmtcBridgeImpl()
}
