// ============================================================================
// Nexus Dock v1.5 溢出压力测试（可选验收，会临时改写设置并在结束时还原）
//
// 背景：v1.5 修了「图标多/尺寸大时 Dock 伸出屏幕、尾部图标与末端开关不可达」。
// 默认 11 个图标不会溢出，因此本脚本临时把图标复制到 25 个 + iconSize 80 + gap 32，
// 断言：
//   1) Dock 窗口宽度被主进程夹紧到工作区（不会超出屏幕）；
//   2) 渲染层挂上 data-scrollable，图标区可滚动，尾部图标可达；
//   3) 末端音乐/时钟开关仍然完整可见（不在屏幕外）；
//   4) 恢复设置后图标数量回到原值。
//
// 用法：node scripts/v15-overflow-check.mjs   （需安装版 + --remote-debugging-port=9333）
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9333)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.5')
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function dockClient() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const targets = await res.json()
  const target = targets.find((t) => t.type === 'page' && t.url.includes('/dock/'))
  if (!target) throw new Error('未找到 Dock 页面')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 超时')), 8000)
    ws.onopen = () => {
      clearTimeout(timer)
      resolve()
    }
    ws.onerror = () => reject(new Error('WebSocket 失败'))
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  }
  const screenshot = async (path) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
  }
  return { evaluate, screenshot, close: () => ws.close() }
}

const checks = []
const record = (id, title, ok, detail) => {
  checks.push({ id, title, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} :: ${JSON.stringify(detail)}`)
}

const client = await dockClient()
let original = null
try {
  original = await client.evaluate('window.nexus.settings.get()')
  const stressApps = []
  for (let i = 0; i < 25; i += 1) {
    const base = original.apps[i % original.apps.length]
    stressApps.push({ ...base, id: `${base.id}-stress-${i}`, name: `${base.name}-${i}` })
  }
  await client.evaluate(
    `window.nexus.settings.update(${JSON.stringify({ apps: stressApps, dock: { iconSize: 80, gap: 32, padding: 14 } })})`
  )
  await sleep(2200) // 等窗口尺寸回报 + 主进程夹紧 + 渲染层重新布局

  const state = await client.evaluate(`(() => {
    const root = document.querySelector('.dock-root')
    const itemsEl = document.querySelector('.dock-items')
    const items = [...document.querySelectorAll('.dock-item')]
    const toggles = [...document.querySelectorAll('.dock-music-toggle, .dock-clock-toggle')]
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } }
    const last = items[items.length - 1]
    return {
      itemCount: items.length,
      windowW: window.innerWidth,
      windowH: window.innerHeight,
      screenAvailW: window.screen.availWidth,
      screenAvailH: window.screen.availHeight,
      rootW: Math.round(root.getBoundingClientRect().width),
      maxW: getComputedStyle(root).getPropertyValue('--dock-max-w').trim(),
      // data-scrollable / data-scroll 由渲染层挂在滚动容器（.dock-items）或底条上，二者都接受
      scrollableRoot: root.getAttribute('data-scrollable'),
      scrollableItems: itemsEl.getAttribute('data-scrollable') ?? itemsEl.getAttribute('data-scroll'),
      scrollableBar: document.querySelector('.dock-bar')?.getAttribute('data-scrollable') ?? null,
      listScrollW: itemsEl.scrollWidth,
      listClientW: itemsEl.clientWidth,
      lastItem: last ? rect(last) : null,
      toggles: toggles.map(rect)
    }
  })()`)

  const toggleInView = state.toggles.every((t) => t.right <= state.windowW + 1 && t.left >= -1 && t.w > 0)
  const clamped = state.windowW <= state.screenAvailW - 2 * 12 + 2
  record('AC-25.10', 'Dock 窗口宽度被夹紧到工作区（不伸出屏幕）', clamped, {
    windowW: state.windowW,
    screenAvailW: state.screenAvailW
  })
  const scrollAttr = state.scrollableItems ?? state.scrollableRoot ?? state.scrollableBar
  record(
    'AC-25.11',
    '溢出时挂载 data-scrollable 且图标区可滚动',
    (state.scrollableRoot === 'true' || state.scrollableItems === 'true' || state.scrollableItems !== null) &&
      state.listScrollW > state.listClientW,
    {
      scrollableRoot: state.scrollableRoot,
      scrollableItems: state.scrollableItems,
      scrollableBar: state.scrollableBar,
      scrollAttr,
      listScrollW: state.listScrollW,
      listClientW: state.listClientW
    }
  )
  record('AC-25.12', '末端音乐/时钟开关仍在可视区内', toggleInView, state.toggles)

  // 滚到末尾，确认最后一项可达
  const scrolled = await client.evaluate(`(() => {
    const el = document.querySelector('.dock-items')
    el.scrollLeft = el.scrollWidth
    return { scrollLeft: el.scrollLeft, maxScroll: el.scrollWidth - el.clientWidth }
  })()`)
  await sleep(300)
  const lastReachable = await client.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const last = items[items.length - 1]
    const el = document.querySelector('.dock-items')
    const lr = last.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    return { inView: lr.left >= er.left - 2 && lr.right <= er.right + 2, scrollLeft: el.scrollLeft, maxScroll: el.scrollWidth - el.clientWidth }
  })()`)
  record('AC-25.13', '滚动到末尾后最后一个图标可达', lastReachable.inView && lastReachable.maxScroll > 0, { ...scrolled, ...lastReachable })

  await client.screenshot(join(OUT_DIR, 'dock-overflow-25-items.png'))
} finally {
  if (original) {
    await client.evaluate(
      `window.nexus.settings.update(${JSON.stringify({ apps: original.apps, dock: { iconSize: original.dock.iconSize, gap: original.dock.gap, padding: original.dock.padding } })})`
    )
    await sleep(1500)
    const restored = await client.evaluate(`(async () => { const s = await window.nexus.settings.get(); return { apps: s.apps.length, iconSize: s.dock.iconSize, gap: s.dock.gap } })()`)
    record('AC-25.14', '压力测试后设置已还原', restored.apps === original.apps.length && restored.iconSize === original.dock.iconSize, restored)
    await client.screenshot(join(OUT_DIR, 'dock-restored.png'))
  }
  client.close()
}

const passed = checks.filter((c) => c.ok).length
writeFileSync(
  join(OUT_DIR, 'overflow-report.json'),
  JSON.stringify({ version: '1.5.0', at: new Date().toISOString(), passed, total: checks.length, checks }, null, 2),
  'utf8'
)
console.log(`\n${passed}/${checks.length} 通过；报告：docs/verification/v1.5/overflow-report.json`)
process.exit(passed === checks.length ? 0 : 1)
