// 通过 Chrome DevTools Protocol 对运行中的应用做自动化验收
// 用法：node scripts/cdp-verify.mjs [--port 9224] [--out docs/verification]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1] || 9224) || 9224
const outDir = resolve(args[args.indexOf('--out') + 1] || 'docs/verification')
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  return res.json()
}

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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
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
  const targets = await listTargets()
  const target = targets.find((t) => t.type === 'page' && t.url.includes(match))
  if (!target) throw new Error(`未找到窗口: ${match}（当前: ${targets.map((t) => t.url).join(', ')}）`)
  return new Cdp(target.webSocketDebuggerUrl).connect()
}

const report = {}
try {
  /* ---------------- Dock ---------------- */
  const dock = await openTarget('/dock/')
  await dock.send('Page.enable')
  report.dock = await dock.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const bar = document.querySelector('.dock-bar')
    const grip = document.querySelector('.dock-grip')
    const imgs = items.map((el) => {
      const img = el.querySelector('img.dock-icon-img')
      return { src: img ? img.getAttribute('src') : null, natural: img ? img.naturalWidth : 0, complete: img ? img.complete : false }
    })
    return {
      edge: document.querySelector('.dock-root')?.dataset.edge,
      theme: document.querySelector('.dock-root')?.dataset.theme,
      itemCount: items.length,
      images: imgs,
      barRect: bar ? bar.getBoundingClientRect().toJSON() : null,
      gripWidth: grip ? grip.getBoundingClientRect().width : 0,
      bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight },
      bg: getComputedStyle(bar).backgroundImage !== 'none' ? 'gradient' : getComputedStyle(bar).backgroundColor
    }
  })()`)

  // 悬停放大：给第 3 个图标派发 mouseenter，读取各图标 transform 矩阵
  report.hover = await dock.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const target = items[2]
    if (!target) return null
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    const inner = target.firstElementChild
    const transforms = items.map((el) => {
      const box = el.firstElementChild
      return box ? getComputedStyle(box).transform : null
    })
    return { hoveredTransform: inner ? getComputedStyle(inner).transform : null, transforms }
  })()`)

  const dockShot = await dock.screenshot('dock-default.png')

  // 切换到左侧停靠，验证方向与位置
  await dock.evaluate(`window.nexus.settings.update({ dock: { edge: 'left', alongPercent: 30 } })`)
  await sleep(1400)
  report.dockLeft = await dock.evaluate(`(() => {
    const bar = document.querySelector('.dock-bar')
    const items = [...document.querySelectorAll('.dock-item')]
    return {
      edge: document.querySelector('.dock-root')?.dataset.edge,
      bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight },
      barRect: bar ? bar.getBoundingClientRect().toJSON() : null,
      firstItem: items[0] ? items[0].getBoundingClientRect().toJSON() : null
    }
  })()`)
  const dockLeftShot = await dock.screenshot('dock-left.png')

  // 顶部停靠
  await dock.evaluate(`window.nexus.settings.update({ dock: { edge: 'top', alongPercent: 50 } })`)
  await sleep(1200)
  const dockTopShot = await dock.screenshot('dock-top.png')
  report.dockTop = await dock.evaluate(`document.querySelector('.dock-root')?.dataset.edge`)

  // 恢复默认底部
  await dock.evaluate(`window.nexus.settings.update({ dock: { edge: 'bottom', alongPercent: 50 } })`)
  await sleep(1200)

  /* ---------------- 音乐卡片 ---------------- */
  const music = await openTarget('/music/')
  await music.send('Page.enable')
  report.music = await music.evaluate(`(() => {
    const card = document.querySelector('[class*="music"]')
    const text = document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220)
    return {
      hasCard: !!card,
      text,
      width: card ? card.getBoundingClientRect().width : null,
      bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight }
    }
  })()`)
  const musicShot = await music.screenshot('music-empty.png')

  /* ---------------- 设置窗口 ---------------- */
  await dock.evaluate(`window.nexus.window.openSettings()`)
  await sleep(1800)
  const settings = await openTarget('/settings/')
  await settings.send('Page.enable')
  report.settings = await settings.evaluate(`(() => {
    const nav = [...document.querySelectorAll('[class*="nav"] button, [class*="nav-item"]')].map((b) => b.textContent?.trim())
    return {
      title: document.title,
      navItems: nav.slice(0, 8),
      text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 260),
      bodySize: { w: document.body.scrollWidth, h: document.body.scrollHeight }
    }
  })()`)
  const settingsShot = await settings.screenshot('settings-dock.png')

  report.files = { dockShot, dockLeftShot, dockTopShot, musicShot, settingsShot }
} catch (error) {
  report.error = error && (error.stack || String(error))
} finally {
  writeFileSync(join(outDir, 'cdp-report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
}
