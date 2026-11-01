// Nexus Dock v1.0 精细化动效验收脚本（CDP 驱动，逐条 AC 采集证据）
// 前置：应用以 `npm run dev` 或安装版 + `--remote-debugging-port=9224` 启动
// 用法：node scripts/v1-motion-verify.mjs [--port 9224] [--out docs/verification/v1]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const port = Number(argv[argv.indexOf('--port') + 1] || 9224) || 9224
const outDir = resolve(argv[argv.indexOf('--out') + 1] || 'docs/verification/v1')
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { startedAt: new Date().toISOString(), port, checks: {} }

/* ---------------------------------- CDP ---------------------------------- */

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.id = 0
    this.pending = new Map()
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', resolvePromise)
      this.ws.addEventListener('error', reject)
    })
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
    return this
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
    }
    return result.result.value
  }
  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const file = join(outDir, name)
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

async function openTarget(match) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const target = targets.find((t) => t.type === 'page' && t.url.includes(match))
  if (!target) throw new Error(`未找到窗口 ${match}；当前：${targets.map((t) => t.url).join(', ')}`)
  const cdp = await new Cdp(target.webSocketDebuggerUrl).connect()
  await cdp.send('Page.enable')
  return cdp
}

/** 逐段执行，失败只记录不中断后续（先占位挂到 report 上，便于步骤内追加截图等证据） */
async function step(name, fn) {
  const entry = { ok: true, data: undefined }
  report.checks[name] = entry
  try {
    entry.data = await fn()
    console.log(`[ok] ${name}`)
  } catch (error) {
    entry.ok = false
    entry.error = String(error && (error.stack || error))
    console.log(`[fail] ${name}: ${error && (error.message || error)}`)
  }
}

let dock = null
let music = null
let settings = null
/** 验收前用户的真实 apps 列表；为拿到有区分度的截图会临时补夹具，结束后必须原样恢复 */
let originalApps = null

/** 夹具：补齐到 6 个图标，让悬停衰减 / FLIP / 弹跳有足够样本；结束后恢复用户原列表 */
const FIXTURE_APPS = [
  {
    id: 'notepad',
    name: '记事本',
    path: 'C:\\Windows\\System32\\notepad.exe',
    aumid: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App',
    source: 'builtin'
  },
  {
    id: 'calc',
    name: '计算器',
    path: 'C:\\Windows\\System32\\calc.exe',
    aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
    source: 'builtin'
  },
  {
    id: 'paint',
    name: '画图',
    path: 'C:\\Windows\\System32\\mspaint.exe',
    aumid: 'Microsoft.Paint_8wekyb3d8bbwe!App',
    source: 'builtin'
  },
  {
    id: 'cmd',
    name: '命令提示符',
    path: 'C:\\Windows\\System32\\cmd.exe',
    aumid: '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe',
    source: 'builtin'
  }
]

try {
  /* ============================== Dock ============================== */
  dock = await openTarget('/dock/')

  await step('dock.environment', async () => {
    return dock.evaluate(`(() => ({
      dataMotion: document.documentElement.dataset.motion,
      dataReducedMotion: document.documentElement.dataset.reducedMotion,
      dataClickSound: document.documentElement.dataset.clickSound,
      itemCount: document.querySelectorAll('.dock-item').length,
      hasDockId: [...document.querySelectorAll('.dock-item')].every((el) => !!el.dataset.dockId),
      innerCount: document.querySelectorAll('.dock-item-inner').length,
      iconCount: document.querySelectorAll('.dock-item-icon').length
    }))()`)
  })

  // 用户可能删减过 Dock 图标（本机只有 2 个）：临时补到 6 个，保证悬停衰减 / FLIP / 弹跳有足够样本，
  // 结束时在 finally 中把 originalApps 原样写回，不改变用户配置
  await step('dock.fixtureApps', async () => {
    const current = await dock.evaluate(`window.nexus.settings.get().then((s) => s.apps)`)
    if (current.length >= 6) return { skipped: true, count: current.length }
    originalApps = current
    const usedIds = new Set(current.map((a) => a.id))
    const fixtures = [...current, ...FIXTURE_APPS.filter((a) => !usedIds.has(a.id))].slice(0, 6)
    await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify(fixtures)} })`)
    await sleep(900)
    const after = await dock.evaluate(`window.nexus.settings.get().then((s) => s.apps.map((a) => a.id))`)
    return { skipped: false, originalCount: current.length, fixtureIds: after }
  })

  // AC-10.2 / AC-9.1：三档强度切换 → data 属性 + 令牌 + 实际 transition duration 变化
  await step('dock.motionIntensity', async () => {
    const read = `(() => {
      const root = document.documentElement
      const inner = document.querySelector('.dock-item-inner')
      const dockRoot = document.querySelector('.dock-root')
      return {
        motion: root.dataset.motion,
        scale: getComputedStyle(root).getPropertyValue('--nx-motion-scale').trim(),
        durBase: getComputedStyle(root).getPropertyValue('--nx-dur-base').trim(),
        spring: getComputedStyle(root).getPropertyValue('--nx-spring').trim(),
        innerTransitionDuration: inner ? getComputedStyle(inner).transitionDuration : null,
        innerTransitionTiming: inner ? getComputedStyle(inner).transitionTimingFunction : null,
        hop: dockRoot ? getComputedStyle(dockRoot).getPropertyValue('--nx-hop').trim() : null
      }
    })()`
    const result = {}
    for (const intensity of ['light', 'standard', 'expressive']) {
      await dock.evaluate(`window.nexus.settings.update({ appearance: { motionIntensity: '${intensity}' } })`)
      await sleep(420)
      result[intensity] = await dock.evaluate(read)
    }
    return result
  })

  // 后续按压/悬停/弹跳证据统一在「标准」档采集（默认档，最有代表性）
  await dock.evaluate(`window.nexus.settings.update({ appearance: { motionIntensity: 'standard' } })`)
  await sleep(450)

  // AC-9.2 / AC-9.3：pointerdown 后 70ms 读取按压 transform 与涟漪图层
  await step('dock.pressAndRipple', async () => {
    const pressed = await dock.evaluate(`(async () => {
      const all = document.querySelectorAll('.dock-item')
      const item = all[Math.min(2, all.length - 1)]
      if (!item) return { error: 'no item' }
      const rect = item.getBoundingClientRect()
      const opts = {
        bubbles: true, cancelable: true, composed: true, pointerId: 71, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: 1,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
      }
      item.dispatchEvent(new PointerEvent('pointerdown', opts))
      await new Promise((r) => setTimeout(r, 70))
      const inner = item.querySelector('.dock-item-inner')
      const ripple = item.querySelector('.nx-ripple')
      const out = {
        pressed: item.dataset.pressed,
        rippleCount: item.querySelectorAll('.nx-ripple').length,
        rippleAnimation: ripple ? getComputedStyle(ripple).animationName : null,
        rippleDuration: ripple ? getComputedStyle(ripple).animationDuration : null,
        rippleHostClass: item.className,
        innerTransform: inner ? getComputedStyle(inner).transform : null
      }
      item.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
      return out
    })()`)
    report.checks['dock.pressAndRipple'].screenshot = await dock.screenshot('dock-press.png')
    return pressed
  })

  // AC-9.5：hover 放大（含过冲）+ 强调色柔光
  await step('dock.hoverGlow', async () => {
    const hovered = await dock.evaluate(`(async () => {
      const items = [...document.querySelectorAll('.dock-item')]
      const target = items[Math.min(2, items.length - 1)]
      if (!target) return { error: 'no item' }
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true, pointerId: 72, pointerType: 'mouse', isPrimary: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
      }))
      await new Promise((r) => setTimeout(r, 120))
      const inner = target.querySelector('.dock-item-inner')
      const icon = target.querySelector('.dock-item-icon')
      const transforms = items.map((el) => {
        const innerEl = el.querySelector('.dock-item-inner')
        return innerEl ? getComputedStyle(innerEl).transform : null
      })
      const out = {
        centerScale: inner ? getComputedStyle(inner).transform : null,
        iconFilter: icon ? getComputedStyle(icon).filter : null,
        transforms
      }
      target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerId: 72, pointerType: 'mouse' }))
      return out
    })()`)
    report.checks['dock.hoverGlow'].screenshot = await dock.screenshot('dock-hover.png')
    return hovered
  })

  // AC-9.6：运行指示点呼吸（本机进程可见性受限，无法点亮真实运行点；临时挂 is-running 读动画参数）
  await step('dock.indicatorBreath', async () => {
    return dock.evaluate(`(() => {
      const indicator = document.querySelector('.dock-indicator')
      if (!indicator) return { error: 'no indicator element' }
      indicator.classList.add('is-running')
      const cs = getComputedStyle(indicator)
      const out = {
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        iterationCount: cs.animationIterationCount,
        boxShadow: cs.boxShadow.slice(0, 90)
      }
      indicator.classList.remove('is-running')
      return out
    })()`)
  })

  // AC-9.4：点击 → 乐观启动弹跳（真实点击由合成 click 触发 React 链路）
  await step('dock.launchBounce', async () => {
    const bounce = await dock.evaluate(`(async () => {
      const all = document.querySelectorAll('.dock-item')
      const item = all[Math.min(2, all.length - 1)]
      if (!item) return { error: 'no item' }
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 90))
      const icon = item.querySelector('.dock-item-icon')
      return {
        launchingClass: icon ? icon.className : '',
        animation: icon ? getComputedStyle(icon).animationName + ' ' + getComputedStyle(icon).animationDuration : null,
        name: item.getAttribute('aria-label')
      }
    })()`)
    report.checks['dock.launchBounce'].screenshot = await dock.screenshot('dock-launch-bounce.png')
    return bounce
  })

  // AC-9.8：Toast 进出动画 —— 临时加入一个不存在的应用，点击触发启动失败
  await step('dock.errorToast', async () => {
    const bad = {
      id: 'fixture-missing',
      name: '__验收用不存在的应用__',
      path: 'C:\\__nexus_missing_app__.exe',
      source: 'custom'
    }
    await dock.evaluate(`(async () => {
      const s = await window.nexus.settings.get()
      await window.nexus.settings.update({ apps: [...s.apps, ${JSON.stringify(bad)}] })
      return true
    })()`)
    await sleep(800)
    const clicked = await dock.evaluate(`(() => {
      const item = [...document.querySelectorAll('.dock-item')].find(
        (el) => el.getAttribute('aria-label') === '__验收用不存在的应用__'
      )
      if (!item) return { error: 'fixture item not found' }
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return { clicked: true }
    })()`)
    // 失败链路要依次尝试 COM→openPath→ShellExecute 回退，坏路径约 43s 才返回失败；
    // Toast 出现后停留 2s，因此先轮询 60s，再单独轮询退场态
    let appeared = null
    for (let i = 0; i < 150; i += 1) {
      await sleep(400)
      appeared = await dock.evaluate(`(() => {
        const el = document.querySelector('.dock-toast')
        if (!el) return null
        return {
          text: el.textContent.trim().slice(0, 140),
          animation: getComputedStyle(el).animationName + ' ' + getComputedStyle(el).animationDuration,
          leaving: el.classList.contains('is-leaving')
        }
      })()`)
      if (appeared) break
    }
    if (appeared) {
      report.checks['dock.errorToast'].screenshot = await dock.screenshot('dock-toast-in.png')
      // 等 2s 停留期结束，轮询 is-leaving（退出动画仅 160ms）
      let leaving = null
      for (let i = 0; i < 30; i += 1) {
        await sleep(80)
        leaving = await dock.evaluate(`(() => {
          const el = document.querySelector('.dock-toast')
          if (!el) return { present: false }
          return {
            present: true,
            leaving: el.classList.contains('is-leaving'),
            animation: getComputedStyle(el).animationName + ' ' + getComputedStyle(el).animationDuration,
            opacity: getComputedStyle(el).opacity
          }
        })()`)
        if (leaving?.leaving) break
      }
      report.checks['dock.errorToast'].leavingScreenshot = await dock.screenshot('dock-toast-out.png')
      await dock.evaluate(`(async () => {
        const s = await window.nexus.settings.get()
        await window.nexus.settings.update({ apps: s.apps.filter((a) => a.id !== 'fixture-missing') })
      })()`)
      return { clicked, appeared, leaving }
    }
    await dock.evaluate(`(async () => {
      const s = await window.nexus.settings.get()
      await window.nexus.settings.update({ apps: s.apps.filter((a) => a.id !== 'fixture-missing') })
    })()`)
    return { clicked, appeared: null }
  })

  // AC-9.7：拖拽排序 FLIP（合成指针拖动，结束后由 finally 恢复用户列表）
  await step('dock.flipReorder', async () => {
    return dock.evaluate(`(async () => {
      const items = [...document.querySelectorAll('.dock-item')]
      if (items.length < 2) return { error: 'items < 2' }
      const a = items[0]
      const b = items[items.length - 1]
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const startX = ra.left + ra.width / 2
      const startY = ra.top + ra.height / 2
      const endX = rb.left + rb.width / 2
      const endY = rb.top + rb.height / 2
      const container = document.querySelector('.dock-items')
      a.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 73, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
        clientX: startX, clientY: startY
      }))
      container.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 73, clientX: startX + 24, clientY: startY, buttons: 1
      }))
      await new Promise((r) => setTimeout(r, 24))
      container.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 73, clientX: endX, clientY: endY, buttons: 1
      }))
      await new Promise((r) => setTimeout(r, 40))
      const mid = [...document.querySelectorAll('.dock-item')].map((el) => ({
        id: el.dataset.dockId,
        transform: getComputedStyle(el).transform
      }))
      container.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 73, clientX: endX, clientY: endY
      }))
      await new Promise((r) => setTimeout(r, 500))
      const orderAfter = (await window.nexus.settings.get()).apps.map((app) => app.id)
      return { mid, orderAfter, nonIdentity: mid.filter((m) => m.transform && m.transform !== 'none').length }
    })()`)
  })

  // AC-9.11：减少动效 → 时长收敛到 0.01ms
  await step('dock.reducedMotion', async () => {
    await dock.evaluate(`window.nexus.settings.update({ appearance: { reducedMotion: true } })`)
    await sleep(420)
    const reduced = await dock.evaluate(`(() => {
      const root = document.documentElement
      const inner = document.querySelector('.dock-item-inner')
      const indicator = document.querySelector('.dock-indicator')
      let indicatorAnimationDuration = null
      if (indicator) {
        indicator.classList.add('is-running')
        indicatorAnimationDuration = getComputedStyle(indicator).animationDuration
        indicator.classList.remove('is-running')
      }
      return {
        dataReducedMotion: root.dataset.reducedMotion,
        innerTransitionDuration: inner ? getComputedStyle(inner).transitionDuration : null,
        indicatorAnimationDuration,
        mediaReduced: matchMedia('(prefers-reduced-motion: reduce)').matches
      }
    })()`)
    await dock.evaluate(`window.nexus.settings.update({ appearance: { reducedMotion: false } })`)
    await sleep(300)
    return reduced
  })

  await dock.evaluate(
    `window.nexus.settings.update({ appearance: { motionIntensity: 'standard', reducedMotion: false, clickSound: false } })`
  )
  await sleep(500)

  /* ============================ 音乐卡片 ============================ */
  music = await openTarget('/music/')

  await step('music.environment', async () => {
    return music.evaluate(`(() => {
      const root = document.documentElement
      return {
        dataMotion: root.dataset.motion,
        dataReducedMotion: root.dataset.reducedMotion,
        dataClickSound: root.dataset.clickSound,
        controlCount: document.querySelectorAll('.music-ctrl').length,
        rippleHosts: document.querySelectorAll('.nx-ripple-host').length,
        playIconLayers: document.querySelectorAll('.music-play-icon .music-play-layer').length,
        playIconSvgs: document.querySelectorAll('.music-play-icon svg').length,
        progressStyle: document.querySelector('.music-ring') ? 'ring' : 'bar'
      }
    })()`)
  })

  // 用 CDP 真实鼠标按下，才能同时触发 CSS :active 与 pointerdown 涟漪
  await step('music.pressAndRipple', async () => {
    const rect = await music.evaluate(`(() => {
      const btn = document.querySelector('.music-badge') || document.querySelector('.music-ctrl')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, className: btn.className }
    })()`)
    if (!rect) return { error: 'no button' }
    await music.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await sleep(90)
    const pressed = await music.evaluate(`(() => {
      const btn = document.querySelector('.music-badge') || document.querySelector('.music-ctrl')
      const ripple = document.querySelector('.nx-ripple')
      return {
        rippleCount: document.querySelectorAll('.nx-ripple').length,
        rippleAnimation: ripple ? getComputedStyle(ripple).animationName : null,
        buttonTransform: btn ? getComputedStyle(btn).transform : null,
        buttonTransition: btn ? getComputedStyle(btn).transitionDuration : null,
        active: btn ? btn.matches(':active') : null
      }
    })()`)
    report.checks['music.pressAndRipple'].screenshot = await music.screenshot('music-press.png')
    await music.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    // 徽标按钮会切换系统/本地来源：finally 恢复为系统来源
    return { target: rect.className, ...pressed }
  })

  /* ============================ 设置面板 ============================ */
  await dock.evaluate(`window.nexus.window.openSettings()`)
  await sleep(1600)
  settings = await openTarget('/settings/')

  await step('settings.appearancePage', async () => {
    const before = await settings.evaluate(`window.nexus.settings.get().then((s) => s.appearance)`)
    const opened = await settings.evaluate(`(async () => {
      const nav = [...document.querySelectorAll('.settings-nav-item')]
      const appearanceNav = nav.find((el) => (el.textContent || '').includes('外观'))
      if (!appearanceNav) return { error: '未找到外观导航项', nav: nav.map((n) => n.textContent.trim()) }
      appearanceNav.click()
      await new Promise((r) => setTimeout(r, 320))
      return {
        navLabels: nav.map((n) => n.textContent.trim()),
        pageVisible: !!document.querySelector('.settings-page'),
        segmentedOptions: [...document.querySelectorAll('.ui-seg')].map((s) => s.textContent.trim()),
        hasPreviewTile: !!document.querySelector('.nx-motion-preview'),
        switches: [...document.querySelectorAll('.ui-row-label')].map((s) => s.textContent.trim()).slice(0, 12)
      }
    })()`)
    report.checks['settings.appearancePage'].screenshot = await settings.screenshot('settings-appearance.png')
    return { before, opened }
  })

  await step('settings.motionSwitch', async () => {
    const light = await settings.evaluate(`(async () => {
      const seg = [...document.querySelectorAll('.ui-seg')].find((el) => (el.textContent || '').includes('轻快'))
      if (seg) seg.click()
      await new Promise((r) => setTimeout(r, 380))
      return {
        dataMotion: document.documentElement.dataset.motion,
        setting: await window.nexus.settings.get().then((s) => s.appearance.motionIntensity),
        scale: getComputedStyle(document.documentElement).getPropertyValue('--nx-motion-scale').trim()
      }
    })()`)
    const expressive = await settings.evaluate(`(async () => {
      const seg = [...document.querySelectorAll('.ui-seg')].find((el) => (el.textContent || '').includes('弹性'))
      if (seg) seg.click()
      await new Promise((r) => setTimeout(r, 380))
      return {
        dataMotion: document.documentElement.dataset.motion,
        setting: await window.nexus.settings.get().then((s) => s.appearance.motionIntensity),
        scale: getComputedStyle(document.documentElement).getPropertyValue('--nx-motion-scale').trim()
      }
    })()`)
    report.checks['settings.motionSwitch'].screenshot = await settings.screenshot('settings-motion-expressive.png')
    return { light, expressive }
  })

  await step('settings.accessibilitySwitches', async () => {
    const result = await settings.evaluate(`(async () => {
      const findSwitch = (keyword) => {
        const row = [...document.querySelectorAll('.ui-row')].find((el) => (el.textContent || '').includes(keyword))
        return row ? row.querySelector('.ui-switch') : null
      }
      const reduced = findSwitch('减少动效')
      const sound = findSwitch('点击音效')
      const out = { foundReduced: !!reduced, foundSound: !!sound }
      if (reduced) reduced.click()
      await new Promise((r) => setTimeout(r, 420))
      out.reduced = {
        dataset: document.documentElement.dataset.reducedMotion,
        setting: await window.nexus.settings.get().then((s) => s.appearance.reducedMotion),
        innerDuration: (() => {
          const el = document.querySelector('.ui-switch')
          return el ? getComputedStyle(el).transitionDuration : null
        })()
      }
      if (reduced) reduced.click()
      if (sound) sound.click()
      await new Promise((r) => setTimeout(r, 380))
      out.sound = {
        dataset: document.documentElement.dataset.clickSound,
        setting: await window.nexus.settings.get().then((s) => s.appearance.clickSound)
      }
      if (sound) sound.click()
      const standard = [...document.querySelectorAll('.ui-seg')].find((el) => (el.textContent || '').includes('标准'))
      if (standard) standard.click()
      await new Promise((r) => setTimeout(r, 380))
      return out
    })()`)
    report.checks['settings.accessibilitySwitches'].screenshot = await settings.screenshot('settings-accessibility.png')
    return result
  })

  await step('settings.persisted', async () => {
    return settings.evaluate(`(async () => {
      const s = await window.nexus.settings.get()
      return {
        appearance: s.appearance,
        schemaVersion: s.schemaVersion,
        dataset: {
          motion: document.documentElement.dataset.motion,
          reduced: document.documentElement.dataset.reducedMotion,
          sound: document.documentElement.dataset.clickSound
        }
      }
    })()`)
  })

  // AC-9.10：恢复默认弹层进出动画（入场 nx-pop-in / nx-fade-in，退场 nx-pop-out / nx-fade-out）
  await step('settings.resetPopover', async () => {
    const opened = await settings.evaluate(`(async () => {
      const link = document.querySelector('.settings-reset-link')
      if (!link) return { error: 'no reset link' }
      link.click()
      await new Promise((r) => setTimeout(r, 260))
      const pop = document.querySelector('.nx-foot-confirm')
      const back = document.querySelector('.nx-popover-backdrop')
      return {
        popover: !!pop,
        inAnimation: pop ? getComputedStyle(pop).animationName : null,
        backdropIn: back ? getComputedStyle(back).animationName : null
      }
    })()`)
    const closing = await settings.evaluate(`(async () => {
      const cancel = [...document.querySelectorAll('.nx-foot-confirm .ui-btn')].find(
        (b) => (b.textContent || '').includes('取消')
      )
      if (!cancel) return { error: 'no cancel button' }
      cancel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
      const pop = document.querySelector('.nx-foot-confirm')
      return {
        present: !!pop,
        leaving: pop ? pop.classList.contains('is-leaving') : null,
        animation: pop ? getComputedStyle(pop).animationName : null
      }
    })()`)
    await sleep(220)
    const gone = await settings.evaluate(`!document.querySelector('.nx-foot-confirm')`)
    return { opened, closing, gone }
  })
} catch (error) {
  report.error = String(error && (error.stack || error))
} finally {
  // 还原现场：外观默认档、音乐来源、用户真实 Dock 图标列表（夹具只用于验收截图）
  if (dock) {
    try {
      await dock.evaluate(
        `window.nexus.settings.update({
          appearance: { motionIntensity: 'standard', reducedMotion: false, clickSound: false },
          music: { source: 'system' }
        })`
      )
      if (originalApps) {
        await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify(originalApps)} })`)
      }
      await sleep(500)
      report.restored = await dock.evaluate(
        `window.nexus.settings.get().then((s) => ({
          apps: s.apps.map((a) => a.id),
          appearance: s.appearance,
          musicSource: s.music.source,
          schemaVersion: s.schemaVersion
        }))`
      )
    } catch (restoreError) {
      report.restoreError = String(restoreError && (restoreError.stack || restoreError))
    }
  }
  for (const cdp of [dock, music, settings]) {
    if (cdp) cdp.close()
  }
  report.finishedAt = new Date().toISOString()
  const file = join(outDir, 'motion-report.json')
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nREPORT=${file}`)
}
