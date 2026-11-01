// 直接调用 preload API 验证「启动应用」链路（绕过鼠标，定位 UI 还是主进程的问题）
const list = async () => (await fetch('http://127.0.0.1:9224/json')).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await list()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) throw new Error('dock target not found')
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value
}

console.log('LAUNCH=', JSON.stringify(await evaluate("window.nexus.apps.launch('notepad')")))
await sleep(2500)
console.log('DOCK_TEXT=', JSON.stringify(await evaluate('document.body.innerText.slice(0,300)')))
console.log('RUNNING=', JSON.stringify(await evaluate('window.nexus.apps.list().then(() => true)')))
ws.close()
