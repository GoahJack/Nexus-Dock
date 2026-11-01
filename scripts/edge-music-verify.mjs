// 音乐卡片联调验证：在 Edge 中开始播放 → 检查 Nexus 音乐卡片是否同步
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
      }, 10000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
    return r.result.value
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

try {
  const edge = await connectTo(9333, 'test-page')
  // 播放并设置为 playing 状态
  const playResult = await edge.evaluate(`(() => {
    const p = document.getElementById('player')
    const start = document.getElementById('start')
    if (start) start.click()
    const r = p.play()
    return String(r)
  })()`)
  await sleep(3000)
  const edgeState = await edge.evaluate(`(() => {
    const p = document.getElementById('player')
    return { paused: p.paused, currentTime: Math.round(p.currentTime), duration: Math.round(p.duration), meta: navigator.mediaSession?.metadata?.title ?? null }
  })()`)
  console.log('EDGE=', JSON.stringify(edgeState), 'playResult=', playResult)
  edge.close()

  await sleep(3000)
  const music = await connectTo(9224, '/music/')
  const state = await music.evaluate(`(() => ({
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 240),
    images: [...document.images].map((i) => ({ src: i.src.slice(0, 40), natural: i.naturalWidth }))
  }))()`)
  await music.shot('docs/verification/music-playing.png')
  console.log('MUSIC=', JSON.stringify(state))
  music.close()
} catch (error) {
  console.error('ERR=', error.message)
  process.exitCode = 1
}
