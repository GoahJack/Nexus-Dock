// 点击图标后持续轮询 10 秒，判断是「没启动」还是「启动慢」
import { execSync } from 'node:child_process'
const port = 9224
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

const pt = await evaluate(`(() => {
  const el = [...document.querySelectorAll('.dock-item')].find((x) => (x.getAttribute('title') || '').includes('计算器'))
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
await sleep(200)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 })
await sleep(80)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 })

const counts = []
for (let i = 0; i < 10; i += 1) {
  await sleep(1000)
  try {
    const n = execSync('powershell -NoProfile -Command "(Get-Process CalculatorApp -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8' }).trim()
    counts.push(Number(n))
  } catch {
    counts.push(-1)
  }
}
const toast = await evaluate('(document.querySelector(".dock-toast-text")||{}).textContent||null')
console.log('PT=', JSON.stringify(pt))
console.log('CALC_COUNTS_PER_SEC=', JSON.stringify(counts))
console.log('TOAST=', JSON.stringify(toast))
ws.close()
