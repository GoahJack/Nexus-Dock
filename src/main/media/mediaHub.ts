/**
 * MediaHub：聚合 SMTC 系统媒体状态，并做「变化才广播」的节流。
 *
 * - 曲目信息（标题/歌手/专辑/状态/时长/封面/按钮可用性）变化 → 立即广播；
 * - 仅进度变化且相对上次广播 >1500ms → 广播（避免 700ms 轮询造成的高频刷新）；
 * - 首次拿到状态时（通常是 stopped 空状态）也广播一次，保证渲染层能进入空状态。
 *
 * v1.4 轻量化：SMTC 桥是常驻 PowerShell（工作集约 100MB），
 * 只在「音乐卡片可见 + 来源=系统」时才有意义，因此由主进程按需 setBridgeEnabled()；
 * 关闭时立即杀掉子进程并回到空状态，避免隐藏音乐卡片后仍白烧内存。
 *
 * 注意：本地播放器状态由音乐卡片渲染层自行维护（LocalPlayer），不经过本 Hub。
 */
import { DEFAULT_MEDIA_STATE, type MediaAction, type MediaState } from '@shared/types'
import { createSmtcBridge, type SmtcBridge } from './smtcBridge'

export interface MediaHub {
  /**
   * 启动 Hub。`bridgeEnabled` 决定是否立即拉起 SMTC 桥（默认 true，保持旧行为）；
   * 主进程会按设置传入，避免音乐卡片关闭时白起 PowerShell。
   */
  start(options?: { bridgeEnabled?: boolean }): void
  dispose(): void
  /** 按需启停 SMTC 桥：false → 杀子进程并回到空状态；true → 重新拉起 */
  setBridgeEnabled(enabled: boolean): void
  isBridgeEnabled(): boolean
  getState(): MediaState
  control(action: MediaAction, positionMs?: number): Promise<{ ok: boolean }>
  onStateChange(cb: (s: MediaState) => void): () => void
}

const POSITION_BROADCAST_THRESHOLD = 1500

function identity(state: MediaState): string {
  return [
    state.status,
    state.title,
    state.artist,
    state.album,
    String(state.durationMs),
    state.artUrl,
    state.canNext ? '1' : '0',
    state.canPrev ? '1' : '0',
    state.appId
  ].join('\u0001')
}

class MediaHubImpl implements MediaHub {
  private bridge: SmtcBridge = createSmtcBridge()
  private state: MediaState = { ...DEFAULT_MEDIA_STATE }
  private listeners = new Set<(s: MediaState) => void>()
  private started = false
  private bridgeEnabled = false
  private firstBroadcastDone = false
  private lastBroadcast: MediaState | null = null

  constructor() {
    this.bridge.on('state', (next) => this.ingest(next))
  }

  start(options: { bridgeEnabled?: boolean } = {}): void {
    if (this.started) {
      if (typeof options.bridgeEnabled === 'boolean') this.setBridgeEnabled(options.bridgeEnabled)
      return
    }
    this.started = true
    this.firstBroadcastDone = false
    this.lastBroadcast = null
    this.setBridgeEnabled(options.bridgeEnabled !== false)
  }

  setBridgeEnabled(enabled: boolean): void {
    if (!this.started) {
      // Hub 尚未 start：只记录期望状态，等 start() 时生效
      this.bridgeEnabled = enabled
      return
    }
    if (enabled === this.bridgeEnabled) return
    this.bridgeEnabled = enabled
    if (enabled) {
      // 重新开始：下一帧拿到什么状态都要广播一次（即使与空状态相同）
      this.firstBroadcastDone = false
      this.lastBroadcast = null
      this.bridge.start()
      return
    }
    // 关桥：停止子进程并回到空状态广播一次，避免音乐卡片残留上一首曲目
    this.bridge.stop()
    this.firstBroadcastDone = false
    this.lastBroadcast = null
    this.ingest({ ...DEFAULT_MEDIA_STATE })
  }

  isBridgeEnabled(): boolean {
    return this.started && this.bridgeEnabled
  }

  dispose(): void {
    this.started = false
    this.bridgeEnabled = false
    this.bridge.stop()
    this.listeners.clear()
    this.lastBroadcast = null
    this.firstBroadcastDone = false
  }

  getState(): MediaState {
    return { ...this.state }
  }

  async control(action: MediaAction, positionMs?: number): Promise<{ ok: boolean }> {
    try {
      const ok = await this.bridge.control(action, positionMs)
      return { ok }
    } catch {
      return { ok: false }
    }
  }

  onStateChange(cb: (s: MediaState) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private ingest(next: MediaState): void {
    const previousIdentity = identity(this.state)
    this.state = { ...next }
    const changed = identity(this.state) !== previousIdentity
    const first = !this.firstBroadcastDone

    let positionJumped = false
    if (!first && !changed && this.lastBroadcast) {
      positionJumped =
        Math.abs(this.state.positionMs - this.lastBroadcast.positionMs) > POSITION_BROADCAST_THRESHOLD
    }

    if (!first && !changed && !positionJumped) return

    this.firstBroadcastDone = true
    const snapshot = this.getState()
    this.lastBroadcast = snapshot
    for (const listener of [...this.listeners]) {
      try {
        listener({ ...snapshot })
      } catch {
        /* 单个监听器异常不影响其他窗口 */
      }
    }
  }
}

export function createMediaHub(): MediaHub {
  return new MediaHubImpl()
}
