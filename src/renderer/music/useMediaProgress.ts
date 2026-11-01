import { useEffect, useRef, useState } from 'react'
import type { PlaybackStatus } from '@shared/types'

/** 重锚时允许平滑追赶的最大偏差；更大的偏差视为跳转（切歌/拖动）直接对齐 */
const MAX_SMOOTH_OFFSET = 4000
/** 偏移量每帧衰减系数（约 180ms 收敛到 1ms 以内） */
const OFFSET_DECAY = 0.82
/** 播放器「位置回退到起点」的容差：小于该值且明显小于当前显示值时视为播放器没上报位置 */
const RESET_GUARD_MS = 1200

function clock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * 音乐进度插值。
 *
 * 修复两个真实问题：
 * 1) 暂停再播放后，部分播放器（酷狗等）会把 position 重新上报为 0，导致时间归零
 *    → 同曲目内若新 position 突然回退到接近 0，保留当前显示值继续走，不跳回 0；
 * 2) 暂停瞬间播放器可能上报 0 → 暂停时冻结当前显示值，不闪回。
 *
 * 其他行为保留：新 position 到达用偏移量平滑追赶；duration 未知时不做上限钳制、不参与除法。
 */
export function useMediaProgress(
  positionMs: number,
  durationMs: number,
  status: PlaybackStatus,
  trackKey = ''
): number {
  const [display, setDisplay] = useState<number>(() => Math.max(0, Math.round(positionMs)))
  const displayRef = useRef(display)
  const baseRef = useRef({ position: Math.max(0, positionMs), at: clock() })
  const offsetRef = useRef(0)
  const statusRef = useRef(status)
  const durationRef = useRef(durationMs)
  const trackRef = useRef(trackKey)
  /** 上一次进入 effect 时的播放状态（用于识别「暂停 → 播放」这个切换） */
  const prevStatusRef = useRef(status)
  durationRef.current = durationMs

  // 切歌：立即重置
  useEffect(() => {
    if (trackRef.current === trackKey) return
    trackRef.current = trackKey
    const next = Math.max(0, Math.round(positionMs))
    displayRef.current = next
    baseRef.current = { position: next, at: clock() }
    offsetRef.current = 0
    setDisplay(next)
  }, [trackKey, positionMs])

  // 新 position 到达
  useEffect(() => {
    const previousStatus = prevStatusRef.current
    prevStatusRef.current = status
    statusRef.current = status
    const current = displayRef.current
    const isPause = status === 'paused' || status === 'stopped'

    // 暂停/停止：冻结当前显示值（播放器此时常把 position 报成 0）
    if (isPause) {
      baseRef.current = { position: current, at: clock() }
      offsetRef.current = 0
      return
    }

    // 续播：播放器把位置重置到起点时，接着上次显示值继续走
    // （酷狗/QQ音乐等暂停后会丢失 position，恢复播放时上报 0）
    if (previousStatus !== 'playing' && status === 'playing' && current > 2000 && positionMs < RESET_GUARD_MS) {
      baseRef.current = { position: current, at: clock() }
      offsetRef.current = 0
      return
    }

    // 同一曲目播放中，位置突然回退到接近 0（播放器丢 position）也保持连续
    if (status === 'playing' && current > 3000 && positionMs < RESET_GUARD_MS) {
      baseRef.current = { position: current, at: clock() }
      offsetRef.current = 0
      return
    }

    let offset = current - positionMs
    if (!Number.isFinite(offset) || Math.abs(offset) > MAX_SMOOTH_OFFSET) offset = 0
    offsetRef.current = offset
    baseRef.current = { position: Math.max(0, positionMs), at: clock() }
  }, [positionMs, status])

  // 帧循环：播放中持续推进；暂停/停止时保持不动。
  // 轻量化：music 窗口恢复 backgroundThrottling 后，隐藏期间 rAF 会被暂停；
  // 这里主动停止排帧（隐藏时不做无效计算），重新可见时立即排一帧 ——
  // tick 用 base.position + 真实经过时间推算，隐藏多久都会立即补齐当前进度。
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = 0
      if (document.visibilityState === 'hidden') return
      const base = baseRef.current
      const playing = statusRef.current === 'playing'
      let raw = base.position + (playing ? clock() - base.at : 0)
      if (!Number.isFinite(raw) || raw < 0) raw = 0
      const duration = durationRef.current
      if (duration > 0 && raw > duration) raw = duration

      let offset = offsetRef.current
      if (offset !== 0) {
        offset *= OFFSET_DECAY
        if (Math.abs(offset) < 0.5) offset = 0
        offsetRef.current = offset
      }

      const next = Math.max(0, Math.round(raw + offset))
      if (next !== displayRef.current) {
        displayRef.current = next
        setDisplay(next)
      }
      if (playing || offsetRef.current !== 0) {
        raf = window.requestAnimationFrame(tick)
      }
    }
    const onVisibilityChange = (): void => {
      // 重新可见时立即补一帧（隐藏期间不会排帧）
      if (document.visibilityState === 'visible' && raf === 0) {
        raf = window.requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.visibilityState === 'visible') raf = window.requestAnimationFrame(tick)
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [positionMs, status, durationMs])

  return display
}
