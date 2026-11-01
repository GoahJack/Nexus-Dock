// 记录 UI 点击触发的 launch 返回值、toast、进程结果
import { execSync } from 'node:child_process'
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

const setup = await evaluate(`(() => {
  window.__launchLog = []
  const orig = window.nexus.apps.launch
  window.nexus.apps.launch = (appId) => {
    const p = orig(appId)
    p.then((res) => window.__launchLog.push({ appId, res })).catch((err) => window.__launchLog.push({ appId, err: String(err) }))
    return p
  }
  const items = [...document.querySelectorAll('.dock-item')]
  const el = items.find((x) => (x.getAttribute('title') || '').includes('计算器')) || items[2]
  const rect = el.getBoundingClientRect()
  const base = { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }
  el.dispatchEvent(new PointerEvent('pointerdown', base))
  document.querySelector('.dock-items').dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
  return true
})()`)
await new Promise((r) => setTimeout(r, 3000))
const log = await evaluate('window.__launchLog')
const toast = await evaluate('(document.querySelector(".dock-toast-text")||{}).textContent||null')
console.log('SETUP=', setup)
console.log('LAUNCH_LOG=', JSON.stringify(log))
console.log('TOAST=', JSON.stringify(toast))
ws.close()
try {
  const procs = execSync('powershell -NoProfile -Command "(Get-Process CalculatorApp -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8' }).trim()
  console.log('CALC_PROCS=', procs)
} catch (error) {
  console.log('PROC_CHECK_ERR=', String(error).slice(0, 120))
}
