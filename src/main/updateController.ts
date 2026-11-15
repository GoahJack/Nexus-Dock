import type { EventEmitter } from 'node:events'
import type { UpdateErrorStage, UpdateMode, UpdateProgress, UpdateState } from '../shared/updates'

/** 和 Electron 解耦，离线测试可覆盖完整状态机；实现仍由 electron-updater 负责。 */
export interface UpdateEngine extends Pick<EventEmitter, 'on' | 'removeListener'> {
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
}

interface Scheduler {
  now(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

interface Options {
  engine: UpdateEngine | null
  mode: UpdateMode
  currentVersion: string
  automatic: boolean
  onChanged: (state: UpdateState) => void
  beforeInstall: () => void
  scheduler?: Scheduler
}

export const UPDATE_START_DELAY = 12_000
export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000
export const UPDATE_RETRY_DELAY = 30 * 60 * 1000

function errorMessage(error: unknown, stage: UpdateErrorStage): string {
  const code = String((error as { code?: string })?.code ?? '')
  const detail = String(error)
  if (/NO_PUBLISHED_VERSIONS|LATEST_VERSION_NOT_FOUND/.test(code) || /404|No published versions/i.test(detail)) {
    return '尚未发布可用的更新包，请稍后再试。'
  }
  if (/SHA512|CHECKSUM|SIGNATURE|sha512 checksum|checksum mismatch/i.test(`${code} ${detail}`)) {
    return '更新包校验未通过，已阻止安装。请重试或前往发布页下载。'
  }
  if (stage === 'install') return '未能启动安装程序，请重试或前往发布页下载安装版。'
  if (stage === 'download') return '更新下载失败，请检查网络或磁盘空间后重试。'
  return '暂时无法检查更新，请检查网络后重试。'
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export class UpdateController {
  private readonly options: Options
  private readonly scheduler: Scheduler
  private state: UpdateState
  private automatic: boolean
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private installTimer: ReturnType<typeof setTimeout> | null = null
  private checkTask: Promise<void> | null = null
  private downloadTask: Promise<void> | null = null
  private lastProgressAt = -Infinity
  private readonly listeners: Array<[string, (...args: any[]) => void]> = []

  constructor(options: Options) {
    this.options = options
    this.scheduler = options.scheduler ?? { now: Date.now, setTimeout, clearTimeout }
    this.automatic = options.automatic
    const supported = options.mode === 'installer' && !!options.engine
    this.state = {
      revision: 0,
      mode: options.mode,
      phase: supported ? 'idle' : 'unsupported',
      currentVersion: options.currentVersion
    }
    if (!supported) return
    this.listen('update-available', (info: { version: string }) => {
      if (this.state.phase !== 'checking') return
      this.change({ phase: 'available', latestVersion: info.version, checkedAt: this.scheduler.now() })
    })
    this.listen('update-not-available', () => {
      if (this.state.phase !== 'checking') return
      this.change({ phase: 'idle', latestVersion: undefined, checkedAt: this.scheduler.now() })
    })
    this.listen('download-progress', (progress: UpdateProgress) => {
      if (this.state.phase !== 'downloading') return
      const now = this.scheduler.now()
      if (now - this.lastProgressAt < 500 && progress.percent < 100) return
      this.lastProgressAt = now
      this.change({ progress: {
        percent: Math.min(100, safeNumber(progress.percent)),
        transferred: safeNumber(progress.transferred),
        total: safeNumber(progress.total),
        bytesPerSecond: safeNumber(progress.bytesPerSecond)
      } })
    })
    this.listen('update-downloaded', (info: { version: string }) => {
      if (this.state.phase !== 'downloading') return
      this.change({ phase: 'downloaded', latestVersion: info.version, progress: undefined })
      this.clearTimer()
    })
    this.listen('error', (error: unknown) => {
      const stage = this.state.phase === 'installing' ? 'install' : this.state.phase === 'downloading' ? 'download' : 'check'
      this.fail(error, stage)
    })
    this.schedule(UPDATE_START_DELAY)
  }

  getState(): UpdateState {
    return structuredClone(this.state)
  }

  setAutomatic(enabled: boolean): void {
    if (this.automatic === enabled || this.disposed) return
    this.automatic = enabled
    this.clearTimer()
    if (enabled) this.schedule(UPDATE_START_DELAY)
  }

  async check(): Promise<UpdateState> {
    if (this.disposed || this.state.mode !== 'installer' || ['downloading', 'downloaded', 'installing'].includes(this.state.phase)) {
      return this.getState()
    }
    if (!this.checkTask) {
      // Defer one microtask so even synchronous events see the in-flight lock.
      this.checkTask = Promise.resolve().then(() => this.performCheck()).finally(() => { this.checkTask = null })
    }
    await this.checkTask
    return this.getState()
  }

  private async performCheck(): Promise<void> {
    if (this.disposed) return
    this.change({ phase: 'checking', message: undefined, errorStage: undefined, progress: undefined })
    try {
      await this.options.engine!.checkForUpdates()
      if (this.state.phase === 'checking') throw new Error('Update provider returned no result')
      if (this.state.phase === 'available' && this.automatic && !this.disposed) await this.download()
    } catch (error) {
      this.fail(error, 'check')
    }
  }

  async download(): Promise<UpdateState> {
    if (this.disposed || this.state.mode !== 'installer') return this.getState()
    if (!this.downloadTask && (this.state.phase === 'available' || (this.state.phase === 'error' && this.state.errorStage === 'download'))) {
      this.downloadTask = Promise.resolve().then(async () => {
        if (this.disposed) return
        this.lastProgressAt = -Infinity
        this.change({ phase: 'downloading', message: undefined, errorStage: undefined, progress: undefined })
        try {
          await this.options.engine!.downloadUpdate()
          if (this.state.phase === 'downloading') throw new Error('Download returned without verified update')
        } catch (error) {
          this.fail(error, 'download')
        }
      }).finally(() => { this.downloadTask = null })
    }
    if (this.downloadTask) await this.downloadTask
    return this.getState()
  }

  install(): UpdateState {
    if (this.disposed || this.state.phase !== 'downloaded') return this.getState()
    this.change({ phase: 'installing', message: undefined, errorStage: undefined })
    // Return the IPC acknowledgement before shutdown closes the renderer.
    this.installTimer = this.scheduler.setTimeout(() => {
      this.installTimer = null
      if (this.disposed) return
      try {
        this.options.beforeInstall()
        this.options.engine!.quitAndInstall(true, true)
      } catch (error) {
        this.fail(error, 'install')
      }
    }, 150)
    return this.getState()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    if (this.installTimer) this.scheduler.clearTimeout(this.installTimer)
    for (const [event, listener] of this.listeners) this.options.engine?.removeListener(event, listener)
    this.listeners.length = 0
  }

  private listen(event: string, handler: (...args: any[]) => void): void {
    const listener = (...args: any[]): void => { if (!this.disposed) handler(...args) }
    this.listeners.push([event, listener])
    this.options.engine!.on(event, listener)
  }

  private change(patch: Partial<UpdateState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.options.onChanged(this.getState())
  }

  private fail(error: unknown, stage: UpdateErrorStage): void {
    if (this.disposed || (['downloaded', 'installing'].includes(this.state.phase) && stage !== 'install')) return
    this.change({ phase: 'error', errorStage: stage, message: errorMessage(error, stage), progress: undefined })
  }

  private clearTimer(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delay: number): void {
    if (this.disposed || !this.automatic || this.state.mode !== 'installer' || ['downloaded', 'installing'].includes(this.state.phase)) return
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      void this.check().finally(() => {
        if (!this.timer) this.schedule(this.state.phase === 'error' ? UPDATE_RETRY_DELAY : UPDATE_INTERVAL)
      })
    }, delay)
    this.timer.unref?.()
  }
}
