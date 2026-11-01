// 验证「AppID 是 exe 路径」的桌面应用能正常启动（修复前会被包成 shell:AppsFolder\D:\...\app.exe）
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
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
}

const result = await evaluate(`(async () => {
  const catalog = await window.nexus.apps.scanStartMenu()
  const target = catalog.find((a) => a.name === '7-Zip File Manager')
  if (!target) return { error: '未找到 7-Zip' }
  await window.nexus.apps.addFromStartMenu(target)
  const res = await window.nexus.apps.launch(target.id)
  return { added: target.id, aumid: target.aumid, result: res }
})()`)
console.log('RESULT=', JSON.stringify(result))
await new Promise((r) => setTimeout(r, 4000))
ws.close()
