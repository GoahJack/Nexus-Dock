// 检查 Dock 当前透明状态
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
const info = await evaluate(`(async () => {
  const s = await window.nexus.settings.get()
  const bar = document.querySelector('.dock-bar')
  const cs = bar ? getComputedStyle(bar) : null
  return {
    opacitySetting: s.dock.opacity,
    snapToEdge: s.dock.snapToEdge,
    transparentAttr: bar?.dataset.transparent ?? null,
    background: cs?.backgroundColor,
    backgroundImage: cs?.backgroundImage?.slice(0, 80),
    boxShadow: cs?.boxShadow?.slice(0, 60),
    backdropFilter: cs?.backdropFilter,
    classes: bar?.className,
    screen: { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }
  }
})()`)
console.log(JSON.stringify(info, null, 2))
ws.close()
