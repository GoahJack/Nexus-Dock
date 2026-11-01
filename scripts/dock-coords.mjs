// 导出 Dock 图标在屏幕上的物理坐标（供系统级鼠标点击使用）
const port = 9224
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
})
const evaluate = (expression) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, (r) => resolve(r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

const info = await evaluate(`(() => {
  const dpr = window.devicePixelRatio || 1
  const items = [...document.querySelectorAll('.dock-item')].map((el) => {
    const r = el.getBoundingClientRect()
    return { title: el.getAttribute('title'), x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  return { screenX: window.screenX, screenY: window.screenY, dpr, items }
})()`)
console.log(JSON.stringify(info, null, 2))
ws.close()
