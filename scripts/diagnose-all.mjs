// 全量诊断：应用列表 + 逐个启动结果 + 音乐状态
const port = 9224
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const dock = targets.find((t) => t.url.includes('/dock/'))
if (!dock) throw new Error('dock 未找到')
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
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description }
  return r.result.value
}

const apps = await evaluate('window.nexus.apps.list()')
console.log('APPS=', JSON.stringify(apps, null, 2))

for (const app of apps) {
  if (!['explorer', 'notepad', 'calc', 'settings', 'cmd'].includes(app.id) && !/微信|Edge|edge/i.test(app.name)) continue
  const result = await evaluate(`window.nexus.apps.launch(${JSON.stringify(app.id)})`)
  console.log(`LAUNCH ${app.name} (${app.id}) aumid=${app.aumid ?? ''} path=${app.path} → ${JSON.stringify(result)}`)
  await sleep(1200)
}

const musicTarget = targets.find((t) => t.url.includes('/music/'))
if (musicTarget) {
  const mw = new WebSocket(musicTarget.webSocketDebuggerUrl)
  await new Promise((r) => mw.addEventListener('open', r))
  let mid = 0
  const mpending = new Map()
  mw.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && mpending.has(m.id)) {
      mpending.get(m.id)(m.result)
      mpending.delete(m.id)
    }
  })
  const mevaluate = (expression) =>
    new Promise((resolve) => {
      const i = ++mid
      mpending.set(i, (r) => resolve(r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value))
      mw.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  const state = await mevaluate('window.nexus.media.getState()')
  const text = await mevaluate('document.body.innerText.replace(/\\s+/g," ").slice(0,200)')
  console.log('MUSIC_STATE=', JSON.stringify(state))
  console.log('MUSIC_TEXT=', JSON.stringify(text))
  mw.close()
}
ws.close()
