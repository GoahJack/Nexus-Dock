// 检查 apps:running 广播是否真正到达渲染层
const targets = await (await fetch('http://127.0.0.1:9224/json')).json()
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
    pending.set(i, (r) => resolve(r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

await evaluate(`(() => {
  window.__runs = []
  const off = window.nexus.apps.onRunning((m) => window.__runs.push(m))
  return typeof off
})()`)
await new Promise((r) => setTimeout(r, 9000))
console.log('RUN_EVENTS=', JSON.stringify(await evaluate('window.__runs.slice(-2)')))
console.log('DOCK_RUNNING_ATTR=', JSON.stringify(await evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => el.getAttribute('data-running'))`)))
ws.close()
