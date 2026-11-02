import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { DockEdge, DockItem } from '@shared/types'
import { displayIconOf, displayNameOf } from '@shared/types'
import { spawnRipple } from '../shared/motion'

/**
 * AC-2.2 悬停放大的距离衰减系数。
 * 默认 magnification = 1.3 时，spec 要求 ±1 图标 ≈ 1.18、±2 图标 ≈ 1.06：
 *   factor(0) = 1、factor(1) = 0.6、factor(2) = 0.2 ⇒ factor = max(0, 1 - dist * 0.4)
 * 说明：任务书里给的是 0.14，代入会得到 ±1 = 1.258、±2 = 1.216，与 AC-2.2 的数值冲突；
 *       这里以 spec 验收标准为准，并已向 Lead 报备（只需改这一个常量即可切换）。
 */
export const HOVER_FALLOFF = 0.4

/** AC-2.2：悬停图标额外上浮 8px（随放大衰减一起递减） */
export const HOVER_LIFT_PX = 8

/** AC-9.2：按下时额外下沉 2px，产生「按进底条」的观感 */
const PRESS_LIFT_REDUCE_PX = 2

/** 读不到 --dock-press-scale 时的兜底值（标准档 0.94） */
const PRESS_SCALE_FALLBACK = 0.94

type DockItemCssVars = CSSProperties & Record<`--${string}`, string | number>

/**
 * 按压系数来自 motion.css 的 --dock-press-scale（随 data-motion 档位变化）。
 * 按档位缓存，避免每次渲染都读计算样式；data-motion 切换后首次读取会自动刷新。
 */
let pressScaleCache: { key: string; value: number } | null = null

function readDockPressScale(): number {
  const root = document.documentElement
  const key = root.dataset.motion ?? 'standard'
  if (pressScaleCache?.key === key) return pressScaleCache.value
  const parsed = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dock-press-scale'))
  const value = Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : PRESS_SCALE_FALLBACK
  pressScaleCache = { key, value }
  return value
}

interface DockItemViewProps {
  item: DockItem
  index: number
  edge: DockEdge
  iconSize: number
  magnification: number
  hoveredIndex: number | null
  running: boolean
  showIndicator: boolean
  dragging: boolean
  pressed: boolean
  /** 启动弹跳令牌：>0 表示正在播乐观反馈，值变化用于重新触发动画 */
  launchToken: number
  /**
   * Roving tabindex：工具栏内同一时刻只有一项 tabIndex=0（其余 -1），
   * Tab 进出工具栏只停一次，图标之间用方向键移动焦点（见 Dock.tsx 的 handleListKeyDown）。
   */
  tabIndex: number
  /** 图标获得焦点时上报 id，供 Dock 维护 roving tabindex 的「当前项」 */
  onFocus: (id: string) => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, index: number) => void
  onPointerEnter: (index: number) => void
  onPointerLeave: (index: number) => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, item: DockItem) => void
  onLaunch: (item: DockItem) => void
  onClick: (item: DockItem) => void
}

export function DockItemView(props: DockItemViewProps): JSX.Element {
  const { item, index, edge, iconSize, magnification, hoveredIndex, running, showIndicator, dragging, pressed } = props
  const { launchToken } = props
  const [imageFailed, setImageFailed] = useState(false)
  const iconRef = useRef<HTMLDivElement | null>(null)

  // 图标地址变化（例如主进程补齐了真实图标 / 用户改了自定义图标）时重试加载
  useEffect(() => {
    setImageFailed(false)
  }, [item.icon, item.customIcon])

  /**
   * 启动弹跳：类名由这里手动挂/摘。
   * 连点同一图标时 launchToken 会变，先移除类 → 强制重排 → 再挂回，动画才从头播放；
   * 令牌归零（Dock.tsx 定时清理）时移除类，图标恢复静态。
   */
  useEffect(() => {
    const element = iconRef.current
    if (!element) return
    if (launchToken <= 0) {
      element.classList.remove('is-launching')
      return
    }
    element.classList.remove('is-launching')
    // 读一次布局属性强制样式刷新，产生新的动画周期
    void element.offsetWidth
    element.classList.add('is-launching')
    return () => {
      element.classList.remove('is-launching')
    }
  }, [launchToken])

  const distance = hoveredIndex === null ? Number.POSITIVE_INFINITY : Math.abs(index - hoveredIndex)
  const factor = Number.isFinite(distance) ? Math.max(0, 1 - distance * HOVER_FALLOFF) : 0
  /** 按压中（拖拽开始时 pressed 会被清空，这里再兜一层，避免拖拽中误按压） */
  const pressActive = pressed && !dragging
  const pressScale = readDockPressScale()
  const scale = (dragging ? 1.05 : 1 + (magnification - 1) * factor) * (pressActive ? pressScale : 1)
  const hoverLift = dragging ? 0 : HOVER_LIFT_PX * factor
  // AC-9.2 按压时抬升减少 2px，松手后由 CSS 的 spring 曲线回弹
  const lift = pressActive ? Math.max(0, hoverLift - PRESS_LIFT_REDUCE_PX) : hoverLift
  const offset =
    edge === 'bottom'
      ? `translateY(${-lift}px)`
      : edge === 'top'
        ? `translateY(${lift}px)`
        : edge === 'left'
          ? `translateX(${lift}px)`
          : `translateX(${-lift}px)`

  const icon = displayIconOf(item)
  const imageSrc = icon.startsWith('icon://') || icon.startsWith('data:') ? icon : ''
  const showImage = imageSrc.length > 0 && !imageFailed
  /** v1.6：Dock 显示自定义名称（回退原始名称），tooltip / 无障碍标签同步 */
  const displayName = displayNameOf(item)
  const letter = firstChar(displayName)

  // 放大时按衰减程度抬高层级，避免放大后的图标被相邻图标盖住
  const stackZIndex = factor > 0 ? Math.round(factor * 100) : undefined

  // AC-9.5 悬停光效：强度随邻项衰减系数走，由 CSS 注册属性 --dock-glow 平滑过渡
  const itemStyle: DockItemCssVars = {
    zIndex: stackZIndex,
    // 入场错峰：每项延迟 = index × 24ms（dock.css 读取该变量）
    '--dock-index': index
  }
  const iconStyle: DockItemCssVars = { '--dock-glow': factor.toFixed(3) }

  return (
    <div
      className="dock-item nx-ripple-glow-host"
      role="button"
      tabIndex={props.tabIndex}
      aria-label={displayName}
      aria-haspopup="menu"
      title={displayName}
      style={itemStyle}
      data-dock-id={item.id}
      data-dragging={dragging ? 'true' : undefined}
      data-pressed={pressed ? 'true' : undefined}
      data-running={running ? 'true' : undefined}
      onFocus={() => props.onFocus(item.id)}
      onPointerDown={(event) => {
        // AC-9.3 跟手：按下瞬间就从点击点扩散光晕（独立图层，pointer-events:none，不影响拖拽判定）
        // 仅左键：右键会弹原生菜单，不应有按压缩放/光晕
        if (event.button === 0) spawnRipple(event.currentTarget, event, { kind: 'glow', scale: 1.9 })
        props.onPointerDown(event, index)
      }}
      onPointerEnter={() => props.onPointerEnter(index)}
      onPointerLeave={() => props.onPointerLeave(index)}
      onContextMenu={(event) => props.onContextMenu(event, item)}
      onClick={(event) => {
        // 单击启动走 click（pointerdown 阶段不抢指针捕获，所以 target 仍是图标本身）
        event.stopPropagation()
        props.onClick(item)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onLaunch(item)
        }
      }}
    >
      <div className="dock-item-inner" style={{ transform: `${offset} scale(${scale})` }}>
        <div className="dock-item-icon" ref={iconRef} style={iconStyle}>
          {showImage ? (
            <img
              className="dock-icon-img"
              src={imageSrc}
              alt=""
              draggable={false}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="dock-icon-letter" style={letterStyle(item, iconSize)} aria-hidden="true">
              {letter}
            </span>
          )}
        </div>
      </div>
      {showIndicator ? <span className={`dock-indicator${running ? ' is-running' : ''}`} aria-hidden="true" /> : null}
    </div>
  )
}

/** 名称首字（兼容 emoji / 中日韩字符，按码点取第一个） */
function firstChar(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return Array.from(trimmed)[0] ?? '?'
}

/** 由 id + 名称稳定散列出一个色相，让字母占位图标的渐变有区分度且不闪变 */
function hueOf(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

function letterStyle(item: DockItem, iconSize: number): CSSProperties {
  const hue = hueOf(`${item.id}:${item.name}`)
  return {
    background: `linear-gradient(145deg, hsl(${hue} 72% 62%), hsl(${(hue + 42) % 360} 68% 42%))`,
    borderRadius: `${Math.round(iconSize * 0.24)}px`,
    fontSize: `${Math.round(iconSize * 0.42)}px`
  }
}
