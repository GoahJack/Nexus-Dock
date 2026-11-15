import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnimationEvent as ReactAnimationEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { DEFAULT_MEDIA_STATE, type MediaAction, type MediaSource, type MediaState } from '@shared/types'
import { formatTime, useContentSize, useSettings } from '../shared/hooks'
import { spawnRipple } from '../shared/motion'
import { LocalPlayer } from './LocalPlayer'
import { useMediaProgress } from './useMediaProgress'
import { useIsland } from '../shared/useIsland'
import { IslandPin } from '../shared/IslandPin'

/** 环形进度几何（viewBox 72×72，圆环半径 33，封面约 60px） */
const RING_SIZE = 72
const RING_RADIUS = 33
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** 切歌图标微动的清理延迟：与 motion.css 的 --nx-dur-slow（260ms）基准一致 */
const NUDGE_CLEAR_MS = 260
/** 封面交叉淡入的兜底卸载延迟：正常由新图 animationend 触发，这里只防动画被中断后旧层残留 */
const ART_CLEANUP_FALLBACK_MS = 900
/** 卡片内轻量提示的停留时长：足够读完一行错误，又不至于长期遮挡控件 */
const NOTICE_MS = 3600

function IconPrev(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="5" y="5" width="2.4" height="14" rx="1.2" fill="currentColor" />
      <path d="M20 5.6v12.8a.9.9 0 0 1-1.4.76l-9.3-6.4a.9.9 0 0 1 0-1.52l9.3-6.4A.9.9 0 0 1 20 5.6Z" fill="currentColor" />
    </svg>
  )
}

function IconNext(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <rect x="16.6" y="5" width="2.4" height="14" rx="1.2" fill="currentColor" />
      <path d="M4 5.6v12.8a.9.9 0 0 0 1.4.76l9.3-6.4a.9.9 0 0 0 0-1.52L5.4 4.84A.9.9 0 0 0 4 5.6Z" fill="currentColor" />
    </svg>
  )
}

function IconPlay(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 5.4v13.2a.9.9 0 0 0 1.37.77l10.5-6.6a.9.9 0 0 0 0-1.54L9.37 4.63A.9.9 0 0 0 8 5.4Z" fill="currentColor" />
    </svg>
  )
}

function IconPause(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" />
    </svg>
  )
}

function IconFolder(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 6.5c0-.9.7-1.6 1.6-1.6h4.1c.5 0 1 .25 1.3.66l.9 1.24h7.5c.9 0 1.6.7 1.6 1.6v9.1c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6V6.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconNote(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M9 17.2a2.9 2.9 0 1 1-2-2.75V6.4a1 1 0 0 1 .76-.97l8-2a1 1 0 0 1 1.24.97v10.6a2.9 2.9 0 1 1-2-2.75V7.05l-6 1.5v8.65Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconClose(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** 封面双层状态：current 为新图（淡入），previous 为旧图（淡出，动画结束后卸载） */
interface ArtworkLayers {
  current: string
  previous: string | null
  seq: number
}

function Artwork(props: { artUrl: string }): JSX.Element {
  const [layers, setLayers] = useState<ArtworkLayers>(() => ({
    current: props.artUrl,
    previous: null,
    seq: 0
  }))
  const fallbackTimer = useRef<number | null>(null)

  // 切歌：旧封面继续留在 previous 层可见，新封面进入 current 层淡入（不做 key 重挂单图）
  useEffect(() => {
    setLayers((prev) =>
      prev.current === props.artUrl
        ? prev
        : { current: props.artUrl, previous: prev.current, seq: prev.seq + 1 }
    )
  }, [props.artUrl])

  const dropPrevious = useCallback(() => {
    setLayers((prev) => (prev.previous === null ? prev : { ...prev, previous: null }))
  }, [])

  // 兜底清理：新图动画结束事件在少数场景（窗口隐藏/动画被中断）不触发时不留下旧图层
  useEffect(() => {
    if (layers.previous === null) return
    fallbackTimer.current = window.setTimeout(() => {
      fallbackTimer.current = null
      dropPrevious()
    }, ART_CLEANUP_FALLBACK_MS)
    return () => {
      if (fallbackTimer.current !== null) {
        window.clearTimeout(fallbackTimer.current)
        fallbackTimer.current = null
      }
    }
  }, [layers.previous, layers.seq, dropPrevious])

  const renderPrevious = (url: string): JSX.Element =>
    url.length > 0 ? (
      <img className="music-art-img is-prev" src={url} alt="" draggable={false} />
    ) : (
      <div className="music-art-placeholder is-prev">
        <IconNote />
      </div>
    )

  // 新图动画结束即卸载旧图（currentTarget 判断避开冒泡的子元素动画事件）
  const onCurrentAnimationEnd = (event: ReactAnimationEvent<HTMLElement>): void => {
    if (event.target === event.currentTarget) dropPrevious()
  }

  return (
    <div className="music-art">
      {layers.previous !== null ? renderPrevious(layers.previous) : null}
      {layers.current.length > 0 ? (
        <img
          key={`art-current-${layers.seq}`}
          className="music-art-img is-current"
          src={layers.current}
          alt=""
          draggable={false}
          onAnimationEnd={onCurrentAnimationEnd}
        />
      ) : (
        <div
          key={`art-current-${layers.seq}`}
          className="music-art-placeholder is-current"
          onAnimationEnd={onCurrentAnimationEnd}
        >
          <IconNote />
        </div>
      )}
    </div>
  )
}

/** 切歌微动方向；dir 为 null 表示当前没有播放动画，seq 用于连续点击时重启动画 */
interface NudgeState {
  dir: 'prev' | 'next' | null
  seq: number
}

/** 卡片内轻量提示（失败反馈）；seq 用于连续触发时重启动画 */
interface NoticeState {
  kind: 'ok' | 'err'
  text: string
  seq: number
}

export function MusicCard(): JSX.Element {
  const { settings, patch, error: settingsError } = useSettings()
  const [systemState, setSystemState] = useState<MediaState>({ ...DEFAULT_MEDIA_STATE })
  const [localState, setLocalState] = useState<MediaState>({ ...DEFAULT_MEDIA_STATE, source: 'local' })
  const [dragging, setDragging] = useState(false)
  const [dragMs, setDragMs] = useState(0)
  const [nudge, setNudge] = useState<NudgeState>({ dir: null, seq: 0 })
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const nudgeTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const playerRef = useRef<LocalPlayer | null>(null)
  const sourceRef = useRef<MediaSource>('system')
  const previousSourceRef = useRef<MediaSource>('system')

  /** 卡片内轻量提示：自动消失；连续触发时用 seq 重启动画 */
  const notify = useCallback((kind: NoticeState['kind'], text: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setNotice((prev) => ({ kind, text, seq: (prev?.seq ?? 0) + 1 }))
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, NOTICE_MS)
  }, [])

  const music = settings?.music
  const width = music?.width ?? 330
  const progressStyle = music?.progressStyle ?? 'bar'
  const theme = music?.theme ?? 'dark'
  const source: MediaSource = music?.source ?? 'system'
  const isLocal = source === 'local'
  /** v1.1 位置锁定（US-14）：锁定后整卡拖动区失效，关闭 / 播放 / 进度等控件仍可操作 */
  const musicLocked = settings?.lock.music === true
  const { ref } = useContentSize('music', [width, progressStyle])
  const collapsed = useIsland(ref, music?.collapsed ?? false, music?.pinned ?? false)

  const state = isLocal ? localState : systemState
  const empty = state.title.trim().length === 0
  const status = state.status
  const canPrev = isLocal ? localState.canPrev : systemState.canPrev
  const canNext = isLocal ? localState.canNext : systemState.canNext
  const durationMs = state.durationMs
  /** 时长未知：<=0 或非有限值（部分播放器上报 NaN）；此时进度条只能显示已播时间 */
  const durationUnknown = !Number.isFinite(durationMs) || durationMs <= 0

  // 进度插值：duration 未知时依然按真实 position 锚定，但不做上限钳制、不参与除法
  // trackKey 变化才重置；同曲目暂停再播放不会被播放器的「位置归零」带回去
  const trackKey = `${state.appId}|${state.title}|${state.artist}`
  const smoothMs = useMediaProgress(state.positionMs, durationMs, status, trackKey, !collapsed)
  const shownMs = dragging ? dragMs : smoothMs
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, shownMs / durationMs)) : 0


  /* ------------------------------- 本地播放器 ------------------------------- */
  useEffect(() => {
    const player = new LocalPlayer()
    playerRef.current = player
    setLocalState(player.getState())
    const unsubscribe = player.onState((next) => setLocalState(next))
    const unsubscribeError = player.onError((message) => notify('err', message))
    return () => {
      unsubscribe()
      unsubscribeError()
      player.destroy()
      if (playerRef.current === player) playerRef.current = null
    }
  }, [notify])

  /* ------------------------------- 系统媒体状态 ------------------------------ */
  useEffect(() => {
    sourceRef.current = source
  }, [source])

  useEffect(() => {
    let alive = true
    window.nexus.media
      .getState()
      .then((next) => {
        if (alive && sourceRef.current === 'system') setSystemState(next)
      })
      .catch(() => {
        /* 主进程暂不可用时保持空状态 */
      })
    const off = window.nexus.media.onUpdate((next) => {
      if (sourceRef.current === 'system') setSystemState(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  // 切回系统模式时主动拉一次最新状态（设置更新后主进程也会推一次）
  useEffect(() => {
    if (source !== 'system') return
    let alive = true
    window.nexus.media
      .getState()
      .then((next) => {
        if (alive) setSystemState(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [source])

  // 从本地切回系统时暂停本地音频，避免「看不见但还在放」
  useEffect(() => {
    const previous = previousSourceRef.current
    previousSourceRef.current = source
    if (previous === 'local' && source === 'system') playerRef.current?.pause()
  }, [source])

  // 设置面板选完本地文件后主进程广播 media:tracks → 自动加载并播放第一首
  useEffect(() => {
    const off = window.nexus.media.onTracks((tracks) => {
      if (!tracks || tracks.length === 0) return
      playerRef.current?.loadPlaylist(tracks, true)
    })
    return off
  }, [])

  // 卸载时清理切歌微动 / 提示定时器
  useEffect(
    () => () => {
      if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current)
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  /* -------------------------------- 交互逻辑 -------------------------------- */
  const controlSystem = useCallback(
    (action: MediaAction, positionMs?: number) => {
      void window.nexus.media
        .control(action, positionMs)
        .then((result) => {
          // 主进程在无 SMTC 会话 / 本地来源下返回 ok:false：不再静默，给出卡片内提示
          if (!result?.ok) notify('err', '当前播放器不支持该操作')
        })
        .catch(() => notify('err', '媒体控制失败，请重试'))
    },
    [notify]
  )

  const pickLocalFiles = useCallback(async () => {
    try {
      const tracks = await window.nexus.media.pickFiles()
      if (tracks.length === 0) {
        notify('ok', '未选择音频文件')
        return
      }
      // 主进程 pickFiles 成功后已把来源切到本地并广播 media:tracks，这里只做兜底加载 + 提示
      playerRef.current?.loadPlaylist(tracks, true)
      notify('ok', `已加载 ${tracks.length} 首本地音频`)
    } catch {
      notify('err', '选择本地音频失败，请重试')
    }
  }, [notify])

  const toggleSource = useCallback(() => {
    const next: MediaSource = source === 'local' ? 'system' : 'local'
    void patch({ music: { source: next } }).catch(() => notify('err', '切换来源失败，请重试'))
  }, [source, patch, notify])

  // 卡片右上角关闭按钮：只隐藏音乐卡片，设置面板 / Dock 音符按钮负责重新打开
  const closeCard = useCallback(() => {
    void window.nexus.settings.update({ music: { visible: false } }).catch(() => notify('err', '关闭失败，请重试'))
  }, [notify])

  const togglePlay = useCallback(() => {
    if (empty) return
    if (isLocal) {
      const player = playerRef.current
      if (!player) return
      if (localState.status === 'playing') player.pause()
      else player.play()
      return
    }
    controlSystem('playpause')
  }, [empty, isLocal, localState.status, controlSystem])

  const goPrev = useCallback(() => {
    if (isLocal) {
      playerRef.current?.prev()
      return
    }
    if (canPrev) controlSystem('prev')
  }, [isLocal, canPrev, controlSystem])

  const goNext = useCallback(() => {
    if (isLocal) {
      playerRef.current?.next()
      return
    }
    if (canNext) controlSystem('next')
  }, [isLocal, canNext, controlSystem])

  // 切歌微动：每次点击都自增 seq，确保连续点击也能重新播放一次方向动画
  const bumpNudge = useCallback((dir: 'prev' | 'next') => {
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current)
    setNudge((prev) => ({ dir, seq: prev.seq + 1 }))
    nudgeTimer.current = window.setTimeout(() => {
      nudgeTimer.current = null
      setNudge((prev) => (prev.dir === null ? prev : { ...prev, dir: null }))
    }, NUDGE_CLEAR_MS)
  }, [])

  const handlePrev = useCallback(() => {
    bumpNudge('prev')
    goPrev()
  }, [bumpNudge, goPrev])

  const handleNext = useCallback(() => {
    bumpNudge('next')
    goNext()
  }, [bumpNudge, goNext])

  // 所有按钮的按压反馈：pointerdown 即出涟漪（不等 click）；禁用态不响应
  const onButtonPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.disabled) return
    spawnRipple(event.currentTarget, event)
  }, [])

  const seekTo = useCallback(
    (milliseconds: number) => {
      if (isLocal) {
        playerRef.current?.seek(milliseconds)
        return
      }
      controlSystem('seek', milliseconds)
    },
    [isLocal, controlSystem]
  )

  const msFromPointer = (clientX: number, element: HTMLElement): number => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || durationUnknown) return 0
    const position = (clientX - rect.left) / rect.width
    return Math.round(Math.min(1, Math.max(0, position)) * durationMs)
  }

  const onProgressPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (durationUnknown) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const value = msFromPointer(event.clientX, event.currentTarget)
    setDragging(true)
    setDragMs(value)
  }

  const onProgressPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    setDragMs(msFromPointer(event.clientX, event.currentTarget))
  }

  const onProgressPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    const value = msFromPointer(event.clientX, event.currentTarget)
    setDragging(false)
    setDragMs(value)
    seekTo(value)
  }

  const onProgressPointerCancel = (): void => {
    setDragging(false)
  }

  const onProgressKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (durationUnknown) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -5000 : 5000
    const target = Math.min(Math.max(0, shownMs + delta), durationMs)
    setDragMs(target)
    seekTo(target)
  }

  const playing = status === 'playing'
  const hint = isLocal ? '点击文件夹按钮选择本地音乐' : '打开任意播放器即可同步'

  return (
    <div
      ref={ref}
      className="music-card nx-glass"
      data-locked={musicLocked ? 'true' : undefined}
      data-theme={theme}
      data-collapsed={collapsed ? 'true' : undefined}
      title={musicLocked ? '位置已锁定（设置 → 系统 解锁）' : undefined}
      style={{ width }}
    >
      {music?.collapsed ? <IslandPin className="music-fold" pinned={music.pinned} onClick={() => void patch({ music: { pinned: !music.pinned } })} /> : null}
      <button
        type="button"
        className="music-close nx-no-drag nx-ripple-host music-pressable"
        title="关闭音乐卡片"
        aria-label="关闭音乐卡片"
        onPointerDown={onButtonPointerDown}
        onClick={closeCard}
      >
        <IconClose />
      </button>

      {progressStyle === 'ring' ? (
        <div className="music-ring" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg className="music-ring-svg" viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} width={RING_SIZE} height={RING_SIZE} aria-hidden="true">
            <circle className="music-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} />
            <circle
              className="music-ring-value"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </svg>
          <Artwork artUrl={state.artUrl} />
        </div>
      ) : (
        <Artwork artUrl={state.artUrl} />
      )}

      <div className="music-main">
        <div className="music-topline">
          <button
            type="button"
            className="music-badge nx-no-drag nx-ripple-host music-pressable"
            title="切换系统媒体 / 本地音乐"
            onPointerDown={onButtonPointerDown}
            onClick={toggleSource}
          >
            <span>{isLocal ? '本地' : '系统'}</span>
          </button>
          <button
            type="button"
            className="music-pick nx-no-drag nx-ripple-host music-pressable"
            title="选择本地音频文件"
            onPointerDown={onButtonPointerDown}
            onClick={() => void pickLocalFiles()}
          >
            <IconFolder />
          </button>
          <span className="music-appid" title={state.appId || undefined}>
            {isLocal ? '内置播放器' : state.appId.replace(/\.exe$/i, '')}
          </span>
        </div>
        <div className={`music-title${empty ? ' is-empty' : ''}`} title={empty ? undefined : state.title}>
          {empty ? '未在播放' : state.title}
        </div>
        <div className="music-artist" title={empty ? undefined : state.artist}>
          {empty ? hint : state.artist || (isLocal ? '本地播放' : '未知艺术家')}
        </div>
      </div>

      <div className="music-bottom">
        {/* 进度条在 bar / ring 两种样式下都渲染：环只是装饰，seek 必须始终可达（点击/拖拽/方向键） */}
        <div
          className={`music-progress nx-no-drag${dragging ? ' is-dragging' : ''}${durationUnknown ? ' is-unknown' : ''}${
            durationUnknown && playing && !empty ? ' is-sweeping' : ''
          }${progressStyle === 'ring' ? ' is-ring' : ''}`}
          role="slider"
          tabIndex={0}
          title={durationUnknown ? '当前播放器未上报总时长，无法拖动定位；进度条只显示已播时间' : undefined}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={durationUnknown ? 0 : Math.round(durationMs)}
          aria-valuenow={durationUnknown ? 0 : Math.round(shownMs)}
          aria-valuetext={`${formatTime(shownMs)} / ${durationUnknown ? '未知' : formatTime(durationMs)}`}
          onPointerDown={onProgressPointerDown}
          onPointerMove={onProgressPointerMove}
          onPointerUp={onProgressPointerUp}
          onPointerCancel={onProgressPointerCancel}
          onKeyDown={onProgressKeyDown}
        >
          <div className="music-progress-fill" style={{ width: `${ratio * 100}%` }} />
          <div className="music-progress-thumb" style={{ left: `${ratio * 100}%` }} />
        </div>

        <div className="music-controls">
          <div className="music-buttons">
            <button
              type="button"
              className="music-ctrl nx-no-drag nx-ripple-host music-pressable"
              title="上一首"
              onPointerDown={onButtonPointerDown}
              onClick={handlePrev}
              disabled={empty || !canPrev}
            >
              <span key={nudge.seq} className={`music-nudge${nudge.dir === 'prev' ? ' is-prev' : ''}`}>
                <IconPrev />
              </span>
            </button>
            <button
              type="button"
              className="music-ctrl is-main nx-no-drag nx-ripple-host music-pressable"
              title={playing ? '暂停' : '播放'}
              onPointerDown={onButtonPointerDown}
              onClick={togglePlay}
              disabled={empty}
            >
              <span className={`music-play-icon${playing ? ' is-playing' : ''}`} aria-hidden="true">
                <span className="music-play-layer music-play-layer-play">
                  <IconPlay />
                </span>
                <span className="music-play-layer music-play-layer-pause">
                  <IconPause />
                </span>
              </span>
            </button>
            <button
              type="button"
              className="music-ctrl nx-no-drag nx-ripple-host music-pressable"
              title="下一首"
              onPointerDown={onButtonPointerDown}
              onClick={handleNext}
              disabled={empty || !canNext}
            >
              <span key={nudge.seq} className={`music-nudge${nudge.dir === 'next' ? ' is-next' : ''}`}>
                <IconNext />
              </span>
            </button>
          </div>
          <div className="music-time">
            <span>{formatTime(shownMs)}</span>
            <span className="music-time-sep">/</span>
            <span>{durationUnknown ? '--:--' : formatTime(durationMs)}</span>
          </div>
        </div>
      </div>

      {settingsError ? <div className="music-toast is-err" role="alert">{settingsError}</div> : null}
      {notice ? (
        <div key={notice.seq} className={`music-toast is-${notice.kind}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}
