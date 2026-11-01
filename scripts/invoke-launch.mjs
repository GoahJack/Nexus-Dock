// 直接调用 launch IPC 并打印结果（排查启动链路）
const port = 9224
const appId = process.argv[2] || 'calc'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) throw new Error('dock 未找到')
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const res = await send('Runtime.evaluate', {
  expression: `window.nexus.apps.launch(${JSON.stringify(appId)})`,
  awaitPromise: true,
  returnByValue: true
})
console.log('RESULT=', JSON.stringify(res))
ws.close()
