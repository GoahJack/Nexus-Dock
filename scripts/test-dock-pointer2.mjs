// 逐步验证 pointerdown/up 是否被 React 处理
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
  const out = {}
  const items = [...document.querySelectorAll('.dock-item')]
  const el = items.find((x) => (x.getAttribute('title') || '').includes('计算器')) || items[2]
  const rect = el.getBoundingClientRect()
  const base = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }
  out.before = el.outerHTML.slice(0, 160)
  el.dispatchEvent(new PointerEvent('pointerdown', base))
  await new Promise((r) => setTimeout(r, 150))
  out.afterDown = {
    html: el.outerHTML.slice(0, 200),
    pressedAttr: el.getAttribute('data-pressed'),
    class: el.className
  }
  const list = document.querySelector('.dock-items')
  list.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
  await new Promise((r) => setTimeout(r, 600))
  out.afterUp = { pressedAttr: el.getAttribute('data-pressed'), class: el.className }
  return out
})()`)
console.log(JSON.stringify(result, null, 2))
ws.close()
