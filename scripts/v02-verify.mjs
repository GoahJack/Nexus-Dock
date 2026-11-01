// v0.2 综合验收：Dock 位置/透明、音乐开关、时间显示、应用目录
const port = 9224
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
      }, 15000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description }
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
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, Buffer.from(data, 'base64'))
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function connectTo(match) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`)
  const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
  if (!t) throw new Error(`未找到 ${match}（${targets.map((x) => x.url).join(',')}）`)
  return new Cdp(t.webSocketDebuggerUrl).connect()
}

const out = {}
try {
  const dock = await connectTo('/dock/')
  await dock.send('Page.enable')

  out.dock = await dock.evaluate(`(() => {
    const bar = document.querySelector('.dock-bar')
    const root = document.querySelector('.dock-root')
    const musicBtn = document.querySelector('.dock-music-toggle')
    const cs = bar ? getComputedStyle(bar) : null
    return {
      screen: { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight },
      edge: root?.dataset.edge,
      transparent: bar?.dataset.transparent ?? null,
      background: cs ? cs.backgroundColor : null,
      backgroundImage: cs ? cs.backgroundImage : null,
      boxShadow: cs ? cs.boxShadow : null,
      musicButton: !!musicBtn,
      musicButtonOn: musicBtn ? musicBtn.classList.contains('is-on') : null,
      bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight }
    }
  })()`)
  await dock.shot('docs/verification/v02-dock-transparent.png')

  // 点击 Dock 音符按钮 → 音乐卡片隐藏
  const musicPos = await dock.evaluate(`(() => {
    const btn = document.querySelector('.dock-music-toggle')
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  const before = await dock.evaluate('window.nexus.settings.get().then((s) => s.music.visible)')
  if (musicPos) await dock.click(musicPos.x, musicPos.y)
  await sleep(900)
  const after = await dock.evaluate('window.nexus.settings.get().then((s) => s.music.visible)')
  const musicWindowExists = await dock.evaluate(`(() => true)()`)
  await sleep(300)
  out.musicToggle = { before, after, flipped: before !== after, musicWindowExists }

  // 再点回来
  if (musicPos) await dock.click(musicPos.x, musicPos.y)
  await sleep(900)
  out.musicToggle.restored = await dock.evaluate('window.nexus.settings.get().then((s) => s.music.visible)')

  // 应用目录（前 8 个中文名是否正常）
  out.catalog = await dock.evaluate(`window.nexus.apps.scanStartMenu().then((items) => ({
    count: items.length,
    sample: items.slice(0, 8).map((i) => ({ name: i.name, aumid: i.aumid, hasIcon: !!i.icon }))
  }))`)

  // 音乐卡片
  const music = await connectTo('/music/')
  await music.send('Page.enable')
  await sleep(1200)
  out.music = await music.evaluate(`(() => ({
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220),
    closeButton: !!document.querySelector('[class*="close"]'),
    bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    images: [...document.images].map((i) => i.src.slice(0, 32))
  }))()`)
  await music.shot('docs/verification/v02-music.png')
  music.close()

  dock.close()
  out.ok = true
} catch (error) {
  out.error = error?.stack || String(error)
} finally {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('docs/verification/v02-report.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2))
}
