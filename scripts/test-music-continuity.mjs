// 验证暂停再播放后进度不回零
const port = 9224
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const music = targets.find((t) => t.url.includes('/music/'))
const ws = new WebSocket(music.webSocketDebuggerUrl)
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
const clickMain = async () => {
  const pos = await evaluate(`(() => { const b = document.querySelector('.music-ctrl.is-main'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', buttons: 0, clickCount: 1 })
}
const timeText = () => evaluate(`(document.querySelector('.music-time')||document.body).innerText`)

console.log('BEFORE=', await timeText())
await clickMain() // pause
await sleep(1200)
console.log('PAUSED=', await timeText())
await clickMain() // resume
await sleep(600)
console.log('RESUMED_0.6S=', await timeText())
await sleep(3200)
console.log('RESUMED_3.8S=', await timeText())
ws.close()
