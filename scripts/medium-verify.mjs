// Nexus Dock 正常权限下的启动/置前真实验收
// 用法: node scripts/medium-verify.mjs [debugPort]
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 9230)
const outDir = 'E:/AI WorkRegion/app_creator/scripts/out'
const probe = `${outDir}/win-probe.exe`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const probeFg = () => JSON.parse(execFileSync(probe, ['FG'], { encoding: 'utf8' }).trim())
const probeWins = () => JSON.parse(execFileSync(probe, ['WINS'], { encoding: 'utf8' }).trim())
const shot = (file) => execFileSync(probe, ['SHOT', file], { encoding: 'utf8' })

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) {
  console.error('dock target not found', targets)
  process.exit(1)
}
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed')
  return result.result.value
}

const results = { startedAt: new Date().toISOString(), port, steps: [], errors: [] }
const record = (step) => {
  results.steps.push(step)
  console.log(JSON.stringify(step))
}

// 读取设置并把「仅在桌面显示」临时关闭（否则最大化窗口会让 Dock 隐藏，无法点击）
const settings = await evaluate('window.nexus.settings.get()')
const originalOnlyOnDesktop = settings.dock.onlyOnDesktop
await evaluate('window.nexus.settings.update({ dock: { onlyOnDesktop: false } })')
await sleep(700)

const dockWins = probeWins().filter((w) => w.proc === 'NexusDockApp' && /Nexus Dock/i.test(w.title))
record({ kind: 'setup', originalOnlyOnDesktop, dockWindows: dockWins.length, dockRect: dockWins[0]?.rect ?? null })

const readToast = async () => (await evaluate("document.querySelector('.dock-toast-text')?.textContent ?? ''")).trim()

const snapshot = async (label) => {
  const fg = probeFg()
  const wins = probeWins()
  const toast = await readToast()
  const dockVisible = wins.some((w) => w.proc === 'NexusDockApp' && /Nexus Dock/i.test(w.title))
  return { label, at: new Date().toISOString(), toast, foreground: fg, dockVisible, externalWindows: wins.length }
}

const clickItem = async (name) => {
  const rect = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.dock-item')].find((n) => n.getAttribute('aria-label') === ${JSON.stringify(name)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!rect) throw new Error(`dock item not found: ${name}`)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  return rect
}

const apps = settings.apps
const appResults = []

for (const app of apps) {
  const t0 = Date.now()
  let launchResult = null
  let launchError = null
  try {
    launchResult = await evaluate(`window.nexus.apps.launch(${JSON.stringify(app.id)})`)
  } catch (error) {
    launchError = String(error.message ?? error)
  }
  await sleep(650)
  const snap = await snapshot(app.name)
  await sleep(1400)
  const after = await snapshot(`${app.name}-settled`)
  const entry = {
    id: app.id,
    name: app.name,
    path: app.path,
    aumid: app.aumid ?? '',
    launchResult,
    launchError,
    elapsedMs: Date.now() - t0,
    toast: snap.toast || after.toast,
    foreground: snap.foreground,
    foregroundSettled: after.foreground,
    dockVisible: after.dockVisible
  }
  appResults.push(entry)
  record({ kind: 'api-launch', ...entry })
}

// 真实鼠标点击（走渲染层 onClick → IPC 全链路），重复点两次验证“双击”不会重复报错
const clickTargets = ['计算器', '文件资源管理器']
const clickResults = []
for (const name of clickTargets) {
  const rect = await clickItem(name)
  await sleep(800)
  const snap = await snapshot(`click-${name}`)
  await sleep(1200)
  const settled = await snapshot(`click-${name}-settled`)
  clickResults.push({ name, rect, firstToast: snap.toast, foreground: snap.foreground, settledForeground: settled.foreground, settledToast: settled.toast })
  record({ kind: 'dom-click', ...clickResults.at(-1) })
}

// 恢复设置
await evaluate(`window.nexus.settings.update({ dock: { onlyOnDesktop: ${originalOnlyOnDesktop} } })`)
await sleep(500)
shot(`${outDir}/medium-verify-desktop.png`)

results.appResults = appResults
results.clickResults = clickResults
results.finishedAt = new Date().toISOString()
writeFileSync(`${outDir}/medium-verify.json`, JSON.stringify(results, null, 2), 'utf8')
console.log('RESULT_FILE=' + `${outDir}/medium-verify.json`)
ws.close()
