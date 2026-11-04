/**
 * 主进程统一文件日志（v1.5）：
 *
 * 背景：此前 desktopState / smtcBridge / apps 各自用 appendFile(Sync) 直写
 * `logs/desktop.log`、`logs/media.log`、`logs/launch.log`，既无轮转也无上限
 * （实测 media.log 单会话已 557KB，长期运行会无限增长），且同步写会卡主进程。
 *
 * 本模块提供唯一入口 `logToFile(kind, message)`：
 * - 落盘路径 `%APPDATA%/nexus-dock/logs/<kind>.log`（与旧实现一致，走 app.getPath('userData')）；
 * - 行格式 `[ISO时间] message`（与旧实现一致，多行消息逐行加前缀，避免出现无时间戳的裸行）；
 * - 按大小轮转：单文件超过 1MB 时改名为 `<kind>.log.1`（覆盖旧备份，只保留 1 个备份）；
 * - 目录懒创建；
 * - 异步写 + 进程内队列：高频日志不阻塞主进程；队列有上限，溢出丢最旧行；
 * - 任何异常（路径不可用、磁盘满、文件被占用……）一律静默，绝不抛出、绝不阻塞功能。
 *
 * 注意：日志是诊断辅助，不允许因为日志失败改变任何业务行为。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export type LogKind = 'desktop' | 'media' | 'launch' | 'main' | 'extra'

/** 单文件轮转阈值：超过 1MB 就滚动到 <kind>.log.1 */
const MAX_LOG_BYTES = 1024 * 1024
/** 进程内待写队列上限：溢出丢弃最旧行（日志不能吃内存） */
const MAX_QUEUE_LINES = 512
/** 单行上限：防止异常超长行撑爆队列/磁盘 */
const MAX_LINE_CHARS = 8 * 1024
const ROTATE_SUFFIX = '.1'

const queues = new Map<LogKind, string[]>()
const flushing = new Set<LogKind>()
/** 每个日志文件的近似大小（首次写入时 stat 初始化，之后按写入量累加，避免每次 stat） */
const sizes = new Map<LogKind, number>()
let logsDirPath: string | null = null

/** 日志目录：优先 userData/logs；app 未就绪时回退 %APPDATA%/nexus-dock/logs、~/.nexus-dock/logs */
function logsDir(): string | null {
  if (logsDirPath) return logsDirPath
  try {
    logsDirPath = join(app.getPath('userData'), 'logs')
    return logsDirPath
  } catch {
    /* app 可能尚未就绪 */
  }
  try {
    const appData = process.env['APPDATA']
    if (appData && appData.length > 0) {
      logsDirPath = join(appData, 'nexus-dock', 'logs')
      return logsDirPath
    }
  } catch {
    /* 忽略 */
  }
  try {
    logsDirPath = join(homedir(), '.nexus-dock', 'logs')
    return logsDirPath
  } catch {
    return null
  }
}

/** 统一行格式，并把消息里的换行拆成多条带时间戳的行 */
function formatLines(message: string): string[] {
  const iso = new Date().toISOString()
  const raw = String(message).split(/\r?\n/)
  const lines: string[] = []
  for (let index = 0; index < raw.length; index++) {
    const piece = raw[index] ?? ''
    // 末尾空行不产生日志行（`"msg\n"` 与 `"msg"` 等价）
    if (piece.length === 0 && index > 0 && index === raw.length - 1) continue
    const text = piece.length > MAX_LINE_CHARS ? `${piece.slice(0, MAX_LINE_CHARS)}…(truncated)` : piece
    lines.push(`[${iso}] ${text}\n`)
  }
  return lines.length > 0 ? lines : [`[${iso}] \n`]
}

/**
 * 写入一条日志。同步返回、实际落盘异步；任何异常静默。
 * @param kind 日志类别，决定文件名
 * @param message 消息正文（不含时间戳与换行）
 */
export function logToFile(kind: LogKind, message: string): void {
  try {
    const queue = queues.get(kind) ?? []
    for (const line of formatLines(message)) {
      if (queue.length >= MAX_QUEUE_LINES) queue.shift()
      queue.push(line)
    }
    queues.set(kind, queue)
    void flush(kind)
  } catch {
    /* 日志失败绝不影响功能 */
  }
}

/** 刷队列：同一 kind 串行化，失败静默；写入量到阈值先轮转 */
async function flush(kind: LogKind): Promise<void> {
  if (flushing.has(kind)) return
  const queue = queues.get(kind)
  if (!queue || queue.length === 0) return
  flushing.add(kind)
  try {
    const dir = logsDir()
    if (!dir) {
      // 没有可用目录：丢弃本轮，避免 setImmediate 空转
      queue.length = 0
      return
    }
    const lines = queue.splice(0, queue.length)
    const file = join(dir, `${kind}.log`)
    const payload = lines.join('')
    const bytes = Buffer.byteLength(payload, 'utf8')
    await mkdir(dir, { recursive: true })
    let size = sizes.get(kind)
    if (size === undefined) {
      try {
        size = (await stat(file)).size
      } catch {
        size = 0
      }
    }
    if (size + bytes > MAX_LOG_BYTES) {
      await rotate(file)
      size = 0
    }
    await appendFile(file, payload, 'utf8')
    sizes.set(kind, size + bytes)
  } catch {
    /* 静默：日志不能影响功能 */
  } finally {
    flushing.delete(kind)
    const rest = queues.get(kind)
    if (rest && rest.length > 0) setImmediate(() => void flush(kind))
  }
}

/** 轮转：<kind>.log → <kind>.log.1（覆盖旧备份，只保留 1 个） */
async function rotate(file: string): Promise<void> {
  const backup = `${file}${ROTATE_SUFFIX}`
  try {
    await unlink(backup)
  } catch {
    /* 没有旧备份 */
  }
  try {
    await rename(file, backup)
  } catch {
    /* 文件不存在 / 被占用：下次再试 */
  }
}

/**
 * 退出兜底：进程退出时把队列里还没落盘的行同步写完（尽力而为，仍然静默）。
 * 只在进程退出阶段同步写，不影响运行期；不做轮转（最多多几百行）。
 */
function installExitFlush(): void {
  try {
    process.once('exit', () => {
      const dir = logsDir()
      if (!dir) return
      for (const [kind, queue] of queues) {
        if (!queue || queue.length === 0) continue
        const lines = queue.splice(0, queue.length)
        try {
          mkdirSync(dir, { recursive: true })
          appendFileSync(join(dir, `${kind}.log`), lines.join(''), 'utf8')
        } catch {
          /* 退出阶段尽力而为 */
        }
      }
    })
  } catch {
    /* 忽略 */
  }
}

installExitFlush()
