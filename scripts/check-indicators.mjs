// 读取 Dock 运行指示点状态
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
    pending.set(i, (r) => resolve(r.result.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

const indicators = await evaluate(`[...document.querySelectorAll('.dock-item')].map((el) => ({
  name: el.getAttribute('title') || el.textContent,
  dot: el.querySelector('.dock-indicator')?.className || null
}))`)
const running = await evaluate(`window.nexus.apps.list().then(() => true)`)
console.log('INDICATORS=', JSON.stringify(indicators))
console.log('READY=', running)
ws.close()
