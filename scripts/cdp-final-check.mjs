// 最终联动验收：音乐卡片控制真实播放器、Dock 点击启动、窗口位置跟随
import { writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = async (url) => JSON.parse(await (await fetch(url)).text())

class Cdp {
  constructor(wsUrl) {
    this.id = 0
    this.pending = new Map()
    this.wsUrl = wsUrl
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res)
      this.ws.addEventListener('error', rej)
    })
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) reject(new Error(JSON.stringify(m.error)))
        else resolve(m.result)
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
      }, 12000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result.value
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(60)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(file, Buffer.from(data, 'base64'))
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function connectTo(port, match) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`)
  const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
  if (!t) throw new Error(`port ${port} 未找到 ${match}`)
  return new Cdp(t.webSocketDebuggerUrl).connect()
}

const report = {}
try {
  /* ---------- 1) 音乐卡片控制真实播放器 ---------- */
  const edge = await connectTo(9333, 'test-page')
  await edge.evaluate(`(() => { const p = document.getElementById('player'); p.play(); return true })()`)
  await sleep(2600)

  const music = await connectTo(9224, '/music/')
  const cardBefore = await music.evaluate(`(() => {
    const main = document.querySelector('.music-ctrl.is-main')
    const r = main.getBoundingClientRect()
    return {
      buttonTitle: main.getAttribute('title'),
      pos: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160),
      windowPos: { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }
    }
  })()`)
  report.cardPlaying = cardBefore

  // 点击「暂停」→ 检查 Edge 是否真的暂停
  await music.click(cardBefore.pos.x, cardBefore.pos.y)
  await sleep(1800)
  const edgeAfterPause = await edge.evaluate(`document.getElementById('player').paused`)
  const cardAfterPause = await music.evaluate(`document.querySelector('.music-ctrl.is-main').getAttribute('title')`)

  // 再点一次「播放」
  await music.click(cardBefore.pos.x, cardBefore.pos.y)
  await sleep(1800)
  const edgeAfterPlay = await edge.evaluate(`document.getElementById('player').paused`)
  const cardAfterPlay = await music.evaluate(`document.querySelector('.music-ctrl.is-main').getAttribute('title')`)
  await music.shot('docs/verification/music-playing.png')
  report.mediaControl = { edgeAfterPause, cardAfterPause, edgeAfterPlay, cardAfterPlay }
  edge.close()

  /* ---------- 2) Dock 点击启动应用 + 运行指示点 ---------- */
  const dock = await connectTo(9224, '/dock/')
  const apps = await dock.evaluate('window.nexus.apps.list().then((a) => a.map((x) => ({ id: x.id, name: x.name })))')
  const idx = apps.findIndex((a) => a.id === 'notepad')
  const pos = await dock.evaluate(`(() => {
    const el = document.querySelectorAll('.dock-item')[${idx}]
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await dock.click(pos.x, pos.y)
  await sleep(5200)
  const running = await dock.evaluate(`new Promise((resolve) => {
    const timer = setTimeout(() => { off(); resolve(null) }, 8000)
    const off = window.nexus.apps.onRunning((m) => { clearTimeout(timer); off(); resolve(m) })
  })`)
  const indicators = await dock.evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => {
    const dot = el.querySelector('.dock-indicator')
    return { name: el.getAttribute('data-name') || null, cls: dot ? dot.className : null }
  })`)
  await dock.shot('docs/verification/dock-running.png')
  report.launchAndIndicator = { apps: apps.length, running, indicators }

  /* ---------- 3) 音乐卡片跟随停靠边 ---------- */
  const before = await dock.evaluate('Promise.all([window.nexus.settings.get().then((s) => s.dock.edge), new Promise((r) => setTimeout(() => r({ x: window.screenX, y: window.screenY }), 400))])')
  await dock.evaluate(`window.nexus.settings.update({ dock: { edge: 'left', alongPercent: 40 } })`)
  await sleep(1600)
  const musicLeft = await music.evaluate(`({ x: window.screenX, y: window.screenY })`)
  await dock.evaluate(`window.nexus.settings.update({ dock: { edge: 'bottom', alongPercent: 50 } })`)
  await sleep(1600)
  const musicBottom = await music.evaluate(`({ x: window.screenX, y: window.screenY })`)
  report.musicFollow = { dockEdgeBefore: before[0], musicLeft, musicBottom }

  /* ---------- 4) 设置持久化确认 ---------- */
  const settings = await dock.evaluate('window.nexus.settings.get()')
  report.settingsSnapshot = { dock: settings.dock, music: settings.music, appCount: settings.apps.length }

  dock.close()
  music.close()
  report.ok = true
} catch (error) {
  report.error = error?.stack || String(error)
  console.error('ERR=', report.error)
} finally {
  writeFileSync('docs/verification/final-report.json', JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}
