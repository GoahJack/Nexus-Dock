// 从 Dock 移除指定 id 的应用
const port = 9224
const appId = process.argv[2]
if (!appId) {
  console.error('usage: node scripts/remove-app.mjs <appId>')
  process.exit(1)
}
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
const r = await new Promise((resolve) => {
  const i = ++id
  pending.set(i, resolve)
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `window.nexus.apps.remove(${JSON.stringify(appId)})`, awaitPromise: true, returnByValue: true } }))
})
console.log('APPS_AFTER_REMOVE=', JSON.stringify(r.result.value?.length ?? r.result.value))
ws.close()
