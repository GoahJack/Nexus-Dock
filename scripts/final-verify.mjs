// Nexus Dock 修复后的最终功能验收（正常权限、安装版）
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 9270)
const outDir = 'E:/AI WorkRegion/app_creator/scripts/out'
const probe = `${outDir}/win-probe.exe`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fg = () => JSON.parse(execFileSync(probe, ['FG'], { encoding: 'utf8' }).trim())
const wins = () => JSON.parse(execFileSync(probe, ['WINS'], { encoding: 'utf8' }).trim())
const shot = (file) => execFileSync(probe, ['SHOT', file], { encoding: 'utf8' })

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) { console.error('dock target not found'); process.exit(1) }
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } })
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, (m) => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed'); return r.result.value }

const report = { startedAt: new Date().toISOString(), results: [], clicks: [], indicators: null, errors: [] }

const settings = await ev('window.nexus.settings.get()')
const originalOnlyOnDesktop = settings.dock.onlyOnDesktop
await ev('window.nexus.settings.update({ dock: { onlyOnDesktop: false } })')
await sleep(900)

const dockWin = () => wins().filter((w) => w.proc === 'NexusDockApp' && /Nexus Dock/i.test(w.title))
console.log('dock windows:', JSON.stringify(dockWin()))

for (const item of settings.apps) {
  const t0 = Date.now()
  let result = null, error = null
  try { result = await ev(`window.nexus.apps.launch(${JSON.stringify(item.id)})`) } catch (e) { error = String(e) }
  const elapsed = Date.now() - t0
  await sleep(500)
  const toast = (await ev("document.querySelector('.dock-toast-text')?.textContent ?? ''")).trim()
  const foreground = fg()
  const visible = wins().filter((w) => !/Nexus (Dock|Music)|NexusDockApp/.test(w.title) && w.proc !== 'NexusDockApp').map((w) => `${w.proc}:${w.title}`).slice(0, 8)
  const entry = { id: item.id, name: item.name, result, error, elapsed, toast, foreground, visible }
  report.results.push(entry)
  console.log(JSON.stringify(entry))
  await sleep(1500)
}

// 真实鼠标点击（DOM 事件 → onClick → IPC → 主进程启动链路）
const clickItem = async (name) => {
  const rect = await ev(`(() => {
    const el = [...document.querySelectorAll('.dock-item')].find((n) => n.getAttribute('aria-label') === ${JSON.stringify(name)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!rect) return null
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  return rect
}

// 双击测试：连续两次点击同一图标，不应该出现错误提示
for (const name of ['计算器', '文件资源管理器', 'DeepSeek Harness']) {
  const rect = await clickItem(name)
  await sleep(300)
  const rect2 = await clickItem(name)
  await sleep(1800)
  const toast = (await ev("document.querySelector('.dock-toast-text')?.textContent ?? ''")).trim()
  const foreground = fg()
  report.clicks.push({ name, rect, rect2, toast, foreground })
  console.log('click', name, '=>', JSON.stringify(report.clicks.at(-1)))
  await sleep(1200)
}

// 运行指示点检查（主进程每 4s 更新一次，多等一会）
await sleep(5500)
report.indicators = await ev(`(() => {
  const items = [...document.querySelectorAll('.dock-item')].map((el) => ({
    name: el.getAttribute('aria-label'),
    running: el.getAttribute('data-running') === 'true'
  }))
  return { total: items.length, running: items.filter((i) => i.running) }
})()`)
console.log('indicators:', JSON.stringify(report.indicators))

await ev(`window.nexus.settings.update({ dock: { onlyOnDesktop: ${originalOnlyOnDesktop} } })`)
await sleep(600)
shot(`${outDir}/final-verify-desktop.png`)
report.finishedAt = new Date().toISOString()
writeFileSync(`${outDir}/final-verify.json`, JSON.stringify(report, null, 2), 'utf8')
console.log('VERIFY_DONE')
ws.close()
