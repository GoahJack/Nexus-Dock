/** Real Electron + real IPC, isolated profile. Run after npm run build. */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, openSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const root = process.cwd()
const profile = resolve(root, '.userdata/window-fold-verify')
const output = resolve(root, 'docs/verification/folding')
mkdirSync(profile, { recursive: true })
mkdirSync(output, { recursive: true })
const settings = structuredClone(DEFAULT_SETTINGS)
settings.dock.onlyOnDesktop = false
settings.dock.snapToEdge = true
settings.dock.opacity = .94
settings.music.source = 'local'
settings.music.onlyOnDesktop = false
settings.extraWindows.forEach(w => { w.onlyOnDesktop = false })
writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE
const executable = process.env.NEXUS_ISLAND_EXE ?? resolve(root, 'node_modules/electron/dist/electron.exe')
const child = spawn(executable, [
  '--no-sandbox', '--remote-debugging-port=9463', `--user-data-dir=${profile}`, root
], { env, windowsHide: true, stdio: ['ignore', openSync(join(profile, 'stdout.log'), 'w'), openSync(join(profile, 'stderr.log'), 'w')] })
const pause = ms => new Promise(r => setTimeout(r, ms))
const results = []
const sockets = []
const errors = []
child.on('error', e => errors.push(String(e)))
async function targets() { return (await fetch('http://127.0.0.1:9463/json/list')).json() }
async function connect(name) {
  let target
  for (let n = 0; n < 100; n++) {
    try { target = (await targets()).find(t => t.url.includes(`/${name}/index.html`)) } catch {}
    if (target) break
    await pause(200)
  }
  assert.ok(target, `${name} target unavailable`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  sockets.push(socket)
  let serial = 0
  const pending = new Map()
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text)
    if (!data.id) return
    const p = pending.get(data.id)
    if (!p) return
    pending.delete(data.id)
    clearTimeout(p.timer)
    data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const screenshot = async filename => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(output, filename), Buffer.from(r.data, 'base64'))
  }
  const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  const click = async selector => {
    const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
    await move(point.x, point.y)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await pause(100)
  }
  return { send, evaluate, screenshot, move, click }
}
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, pass: true, detail }); console.log('PASS', name) }
  catch (e) { results.push({ name, pass: false, error: String(e) }); console.log('FAIL', name, String(e)) }
}
try {
  const dock = await connect('dock')
  await pause(500)
  const patch = async p => { await dock.evaluate(`window.nexus.settings.update(${JSON.stringify(p)})`); await pause(350) }
  const fits = async (page, selector) => page.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight&&innerWidth-r.width<5&&innerHeight-r.height<5})()`)
  await check('Dock remains expanded after pointer exit, with no capsule or folding setting', async () => {
    const width = await dock.evaluate("document.querySelector('.dock-root').getBoundingClientRect().width")
    await dock.move(-50,-50); await pause(1400)
    assert.equal(await dock.evaluate("document.querySelector('.dock-island')===null && !document.querySelector('.dock-bar').hidden"), true)
    assert.equal(await dock.evaluate("document.querySelector('.dock-root').getBoundingClientRect().width"), width)
    assert.equal(await fits(dock,'.dock-root'),true)
    await dock.screenshot('dock.png')
  })
  const music = await connect('music')
  await check('music setting folds card; card button restores same persisted setting', async () => {
    const before = await music.evaluate("document.querySelector('.music-card').getBoundingClientRect().height")
    await patch({music:{collapsed:true}})
    const after = await music.evaluate("document.querySelector('.music-card').getBoundingClientRect().height")
    assert.ok(after<before)
    assert.equal(await fits(music,'.music-card'),true)
    await music.screenshot('music-mini.png')
    await music.click('.music-fold'); await pause(300)
    assert.equal(await dock.evaluate('(async()=> (await window.nexus.settings.get()).music.collapsed)()'),false)
    return {before,after}
  })
  await check('ring music mini keeps artwork and playback button visible', async () => {
    await patch({music:{progressStyle:'ring',collapsed:true}})
    assert.equal(await music.evaluate("(() => {const art=document.querySelector('.music-ring .music-art');const r=art.getBoundingClientRect();const svg=art.querySelector('svg');return r.width===32 && (!svg || getComputedStyle(svg).display!=='none') && document.querySelector('.music-ctrl.is-main').getBoundingClientRect().width>0})()"),true)
    await patch({music:{progressStyle:'bar',collapsed:false}})
  })
  await patch({clock:{visible:true,showSeconds:true,showDate:true}})
  const clock = await connect('clock')
  await check('clock folds to time capsule and restores seconds/date preferences', async () => {
    const before = await clock.evaluate("document.querySelector('.clock-root').getBoundingClientRect().height")
    await patch({clock:{collapsed:true}})
    const after = await clock.evaluate("document.querySelector('.clock-root').getBoundingClientRect().height")
    assert.ok(after<before)
    assert.equal(await clock.evaluate("document.querySelector('.clock-date')===null"),true)
    assert.equal(await fits(clock,'.clock-root'),true)
    await clock.screenshot('clock-mini.png')
    await clock.click('.clock-fold'); await pause(250)
    assert.equal(await clock.evaluate("document.querySelector('.clock-date')!==null && document.querySelector('.clock-time').textContent.split(':').length===3"),true)
    assert.equal(await dock.evaluate('(async()=> (await window.nexus.settings.get()).clock.collapsed)()'),false)
    await patch({clock:{collapsed:true},lock:{clock:true}})
    assert.equal(await clock.evaluate("(() => {const a=document.querySelector('.clock-lock').getBoundingClientRect();const b=document.querySelector('.clock-fold').getBoundingClientRect();return a.right<=b.left||a.bottom<=b.top||a.left>=b.right||a.top>=b.bottom})()"),true)
    await clock.click('.clock-fold'); await pause(200)
    assert.equal(await dock.evaluate('(async()=> (await window.nexus.settings.get()).clock.collapsed)()'),false)
    await patch({lock:{clock:false}})
    return {before,after}
  })
  const study = await connect('wordstudy')
  await check('word capsule preserves current word and ignores study grading shortcuts', async () => {
    const word = await study.evaluate("document.querySelector('.ws-word').textContent")
    const progress = await study.evaluate('(async()=>JSON.stringify((await window.nexus.wordBank.get()).progress))()')
    await study.click('.ws-fold-full'); await pause(300)
    assert.equal(await study.evaluate("document.querySelector('.ws-mini-word').textContent"),word)
    assert.equal(await study.evaluate("document.querySelector('.ws-content').hidden"),true)
    assert.equal(await fits(study,'.ws-root'),true)
    await study.screenshot('word-mini.png')
    await study.send('Input.dispatchKeyEvent',{type:'keyDown',key:'3',code:'Digit3',windowsVirtualKeyCode:51})
    assert.equal(await study.evaluate('(async()=>JSON.stringify((await window.nexus.wordBank.get()).progress))()'),progress)
    await study.click('.ws-mini .ws-fold'); await pause(300)
    assert.equal(await study.evaluate("document.querySelector('.ws-content').hidden"),false)
    assert.equal(await study.evaluate("document.querySelector('.ws-word').textContent"),word)
  })
  await check('word editor draft survives folding and settings-driven unfold', async () => {
    await study.click('.ws-bank-toggle')
    await study.evaluate("(() => {const e=document.querySelector('.ws-bank-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'draft-test');e.dispatchEvent(new Event('input',{bubbles:true}))})()")
    await study.click('.ws-fold-full'); await pause(300)
    const current=await dock.evaluate('window.nexus.settings.get()')
    await patch({extraWindows:current.extraWindows.map(w=>({...w,collapsed:false}))})
    assert.equal(await study.evaluate("document.querySelector('.ws-bank-search').value"),'draft-test')
    assert.equal(await study.evaluate("document.querySelector('.ws-root').dataset.view"),'editor')
    await study.click('.ws-editor-back')
  })
  await check('settings expose folding for music, clock and word study, never Dock', async () => {
    await dock.evaluate('window.nexus.window.openSettings()')
    const page=await connect('settings'); await pause(250)
    await page.click('.nx-acc-head')
    assert.equal(await page.evaluate("document.querySelector('.nx-acc-body').textContent.includes('收起为胶囊')"),false)
    await page.evaluate("document.querySelectorAll('.nx-acc-head')[1].click()")
    await pause(100)
    await page.evaluate("[...document.querySelectorAll('.ui-row')].find(r=>r.textContent.includes('收起为胶囊')).querySelector('[role=switch]').click()")
    await pause(350)
    assert.equal(await dock.evaluate('(async()=> (await window.nexus.settings.get()).music.collapsed)()'),true)
    await page.screenshot('settings-builtins.png')
    await page.evaluate("document.querySelectorAll('.settings-nav-item')[1].click()")
    await pause(100); await page.click('.nx-acc-head')
    assert.equal(await page.evaluate("document.body.textContent.includes('收起为胶囊')"),true)
    await page.screenshot('settings-wordstudy.png')
  })
  await check('fold state persists to disk and survives renderer reload', async () => {
    await patch({music:{collapsed:true},clock:{collapsed:true}})
    const current=await dock.evaluate('window.nexus.settings.get()')
    await patch({extraWindows:current.extraWindows.map(w=>({...w,collapsed:true}))})
    await pause(1000)
    const disk=JSON.parse(readFileSync(join(profile,'settings.json'),'utf8'))
    assert.equal(disk.music.collapsed,true)
    assert.equal(disk.clock.collapsed,true)
    assert.equal(disk.extraWindows.find(w=>w.kind==='wordstudy').collapsed,true)
    await music.send('Page.reload'); await pause(600)
    assert.equal(await music.evaluate("document.querySelector('.music-card').dataset.collapsed"),'true')
  })
  await check('all Dock edges remain usable; reduced motion and runtime errors', async () => {
    for (const edge of ['top','left','right','bottom']) {
      await patch({dock:{edge}})
      assert.equal(await fits(dock,'.dock-root'),true)
      assert.equal(await dock.evaluate("document.querySelectorAll('.dock-item').length>0"),true)
    }
    await patch({appearance:{reducedMotion:true},music:{collapsed:false},clock:{collapsed:false}})
    assert.equal(await music.evaluate("document.querySelector('.music-card').dataset.collapsed"),undefined)
    assert.deepEqual(errors,[])
  })
} catch (e) { errors.push(String(e)); console.error(e); process.exitCode = 1 }
finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify({ at: new Date().toISOString(), executable, scope: 'real Electron, isolated profile, real IPC', results, errors }, null, 2))
  for (const socket of sockets) socket.close()
  // Only terminate the process created by this script; leave user instances alone.
  if (child.pid) child.kill()
  if (results.some(r => !r.pass) || errors.length) process.exitCode = 1
}
