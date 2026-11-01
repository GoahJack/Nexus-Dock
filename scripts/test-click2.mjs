const port = 9224
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
const evaluate = async (expression) => {
  const i = ++id
  const r = await new Promise((resolve) => { pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
}
const out = await evaluate(`(async () => {
  const el = [...document.querySelectorAll('.dock-item')].find((x) => (x.getAttribute('title') || '').includes('计算器'))
  const rect = el.getBoundingClientRect()
  const before = { clickDbg: window.__clickDbg ?? null, html: el.outerHTML.slice(0, 120) }
  el.click()
  await new Promise((r) => setTimeout(r, 500))
  return { before, after: { clickDbg: window.__clickDbg ?? null }, rect: { x: rect.x, y: rect.y } }
})()`)
console.log(JSON.stringify(out, null, 2))
ws.close()
