/** Real Electron + real IPC, isolated profile. Run after npm run build. */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, openSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const root = process.cwd()
const profile = resolve(root, '.userdata/island-hover-verify')
const output = resolve(root, process.env.NEXUS_VERIFY_OUTPUT ?? 'docs/verification/motion-island')
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
  '--no-sandbox', '--inspect=127.0.0.1:9464', '--remote-debugging-port=9463', `--user-data-dir=${profile}`, root
], { env, windowsHide: true, stdio: ['ignore', openSync(join(profile, 'stdout.log'), 'w'), openSync(join(profile, 'stderr.log'), 'w')] })
const pause = ms => new Promise(r => setTimeout(r, ms))
const results = []
const sockets = []
const errors = []
child.on('error', e => errors.push(String(e)))
async function targets(port) { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json() }
async function connect(name, port = 9463) {
  let target
  for (let n = 0; n < 100; n++) {
    try { target = (await targets(port)).find(t => name === null || t.url.includes(`/${name}/index.html`)) } catch {}
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
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(a=>a.value??a.description??'').join(' '))
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

// The test changes only the screen cursor source in this isolated main process.
// Native BrowserWindow bounds, proximity monitor, renderer, preload and IPC stay real.
// The OS pointer is never moved. No Computer Use capture session is opened.
let main
try {
  main = await connect(null, 9464)
  await main.evaluate(`(() => {
    const electron = process.mainModule.require('electron');
    globalThis.__islandTest = { electron, original: electron.screen.getCursorScreenPoint, cursor: {x:-100000,y:-100000}, calls:0 };
    electron.screen.getCursorScreenPoint = () => { __islandTest.calls++; return __islandTest.cursor };
  })()`)
  const cursor = point => main.evaluate(`__islandTest.cursor=${JSON.stringify(point)}`)
  const bounds = kind => main.evaluate(`(() => {const w=__islandTest.electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/${kind}/'));return w.getBounds()})()`)
  const dock = await connect('dock')
  const patch = async p => { await dock.evaluate(`window.nexus.settings.update(${JSON.stringify(p)})`); await pause(250) }
  const config = () => dock.evaluate('window.nexus.settings.get()')
  const patchWord = async values => {
    const current=await config()
    await patch({extraWindows:current.extraWindows.map(w=>w.kind==='wordstudy'?{...w,...values}:w)})
  }
  await patch({clock:{visible:true,onlyOnDesktop:false},music:{onlyOnDesktop:false}})
  const widgets = [
    {kind:'music',root:'.music-card',page:await connect('music')},
    {kind:'clock',root:'.clock-root',page:await connect('clock')},
    {kind:'wordstudy',root:'.ws-root',page:await connect('wordstudy')}
  ]
  const compact = w => w.page.evaluate(`document.querySelector('${w.root}').dataset.collapsed==='true'`)
  const setMode = async (w, enabled, pinned = false) => {
    if(w.kind==='wordstudy') await patchWord({collapsed:enabled,pinned})
    else await patch({[w.kind]:{collapsed:enabled,pinned}})
  }
  const settled = async w => {
    for(let n=0;n<100;n++) {
      if(!await w.page.evaluate(`document.querySelector('${w.root}').dataset.islandAnimating==='true'`)) { await pause(50); return }
      await pause(20)
    }
    throw Error(`${w.kind} morph failed to settle`)
  }
  const fits = async w => {
    await settled(w)
    return w.page.evaluate(`(() => {const r=document.querySelector('${w.root}').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight&&innerWidth-r.width<5&&innerHeight-r.height<5})()`)
  }
  const far = async w => {
    await cursor({x:-100000,y:-100000})
    await w.page.move(-50,-50)
  }
  const approach = async w => {
    await settled(w)
    const b=await bounds(w.kind)
    await cursor({x:b.x-16,y:b.y+b.height/2})
    await pause(350)
    await settled(w)
  }
  await check('Dock stays fully expanded and has no proximity/pin controls', async () => {
    await dock.move(-50,-50); await pause(1000)
    assert.equal(await dock.evaluate("document.querySelector('.dock-island')===null && document.querySelector('[data-island-pin]')===null && !document.querySelector('.dock-bar').hidden"),true)
  })
  for(const w of widgets) {
    await check(`${w.kind}: native proximity expands outside window, delays collapse and fits viewport`, async () => {
      await far(w); await setMode(w,true); await pause(1100)
      assert.equal(await compact(w),true,'starts as capsule')
      await w.page.screenshot(`${w.kind}-capsule.png`)
      await approach(w)
      assert.equal(await compact(w),false,'pointer 16 DIP outside capsule expands it')
      assert.equal(await fits(w),true)
      const saved=await config()
      assert.equal(w.kind==='wordstudy'?saved.extraWindows.find(x=>x.kind==='wordstudy').collapsed:saved[w.kind].collapsed,true,'hover never persists expanded state')
      await w.page.screenshot(`${w.kind}-expanded.png`)
      await far(w); await pause(300)
      assert.equal(await compact(w),false,'does not snap closed')
      await pause(900)
      assert.equal(await compact(w),true,'collapses after delay')
      assert.equal(await fits(w),true)
    })
    await check(`${w.kind}: pin holds open, click again resumes auto collapse`, async () => {
      await approach(w)
      const pin = w.kind==='wordstudy'?'.ws-fold-full':'[data-island-pin]'
      await w.page.click(pin); await pause(250)
      await far(w); await pause(1200)
      assert.equal(await compact(w),false,'pin survives pointer exit')
      const saved=await config()
      assert.equal(w.kind==='wordstudy'?saved.extraWindows.find(x=>x.kind==='wordstudy').pinned:saved[w.kind].pinned,true)
      await w.page.screenshot(`${w.kind}-pinned.png`)
      await w.page.click(pin); await pause(250)
      await far(w); await pause(1200)
      assert.equal(await compact(w),true,'unpin restores collapse')
    })
  }
  for(const w of [widgets[0],widgets[2]]) {
    await check(`${w.kind}: shell has intermediate native sizes, no text scaling, and reverses cleanly`, async () => {
      await far(w); await setMode(w,true,false); await pause(1500); await settled(w)
      const initial=await w.page.evaluate(`document.querySelector('${w.root}').getBoundingClientRect().height`)
      await w.page.evaluate(`(() => {
        const root=document.querySelector('${w.root}');globalThis.__morphTrace=[];const start=performance.now();
        const frame=()=>{const r=root.getBoundingClientRect();__morphTrace.push({t:performance.now()-start,w:r.width,h:r.height,vh:innerHeight,transform:getComputedStyle(root).transform});if(performance.now()-start<650)requestAnimationFrame(frame)};requestAnimationFrame(frame)
      })()`)
      const b=await bounds(w.kind); await cursor({x:b.x-16,y:b.y+b.height/2})
      await pause(180); await w.page.screenshot(`${w.kind}-morph-mid.png`)
      await pause(550); await settled(w)
      const frames=await w.page.evaluate('__morphTrace')
      const final=await w.page.evaluate(`document.querySelector('${w.root}').getBoundingClientRect().height`)
      assert.ok(new Set(frames.map(f=>Math.round(f.h))).size>=5,'at least five distinct surface sizes')
      assert.ok(new Set(frames.map(f=>f.vh)).size>=4,'native viewport follows the surface')
      assert.ok(frames.some(f=>f.h>initial+2&&f.h<final-2),'visible intermediate geometry')
      assert.ok(frames.every(f=>f.transform==='none'),'root/text are never scaled')
      await far(w)
      for(let n=0;n<85;n++) {
        if(await w.page.evaluate(`document.querySelector('${w.root}').dataset.islandAnimating==='true'`))break
        await pause(20)
      }
      await pause(70)
      const reversing=await bounds(w.kind);await cursor({x:reversing.x-16,y:reversing.y+reversing.height/2})
      await pause(500);await settled(w)
      const reverseState={compact:await compact(w),requestedFrom:reversing,after:await bounds(w.kind),near:await w.page.evaluate('window.nexus.window.getIslandProximity()')}
      assert.equal(reverseState.compact,false,`reentry reverses closing: ${JSON.stringify(reverseState)}`)
      assert.equal(await w.page.evaluate(`(() => {const s=document.querySelector('${w.root}').style;return s.height===''&&s.minHeight===''&&s.overflow===''})()`),true,'temporary geometry is cleaned up')
      assert.equal(await fits(w),true)
      if(w.kind==='music') {
        await far(w)
        for(let n=0;n<85;n++) {
          if(await w.page.evaluate(`document.querySelector('${w.root}').dataset.islandAnimating==='true'`))break
          await pause(20)
        }
        try {
          await dock.evaluate('window.nexus.settings.update({appearance:{reducedMotion:true}})')
          await pause(60)
          assert.equal(await w.page.evaluate(`document.querySelector('${w.root}').dataset.islandAnimating`),undefined,'reduce-motion change settles a running morph')
          assert.equal(await w.page.evaluate(`document.querySelector('${w.root}').style.height`),'')
        } finally {await patch({appearance:{reducedMotion:false}})}
        await approach(w)
      }
      return {initial,final,frames}
    })
  }
  await check('animated clamping never overwrites the saved free position', async () => {
    const w=widgets[2];const before=(await config()).extraWindows.find(x=>x.kind==='wordstudy')
    const area=await main.evaluate('__islandTest.electron.screen.getPrimaryDisplay().workArea')
    const x=area.x+area.width-310;const y=area.y+80
    try {
      await far(w);await patchWord({collapsed:true,pinned:false,snapToEdge:false,freeX:x,freeY:y})
      await pause(1500);await approach(w);await far(w);await pause(1600)
      const after=(await config()).extraWindows.find(x=>x.kind==='wordstudy')
      assert.equal(after.freeX,x);assert.equal(after.freeY,y);assert.equal(after.snapToEdge,false)
    } finally {await patchWord({freeX:before.freeX,freeY:before.freeY,snapToEdge:before.snapToEdge})}
  })
  for (const w of [widgets[0], widgets[2]]) {
    await check(`${w.kind}: missing DOM leave/up cannot latch the native drag region open`, async () => {
      await far(w); await setMode(w,true,false); await pause(1200); await approach(w)
      await w.page.evaluate(`(() => {const r=document.querySelector('${w.root}');r.dispatchEvent(new PointerEvent('pointerenter',{pointerId:79}));r.dispatchEvent(new PointerEvent('pointerdown',{pointerId:79,buttons:1,bubbles:true}))})()`)
      // Simulate Windows caption hit testing: main sees the pointer leave, but Chromium
      // never receives pointerleave/pointerup. Do not use page.move() here.
      await cursor({x:-100000,y:-100000}); await pause(1500)
      try { assert.equal(await compact(w),true) }
      finally {
        await w.page.evaluate(`(() => {window.dispatchEvent(new PointerEvent('pointerup',{pointerId:79}));document.querySelector('${w.root}').dispatchEvent(new PointerEvent('pointerleave',{pointerId:79}))})()`)
      }
      // No native true->false edge occurs if the whole interaction falls between ticks.
      // The one-shot native verification must also release these stale DOM flags.
      await w.page.evaluate(`document.querySelector('${w.root}').dispatchEvent(new PointerEvent('pointerenter',{pointerId:80}))`)
      await pause(1700)
      assert.equal(await compact(w),true,'fast hover is cleared even without a native state-change event')
    })
  }
  await check('genuine pointer capture retains drag protection until release', async () => {
    const w=widgets[0];await approach(w)
    const point=await w.page.evaluate(`(() => {
      const el=document.querySelector('.music-title');el.style.webkitAppRegion='no-drag';
      el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);globalThis.__captureId=e.pointerId},{once:true});
      const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}
    })()`)
    await w.page.move(point.x,point.y)
    await w.page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
    try {
      assert.equal(await w.page.evaluate("document.querySelector('.music-title').hasPointerCapture(__captureId)"),true)
      await cursor({x:-100000,y:-100000});await pause(1500)
      assert.equal(await compact(w),false,'real capture survives native pointer exit')
    } finally {
      await w.page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
      await w.page.evaluate("document.querySelector('.music-title').style.removeProperty('-webkit-app-region')")
    }
    await pause(1500)
    assert.equal(await compact(w),true,'release restores automatic collapse')
  })
  const word=widgets[2]
  await check('word editor keeps draft and stays expanded while typing outside proximity zone', async () => {
    await approach(word)
    await word.page.click('.ws-bank-toggle')
    await word.page.send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await word.page.evaluate(`(() => {const e=document.querySelector('.ws-bank-search');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'draft-kept');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await far(word); await pause(1200)
    assert.equal(await compact(word),false,'typing prevents collapse')
    await word.page.evaluate('document.activeElement.blur()')
    await pause(1200)
    assert.equal(await compact(word),true)
    await approach(word)
    assert.equal(await word.page.evaluate("document.querySelector('.ws-bank-search').value"),'draft-kept')
    await word.page.click('.ws-editor-back')
    await word.page.evaluate('document.activeElement.blur()')
    await word.page.send('Emulation.setFocusEmulationEnabled',{enabled:false})
  })
  await check('keyboard focus opens capsule and transfers to visible pin without losing focus', async () => {
    await far(word); await pause(1200)
    await word.page.send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await word.page.evaluate("document.querySelector('.ws-mini [data-island-pin]').focus()")
    await word.page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
    await pause(250)
    assert.equal(await compact(word),false)
    assert.equal(await word.page.evaluate("document.activeElement.matches('[data-island-pin]')&&document.activeElement.getClientRects().length>0"),true)
    await far(word); await pause(1200)
    assert.equal(await compact(word),false,'keyboard focus holds expansion')
    await word.page.evaluate('document.activeElement.blur()')
    await word.page.send('Emulation.setFocusEmulationEnabled',{enabled:false})
  })
  await check('settings expose auto expansion and persistent pins; renderer reload preserves pin', async () => {
    await dock.evaluate('window.nexus.window.openSettings()')
    const page=await connect('settings'); await pause(250)
    await page.evaluate("document.querySelectorAll('.nx-acc-head')[1].click()")
    await pause(100)
    assert.equal(await page.evaluate("document.body.textContent.includes('灵动岛：靠近时展开')&&document.body.textContent.includes('保持展开')"),true)
    await patch({music:{collapsed:false}})
    assert.equal(await page.evaluate("document.body.textContent.includes('动态折叠：未启用')"),true)
    await patch({music:{collapsed:true}})
    await page.evaluate("[...document.querySelectorAll('.ui-row')].find(r=>r.textContent.includes('保持展开')).querySelector('[role=switch]').click()")
    await pause(400)
    assert.equal((await config()).music.pinned,true)
    assert.equal(await page.evaluate("document.body.textContent.includes('动态折叠：已固定展开')"),true)
    await widgets[0].page.send('Page.reload'); await pause(600)
    assert.equal(await compact(widgets[0]),false)
    await pause(700)
    const disk=JSON.parse(readFileSync(join(profile,'settings.json'),'utf8'))
    assert.equal(disk.music.collapsed,true)
    assert.equal(disk.music.pinned,true)
    await page.evaluate("[...document.querySelectorAll('.ui-row')].find(r=>r.textContent.includes('保持展开')).scrollIntoView({block:'center'})")
    await page.screenshot('settings.png')
  })
  await check('reduced motion disables content Web Animations during proximity expansion', async () => {
    const w=widgets[0]
    await far(w)
    await patch({appearance:{reducedMotion:true}})
    await setMode(w,true,false)
    await pause(1100)
    const b=await bounds(w.kind)
    await cursor({x:b.x-16,y:b.y+b.height/2})
    for(let n=0;n<30 && await compact(w);n++) await pause(20)
    assert.equal(await compact(w),false)
    assert.equal(await w.page.evaluate("document.querySelector('.music-card').getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().duration===180).length"),0)
    await patch({appearance:{reducedMotion:false}})
  })
  await check('disabled/hidden/pinned widgets stop native cursor probing; Dock unaffected', async () => {
    for(const w of widgets) await setMode(w,true,true)
    await pause(250)
    const calls=await main.evaluate('__islandTest.calls')
    await pause(450)
    assert.equal(await main.evaluate('__islandTest.calls'),calls,'all pinned means no polling')
    for(const w of widgets) await setMode(w,false,false)
    await pause(250)
    for(const w of widgets) assert.equal(await compact(w),false,'mode disabled is fully expanded')
    const disabled=await main.evaluate('__islandTest.calls'); await pause(450)
    assert.equal(await main.evaluate('__islandTest.calls'),disabled)
    await patch({music:{collapsed:true,visible:false},clock:{collapsed:true,visible:false}})
    await patchWord({collapsed:true,visible:false})
    await pause(250)
    const hidden=await main.evaluate('__islandTest.calls'); await pause(450)
    assert.equal(await main.evaluate('__islandTest.calls'),hidden,'hidden widgets mean no polling')
    assert.deepEqual(errors,[])
  })
} catch (e) { errors.push(String(e)); console.error(e); process.exitCode=1 }
finally {
  if(main) await main.evaluate(`if(globalThis.__islandTest){__islandTest.electron.screen.getCursorScreenPoint=__islandTest.original;delete globalThis.__islandTest}`).catch(()=>{})
  writeFileSync(join(output,'report.json'),JSON.stringify({at:new Date().toISOString(),executable,scope:'real Electron + IPC + BrowserWindow bounds; synthetic cursor via isolated loopback main inspector; OS pointer untouched',results,errors},null,2))
  for(const socket of sockets) socket.close()
  if(child.pid) child.kill()
  if(results.some(r=>!r.pass)||errors.length)process.exitCode=1
}
