// 检查图标 DOM 上的 React props（是否有 onClick），并验证 click 是否派发
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
}

console.log(
  JSON.stringify(
    await evaluate(`(() => {
  const el = [...document.querySelectorAll('.dock-item')].find((x) => (x.getAttribute('title') || '').includes('计算器'))
  const keys = Object.keys(el)
  const propKeys = keys.filter((k) => k.startsWith('__reactProps'))
  const props = propKeys.map((k) => Object.keys(el[k] || {}))
  const fired = []
  document.addEventListener('click', (e) => fired.push({ phase: 'capture', target: (e.target.className || '').toString() }), true)
  document.addEventListener('click', (e) => fired.push({ phase: 'bubble', target: (e.target.className || '').toString() }))
  el.click()
  return { propKeys, props, fired, reactKeys: keys.filter((k) => k.startsWith('__react')).slice(0, 6) }
})()`),
    null,
    2
  )
)

// 再等 800ms 看是否设置 clickDbg
await new Promise((r) => setTimeout(r, 800))
console.log('CLICK_DBG=', JSON.stringify(await evaluate('window.__clickDbg ?? null')))
ws.close()
