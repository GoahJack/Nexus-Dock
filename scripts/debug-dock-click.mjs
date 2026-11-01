// 调试 Dock 点击链路：记录事件目标 + 是否调用 launch
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
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await evaluate(`(() => {
  window.__trace = []
  window.__launchIds = []
  const origLaunch = window.nexus.apps.launch
  if (!window.__patched) {
    window.__patched = true
    window.nexus.apps.launch = (appId) => {
      window.__launchIds.push(appId)
      return origLaunch(appId).then((r) => { window.__launchIds.push({ appId, result: r }); return r })
    }
  }
  for (const type of ['pointerdown','pointerup','pointercapture','lostpointercapture','click']) {
    document.addEventListener(type, (e) => {
      window.__trace.push({ type, target: (e.target.className || e.target.tagName || '').toString().slice(0, 60), pointerId: e.pointerId })
    }, true)
  }
  const items = [...document.querySelectorAll('.dock-item')]
  const calc = items.find((el) => (el.getAttribute('title') || '').includes('计算器')) || items[2]
  const r = calc.getBoundingClientRect()
  window.__pt = { x: r.x + r.width / 2, y: r.y + r.height / 2, title: calc.getAttribute('title') }
  return window.__pt
})()`)
const pt = await evaluate('window.__pt')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
await sleep(260)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(90)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(1200)
console.log('PT=', JSON.stringify(pt))
console.log('TRACE=', JSON.stringify(await evaluate('window.__trace')))
console.log('LAUNCH_IDS=', JSON.stringify(await evaluate('window.__launchIds')))
console.log('TOAST=', JSON.stringify(await evaluate('(document.querySelector(".dock-toast-text")||{}).textContent||null')))
ws.close()
