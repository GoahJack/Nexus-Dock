// 逐个启动内置应用，采集：返回结果 + Dock 错误提示 + 进程是否出现
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
    pending.set(i, (r) => resolve(r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const appId of ['notepad', 'calc', 'paint', 'explorer', 'taskmgr', 'cmd']) {
  const launched = await evaluate(`window.nexus.apps.launch(${JSON.stringify(appId)})`)
  await sleep(2600)
  const toast = await evaluate(`(document.querySelector('.dock-toast-text') || {}).textContent || null`)
  console.log(`APP=${appId} RESULT=${JSON.stringify(launched)} TOAST=${JSON.stringify(toast)}`)
}
ws.close()
