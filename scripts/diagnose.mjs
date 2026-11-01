// 诊断：内置应用启动返回值、开始菜单扫描、媒体时间准确性
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
      }, 25000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description }
    return r.result.value
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

const out = {}
try {
  const dock = await connectTo(9224, '/dock/')

  // 1) 应用列表
  out.apps = await dock.evaluate('window.nexus.apps.list().then((a) => a.map((x) => ({ id: x.id, name: x.name, path: x.path, icon: x.icon || "" })))')

  // 2) 逐个启动（记录返回，随后关闭）
  out.launch = {}
  for (const id of ['explorer', 'notepad', 'calc', 'paint', 'cmd', 'taskmgr']) {
    out.launch[id] = await dock.evaluate(`window.nexus.apps.launch(${JSON.stringify(id)}).then((r) => r).catch((e) => ({ ok: false, error: String(e) }))`)
    await sleep(400)
  }

  // 3) 开始菜单扫描（应用面板「从开始菜单选择」依赖它）
  out.scanStartMenu = await dock.evaluate(`window.nexus.apps.scanStartMenu().then((items) => ({ count: items.length, sample: items.slice(0, 5).map((i) => i.name) })).catch((e) => ({ error: String(e) }))`)

  // 4) 添加应用对话框行为（不真正点，只确认 API 存在）
  out.hasAddDialog = await dock.evaluate('typeof window.nexus.apps.addByDialog === "function"')

  // 5) 媒体状态 + 卡片文本 + 与 Edge 实际进度对比
  const music = await connectTo(9224, '/music/')
  const state = await music.evaluate(`window.nexus.media.getState().then((s) => s)`)
  const cardText = await music.evaluate(`document.body.innerText.replace(/\\s+/g, " ").slice(0, 200)`)
  let edgeState = null
  try {
    const edge = await connectTo(9333, 'test-page')
    edgeState = await edge.evaluate(`(() => { const p = document.getElementById('player'); return { paused: p.paused, currentTime: p.currentTime, duration: p.duration } })()`)
    edge.close()
  } catch (e) {
    edgeState = { error: String(e) }
  }
  out.media = { state, cardText, edgeState, deltaSeconds: edgeState && !edgeState.error ? Number((edgeState.currentTime - state.positionMs / 1000).toFixed(2)) : null }

  dock.close()
  music.close()
  out.ok = true
} catch (error) {
  out.error = error?.stack || String(error)
} finally {
  console.log(JSON.stringify(out, null, 2))
}
