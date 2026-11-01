// 检查 Dock 各层计算样式，定位残留背景
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
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage.slice(0, 60),
      shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 50),
      filter: cs.backdropFilter,
      opacity: cs.opacity
    }
  }
  const bar = document.querySelector('.dock-bar')
  return {
    html: pick(document.documentElement),
    body: pick(document.body),
    root: pick(document.getElementById('root')),
    dockRoot: pick(document.querySelector('.dock-root')),
    bar: pick(bar),
    barBefore: (() => {
      if (!bar) return null
      const ps = getComputedStyle(bar, '::before')
      return { content: ps.content, bg: ps.backgroundColor, display: ps.display, boxShadow: ps.boxShadow === 'none' ? 'none' : ps.boxShadow.slice(0, 40) }
    })(),
    transparentAttr: bar?.dataset.transparent ?? null,
    opacitySetting: null
  }
})()`)
const setting = await evaluate('window.nexus.settings.get().then((s) => s.dock.opacity)')
info.opacitySetting = setting
console.log(JSON.stringify(info, null, 2))
ws.close()
