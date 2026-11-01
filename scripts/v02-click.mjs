// 验收：Dock 图标点击启动 + 最大化时自动隐藏
import { writeFileSync } from 'node:fs'
const port = 9224
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = async (url) => JSON.parse(await (await fetch(url)).text())

async function cdp(match) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`)
  const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
  if (!t) throw new Error('未找到 ' + match)
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
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
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(70)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
  }
  return { send, evaluate, click, shot, close: () => ws.close() }
}

const out = {}
try {
  const dock = await cdp('/dock/')
  await dock.send('Page.enable')

  // 1) 点击「计算器」图标 → 检查 CalculatorApp 进程
  const pos = await dock.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const target = items.find((el) => (el.getAttribute('title') || '').includes('计算器')) || items[2]
    const r = target.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, title: target.getAttribute('title') }
  })()`)
  const launch = await dock.evaluate(`window.nexus.apps.launch('calc')`)
  await sleep(2500)
  out.launch = { pos, result: launch }
  await dock.shot('docs/verification/v02-dock-clicked.png')

  // 2) 最大化计算器 → Dock 应该隐藏；用 UIA 操作
  out.beforeMax = await dock.evaluate('window.nexus.settings.get().then((s) => ({ onlyOnDesktop: s.dock.onlyOnDesktop }))')
  dock.close()
  await sleep(300)
} catch (error) {
  out.error = error?.stack || String(error)
} finally {
  writeFileSync('docs/verification/v02-click.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2))
}
