// 连打包版（9225）测试启动
const port = 9225
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
const ev = (expression) => new Promise((resolve) => { const i = ++id; pending.set(i, (r) => resolve(r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
const apps = await ev('window.nexus.apps.list()')
for (const app of apps) {
  if (!['explorer', 'settings', 'calc', 'notepad'].includes(app.id) && !/edge|weixin|微信/i.test(app.name)) continue
  const res = await ev(`window.nexus.apps.launch(${JSON.stringify(app.id)})`)
  console.log(`LAUNCH ${app.name} → ${JSON.stringify(res)}`)
  await new Promise((r) => setTimeout(r, 800))
}
ws.close()
