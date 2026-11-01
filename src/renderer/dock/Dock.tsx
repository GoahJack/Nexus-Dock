import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { isHorizontalEdge, SCREEN_MARGIN } from '@shared/types'
import type { DockItem, Point, Settings, ThemeMode } from '@shared/types'
import { useContentSize, useSettings } from '../shared/hooks'
import { prefersReducedMotion, spawnRipple } from '../shared/motion'
import { DockItemView, HOVER_LIFT_PX } from './DockItemView'

const DRAG_THRESHOLD_PX = 6
const ERROR_VISIBLE_MS = 2000
/** Toast 退出动画时长：先挂 is-leaving 播 nx-toast-out，播完再卸载 */
const TOAST_EXIT_MS = 160
/** 启动弹跳乐观反馈窗口：覆盖最长的 --nx-dur-spring 动画后清理 launching 状态 */
const LAUNCH_FEEDBACK_MS = 700
/** FLIP 兜底清理时间（动画被中断或降级时 transitionend 可能不触发） */
const FLIP_FALLBACK_MS = 900
/** 拖拽排序时指针进入列表边缘这么多像素内就自动滚动（让尾部槽位可拖到） */
const SCROLL_EDGE_PX = 24
/** 每次 pointermove 的自动滚动步长（拖动中逐帧推进，避免一次跳太远） */
const DRAG_SCROLL_STEP_PX = 10
/** 滚轮事件 deltaMode=DOM_DELTA_LINE 时，一行折算的像素 */
const WHEEL_LINE_PX = 16
/** 键盘打开右键菜单后，忽略浏览器补发 contextmenu 的时间窗（ms，见 keyboardMenuAtRef） */
const KEYBOARD_MENU_DEDUPE_MS = 400
/**
 * 屏幕工作区上限的安全余量：
 * useContentSize 上报的是 ceil(rect)+1，主进程夹紧时会四舍五入，留 1px 避免
 * 「渲染上限 +1 恰好等于夹紧上限」这种边界上来回 resize。
 */
const DOCK_LIMIT_SLACK_PX = 1

type DockCssVars = CSSProperties & Record<`--${string}`, string>

interface DragSession {
  pointerId: number
  /** 被拖拽图标的 id：排序后 index 会变，用 id 定位最稳 */
  id: string
  startX: number
  startY: number
  /** 位移超过 6px 才进入拖拽态，否则松手视为单击启动 */
  active: boolean
  /** 当前指针命中的槽位下标 */
  index: number
  /** 按下时的持久化顺序，松手后用于判断是否需要 apps:reorder */
  originalIds: string[]
}

interface DockToast {
  message: string
  /** 退出阶段：保留 DOM 播完 nx-toast-out 再卸载 */
  leaving: boolean
  /** 每次报错递增，用作 key 让连续 toast 重新播放入场动画 */
  seq: number
}

interface LaunchFeedback {
  /** 正在播放启动弹跳的图标 id */
  id: string
  /** 连点同一图标时递增，用于重新触发动画 */
  token: number
}

/** 图标条的主轴可滚动状态：决定是否开滚动容器、两端是否显示渐隐遮罩 */
interface ScrollState {
  /** 内容主轴尺寸 > 可视主轴尺寸：需要滚动（同时触发 data-scrollable） */
  overflow: boolean
  /** 起点方向还有未显示的内容（横排 = 左侧，竖排 = 上方）→ 起点渐隐 */
  start: boolean
  /** 终点方向还有未显示的内容 → 终点渐隐 */
  end: boolean
}

/** 屏幕工作区给出的布局上限（px）；null 表示取不到（回退到 100vw/100vh） */
interface DockLimits {
  /** 横排时底条最大宽度（含 root padding） */
  width: number
  /** 竖排时底条最大高度（含 root padding） */
  height: number
}

/** 未滚动时的初始状态：复用同一个对象，避免每次测量都触发一次 setState */
const NO_SCROLL: ScrollState = { overflow: false, start: false, end: false }

/**
 * Dock 主窗口。
 * settings 未加载完成时渲染空（避免闪一帧默认值）。
 * 拆成 Dock + DockView 两层，保证 Hooks 调用顺序稳定。
 */
export function Dock(): JSX.Element | null {
  const { settings, error, retry } = useSettings()
  // 仍在加载：保持原行为（不闪默认值）
  if (!settings) {
    // 加载失败（settings.get() reject / 预加载缺失）：旧实现此时永久空白透明窗，
    // 用户既看不到内容也不知道该做什么 —— 这里给出可读卡片 + 重试入口
    if (!error) return null
    return <DockLoadError message={error} onRetry={retry} />
  }
  return <DockView settings={settings} />
}

/**
 * 设置加载失败时的降级界面。
 * 样式全部内联自包含（不依赖 ui.css 的新类），只求「看得见、点得到、可重试」。
 * 尺寸仍回报给主进程：否则透明窗口会留下一大片隐形点击区。
 */
function DockLoadError({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const card = cardRef.current
    const bridge = window.nexus?.window
    if (!card || typeof bridge?.setContentSize !== 'function') return
    const push = (): void => {
      const rect = card.getBoundingClientRect()
      const width = Math.ceil(rect.width) + 1
      const height = Math.ceil(rect.height) + 1
      if (width < 2 || height < 2) return
      bridge.setContentSize('dock', { width, height })
    }
    push()
    const observer = new ResizeObserver(push)
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={cardRef}
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxSizing: 'border-box',
        width: 'max-content',
        maxWidth: '420px',
        margin: '8px',
        padding: '8px 10px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 107, 107, 0.5)',
        background: 'rgba(46, 22, 26, 0.94)',
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.45)',
        color: '#ffdede',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: 1.35,
        userSelect: 'none',
        // Electron 的 -webkit-app-region 不在 React 的 CSSProperties 类型里
        ['WebkitAppRegion' as string]: 'no-drag'
      }}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
        Dock 设置加载失败
        <span style={{ display: 'block', color: 'rgba(255, 222, 222, 0.72)', fontSize: '11.5px' }}>{message}</span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          flex: '0 0 auto',
          padding: '5px 12px',
          borderRadius: '999px',
          border: '1px solid rgba(255, 107, 107, 0.55)',
          background: 'rgba(255, 107, 107, 0.16)',
          color: '#ffe9e9',
          fontFamily: 'inherit',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          ['WebkitAppRegion' as string]: 'no-drag'
        }}
      >
        重试
      </button>
    </div>
  )
}

function DockView({ settings }: { settings: Settings }): JSX.Element {
  const { edge, iconSize, magnification, gap, padding, showIndicators, opacity, theme } = settings.dock
  const musicVisible = settings.music.visible
  /** v1.1：桌面时钟可见态与 Dock 位置锁定，均来自 useSettings 订阅的广播，切换即时联动 */
  const clockVisible = settings.clock.visible
  const dockLocked = settings.lock.dock
  /** opacity≈0 时底条完全透明：只保留图标与图标阴影（不能用整块 opacity，否则图标一起变淡） */
  const transparentBar = opacity < 0.02

  /* ------------------------------ 本地状态 ------------------------------ */

  /** 图标顺序用本地 state：拖拽期间实时重排，松手才写回设置 */
  const [items, setItems] = useState<DockItem[]>(settings.apps)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pressedId, setPressedId] = useState<string | null>(null)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<DockToast | null>(null)
  const [launching, setLaunching] = useState<LaunchFeedback | null>(null)
  /** 图标条主轴滚动状态：溢出时开滚动容器 + 两端渐隐 */
  const [scrollState, setScrollState] = useState<ScrollState>(NO_SCROLL)
  /** 屏幕工作区给出的布局上限（常量，避免与窗口尺寸互相反馈，见 dock.css 说明） */
  const [dockLimits, setDockLimits] = useState<DockLimits | null>(readDockLimits)
  /** roving tabindex 的「当前项」：工具栏内同一时刻只有一个图标能被 Tab 到 */
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const horizontal = isHorizontalEdge(edge)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const listRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragSession | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const toastExitTimerRef = useRef<number | null>(null)
  const toastSeqRef = useRef(0)
  const launchTimerRef = useRef<number | null>(null)
  /** FLIP：重排前记录的位置 / 下一帧请求 / 内联样式归属（元素 → 批次号） */
  const flipRectsRef = useRef<Map<string, DOMRect> | null>(null)
  const flipFrameRef = useRef<number | null>(null)
  const flipOwnerRef = useRef<Map<HTMLElement, number>>(new Map())
  const flipBatchRef = useRef(0)
  const flipTimersRef = useRef<Set<number>>(new Set())
  /** 拖拽结束后的短暂窗口内忽略 click，避免「拖完又启动应用」 */
  const suppressClickRef = useRef(false)
  /**
   * 最近一次「键盘打开右键菜单」的时间戳。
   * Chromium 里 Shift+F10 / 菜单键除了派发 keydown，还可能再派发一次 contextmenu；
   * 这里用它去重，避免同一个菜单被打开两次（keydown 里已 preventDefault，这里是兜底）。
   */
  const keyboardMenuAtRef = useRef(0)

  /* --------------------------- 窗口尺寸自适应 --------------------------- */

  // 内容尺寸回报给主进程；transparent 窗口必须与内容等大，否则会出现隐形点击区
  const { ref: rootRef } = useContentSize('dock', [edge, iconSize, gap, items.length])

  /**
   * 放大预留空间：图标朝屏幕内侧整幅放大（transform-origin 贴边），
   * 所以内侧需要 (magnification-1)*iconSize 的放大 + 8px 上浮，减去底条自身 padding；
   * 任务书公式 ceil(iconSize*(magnification-1)/2)+8 在默认值下更大，直接取两者最大值，
   * 保证默认观感完全按公式，同时极端倍数/尺寸下也不会被窗口裁掉。
   */
  const growth = iconSize * Math.max(0, magnification - 1)
  const room = Math.max(Math.ceil(growth / 2) + HOVER_LIFT_PX, Math.ceil(growth) + HOVER_LIFT_PX - padding)

  /* ----------------------- 屏幕工作区给出的布局上限 ----------------------- */

  /**
   * 窗口能长到多大由主进程夹紧决定（工作区 - 边距）。渲染层先用同一个常量把布局
   * 收缩到上限之内，否则 root 宽度会派生自视口，与 useContentSize 的「+1px 回报」
   * 形成正反馈：root=W → 上报 W+1 → 窗口变 W+1 → root=W+1 → … 每帧长 1px。
   */
  useEffect(() => {
    const sync = (): void => {
      const next = readDockLimits()
      setDockLimits((previous) => {
        if (previous === next) return previous
        if (previous && next && previous.width === next.width && previous.height === next.height) return previous
        return next
      })
    }
    // 窗口被移动到另一块显示器时 workArea 会变（主进程重新夹紧会触发 resize）
    window.addEventListener('resize', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  /* ---------------------------- 图标条滚动状态 ---------------------------- */

  /** 空状态按钮引用：items 为空时它的宽度就是主轴内容尺寸 */
  const emptyButtonRef = useRef<HTMLButtonElement | null>(null)
  const emptyWidthRef = useRef(0)

  /**
   * 重新判断「内容主轴尺寸 vs 可视主轴尺寸」。
   * 内容尺寸由设置值直接算出（items × iconSize + gap），不读子元素 rect，
   * 因此拖拽中的 FLIP 内联 transform 不会干扰判断。
   */
  const measureScroll = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const count = itemsRef.current.length
    const contentMain = count > 0 ? count * iconSize + (count - 1) * gap : emptyWidthRef.current
    const clientMain = horizontal ? list.clientWidth : list.clientHeight
    const position = horizontal ? list.scrollLeft : list.scrollTop
    const overflow = contentMain > clientMain + 0.5 && clientMain > 0
    const next: ScrollState = {
      overflow,
      start: overflow && position > 1,
      end: overflow && position + clientMain < contentMain - 1
    }
    setScrollState((previous) =>
      previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end
        ? previous
        : next
    )
  }, [gap, horizontal, iconSize])

  // 首帧就用 layout effect 量：data-scrollable 在浏览器绘制前就位，
  // 避免「先按未溢出画一帧 → 再切换成滚动」造成的图标闪动 / 尾部顶出
  useLayoutEffect(() => {
    emptyWidthRef.current = emptyButtonRef.current?.offsetWidth ?? 0
    measureScroll()
  }, [measureScroll, items])

  // 窗口尺寸变化（主进程夹紧）/ 可见性恢复时重算
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(() => measureScroll())
    observer.observe(list)
    window.addEventListener('resize', measureScroll)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureScroll)
    }
  }, [measureScroll])

  // 滚轮驱动滚动：原生监听才能 passive: false（React 的 onWheel 是 passive，拦不住页面滚动）
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const handleWheel = (event: WheelEvent): void => {
      // 拖拽排序中不接管滚轮：指针不动时滚动会让拖拽落点自己乱跳
      if (dragRef.current) return
      const raw = horizontal
        ? Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
        : event.deltaY
      if (raw === 0) return
      // deltaMode: 0 = 像素, 1 = 行, 2 = 页
      const factor =
        event.deltaMode === 1
          ? WHEEL_LINE_PX
          : event.deltaMode === 2
            ? Math.max(1, horizontal ? list.clientWidth : list.clientHeight)
            : 1
      const delta = raw * factor
      const before = horizontal ? list.scrollLeft : list.scrollTop
      if (horizontal) list.scrollLeft = before + delta
      else list.scrollTop = before + delta
      const after = horizontal ? list.scrollLeft : list.scrollTop
      // 没滚起来（未溢出 / 已到端点）就别吞掉滚轮事件
      if (after === before) return
      event.preventDefault()
      measureScroll()
    }
    list.addEventListener('wheel', handleWheel, { passive: false })
    return () => list.removeEventListener('wheel', handleWheel)
  }, [horizontal, measureScroll])

  /* ------------------------------ 设置联动 ------------------------------ */

  // 设置里的 apps 变化（增删 / 排序 / 主进程补齐图标）时同步本地顺序；拖拽中不打断
  useEffect(() => {
    if (dragRef.current) return
    setItems(settings.apps)
  }, [settings.apps])

  // AC-2.6：订阅运行态；关闭指示点时不必订阅
  useEffect(() => {
    if (!showIndicators) {
      setRunning({})
      return
    }
    // 主进程在受限环境下可能只上报「确定在运行」的条目，这里合并而不是整体替换
    return window.nexus.apps.onRunning((next) => setRunning((previous) => ({ ...previous, ...next })))
  }, [showIndicators])

  // 定时器 / FLIP 内联样式统一在卸载时回收
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
      if (toastExitTimerRef.current !== null) window.clearTimeout(toastExitTimerRef.current)
      if (launchTimerRef.current !== null) window.clearTimeout(launchTimerRef.current)
      for (const timer of flipTimersRef.current) window.clearTimeout(timer)
      flipTimersRef.current.clear()
      flipOwnerRef.current.clear()
    },
    []
  )

  /** 错误提示：2s 后先进入 is-leaving 播 160ms 退出动画，再卸载 DOM */
  const showError = useCallback((message: string) => {
    toastSeqRef.current += 1
    setToast({ message, leaving: false, seq: toastSeqRef.current })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    if (toastExitTimerRef.current !== null) {
      window.clearTimeout(toastExitTimerRef.current)
      toastExitTimerRef.current = null
    }
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast((current) => (current ? { ...current, leaving: true } : current))
      toastExitTimerRef.current = window.setTimeout(() => {
        toastExitTimerRef.current = null
        setToast(null)
      }, TOAST_EXIT_MS)
    }, ERROR_VISIBLE_MS)
  }, [])

  /* -------------------------------- 启动 -------------------------------- */

  const launch = useCallback(
    (item: DockItem) => {
      void window.nexus.apps
        .launch(item.id)
        .then((result) => {
          if (!result.ok) {
            const detail = result.error?.trim()
            showError(detail ? `无法启动「${item.name}」：${detail}` : `无法启动「${item.name}」`)
          }
        })
        .catch((reason: unknown) => {
          const detail = reason instanceof Error ? reason.message : String(reason)
          showError(`无法启动「${item.name}」：${detail}`)
        })
    },
    [showError]
  )

  /**
   * 点击 / 键盘启动：先播乐观反馈（朝屏幕内侧的启动弹跳 + 光晕），再走真实启动流程。
   * 启动耗时 1–2s，等主进程结果再动会显得迟钝；失败只追加 toast，不回滚弹跳。
   */
  const requestLaunch = useCallback(
    (item: DockItem) => {
      setLaunching((previous) => ({ id: item.id, token: (previous?.token ?? 0) + 1 }))
      if (launchTimerRef.current !== null) window.clearTimeout(launchTimerRef.current)
      launchTimerRef.current = window.setTimeout(() => {
        launchTimerRef.current = null
        setLaunching(null)
      }, LAUNCH_FEEDBACK_MS)
      launch(item)
    },
    [launch]
  )

  /* ------------------------------ 音乐开关 ------------------------------ */

  const toggleMusic = useCallback(() => {
    void window.nexus.settings
      .update({ music: { visible: !musicVisible } })
      .catch(() => showError('切换音乐卡片失败'))
  }, [musicVisible, showError])

  /* ------------------------------ 时钟开关 ------------------------------ */

  // AC-13.1：Dock 末端时钟按钮与设置「时钟」页共享 settings.clock.visible
  const toggleClock = useCallback(() => {
    void window.nexus.settings
      .update({ clock: { visible: !clockVisible } })
      .catch(() => showError('切换桌面时钟失败'))
  }, [clockVisible, showError])

  /* ------------------------------ 拖拽排序 ------------------------------ */

  /** 指针在图标条轴向的位置 → 目标槽位（按相邻槽位中点切换） */
  const computeTargetIndex = useCallback(
    (clientX: number, clientY: number, fallback: number): number => {
      const list = listRef.current
      const count = itemsRef.current.length
      if (!list || count === 0) return fallback
      const rect = list.getBoundingClientRect()
      const pitch = iconSize + gap
      if (pitch <= 0) return fallback
      const horizontalLayout = isHorizontalEdge(edge)
      // 列表可滚动后 rect 会跟着滚，必须把滚动位移加回来；
      // 否则滚动过的 Dock 上落点会整体偏移 scrollLeft/pitch 个槽位
      const scrollOffset = horizontalLayout ? list.scrollLeft : list.scrollTop
      const position = (horizontalLayout ? clientX - rect.left : clientY - rect.top) + scrollOffset
      const target = Math.round((position - iconSize / 2) / pitch)
      return Math.min(count - 1, Math.max(0, target))
    },
    [edge, iconSize, gap]
  )

  const commitOrder = useCallback(
    (previousIds: string[]) => {
      const ids = itemsRef.current.map((item) => item.id)
      const changed = ids.length !== previousIds.length || ids.some((id, index) => id !== previousIds[index])
      if (!changed) return
      // AC-2.5：顺序变化才持久化
      void window.nexus.apps
        .reorder(ids)
        .then((next) => setItems(next))
        .catch(() => showError('保存图标顺序失败'))
    },
    [showError]
  )

  /* ---------------------------- FLIP 排序过渡 ---------------------------- */

  /** FLIP 的 First：重排前记录每个 [data-dock-id] 的屏幕位置（减少动效时跳过） */
  const captureFlipRects = useCallback(() => {
    const list = listRef.current
    if (!list || prefersReducedMotion()) {
      flipRectsRef.current = null
      return
    }
    const rects = new Map<string, DOMRect>()
    list.querySelectorAll<HTMLElement>('.dock-item[data-dock-id]').forEach((element) => {
      const id = element.dataset.dockId
      if (id) rects.set(id, element.getBoundingClientRect())
    })
    flipRectsRef.current = rects
  }, [])

  /**
   * FLIP 的 Last/Invert/Play：布局提交后把图标反算回旧位置（无过渡），
   * 下一帧再换成 spring 曲线过渡回 0。位移只作用在 .dock-item 外层，
   * 与 .dock-item-inner 的放大 / 按压 transform 互不干扰。
   */
  useLayoutEffect(() => {
    const previous = flipRectsRef.current
    flipRectsRef.current = null
    if (!previous || previous.size === 0) return
    const list = listRef.current
    if (!list || prefersReducedMotion()) return

    const batch = ++flipBatchRef.current
    const moving: HTMLElement[] = []
    list.querySelectorAll<HTMLElement>('.dock-item[data-dock-id]').forEach((element) => {
      const id = element.dataset.dockId
      const from = id ? previous.get(id) : undefined
      if (!from) return
      // 上一批 FLIP 可能还在动画中：先清掉内联位移再测量，
      // 否则新位移会叠加在旧位移上，切换批次时图标会跳一下
      const carriedOver = flipOwnerRef.current.has(element)
      if (carriedOver) {
        element.style.transition = 'none'
        element.style.transform = 'translate(0px, 0px)'
      }
      const to = element.getBoundingClientRect()
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        if (carriedOver) {
          // 上一批已经基本归位，直接收尾清理，避免遗留内联样式
          flipOwnerRef.current.delete(element)
          element.style.removeProperty('transform')
          element.style.removeProperty('transition')
          element.style.removeProperty('will-change')
        }
        return
      }
      element.style.transition = 'none'
      element.style.transform = `translate(${dx}px, ${dy}px)`
      element.style.willChange = 'transform'
      flipOwnerRef.current.set(element, batch)
      moving.push(element)
    })
    if (moving.length === 0) return

    /** 只清理仍归本批次所有的内联样式，避免拖动中多次 FLIP 互相踩踏 */
    const finish = (element: HTMLElement): void => {
      if (flipOwnerRef.current.get(element) !== batch) return
      flipOwnerRef.current.delete(element)
      element.style.removeProperty('transform')
      element.style.removeProperty('transition')
      element.style.removeProperty('will-change')
    }
    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (event.propertyName !== 'transform') return
      if (event.target instanceof HTMLElement) finish(event.target)
    }
    for (const element of moving) element.addEventListener('transitionend', handleTransitionEnd)

    let started = false
    const firstFrame = window.requestAnimationFrame(() => {
      flipFrameRef.current = window.requestAnimationFrame(() => {
        flipFrameRef.current = null
        started = true
        for (const element of moving) {
          element.style.transition = 'transform var(--nx-dur-slow) var(--nx-spring)'
          element.style.transform = 'translate(0px, 0px)'
        }
        // transitionend 可能因中断/降级不触发，兜底清理内联样式
        const timer = window.setTimeout(() => {
          flipTimersRef.current.delete(timer)
          for (const element of moving) finish(element)
        }, FLIP_FALLBACK_MS)
        flipTimersRef.current.add(timer)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (flipFrameRef.current !== null) {
        window.cancelAnimationFrame(flipFrameRef.current)
        flipFrameRef.current = null
      }
      for (const element of moving) element.removeEventListener('transitionend', handleTransitionEnd)
      // 过渡还没启动就被打断：立即恢复原位，避免遗留半截位移
      if (!started) for (const element of moving) finish(element)
    }
  }, [items])

  const handleItemPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return
    const item = itemsRef.current[index]
    const list = listRef.current
    if (!item || !list) return
    event.preventDefault()
    // 注意：这里不能立刻 setPointerCapture —— 捕获会把后续 click 的 target 改成容器，
    // 导致图标的 onClick 不触发（历史 bug：点图标没反应）。
    // 只有真正开始拖拽时才在 pointermove 里捕获指针。
    dragRef.current = {
      pointerId: event.pointerId,
      id: item.id,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      index,
      originalIds: itemsRef.current.map((candidate) => candidate.id)
    }
    setPressedId(item.id)
  }, [])

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.active) {
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
        if (moved <= DRAG_THRESHOLD_PX) return
        drag.active = true
        // 进入拖拽后才捕获指针：此时 click 不再需要，捕获可保证排序过程稳定
        try {
          listRef.current?.setPointerCapture(event.pointerId)
        } catch {
          /* 忽略失效指针 */
        }
        setPressedId(null)
        setDraggingId(drag.id)
        setHoveredIndex(null)
      }
      // 拖到列表边缘时自动滚动：窗口被夹紧后，不滚动就永远拖不到可视区外的槽位
      const list = listRef.current
      if (list) {
        const rect = list.getBoundingClientRect()
        if (horizontal) {
          if (event.clientX < rect.left + SCROLL_EDGE_PX) list.scrollLeft -= DRAG_SCROLL_STEP_PX
          else if (event.clientX > rect.right - SCROLL_EDGE_PX) list.scrollLeft += DRAG_SCROLL_STEP_PX
        } else {
          if (event.clientY < rect.top + SCROLL_EDGE_PX) list.scrollTop -= DRAG_SCROLL_STEP_PX
          else if (event.clientY > rect.bottom - SCROLL_EDGE_PX) list.scrollTop += DRAG_SCROLL_STEP_PX
        }
      }
      const target = computeTargetIndex(event.clientX, event.clientY, drag.index)
      if (target === drag.index) return
      drag.index = target
      // 同步更新 ref：连续 pointermove 可能落在同一帧，不能等 setState 渲染后再读顺序
      const next = moveItem(itemsRef.current, drag.id, target)
      if (next === itemsRef.current) return
      // FLIP 的 First：重排提交前记录当前每个图标的屏幕位置
      captureFlipRects()
      itemsRef.current = next
      setItems(next)
    },
    [captureFlipRects, computeTargetIndex, horizontal]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      setPressedId(null)
      setDraggingId(null)
      releasePointerCapture(event.currentTarget, event.pointerId)
      if (drag.active) {
        // 拖拽结束后紧跟的 click 要忽略，避免拖完又启动应用
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 350)
        commitOrder(drag.originalIds)
      }
    },
    [commitOrder]
  )

  /** 单击图标启动（click 仍然落在图标上，因为 pointerdown 阶段不再捕获指针） */
  const handleItemClick = useCallback(
    (item: DockItem) => {
      if (suppressClickRef.current) return
      requestLaunch(item)
    },
    [requestLaunch]
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      setPressedId(null)
      setDraggingId(null)
      releasePointerCapture(event.currentTarget, event.pointerId)
      setItems(settings.apps)
    },
    [settings.apps]
  )

  const handlePointerEnter = useCallback((index: number) => {
    if (dragRef.current?.active) return
    setHoveredIndex(index)
  }, [])

  const handlePointerLeave = useCallback((index: number) => {
    setHoveredIndex((current) => (current === index ? null : current))
  }, [])

  /* ------------------------------- 右键菜单 ------------------------------ */

  /**
   * 打开某个应用的原生右键菜单。
   * 坐标沿用 onContextMenu 的 client 坐标（主进程 sanitizePoint 只校验有限数，
   * 菜单本身由 Menu.popup 按系统光标位置弹出）；键盘路径传图标矩形中心即可保持一致。
   */
  const openItemMenu = useCallback(
    (item: DockItem, point: Point) => {
      void window.nexus.apps
        .menu(item.id, { x: Math.round(point.x), y: Math.round(point.y) })
        .catch(() => showError('无法打开右键菜单'))
    },
    [showError]
  )

  const handleItemContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, item: DockItem) => {
      event.preventDefault()
      event.stopPropagation()
      // 刚用键盘开过菜单（keydown 已处理）：忽略浏览器随后补发的 contextmenu，避免开两次
      if (Date.now() - keyboardMenuAtRef.current < KEYBOARD_MENU_DEDUPE_MS) return
      openItemMenu(item, { x: event.clientX, y: event.clientY })
    },
    [openItemMenu]
  )

  const handleDockContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      void window.nexus.apps.dockMenu({ x: Math.round(event.clientX), y: Math.round(event.clientY) }).catch(() => {
        showError('无法打开右键菜单')
      })
    },
    [showError]
  )

  /* ------------------------------ 键盘可达性 ------------------------------ */

  /** roving tabindex 的当前项：优先用状态里的 id，图标被移除时回退到第一项 */
  const activeFocusId = useMemo(() => {
    if (focusedId && items.some((item) => item.id === focusedId)) return focusedId
    return items[0]?.id ?? null
  }, [focusedId, items])

  /** 把焦点移到第 index 个图标（0 起，自动收敛到有效范围） */
  const focusItemAt = useCallback((index: number): void => {
    const list = listRef.current
    if (!list) return
    const nodes = list.querySelectorAll<HTMLElement>('.dock-item[data-dock-id]')
    if (nodes.length === 0) return
    const node = nodes[Math.max(0, Math.min(nodes.length - 1, index))]
    const id = node?.dataset.dockId
    if (!node || !id) return
    setFocusedId(id)
    // 焦点落在滚动容器里时浏览器会自动把该项滚进可视区（尾部图标因此可用键盘到达）
    node.focus()
  }, [])

  const handleItemFocus = useCallback((id: string): void => {
    setFocusedId(id)
  }, [])

  /**
   * 工具栏方向键 / 上下文菜单键：
   * - 横排左右、竖排上下移动焦点（Home / End 跳首尾）；
   * - ContextMenu 键或 Shift+F10 打开当前图标的原生右键菜单（与鼠标右键同一路径，
   *   坐标取图标矩形中心，保持与 onContextMenu 一致的 client 坐标系）；
   * - Enter / Space 仍由 DockItemView 处理启动，这里不拦截。
   */
  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // 拖拽排序中不响应方向键：此时焦点/顺序正在被动变化
      if (dragRef.current) return
      const targetElement =
        event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.dock-item[data-dock-id]') : null
      if (!targetElement) return
      const id = targetElement.dataset.dockId
      const index = id ? itemsRef.current.findIndex((candidate) => candidate.id === id) : -1
      if (index < 0) return

      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const item = itemsRef.current[index]
        if (!item) return
        event.preventDefault()
        keyboardMenuAtRef.current = Date.now()
        const rect = targetElement.getBoundingClientRect()
        openItemMenu(item, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        return
      }

      const count = itemsRef.current.length
      const previousKey = horizontal ? 'ArrowLeft' : 'ArrowUp'
      const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown'
      let nextIndex: number | null = null
      if (event.key === previousKey) nextIndex = Math.max(0, index - 1)
      else if (event.key === nextKey) nextIndex = Math.min(count - 1, index + 1)
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = count - 1
      if (nextIndex === null) return

      event.preventDefault()
      focusItemAt(nextIndex)
    },
    [focusItemAt, horizontal, openItemMenu]
  )

  /* -------------------------------- 渲染 -------------------------------- */

  /**
   * 末端开关（音乐 / 时钟）尺寸：随图标缩放，但下限提到 24px ——
   * WCAG 2.5.8 的目标尺寸下限，避免图标调小后按钮变成难以命中的小圆点（原下限 18px）。
   */
  const toggleSize = Math.max(24, Math.round(iconSize * 0.72))

  const rootStyle: DockCssVars = {
    '--dock-icon-size': `${iconSize}px`,
    '--dock-gap': `${gap}px`,
    '--dock-padding': `${padding}px`,
    '--dock-room': `${room}px`,
    '--dock-opacity': String(Math.min(1, Math.max(0, opacity))),
    '--nx-bg': glassBackground(theme, opacity),
    // 布局上限：横边夹宽、竖边夹高（详见 dock.css「超出屏幕时的布局上限」）
    ...(dockLimits ? { '--dock-max-w': `${dockLimits.width}px`, '--dock-max-h': `${dockLimits.height}px` } : {})
  }

  return (
    <div
      ref={rootRef}
      className="dock-root"
      data-edge={edge}
      data-theme={theme}
      data-locked={dockLocked ? 'true' : undefined}
      role="toolbar"
      aria-label="Nexus Dock"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      style={rootStyle}
    >
      {toast ? (
        <div key={toast.seq} className={`dock-toast${toast.leaving ? ' is-leaving' : ''}`} role="alert">
          <span className="dock-toast-icon" aria-hidden="true">
            !
          </span>
          <span className="dock-toast-text">{toast.message}</span>
        </div>
      ) : null}

      <div
        className="dock-bar nx-glass"
        data-transparent={transparentBar ? 'true' : undefined}
        onContextMenu={handleDockContextMenu}
      >
        {/* AC-14.4：锁定态手柄改为锁形图标 + 默认光标，文案提示解锁入口 */}
        <div
          className="dock-grip"
          data-locked={dockLocked ? 'true' : undefined}
          title={dockLocked ? '位置已锁定（设置 → 系统 解锁）' : '拖动以移动 Dock'}
          aria-label={dockLocked ? '位置已锁定（设置 → 系统 解锁）' : '拖动以移动 Dock'}
        >
          {dockLocked ? (
            <svg className="dock-grip-lock" width="11" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="4.5" y="10.2" width="15" height="10.4" rx="2.6" fill="currentColor" />
              <path
                d="M8.2 10.2V7.4a3.8 3.8 0 0 1 7.6 0v2.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg className="dock-grip-dots" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
              <circle cx="5" cy="2.4" r="1.3" />
              <circle cx="5" cy="7" r="1.3" />
              <circle cx="5" cy="11.6" r="1.3" />
            </svg>
          )}
        </div>

        <div
          ref={listRef}
          className="dock-items"
          data-scrollable={scrollState.overflow ? 'true' : undefined}
          data-scroll={scrollState.start ? (scrollState.end ? 'both' : 'start') : scrollState.end ? 'end' : undefined}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onScroll={measureScroll}
          onKeyDown={handleListKeyDown}
        >
          {/* 空状态引导：apps 为空时给一个明确的下一步，而不是只剩手柄和两个开关 */}
          {items.length === 0 ? (
            <button
              ref={emptyButtonRef}
              type="button"
              className="dock-empty nx-no-drag nx-ripple-host"
              title="打开设置，添加要显示在 Dock 的应用"
              aria-label="添加应用"
              onPointerDown={(event) => {
                if (event.button === 0) spawnRipple(event.currentTarget, event)
              }}
              onClick={(event) => {
                event.stopPropagation()
                window.nexus.window.openSettings()
              }}
            >
              <span className="dock-empty-plus" aria-hidden="true">
                ＋
              </span>
              <span>添加应用</span>
            </button>
          ) : null}

          {items.map((item, index) => (
            <DockItemView
              key={item.id}
              item={item}
              index={index}
              edge={edge}
              iconSize={iconSize}
              magnification={magnification}
              hoveredIndex={hoveredIndex}
              running={running[item.id] === true}
              showIndicator={showIndicators}
              dragging={draggingId === item.id}
              pressed={pressedId === item.id}
              launchToken={launching?.id === item.id ? launching.token : 0}
              tabIndex={item.id === activeFocusId ? 0 : -1}
              onFocus={handleItemFocus}
              onPointerDown={handleItemPointerDown}
              onPointerEnter={handlePointerEnter}
              onPointerLeave={handlePointerLeave}
              onContextMenu={handleItemContextMenu}
              onLaunch={requestLaunch}
              onClick={handleItemClick}
            />
          ))}
        </div>

        {/* 音乐卡片开关：图标条末端（横排最右 / 竖排最下），不参与拖拽排序 */}
        <button
          type="button"
          className={`dock-music-toggle nx-no-drag nx-ripple-host${musicVisible ? ' is-on' : ''}`}
          title={musicVisible ? '隐藏音乐卡片' : '显示音乐卡片'}
          aria-label={musicVisible ? '隐藏音乐卡片' : '显示音乐卡片'}
          aria-pressed={musicVisible}
          style={{ ['--dock-music-size' as string]: `${toggleSize}px` }}
          onPointerDown={(event) => {
            // 保留原有冒泡拦截；涟漪裁切在圆形按钮内（nx-ripple-host）
            event.stopPropagation()
            spawnRipple(event.currentTarget, event)
          }}
          onClick={(event) => {
            event.stopPropagation()
            toggleMusic()
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </button>

        {/* AC-13.1 桌面时钟开关：位于音乐按钮旁（图标条末端），不参与拖拽排序 */}
        <button
          type="button"
          className={`dock-clock-toggle nx-no-drag nx-ripple-host${clockVisible ? ' is-on' : ''}`}
          title={clockVisible ? '隐藏桌面时钟' : '显示桌面时钟'}
          aria-label={clockVisible ? '隐藏桌面时钟' : '显示桌面时钟'}
          aria-pressed={clockVisible}
          style={{ ['--dock-clock-size' as string]: `${toggleSize}px` }}
          onPointerDown={(event) => {
            event.stopPropagation()
            spawnRipple(event.currentTarget, event)
          }}
          onClick={(event) => {
            event.stopPropagation()
            toggleClock()
          }}
        >
          {/* 时钟图标：圆盘 + 时分指针（stroke 跟随 currentColor，复用按钮态颜色） */}
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M12 7.5v4.9l3.2 1.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

/* -------------------------------- 工具函数 -------------------------------- */

/** 把 id 对应图标移动到目标下标（越界自动收敛） */
function moveItem(items: DockItem[], id: string, to: number): DockItem[] {
  const from = items.findIndex((item) => item.id === id)
  const target = Math.max(0, Math.min(items.length - 1, to))
  if (from < 0 || from === target) return items
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  if (!moved) return items
  next.splice(target, 0, moved)
  return next
}

function releasePointerCapture(element: Element | null, pointerId: number): void {
  if (!element) return
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    /* 指针已被系统释放时忽略 */
  }
}

/** 用 settings.dock.opacity 覆盖 --nx-bg 的 alpha；浅色主题换一套更亮的底色 */
function glassBackground(theme: ThemeMode, opacity: number): string {
  const base = theme === 'light' ? '246, 248, 252' : '20, 21, 26'
  const alpha = Math.min(1, Math.max(0, opacity))
  return `rgba(${base}, ${alpha})`
}

/* ---------------------------- 屏幕工作区上限 ---------------------------- */

/**
 * 把屏幕工作区折算成 Dock 允许的最大内容尺寸（px）。
 * 主进程会把 Dock 窗口夹紧到「工作区 - 两侧 SCREEN_MARGIN」；渲染层用同一上限先收缩
 * 布局，才能让图标条内部滚动而不是把尾部甩出屏幕。
 * 扣 1px 是因为 useContentSize 回报 ceil(rect)+1：上限恰好等于夹紧值时会在边界反复 resize。
 * 取不到屏幕信息（极端环境）时返回 null，CSS 回退到 100vw / 100vh。
 */
function readDockLimits(): DockLimits | null {
  const screenInfo = typeof window === 'undefined' ? undefined : window.screen
  const availableWidth = screenInfo?.availWidth ?? 0
  const availableHeight = screenInfo?.availHeight ?? 0
  if (!Number.isFinite(availableWidth) || !Number.isFinite(availableHeight)) return null
  if (availableWidth < 320 || availableHeight < 240) return null
  return {
    width: Math.max(200, Math.floor(availableWidth - 2 * SCREEN_MARGIN - DOCK_LIMIT_SLACK_PX)),
    height: Math.max(200, Math.floor(availableHeight - 2 * SCREEN_MARGIN - DOCK_LIMIT_SLACK_PX))
  }
}
