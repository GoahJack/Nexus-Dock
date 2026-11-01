import '@renderer/shared/theme.css'
import '@renderer/shared/ui.css'
import './clock.css'
import type { Settings } from '@shared/types'
import { applyAppearanceToDocument } from '../shared/appearance'

/**
 * Nexus Dock — 桌面时钟窗口渲染层（v1.1 US-13 / AC-13.1~13.7）
 *
 * 轻量化改造（2026-11）：时钟只显示时间/日期，原实现却完整加载 react-dom（共享 jsx-runtime chunk）。
 * 这里用原生 TS DOM 重写，**不再引入任何 React 依赖**，但逐条保留既有契约：
 * - 根节点 class `.clock-root nx-glass`，`role="timer"`、`aria-live="off"`；
 * - `data-theme="dark|light"`，`data-locked="true"`（仅锁定时存在）；
 * - 锁定提示 title/aria-label 含「位置已锁定」与解锁路径；
 * - 关键文本 class `.clock-time` / `.clock-date` / `.clock-period`；
 * - 内容尺寸回报（C7）：透明窗口必须与内容等大，否则出现隐形点击区；
 * - 入场淡入只播一次（`.is-entering` + animationend 移除），动效只用 motion.css 的 --nx-* 令牌；
 * - 隐藏时不走时，重新可见立即补一次；主进程设置变更即时响应。
 */

const LOCK_HINT = '位置已锁定：设置 → 系统 解锁'
const DRAG_HINT = '拖动以移动时钟'

/** 日期格式器固定：zh-CN 输出「10月30日」与「周五」，中间补空格 ⇒「10月30日 周五」 */
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' })

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 时钟 DOM 引用：只创建一次，设置变更时原地更新（避免重放入场动画/丢失测量） */
interface ClockDom {
  root: HTMLDivElement
  main: HTMLDivElement
  /** 12 小时制时的「上午/下午」；24 小时制时从 DOM 上移除（与改造前的条件渲染一致） */
  period: HTMLSpanElement
  time: HTMLSpanElement
  /** 显示日期时才存在；隐藏时移除（与改造前一致） */
  date: HTMLSpanElement | null
  /** 锁定态图标：绝对定位不参与布局，不改变窗口尺寸 */
  lock: SVGSVGElement
}

/** 挂载点必须存在；缺失说明 index.html 与入口不匹配 */
function requireMountPoint(): HTMLElement {
  const element = document.getElementById('root')
  if (!element) throw new Error('[clock] 未找到 #root 挂载点')
  return element
}

// 启动即校验，避免设置到达后才发现挂载点缺失
requireMountPoint()

let settings: Settings | null = null
let dom: ClockDom | null = null
let formatter: Intl.DateTimeFormat | null = null
let formatterKey = ''
/** 上一次提交的「显示粒度桶」：只有整秒/整分变化才更新文本 */
let lastBucket = -1
let tickTimer: number | null = null
let resizeObserver: ResizeObserver | null = null
/** 上一次回报给主进程的内容尺寸，避免重复 IPC */
let lastSentSize = ''

/* ------------------------------ 时间文本 ------------------------------ */

/** 从 Intl 分片里拆出「纯时间文本」与「上午/下午」：分片渲染让时间用大字紧排、上下午用小字对齐基线 */
function splitTimeText(target: Intl.DateTimeFormat, date: Date): { time: string; period: string } {
  let time = ''
  let period = ''
  for (const part of target.formatToParts(date)) {
    if (part.type === 'dayPeriod') period = part.value
    else time += part.value
  }
  return { time, period }
}

/** 日期文本：AC-13.2 要求 zh-CN，如「10月30日 周五」 */
function formatDateText(date: Date): string {
  return `${MONTH_DAY_FORMAT.format(date)} ${WEEKDAY_FORMAT.format(date)}`
}

/** 时间格式器随「显示秒 / 12 小时制」重建；按自身键缓存，避免每秒重建 */
function getTimeFormatter(showSeconds: boolean, hour12: boolean): Intl.DateTimeFormat {
  const key = `${showSeconds ? 's' : 'm'}|${hour12 ? '12' : '24'}`
  if (formatter && formatterKey === key) return formatter
  formatter = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' as const } : {}),
    hour12
  })
  formatterKey = key
  return formatter
}

/* -------------------------------- DOM -------------------------------- */

function createLockIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'clock-lock')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const body = document.createElementNS(SVG_NS, 'rect')
  body.setAttribute('x', '3.2')
  body.setAttribute('y', '6.9')
  body.setAttribute('width', '9.6')
  body.setAttribute('height', '6.4')
  body.setAttribute('rx', '1.8')

  const shackle = document.createElementNS(SVG_NS, 'path')
  shackle.setAttribute('d', 'M5.4 6.9V5a2.6 2.6 0 0 1 5.2 0v1.9')

  svg.append(body, shackle)
  return svg
}

/** 入场淡入只播一次：动画结束移除类，回到由 --clock-opacity 决定的基础透明度 */
function bindEnterAnimation(root: HTMLDivElement): void {
  const onAnimationEnd = (event: AnimationEvent): void => {
    // 只认根节点自己的入场动画（子元素动画事件会冒泡到这里）
    if (event.target !== root) return
    root.classList.remove('is-entering')
    root.removeEventListener('animationend', onAnimationEnd)
  }
  root.addEventListener('animationend', onAnimationEnd)
}

function ensureDom(): ClockDom {
  if (dom) return dom

  const root = document.createElement('div')
  root.className = 'clock-root nx-glass is-entering'
  root.setAttribute('role', 'timer')
  root.setAttribute('aria-live', 'off')

  const main = document.createElement('div')
  main.className = 'clock-main'

  const period = document.createElement('span')
  period.className = 'clock-period'

  const time = document.createElement('span')
  time.className = 'clock-time'
  main.append(time)

  const lock = createLockIcon()
  root.append(main, lock)
  requireMountPoint().replaceChildren(root)

  dom = { root, main, period, time, date: null, lock }

  // 透明窗口内容尺寸回报：字号/日期/秒/制式变化都会触发布局 → ResizeObserver 重新量测
  // （同样经样式就绪检查，避免 CSS 未生效时把错误尺寸回报给主进程）
  resizeObserver = new ResizeObserver(() => requestContentSizeReport())
  resizeObserver.observe(root)
  window.addEventListener('resize', requestContentSizeReport)
  bindEnterAnimation(root)

  return dom
}

/** 12 小时制出现「上午/下午」：按需插到时间前；24 小时制移除节点（保持改造前的条件渲染） */
function setPeriod(text: string): void {
  if (!dom) return
  if (text.length > 0) {
    if (dom.period.parentNode !== dom.main) dom.main.insertBefore(dom.period, dom.time)
    if (dom.period.textContent !== text) dom.period.textContent = text
    return
  }
  if (dom.period.parentNode === dom.main) dom.period.remove()
}

function setDate(show: boolean, text: string): void {
  if (!dom) return
  if (!show) {
    if (dom.date) {
      dom.date.remove()
      dom.date = null
    }
    return
  }
  if (!dom.date) {
    const date = document.createElement('span')
    date.className = 'clock-date'
    dom.root.insertBefore(date, dom.lock)
    dom.date = date
  }
  if (dom.date.textContent !== text) dom.date.textContent = text
}

/* ------------------------------ 文本渲染 ------------------------------ */

/**
 * 时钟走时源：只在「显示内容真正变化」时写 DOM。
 * - showSeconds：250ms 轮询（对齐整秒粒度），仅整秒变化才更新；
 * - 不显示秒：1s 轮询，仅跨分钟变化才更新。
 * 窗口隐藏时不计算、不写 DOM；重新可见时用 force 立即补一次。
 */
function renderNow(force: boolean): void {
  if (!settings || !dom) return
  const clock = settings.clock
  const now = new Date()
  // 提交粒度：显示秒按秒，否则按分钟
  const unitMs = clock.showSeconds ? 1000 : 60_000
  const bucket = Math.floor(now.getTime() / unitMs)
  if (!force && bucket === lastBucket) return
  lastBucket = bucket

  const { time, period } = splitTimeText(getTimeFormatter(clock.showSeconds, clock.hour12), now)
  if (dom.time.textContent !== time) dom.time.textContent = time
  setPeriod(period)
  if (clock.showDate) setDate(true, formatDateText(now))
  else setDate(false, '')
}

function tick(): void {
  // 窗口隐藏时不走时；主进程已恢复 backgroundThrottling（默认节流），这里再省一次计算
  if (document.visibilityState === 'hidden') return
  renderNow(false)
}

/** 轮询间隔随「显示秒」切换：显示秒 → 250ms；否则 1000ms（仅跨分钟才写 DOM） */
function scheduleTick(): void {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
  const showSeconds = settings?.clock.showSeconds ?? false
  tickTimer = window.setInterval(tick, showSeconds ? 250 : 1000)
}

/** 内容尺寸回报主进程（C7）：留 1px 余量吸收亚像素误差，未变化则不重复发送 */
function measureContentSize(): void {
  if (!dom) return
  const rect = dom.root.getBoundingClientRect()
  const width = Math.ceil(rect.width) + 1
  const height = Math.ceil(rect.height) + 1
  const key = `${width}x${height}`
  if (key === lastSentSize || width < 2 || height < 2) return
  lastSentSize = key
  window.nexus.window.setContentSize('clock', { width, height })
}

/** 样式表是否已生效：theme.css 的 :root 令牌取不到值时说明 CSSOM 还没就绪 */
function stylesReady(): boolean {
  if (document.readyState === 'complete') return true
  return getComputedStyle(document.documentElement).getPropertyValue('--nx-radius-lg').trim().length > 0
}

/**
 * 首次量测前先确认样式已生效：透明窗口内容尺寸=窗口尺寸（C7），
 * 若在 CSS 生效前量到错误尺寸，主进程会先按错误大小显示窗口（出现隐形点击区/尺寸跳变）。
 * 样式未就绪时交给启动时监听的 load 事件补测。
 */
function requestContentSizeReport(): void {
  if (!stylesReady()) return
  measureContentSize()
}

/* ------------------------------ 设置应用 ------------------------------ */

function applySettings(next: Settings): void {
  settings = next
  // 动效令牌 / 减少动效降级：三窗口共用同一套 <html data-*>
  applyAppearanceToDocument(next)

  const clock = next.clock
  const locked = next.lock.clock === true
  const current = ensureDom()

  current.root.dataset.theme = clock.theme
  // 位置锁定（US-14）：锁定才存在 data-locked，未锁定不输出 "false"
  if (locked) current.root.setAttribute('data-locked', 'true')
  else current.root.removeAttribute('data-locked')
  current.root.setAttribute('aria-label', locked ? `桌面时钟（${LOCK_HINT}）` : '桌面时钟')
  current.root.setAttribute('title', locked ? LOCK_HINT : DRAG_HINT)

  // 外观：字号/透明度走内联 CSS 变量（与改造前一致），锁定时 CSS 改用 no-drag
  current.root.style.setProperty('--clock-font-size', `${clock.fontSize}px`)
  current.root.style.setProperty('--clock-opacity', String(Math.min(1, Math.max(0.2, clock.opacity))))

  // 立即对齐当前时间（切 12/24 小时制、显示秒、显示日期后无需等下一次 tick）
  renderNow(true)
  scheduleTick()
  // 字号/日期/秒/制式变化后重新量测并回报（同尺寸时 measureContentSize 自身去重）
  requestContentSizeReport()
}

/* ------------------------------ 启动与清理 ------------------------------ */

let receivedBroadcast = false

const offSettings = window.nexus.settings.onChanged((next) => {
  receivedBroadcast = true
  applySettings(next)
})

void window.nexus.settings
  .get()
  .then((initial) => {
    // 广播若已先到，以广播的最新值为准，避免旧快照覆盖
    if (!receivedBroadcast) applySettings(initial)
  })
  .catch((error: unknown) => {
    console.error('[clock] 读取设置失败：', error)
  })

const onVisibilityChange = (): void => {
  // 窗口重新可见：立即补一次，不让时钟停在隐藏前的旧时间
  if (document.visibilityState === 'visible') renderNow(true)
}
document.addEventListener('visibilitychange', onVisibilityChange)

// 样式表/资源全部就绪后补测一次：覆盖「首帧样式未生效」的极端时序（正常路径已量测过，会去重）
const onLoad = (): void => requestContentSizeReport()
window.addEventListener('load', onLoad)

window.addEventListener('beforeunload', () => {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', requestContentSizeReport)
  window.removeEventListener('load', onLoad)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  offSettings()
})
