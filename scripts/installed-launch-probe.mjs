// 对已安装（正常权限、沙盒模式）的 Nexus Dock 做启动/置前探测
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 9260)
const outDir = 'E:/AI WorkRegion/app_creator/scripts/out'
const probe = `${outDir}/win-probe.exe`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fg = () => JSON.parse(execFileSync(probe, ['FG'], { encoding: 'utf8' }).trim())
const wins = () => JSON.parse(execFileSync(probe, ['WINS'], { encoding: 'utf8' }).trim())

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) { console.error('no dock target'); process.exit(1) }
const ws = new WebSocket(dock.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const call = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value }

const settings = await ev('window.nexus.settings.get()')
const results = []
for (const item of settings.apps) {
  if (!['calc', 'notepad', 'cmd', 'explorer', 'settings', 'custom-f075a8241e05'].includes(item.id)) continue
  const t0 = Date.now()
  let result = null, error = null
  try { result = await ev(`window.nexus.apps.launch(${JSON.stringify(item.id)})`) } catch (e) { error = String(e) }
  const elapsed = Date.now() - t0
  await sleep(500)
  const toast = await ev("document.querySelector('.dock-toast-text')?.textContent ?? ''")
  const foreground = fg()
  const visible = wins().filter((w) => w.proc !== 'NexusDockApp').map((w) => `${w.proc}:${w.title}`).slice(0, 6)
  results.push({ id: item.id, name: item.name, result, error, elapsed, toast, foreground, visible })
  console.log(JSON.stringify(results[results.length - 1]))
  await sleep(1200)
}
writeFileSync(`${outDir}/installed-launch-probe.json`, JSON.stringify(results, null, 2), 'utf8')
console.log('PROBE_DONE')
ws.close()
