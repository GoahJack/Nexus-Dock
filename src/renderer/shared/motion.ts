/**
 * Nexus Motion v1.0 —— 涟漪光晕与点击音效（零依赖，见 docs/motion-spec.md §1/§2.4）
 *
 * 设计要点：
 * - 涟漪用真实 DOM 图层（<span class="nx-ripple">），动画结束自动移除，不进入 React 状态；
 * - 尊重系统 prefers-reduced-motion 与用户「减少动效」开关：直接不创建图层；
 * - 点击音效默认关闭，开启后用 WebAudio 合成 50ms 短音，不依赖任何音频资源。
 */

export type RippleKind = 'surface' | 'glow'

export interface RippleOptions {
  /** surface = 裁切在圆角容器内（按钮）；glow = 可溢出（透明 Dock 图标） */
  kind?: RippleKind
  /** 自定义光晕颜色（CSS 颜色值），默认强调蓝 */
  color?: string
  /** 直径倍数，默认 surface 2×、glow 1.9× */
  scale?: number
  /** 是否同时播放点击音效，默认 true（仅在用户开启音效时真正播放） */
  sound?: boolean
}

/** 用户是否要求减少动效（系统偏好或设置开关任一为真） */
export function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.reducedMotion === 'true') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let audioContext: AudioContext | null = null

function ensureAudioContext(): AudioContext | null {
  if (audioContext) {
    if (audioContext.state === 'suspended') void audioContext.resume()
    return audioContext
  }
  const Ctor = window.AudioContext
  if (!Ctor) return null
  try {
    audioContext = new Ctor()
    return audioContext
  } catch {
    return null
  }
}

/**
 * 合成一次轻量点击音：三角波 1.45kHz → 0.88kHz，指数衰减 60ms。
 * 音量刻意压得很低（峰值 ~0.05），避免成为噪音源。
 */
export function playClickSound(): void {
  const ctx = ensureAudioContext()
  if (!ctx) return
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1450, now)
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.045)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.07)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}

function maybePlayClickSound(): void {
  if (document.documentElement.dataset.clickSound !== 'true') return
  playClickSound()
}

/**
 * 在宿主元素上生成一圈从点击位置扩散的涟漪/光晕。
 * 宿主需要是定位元素：加 `.nx-ripple-host`（裁剪）或 `.nx-ripple-glow-host`（不裁剪）。
 */
export function spawnRipple(
  host: HTMLElement | null,
  event: { clientX: number; clientY: number },
  options: RippleOptions = {}
): void {
  if (!host) return
  if (options.sound !== false) maybePlayClickSound()
  if (prefersReducedMotion()) return

  const rect = host.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return

  const kind: RippleKind = options.kind ?? 'surface'
  const scale = options.scale ?? (kind === 'glow' ? 1.9 : 2)
  const size = Math.max(rect.width, rect.height) * scale

  const ripple = document.createElement('span')
  ripple.className = `nx-ripple nx-ripple-${kind}`
  ripple.setAttribute('aria-hidden', 'true')
  ripple.style.left = `${event.clientX - rect.left}px`
  ripple.style.top = `${event.clientY - rect.top}px`
  ripple.style.width = `${size}px`
  ripple.style.height = `${size}px`
  if (options.color) ripple.style.setProperty('--nx-ripple-color', options.color)

  host.appendChild(ripple)

  let removed = false
  const cleanup = (): void => {
    if (removed) return
    removed = true
    ripple.remove()
  }
  ripple.addEventListener('animationend', cleanup, { once: true })
  // 动画被降级/中断时的兜底清理
  window.setTimeout(cleanup, 900)
}

/** React 事件用的便捷封装（预留一行动画的图标：取 currentTarget 作为宿主） */
export function rippleFromEvent(
  event: { currentTarget: EventTarget | null; clientX: number; clientY: number },
  options: RippleOptions = {}
): void {
  const target = event.currentTarget
  if (target instanceof HTMLElement) spawnRipple(target, event, options)
}
