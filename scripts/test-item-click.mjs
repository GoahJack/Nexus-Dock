// 直接调用 el.click()，判断 onClick 是否接通
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
const evaluate = async (expression) => {
  const i = ++id
  const r = await new Promise((resolve) => {
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description }
  return r.result.value
}

const out = await evaluate(`(async () => {
  window.__errs = []
  window.addEventListener('error', (e) => window.__errs.push(String(e.message)))
  window.__log = []
  const orig = window.nexus.apps.launch
  if (!window.__patched3) {
    window.__patched3 = true
    window.nexus.apps.launch = (appId) => { window.__log.push(appId); return orig(appId) }
  }
  const items = [...document.querySelectorAll('.dock-item')]
  const el = items.find((x) => (x.getAttribute('title') || '').includes('计算器')) || items[2]
  el.click()
  await new Promise((r) => setTimeout(r, 1500))
  return { log: window.__log, errs: window.__errs, title: el.getAttribute('title') }
})()`)
console.log(JSON.stringify(out, null, 2))
ws.close()
