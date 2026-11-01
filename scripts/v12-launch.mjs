const port = 9228
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
const ev = (expression) => new Promise((resolve) => { const i = ++id; pending.set(i, (r) => resolve(r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
for (const appId of ['explorer', 'cmd']) {
  const res = await ev(`window.nexus.apps.launch(${JSON.stringify(appId)})`)
  console.log(`LAUNCH ${appId} → ${JSON.stringify(res)}`)
}
ws.close()
