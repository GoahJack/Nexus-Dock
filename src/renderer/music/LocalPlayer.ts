/**
 * 本地播放器：封装 HTMLAudioElement，通过主进程的 media:// 协议流式加载本地音频。
 *
 * - 音源 URL：media://local?p=<encodeURIComponent(path)>（主进程协议支持 Range，可拖动进度）
 * - 每次状态变化（加载/播放/暂停/进度/结束）都回调监听者，并上报 media:setLocalState，
 *   让主进程与设置面板感知当前本地曲目。
 * - 标题使用轨道名（主进程 pickFiles 提供文件名，缺省时回退到路径文件名）。
 */
import { DEFAULT_MEDIA_STATE, type LocalTrack, type MediaState, type PlaybackStatus } from '@shared/types'

type LocalStateListener = (state: MediaState) => void

function displayTitle(track: LocalTrack): string {
  const provided = typeof track.title === 'string' ? track.title.trim() : ''
  if (provided.length > 0) return provided
  const parts = track.path.split(/[\\/]/)
  const name = parts[parts.length - 1] ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function mediaUrl(filePath: string): string {
  return `media://local?p=${encodeURIComponent(filePath)}`
}

export class LocalPlayer {
  private readonly audio: HTMLAudioElement
  private playlist: LocalTrack[] = []
  private index = -1
  private status: PlaybackStatus = 'stopped'
  private positionMs = 0
  private durationMs = 0
  private listeners = new Set<LocalStateListener>()
  private destroyed = false

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'metadata'
    this.audio.volume = 1
    this.bindEvents()
  }

  getState(): MediaState {
    return this.buildState()
  }

  onState(listener: LocalStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getPlaylist(): LocalTrack[] {
    return [...this.playlist]
  }

  /** 设置播放列表并加载第一首（相同列表重复调用不会打断当前播放） */
  loadPlaylist(tracks: LocalTrack[], autoPlay = true): void {
    if (this.destroyed) return
    const valid = tracks.filter((track) => track && typeof track.path === 'string' && track.path.length > 0)
    if (valid.length === 0) return
    const same =
      valid.length === this.playlist.length && valid.every((track, i) => track.path === this.playlist[i]?.path)
    if (same && this.index >= 0) {
      if (autoPlay && this.status !== 'playing') this.play()
      return
    }
    this.playlist = valid
    this.index = 0
    this.loadCurrent(autoPlay)
  }

  /** 加载单曲（若不在当前列表中则追加） */
  load(track: LocalTrack): void {
    if (this.destroyed) return
    const existing = this.playlist.findIndex((item) => item.path === track.path)
    if (existing >= 0) {
      this.index = existing
    } else {
      this.playlist = [...this.playlist, track]
      this.index = this.playlist.length - 1
    }
    this.loadCurrent(false)
  }

  play(): void {
    if (this.destroyed || this.index < 0) return
    const result = this.audio.play()
    if (result && typeof result.catch === 'function') {
      result.catch((error: unknown) => {
        console.warn('[music] 本地音频播放失败', error)
        if (this.destroyed) return
        this.status = 'paused'
        this.emit()
      })
    }
  }

  pause(): void {
    if (this.destroyed) return
    try {
      this.audio.pause()
    } catch {
      /* 忽略 */
    }
    this.status = 'paused'
    this.emit()
  }

  next(): void {
    this.advance(1, this.status === 'playing')
  }

  prev(): void {
    this.advance(-1, this.status === 'playing')
  }

  seek(milliseconds: number): void {
    if (this.destroyed || this.index < 0) return
    const duration = this.audio.duration
    const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : this.durationMs
    const upper = durationMs > 0 ? durationMs : Math.max(0, milliseconds)
    const target = Math.min(Math.max(0, milliseconds), upper)
    try {
      this.audio.currentTime = target / 1000
    } catch {
      /* 元数据未就绪时忽略 */
    }
    this.positionMs = Math.round(target)
    this.emit()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.listeners.clear()
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.audio.removeEventListener('durationchange', this.handleLoadedMetadata)
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate)
    this.audio.removeEventListener('play', this.handlePlay)
    this.audio.removeEventListener('pause', this.handlePause)
    this.audio.removeEventListener('ended', this.handleEnded)
    this.audio.removeEventListener('error', this.handleError)
    try {
      this.audio.pause()
    } catch {
      /* 忽略 */
    }
    this.audio.removeAttribute('src')
    try {
      this.audio.load()
    } catch {
      /* 忽略 */
    }
    this.playlist = []
    this.index = -1
  }

  /* -------------------------------- internals -------------------------------- */

  private bindEvents(): void {
    this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.audio.addEventListener('durationchange', this.handleLoadedMetadata)
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate)
    this.audio.addEventListener('play', this.handlePlay)
    this.audio.addEventListener('pause', this.handlePause)
    this.audio.addEventListener('ended', this.handleEnded)
    this.audio.addEventListener('error', this.handleError)
  }

  private currentTrack(): LocalTrack | null {
    return this.index >= 0 ? this.playlist[this.index] ?? null : null
  }

  private loadCurrent(autoPlay: boolean): void {
    const track = this.currentTrack()
    this.positionMs = 0
    this.durationMs = 0
    if (!track) {
      this.status = 'stopped'
      this.emit()
      return
    }
    this.status = 'paused'
    this.audio.src = mediaUrl(track.path)
    try {
      this.audio.load()
    } catch {
      /* 忽略 */
    }
    this.emit()
    if (autoPlay) this.play()
  }

  private advance(delta: number, autoPlay: boolean): void {
    if (this.destroyed || this.playlist.length === 0) return
    this.index = (this.index + delta + this.playlist.length) % this.playlist.length
    this.loadCurrent(autoPlay)
  }

  private buildState(): MediaState {
    const track = this.currentTrack()
    const hasPlaylist = this.playlist.length > 0
    return {
      ...DEFAULT_MEDIA_STATE,
      source: 'local',
      status: this.status,
      title: track ? displayTitle(track) : '',
      artist: track ? '本地播放' : '',
      album: '',
      artUrl: '',
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      canNext: hasPlaylist,
      canPrev: hasPlaylist,
      appId: 'local',
      updatedAt: Date.now()
    }
  }

  private emit(): void {
    if (this.destroyed) return
    const state = this.buildState()
    for (const listener of [...this.listeners]) {
      try {
        listener(state)
      } catch {
        /* 单个监听器异常不影响播放 */
      }
    }
    try {
      window.nexus.media.setLocalState(state)
    } catch {
      /* 主进程不可用（例如窗口销毁中）时忽略 */
    }
  }

  private handleLoadedMetadata = (): void => {
    if (this.destroyed) return
    const duration = this.audio.duration
    if (Number.isFinite(duration) && duration > 0) {
      this.durationMs = Math.round(duration * 1000)
    }
    if (Number.isFinite(this.audio.currentTime)) {
      this.positionMs = Math.round(this.audio.currentTime * 1000)
    }
    this.emit()
  }

  private handleTimeUpdate = (): void => {
    if (this.destroyed) return
    if (Number.isFinite(this.audio.currentTime)) {
      this.positionMs = Math.max(0, Math.round(this.audio.currentTime * 1000))
    }
    this.emit()
  }

  private handlePlay = (): void => {
    if (this.destroyed) return
    this.status = 'playing'
    this.emit()
  }

  private handlePause = (): void => {
    if (this.destroyed) return
    // ended 事件后浏览器也会触发 pause，交给 ended 处理结束态
    if (this.audio.ended) return
    this.status = 'paused'
    this.emit()
  }

  private handleEnded = (): void => {
    if (this.destroyed) return
    if (this.playlist.length > 0) {
      this.advance(1, true)
      return
    }
    this.status = 'stopped'
    this.positionMs = 0
    this.emit()
  }

  private handleError = (): void => {
    if (this.destroyed) return
    console.warn('[music] 本地音频加载失败', this.audio.src, this.audio.error?.message ?? '')
    this.status = 'paused'
    this.emit()
  }
}
