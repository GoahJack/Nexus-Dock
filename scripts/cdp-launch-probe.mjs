// 探针：拦截 nexus.apps.launch，确认点击是否真的调用了启动
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 包装 launch，记录调用
await evaluate(`(() => {
  if (!window.__wrapped) {
    window.__wrapped = true
    window.__calls = []
    const orig = window.nexus.apps.launch
    window.nexus.apps.launch = (appId) => {
      window.__calls.push({ appId, at: Date.now() })
      return orig(appId).then((res) => { window.__calls.push({ appId, res }); return res })
    }
  }
  const items = [...document.querySelectorAll('.dock-item')]
  const el = items[1]
  const r = el.getBoundingClientRect()
  window.__pt = { x: r.x + r.width / 2, y: r.y + r.height / 2, title: el.getAttribute('title') }
  return window.__pt
})()`)
const pt = await evaluate('window.__pt')
console.log('POINT=', JSON.stringify(pt))
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
await sleep(250)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(120)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(1500)
console.log('CALLS=', JSON.stringify(await evaluate('window.__calls')))
console.log('TOAST=', JSON.stringify(await evaluate('(document.querySelector(".dock-toast-text")||{}).textContent || null')))
ws.close()
