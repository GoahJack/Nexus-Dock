// 调试：CDP 鼠标点击是否到达 Dock 图标，以及触发了哪些事件
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
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })

await evaluate(`(() => {
  window.__events = []
  for (const type of ['pointerdown','pointerup','click','mousedown','mouseup','pointermove']) {
    document.addEventListener(type, (e) => {
      window.__events.push({ type, cls: (e.target.className && e.target.className.toString().slice(0,60)) || e.target.tagName, pointerId: e.pointerId })
    }, true)
  }
  const el = document.querySelectorAll('.dock-item')[1]
  const r = el.getBoundingClientRect()
  window.__target = { x: r.x + r.width/2, y: r.y + r.height/2 }
  return window.__target
})()`)

const target = await evaluate('window.__target')
console.log('TARGET=', JSON.stringify(target))
await mouse('mouseMoved', target.x, target.y)
await sleep(200)
await mouse('mousePressed', target.x, target.y, { buttons: 1 })
await sleep(80)
await mouse('mouseReleased', target.x, target.y, { buttons: 0 })
await sleep(600)
console.log('EVENTS=', JSON.stringify(await evaluate('window.__events')))
console.log('TOAST=', JSON.stringify(await evaluate('(document.querySelector(".dock-toast-text")||{}).textContent || null')))
ws.close()
