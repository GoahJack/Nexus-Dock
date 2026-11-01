// v1.4 轻量化验收（CDP）：时钟 DOM 契约 + 时间正确性 + 音乐卡片启停 SMTC 桥 + 设置页可开
// 前置：安装版已用 --remote-debugging-port=9224 启动
// 用法：node scripts/v14-verify.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9224)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.4')
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = []
const addCheck = (id, pass, detail) => {
  checks.push({ id, pass: pass === true, detail })
  console.log(`${pass === true ? 'PASS' : 'FAIL'}  ${id}  ${JSON.stringify(detail).slice(0, 300)}`)
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
}

/** 连接某个页面 target，返回 evaluate(expr) 与 close() */
async function connect(match) {
  const list = await targets()
  const target = list.find((item) => item.type === 'page' && item.url.includes(match))
  if (!target) throw new Error(`target not found: ${match}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (response.error) throw new Error(JSON.stringify(response.error))
    const result = response.result
    if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300))
    return result?.result?.value
  }
  return { evaluate, close: () => ws.close() }
}

/** 等条件成立（轮询） */
async function waitFor(fn, timeoutMs = 8000, interval = 250) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  return last
}

const probes = {
  /** 用 Windows PowerShell 数桥进程（desktop-state.exe / smtc-bridge powershell） */
  async bridgeCounts() {
    const { spawnSync } = await import('node:child_process')
    const script =
      "$ds=@(Get-Process desktop-state -ErrorAction SilentlyContinue).Count; " +
      "$ps=@(Get-Process powershell -ErrorAction SilentlyContinue).Count; " +
      "Write-Output \"$ds|$ps\""
    const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).stdout.trim()
    const [ds, ps] = out.split('|').map((n) => Number(n))
    return { desktopState: ds, powershell: ps }
  }
}

const clock = await connect('/clock/')
const dock = await connect('/dock/')

/* ------------------------------ 1. 时钟 DOM 契约 ------------------------------ */
const clockDom = await clock.evaluate(`(() => {
  const root = document.querySelector('#root > *')
  const text = (sel) => document.querySelector(sel)?.textContent ?? null
  return {
    hasRoot: !!root,
    className: root?.className ?? '',
    theme: root?.dataset.theme ?? null,
    locked: root?.getAttribute('data-locked') ?? null,
    title: root?.getAttribute('title') ?? null,
    aria: root?.getAttribute('aria-label') ?? null,
    time: text('.clock-time'),
    date: text('.clock-date'),
    hasLockIcon: !!document.querySelector('.clock-lock'),
    usesReact: typeof window.React !== 'undefined' || !!document.querySelector('[data-reactroot]')
  }
})()`)
addCheck('clock-root-exists', clockDom.hasRoot === true, clockDom)
addCheck('clock-data-theme', ['dark', 'light'].includes(clockDom.theme), clockDom.theme)
addCheck('clock-locked-attr', clockDom.locked === 'true', clockDom.locked)
addCheck('clock-lock-hint', /位置已锁定/.test(String(clockDom.title)) && /解锁/.test(String(clockDom.aria)), {
  title: clockDom.title,
  aria: clockDom.aria
})
addCheck('clock-time-format', /^\d{2}:\d{2}$/.test(String(clockDom.time)), clockDom.time)
addCheck('clock-date-format', /月.*日/.test(String(clockDom.date)), clockDom.date)
addCheck('clock-lock-icon', clockDom.hasLockIcon === true, clockDom.hasLockIcon)

/** 时间正确性：DOM 文本与系统时间差 ≤ 90 秒（不显示秒时按分钟粒度） */
const sysNow = await clock.evaluate('new Date().toISOString()')
const sysDate = new Date(sysNow)
const domClock = new Date(sysDate)
const [hh, mm] = String(clockDom.time).split(':').map(Number)
domClock.setHours(hh, mm, 0, 0)
const driftSec = Math.abs(sysDate.getTime() - domClock.getTime()) / 1000
addCheck('clock-time-accurate', driftSec <= 90, { dom: clockDom.time, system: sysDate.toTimeString().slice(0, 5), driftSec })

/* ------------------- 1b. 时钟在可见状态下的走时（验证未被节流卡死） ------------------- */
await dock.evaluate(`window.nexus.settings.update({ clock: { showSeconds: true } })`)
await sleep(1200)
const tick1 = await clock.evaluate(`document.querySelector('.clock-time')?.textContent ?? ''`)
await sleep(2200)
const tick2 = await clock.evaluate(`document.querySelector('.clock-time')?.textContent ?? ''`)
addCheck('clock-ticks-live', tick1 !== tick2 && /^\d{2}:\d{2}:\d{2}$/.test(String(tick2)), { tick1, tick2 })
await dock.evaluate(`window.nexus.settings.update({ clock: { showSeconds: false } })`)

/* --------------------------- 2. Dock DOM 与设置接口 --------------------------- */const dockInfo = await dock.evaluate(`(() => ({
  hasNexus: typeof window.nexus === 'object',
  items: document.querySelectorAll('[data-app-id]').length || document.querySelectorAll('.dock-item').length,
  locked: document.querySelector('#root > *')?.getAttribute('data-locked') ?? null
}))()`)
addCheck('dock-api-available', dockInfo.hasNexus === true, dockInfo)
addCheck('dock-items-rendered', dockInfo.items >= 5, { items: dockInfo.items })

/* ----------------------- 3. 音乐卡片开关 → SMTC 桥启停 ----------------------- */
const before = await probes.bridgeCounts()
const enabled = await dock.evaluate(
  `window.nexus.settings.update({ music: { visible: true, source: 'system' } }).then((s) => s.music.visible)`
)
// 桥启停有 500ms 去抖，再留出 powershell 启动时间
const bridgeUp = await waitFor(async () => {
  const counts = await probes.bridgeCounts()
  return counts.powershell > before.powershell ? counts : null
}, 12000)
addCheck('music-enabled-spawns-smtc-bridge', bridgeUp !== null && bridgeUp.powershell > before.powershell, {
  before,
  after: bridgeUp
})

// 音乐卡片窗口应已被创建并显示
const musicTarget = await waitFor(async () => {
  const list = await targets()
  return list.find((item) => item.type === 'page' && item.url.includes('/music/')) ?? null
}, 8000)
addCheck('music-window-created', !!musicTarget, musicTarget ? { url: musicTarget.url } : null)

const disabled = await dock.evaluate(
  `window.nexus.settings.update({ music: { visible: false } }).then((s) => s.music.visible)`
)
const bridgeDown = await waitFor(async () => {
  const counts = await probes.bridgeCounts()
  return counts.powershell <= before.powershell ? counts : null
}, 12000)
addCheck('music-disabled-kills-smtc-bridge', bridgeDown !== null && bridgeDown.powershell <= before.powershell, {
  after: bridgeDown
})
addCheck('music-enabled-flag', enabled === true && disabled === false, { enabled, disabled })

/* --------------------------- 4. 设置窗口可打开 --------------------------- */
await dock.evaluate('window.nexus.window.openSettings()')
const settingsTarget = await waitFor(async () => {
  const list = await targets()
  return list.find((item) => item.type === 'page' && item.url.includes('/settings/')) ?? null
}, 8000)
addCheck('settings-window-opens', !!settingsTarget, settingsTarget ? { url: settingsTarget.url } : null)

let settingsDom = null
if (settingsTarget) {
  const settings = await connect('/settings/')
  // 设置页 target 出现时页面可能仍在加载，body 尚未就绪 → 轮询等它渲染完
  settingsDom = await waitFor(
    async () => {
      const dom = await settings.evaluate(`(() => {
        if (!document.body) return null
        return {
          sections: document.querySelectorAll('[data-section]').length,
          title: document.title,
          textLength: (document.body.innerText || '').length
        }
      })()`)
      return dom && (dom.textLength ?? 0) > 200 ? dom : null
    },
    10000
  )
  addCheck('settings-renders', (settingsDom?.textLength ?? 0) > 200, settingsDom)
  // 关闭设置窗口，避免影响后续截图
  await dock.evaluate('window.nexus.window.closeSettings()')
  settings.close()
}

/* ------------------------------- 报告落盘 ------------------------------- */
const failed = checks.filter((c) => !c.pass)
const report = {
  at: new Date().toISOString(),
  label: 'v1.4 轻量化验收',
  port: PORT,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks
}
writeFileSync(join(OUT_DIR, 'v14-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(`\n==== ${checks.length - failed.length}/${checks.length} PASS，报告：docs/verification/v1.4/v14-report.json`)

clock.close()
dock.close()
process.exit(failed.length === 0 ? 0 : 1)
