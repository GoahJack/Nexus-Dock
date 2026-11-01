// 交互级自动化验收：用 CDP Input 事件驱动真实鼠标行为
// 用法：node scripts/cdp-interact.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const port = 9224
const outDir = resolve('docs/verification')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const listTargets = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json()

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res)
      this.ws.addEventListener('error', rej)
    })
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: r, reject: j } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) j(new Error(JSON.stringify(msg.error)))
        else r(msg.result)
      }
    })
    return this
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`timeout ${method}`))
        }
      }, 15000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result.value
  }
  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
    return join(outDir, name)
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function openTarget(match) {
  const targets = await listTargets()
  const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
  if (!t) throw new Error(`未找到 ${match}`)
  return new Cdp(t.webSocketDebuggerUrl).connect()
}

const report = { steps: [] }
const step = (name, data) => {
  report.steps.push({ name, ...data })
  console.log(`[step] ${name}: ${JSON.stringify(data).slice(0, 300)}`)
}

try {
  const dock = await openTarget('/dock/')
  await dock.send('Page.enable')

  // ---------- 1) 悬停放大 ----------
  const items = await dock.evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
  })`)
  const targetIndex = Math.min(2, items.length - 1)
  const p = items[targetIndex]
  await dock.mouse('mouseMoved', p.x, p.y)
  await sleep(420)
  const hover = await dock.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const read = (el) => {
      const inner = el.firstElementChild
      const t = inner ? getComputedStyle(inner).transform : 'none'
      const m = /matrix\\(([^)]+)\\)/.exec(t)
      const scale = m ? Number(m[1].split(',')[0]) : 1
      return { scale: Number(scale.toFixed(3)), transform: t }
    }
    return {
      scales: items.map(read),
      dockWindowSize: { w: document.body.scrollWidth, h: document.body.scrollHeight }
    }
  })()`)
  const hoverShot = await dock.shot('dock-hover.png')
  step('hover-magnification', { hoveredIndex: targetIndex, scales: hover.scales.map((s) => s.scale), shot: hoverShot })

  // 移开鼠标复位
  await dock.mouse('mouseMoved', 2, 2)
  await sleep(350)
  const reset = await dock.evaluate(`(() => {
    const inner = document.querySelectorAll('.dock-item')[${targetIndex}]?.firstElementChild
    return inner ? getComputedStyle(inner).transform : null
  })()`)
  step('hover-reset', { transform: reset })

  // ---------- 2) 点击启动应用（记事本） ----------
  const before = await dock.evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => el.getAttribute('data-id') || el.textContent)`)
  const order = await dock.evaluate(`window.nexus.apps.list().then((apps) => apps.map((a) => a.id))`)
  const notepadIndex = order.indexOf('notepad')
  if (notepadIndex >= 0 && items[notepadIndex]) {
    const np = items[notepadIndex]
    await dock.mouse('mouseMoved', np.x, np.y)
    await dock.mouse('mousePressed', np.x, np.y, { buttons: 1 })
    await dock.mouse('mouseReleased', np.x, np.y, { buttons: 0 })
    await sleep(2500)
  }
  const running = await dock.evaluate(`window.nexus.apps.list().then(() => new Promise((r) => setTimeout(() => r(true), 3600)))`)
  const indicators = await dock.evaluate(`[...document.querySelectorAll('.dock-indicator')].map((el) => el.className)`)
  const notepadShot = await dock.shot('dock-running.png')
  step('launch-notepad', { running, indicators, shot: notepadShot, dockItems: before?.length })

  // ---------- 3) 拖拽排序 ----------
  const beforeOrder = await dock.evaluate(`window.nexus.settings.get().then((s) => s.apps.map((a) => a.id))`)
  const rects = await dock.evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })`)
  if (rects.length >= 3) {
    const from = rects[0]
    const to = rects[2]
    await dock.mouse('mouseMoved', from.x, from.y)
    await dock.mouse('mousePressed', from.x, from.y, { buttons: 1 })
    for (let i = 1; i <= 6; i += 1) {
      await dock.mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 6, from.y, { buttons: 1 })
      await sleep(45)
    }
    await dock.mouse('mouseReleased', to.x, to.y, { buttons: 0 })
    await sleep(900)
  }
  const afterOrder = await dock.evaluate(`window.nexus.settings.get().then((s) => s.apps.map((a) => a.id))`)
  step('drag-reorder', { beforeOrder, afterOrder, changed: JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder) })
  // 还原顺序
  await dock.evaluate(`window.nexus.apps.reorder(${JSON.stringify(beforeOrder)})`)

  // ---------- 4) 运行指示点状态 ----------
  const runningState = await dock.evaluate(`new Promise((resolve) => {
    const off = window.nexus.apps.onRunning((m) => { off(); resolve(m) })
    setTimeout(() => { off(); resolve({}) }, 6000)
  })`)
  step('running-map', { runningState })

  // ---------- 5) 音乐卡片（真实系统媒体） ----------
  const music = await openTarget('/music/')
  await music.send('Page.enable')
  await sleep(1500)
  const musicState = await music.evaluate(`(() => ({
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    source: window.nexus.settings.get().then((s) => s.music.source)
  }))()`)
  const musicShot = await music.shot('music-state.png')
  step('music-card', { ...musicState, shot: musicShot })

  // ---------- 6) 设置面板各页 ----------
  await dock.evaluate(`window.nexus.window.openSettings()`)
  await sleep(2000)
  const settings = await openTarget('/settings/')
  await settings.send('Page.enable')
  const clickNav = async (label) => {
    await settings.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')]
      const target = buttons.find((b) => b.textContent && b.textContent.trim() === ${JSON.stringify(label)})
      if (target) target.click()
      return !!target
    })()`)
    await sleep(700)
  }
  const shots = {}
  for (const [label, file] of [
    ['Dock', 'settings-dock.png'],
    ['音乐', 'settings-music.png'],
    ['应用', 'settings-apps.png'],
    ['关于', 'settings-about.png']
  ]) {
    await clickNav(label)
    shots[label] = await settings.shot(file)
  }
  const settingsText = await settings.evaluate(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)`)
  step('settings-pages', { shots, text: settingsText })

  report.ok = true
} catch (error) {
  report.error = error?.stack || String(error)
  console.error('[error]', report.error)
} finally {
  writeFileSync(join(outDir, 'interact-report.json'), JSON.stringify(report, null, 2), 'utf8')
}
