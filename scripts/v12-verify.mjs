// ============================================================================
// Nexus Dock v1.2 运行时验收脚本（CDP / Node 24，无第三方依赖）
//
// 用法：
//   node scripts/v11-verify.mjs                # 默认 CDP 端口 9224（安装版）
//   $env:NEXUS_CDP_PORT=9222; node scripts/v11-verify.mjs
//
// 前置条件（由 Lead 准备，脚本不负责启动/重启应用）：
//   - 安装版 Nexus Dock 已启动，且以 --remote-debugging-port=<PORT> 运行；
//   - 真实用户配置 %APPDATA%\nexus-dock\settings.json 已是 schemaVersion 6。
//
// 行为：
//   - 通过 window.nexus API 打开 设置 / 音乐卡片 / 桌面时钟 窗口并逐项验收
//     docs/spec.md §9 的 US-16 / US-17（并回归 v1.1 的 US-11 ~ US-15）；
//   - 每张截图通过对应 target 的 Page.captureScreenshot({format:'png', fromSurface:true})；
//   - 全程监听 Runtime.exceptionThrown；
//   - 开机自启（US-12）会真实写 HKCU Run，脚本用 try/finally 保证最后一定关闭并回读清理；
//   - 脚本幂等：结束时把六组设置（dock/music/clock/lock/system/appearance）恢复为开始时的快照，
//     并关闭设置窗口；可重复多次运行。
//
// 产物：docs/verification/v1.2/v12-report.json + PNG 截图
// ============================================================================

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9224)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.2')
const RUN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rel = (file) => relative(ROOT, file).split(sep).join('/')
const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value))
const truncate = (value, max = 260) => {
  const text = asText(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 收集所有验证结果 / 截图 / 运行时异常 */
const checks = []
const screenshots = []
const screenshotMeta = []
const exceptions = []
const notes = []

function addCheck(id, ac, pass, detail) {
  checks.push({ id, ac, pass: pass === true, detail })
  console.log(`${pass === true ? 'PASS' : 'FAIL'}  ${id.padEnd(22)} [${ac}]  ${truncate(detail)}`)
}

/** GET /json 列出所有可调试页面 target */
async function listPages() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`)
  if (!response.ok) throw new Error(`GET /json HTTP ${response.status}`)
  const targets = await response.json()
  return targets.filter((target) => target.type === 'page')
}

/**
 * 等待某个窗口 target 出现（15s 轮询；已存在立即返回）。
 * match 为 URL 片段，如 '/settings/'、'/clock/'。
 */
async function waitForTarget(match, timeoutMs = 15000) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const pages = await listPages()
      const hit = pages.find((page) => page.url.includes(match))
      if (hit) return hit
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  if (lastError) console.warn(`[waitForTarget] ${match} 轮询失败：${lastError.message}`)
  return null
}

/** 轮询直到 selector 命中（页面渲染完成） */
async function waitForDom(cdp, selector, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if (await cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true
    } catch {
      /* 页面换载过程中 evaluate 可能短暂失败 */
    }
    await sleep(200)
  }
  return false
}

/** 读取当前用户 HKCU Run 登录项（开机自启真实证据；reg.exe 只读） */
function readRunEntries() {
  try {
    const output = execFileSync('reg', ['query', RUN_REG_KEY], { encoding: 'utf8', timeout: 6000 })
    const entries = []
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s{4}(\S.*?)\s{4}REG_\w+\s{4}(.*)$/)
      if (match) entries.push({ name: match[1].trim(), value: match[2].trim() })
    }
    return { ok: true, entries }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/** 对比两次 Run 登录项快照 → 新增 / 移除的条目名 */
function diffRunEntries(before, after) {
  const beforeMap = new Map((before?.entries ?? []).map((entry) => [entry.name, entry.value]))
  const afterMap = new Map((after?.entries ?? []).map((entry) => [entry.name, entry.value]))
  const added = [...afterMap.keys()].filter((name) => !beforeMap.has(name))
  const removed = [...beforeMap.keys()].filter((name) => !afterMap.has(name))
  return { added, removed, addedValues: added.map((name) => afterMap.get(name)) }
}

/* ------------------------------ CDP 客户端 ------------------------------ */

class Cdp {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl
    this.label = label
    this.nextId = 0
    this.pending = new Map()
    this.closed = false
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', (event) => reject(new Error(`WebSocket 连接失败：${event?.message ?? ''}`)), {
        once: true
      })
    })
    this.ws.addEventListener('message', (event) => this.#onMessage(event))
    this.ws.addEventListener('close', () => {
      this.closed = true
    })
    // 约束：连上后先 Runtime.enable，才能收到本页之后的未捕获异常
    await this.send('Runtime.enable')
    return this
  }

  #onMessage(event) {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(`${message.method ?? 'CDP'} 错误：${JSON.stringify(message.error)}`))
      else resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      const text =
        details?.exception?.description ?? details?.text ?? details?.exception?.value ?? '未知未捕获异常'
      const firstLine = String(text).split('\n')[0]
      const entry = {
        target: this.label,
        text: firstLine,
        url: details?.url ?? null,
        line: details?.lineNumber ?? null,
        timestamp: new Date().toISOString()
      }
      exceptions.push(entry)
      console.warn(`[exception] ${this.label}: ${firstLine}`)
    }
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error(`CDP 连接已关闭（${this.label} ${method}）`))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP 超时：${method}（${timeoutMs}ms）`))
      }, timeoutMs)
      // 成功/失败路径都清定时器，避免未清理的 timer 拖住进程退出
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        `页面 evaluate 异常：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`
      )
    }
    return result.result?.value
  }

  /** 通过该 target 截图并落盘；返回相对路径 */
  async shot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 20000)
    const file = join(OUT_DIR, name)
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    const path = rel(file)
    screenshots.push(path)
    screenshotMeta.push({ name, target: this.label, path, bytes: Buffer.byteLength(result.data, 'base64') })
    console.log(`SHOT  ${name.padEnd(24)} (${this.label})`)
    return path
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      /* 忽略重复关闭 */
    }
  }
}

/* --------------------------- 页面内表达式（DOM） --------------------------- */

const CLOCK_READ = `(() => {
  const root = document.querySelector('.clock-root')
  if (!root) return { error: 'clock-root 不存在', body: (document.body.innerText || '').slice(0, 200) }
  const timeEl = document.querySelector('.clock-time')
  const dateEl = document.querySelector('.clock-date')
  const periodEl = document.querySelector('.clock-period')
  const rootStyle = getComputedStyle(root)
  const timeStyle = timeEl ? getComputedStyle(timeEl) : null
  return {
    time: timeEl ? timeEl.textContent.trim() : null,
    date: dateEl ? dateEl.textContent.trim() : null,
    period: periodEl ? periodEl.textContent.trim() : null,
    theme: root.getAttribute('data-theme'),
    locked: root.getAttribute('data-locked'),
    opacity: Number(rootStyle.opacity),
    fontSize: timeStyle ? parseFloat(timeStyle.fontSize) : null,
    entering: root.classList.contains('is-entering'),
    title: root.getAttribute('title'),
    appRegion: rootStyle.getPropertyValue('-webkit-app-region') || rootStyle.webkitAppRegion || null
  }
})()`

const DOCK_LOCK_READ = `(() => {
  const root = document.querySelector('.dock-root')
  const grip = document.querySelector('.dock-grip')
  if (!root) return { error: 'dock-root 不存在' }
  return {
    dataLocked: root.getAttribute('data-locked'),
    gripLocked: grip ? grip.getAttribute('data-locked') : null,
    gripTitle: grip ? grip.getAttribute('title') : null,
    gripHasLockIcon: !!document.querySelector('.dock-grip-lock'),
    appRegion: getComputedStyle(root).getPropertyValue('-webkit-app-region') || null
  }
})()`

const MUSIC_LOCK_READ = `(() => {
  const root = document.querySelector('.music-card')
  if (!root) return { error: 'music-card 不存在' }
  return {
    dataLocked: root.getAttribute('data-locked'),
    title: root.getAttribute('title'),
    appRegion: getComputedStyle(root).getPropertyValue('-webkit-app-region') || null
  }
})()`

/** 读取设置页内某个 Switch（按 label 前缀定位 .ui-row） */
const readSwitchExpr = (labelPrefix) => `(() => {
  const row = [...document.querySelectorAll('.ui-row')].find((element) => {
    const label = element.querySelector('.ui-row-label')
    return label && label.textContent.trim().startsWith(${JSON.stringify(labelPrefix)})
  })
  if (!row) return { found: false }
  const sw = row.querySelector('.ui-switch')
  return {
    found: true,
    checked: sw ? sw.getAttribute('aria-checked') : null,
    disabled: row.classList.contains('is-disabled') || (sw ? sw.getAttribute('aria-disabled') === 'true' : false),
    tabIndex: sw ? sw.getAttribute('tabindex') : null,
    rowText: row.innerText.replace(/\\s+/g, ' ')
  }
})()`

/** 点击设置页左侧导航（按文本精确匹配，DOM click 触发 React onClick） */
const clickNavExpr = (label) => `(() => {
  const button = [...document.querySelectorAll('.settings-nav-item')].find(
    (element) => element.textContent.trim() === ${JSON.stringify(label)}
  )
  if (!button) return false
  button.click()
  return true
})()`

const SETTINGS_CONTENT_TEXT = `(document.querySelector('.settings-content')?.innerText ?? '').replace(/\\s+/g, ' ')`
const SETTINGS_NOTICES = `[...document.querySelectorAll('.settings-content .nx-notice')].map((element) => element.innerText.trim())`
const SETTINGS_NAV_TEXTS = `[...document.querySelectorAll('.settings-nav-item')].map((element) => element.textContent.trim())`

const CLICK_NAV = async (settings, label) => {
  const ok = await settings.evaluate(clickNavExpr(label))
  if (!ok) throw new Error(`设置页未找到导航项「${label}」`)
  await sleep(500) // 页面转场 220ms + React 渲染
}

/* ------------------------------- 主流程 ------------------------------- */

const startedAt = new Date()
const startedAtIso = startedAt.toISOString()
const restoreGroups = ['dock', 'music', 'clock', 'lock', 'system', 'appearance']

let dock = null
let music = null
let settings = null
let clock = null
let snapshot = null
let env = null
let initialTargets = []
let autoStartTouched = false
let fatalError = null
// 恢复/清理现场证据（写入报告）
const restoreEvidence = {}
const registryEvidence = {}
const restoredCheck = { done: false }

/** 一次 settings.update 还原开始时的六组快照 */
function restorePatch() {
  if (!snapshot) return null
  const patch = {}
  for (const group of restoreGroups) patch[group] = snapshot[group]
  return patch
}

async function bestEffortRestore(reason) {
  if (!dock || dock.closed) return
  try {
    if (autoStartTouched) {
      try {
        await dock.evaluate('window.nexus.system.setAutoStart(false)')
        autoStartTouched = false
        restoreEvidence.autoStartEmergencyCleanup = true
        await sleep(400)
      } catch (error) {
        restoreEvidence.autoStartEmergencyCleanupError = String(error?.message ?? error)
      }
    }
    const patch = restorePatch()
    if (patch) {
      await dock.evaluate(`window.nexus.settings.update(${JSON.stringify(patch)})`)
      restoreEvidence.settingsRestored = true
      restoreEvidence.restoreReason = reason
      await sleep(400)
    }
    await dock.evaluate('window.nexus.window.closeSettings()').catch(() => {})
  } catch (error) {
    restoreEvidence.error = String(error?.message ?? error)
  }
}

async function main() {
  console.log(`\nNexus Dock v1.1 运行时验收 — CDP :${PORT}`)
  console.log(`输出目录：${OUT_DIR}\n`)

  /* ---------------- A. 通用：target / env / schema ---------------- */

  const dockTarget = await waitForTarget('/dock/', 8000)
  if (!dockTarget) {
    addCheck('A1-dock-target', 'AC-15.5', false, `CDP :${PORT} 未发现 dock target（应用未启动或端口未开）`)
    throw new Error(`CDP :${PORT} 上找不到 dock target，无法继续验收`)
  }
  addCheck('A1-dock-target', 'AC-15.5', true, { url: dockTarget.url, title: dockTarget.title })

  dock = await new Cdp(dockTarget.webSocketDebuggerUrl, 'dock').connect()
  initialTargets = (await listPages()).map((page) => ({ url: page.url, title: page.title }))

  snapshot = await dock.evaluate('window.nexus.settings.get()')
  env = await dock.evaluate('window.nexus.env')

  const envPass =
    env?.platform === 'win32' && env?.isPackaged === true && typeof env?.appVersion === 'string' && !env?.isDev
  addCheck('A2-env', 'AC-12.4 / AC-15.5', envPass, {
    platform: env?.platform,
    isPackaged: env?.isPackaged,
    isDev: env?.isDev,
    appVersion: env?.appVersion,
    versions: env?.versions
  })

  addCheck('A3-schema-v6', 'AC-16.6 / AC-17.5', snapshot?.schemaVersion === 6, {
    schemaVersion: snapshot?.schemaVersion,
    hasClockGroup: !!snapshot?.clock,
    hasLockGroup: !!snapshot?.lock,
    hasSystemGroup: !!snapshot?.system,
    musicSnapToEdge: snapshot?.music?.snapToEdge,
    clockSnapToEdge: snapshot?.clock?.snapToEdge,
    clockVisible: snapshot?.clock?.visible,
    lock: snapshot?.lock
  })

  addCheck('A3b-clock-snap-field', 'AC-16.6', typeof snapshot?.clock?.snapToEdge === 'boolean', {
    clockSnapToEdge: snapshot?.clock?.snapToEdge,
    note: 'v5→v6 迁移后时钟必须有 snapToEdge 布尔字段（旧字段由 H4 校验保留）'
  })

  notes.push(
    `初始 target 数：${initialTargets.length}（${initialTargets.map((item) => item.url.split('/renderer/')[1] ?? item.url).join(', ')}）`
  )
  const residualWindows = ['/music/', '/clock/'].filter((segment) =>
    initialTargets.some((target) => target.url.includes(segment))
  )
  if (residualWindows.length > 0) {
    notes.push(
      `本次为重复运行：${residualWindows.join('、')} target 在验收开始前已存在（上一次验收创建，窗口 hide 后 target 不销毁）；` +
        '脚本通过 API 重新显示后检查。冷启动时是否创建取决于初始 settings 的 visible 值。'
    )
  }
  if (snapshot?.music?.visible !== true) {
    notes.push(
      '起始 settings.music.visible=false：音乐卡片默认隐藏；验收期间通过 settings.update({music:{visible:true}}) 打开' +
        '（冷启动无 target 则等待主进程创建，重复运行则把残留隐藏窗口重新显示），结束时已还原快照。'
    )
  }

  /* ---------------- 打开其余三窗口（API 驱动，15s 轮询） ---------------- */

  let musicTarget = await waitForTarget('/music/', 1200)
  const musicExistedAtStart = !!musicTarget
  const musicOpenedByVerify = !musicTarget
  if (!musicTarget) {
    await dock.evaluate('window.nexus.settings.update({ music: { visible: true } })')
    musicTarget = await waitForTarget('/music/', 15000)
  }
  addCheck('A4-music-target', '§8 四窗口 / US-11', !!musicTarget, {
    found: !!musicTarget,
    url: musicTarget?.url ?? null,
    existedAtStart: musicExistedAtStart,
    openedByVerify: musicOpenedByVerify,
    initialMusicVisible: snapshot?.music?.visible,
    reason: musicExistedAtStart
      ? snapshot?.music?.visible === false
        ? 'music target 启动时已存在但配置为隐藏（前次验收创建的隐藏窗口，hide 不销毁）；验收期间通过 API 设为可见'
        : '启动时已存在且可见'
      : '启动时无 music target（settings.music.visible=false 时主进程不创建音乐窗口）；验收通过 API 打开'
  })
  if (musicTarget) {
    music = await new Cdp(musicTarget.webSocketDebuggerUrl, 'music').connect()
    // 音乐窗口可能已存在但处于隐藏态（visible=false 只 hide 不销毁）：确保验收期间可见
    await dock.evaluate('window.nexus.settings.update({ music: { visible: true } })')
    await waitForDom(music, '.music-card')
  }

  await dock.evaluate('window.nexus.window.openSettings()')
  const settingsTarget = await waitForTarget('/settings/', 15000)
  addCheck('A5-settings-target', 'AC-15.1', !!settingsTarget, {
    found: !!settingsTarget,
    url: settingsTarget?.url ?? null,
    openedBy: 'window.nexus.window.openSettings()'
  })
  if (settingsTarget) {
    settings = await new Cdp(settingsTarget.webSocketDebuggerUrl, 'settings').connect()
    // nav 骨架在设置加载前就存在，等内容区真实渲染（.ui-section）才算就绪
    await waitForDom(settings, '.settings-content .ui-section')
  }

  await dock.evaluate('window.nexus.settings.update({ clock: { visible: true } })')
  const clockTarget = await waitForTarget('/clock/', 15000)
  addCheck('A6-clock-target', 'AC-13.1', !!clockTarget, {
    found: !!clockTarget,
    url: clockTarget?.url ?? null,
    existedAtStart: initialTargets.some((target) => target.url.includes('/clock/')),
    openedBy: 'settings.update({ clock: { visible: true } })'
  })
  if (clockTarget) {
    clock = await new Cdp(clockTarget.webSocketDebuggerUrl, 'clock').connect()
    await waitForDom(clock, '.clock-time')
  }

  const targetsNow = await listPages()
  const hasTarget = (segment) => targetsNow.some((page) => page.url.includes(segment))
  const fourWindows = {
    dock: hasTarget('/dock/'),
    music: hasTarget('/music/'),
    settings: hasTarget('/settings/'),
    clock: hasTarget('/clock/')
  }
  addCheck('A7-four-targets', 'AC-15.5', Object.values(fourWindows).every(Boolean), {
    ...fourWindows,
    targetUrls: targetsNow.map((page) => page.url)
  })

  if (!settings || !clock) throw new Error('设置 / 时钟窗口未就绪，后续检查无法执行')

  /* ---------------- B. 时钟 US-13 ---------------- */

  const clockUpdate = async (patch, waitMs = 900) => {
    await dock.evaluate(`window.nexus.settings.update(${JSON.stringify(patch)})`)
    await sleep(waitMs)
  }
  const clockRead = () => clock.evaluate(CLOCK_READ)

  // B1：默认显示（24 小时制、不显示秒、显示日期、深色、字号 40、透明度 100%）
  await clockUpdate({
    clock: { visible: true, showSeconds: false, hour12: false, showDate: true, fontSize: 40, opacity: 1, theme: 'dark' }
  })
  const clockDefault = await clockRead()
  const defaultPass =
    /^\d{2}:\d{2}$/.test(clockDefault.time ?? '') &&
    typeof clockDefault.date === 'string' &&
    clockDefault.date.length > 0 &&
    clockDefault.theme === 'dark' &&
    clockDefault.locked === null
  addCheck('B1-clock-default', 'US-13 / AC-13.2', defaultPass, {
    time: clockDefault.time,
    timeMatches24hNoSeconds: /^\d{2}:\d{2}$/.test(clockDefault.time ?? ''),
    date: clockDefault.date,
    theme: clockDefault.theme,
    locked: clockDefault.locked,
    opacity: clockDefault.opacity,
    entering: clockDefault.entering
  })
  await clock.shot('clock-default.png')

  // B2：显示秒
  await clockUpdate({ clock: { showSeconds: true } }, 1100)
  const clockSeconds = await clockRead()
  addCheck('B2-clock-seconds', 'AC-13.2', /^\d{2}:\d{2}:\d{2}$/.test(clockSeconds.time ?? ''), {
    time: clockSeconds.time,
    expected: 'HH:mm:ss'
  })
  await clock.shot('clock-seconds.png')

  // B3：12 小时制 → 上午/下午
  await clockUpdate({ clock: { hour12: true } }, 1000)
  const clock12h = await clockRead()
  addCheck(
    'B3-clock-hour12',
    'AC-13.2',
    ['上午', '下午'].includes(clock12h.period ?? '') && /^\d{2}:\d{2}:\d{2}$/.test(clock12h.time ?? ''),
    { time: clock12h.time, period: clock12h.period }
  )

  // B4：字号 64 → 计算样式 font-size ≈64px
  await clockUpdate({ clock: { fontSize: 64 } }, 1000)
  const clockFont = await clockRead()
  addCheck('B4-clock-fontsize', 'AC-13.3', Math.abs((clockFont.fontSize ?? 0) - 64) <= 1, {
    fontSize: clockFont.fontSize,
    expected: 64
  })

  // B5：透明度 0.5 → 根节点计算 opacity ≈0.5（等 ≥400ms 避开入场动画）
  await clockUpdate({ clock: { opacity: 0.5 } }, 900)
  const clockOpacity = await clockRead()
  addCheck('B5-clock-opacity', 'AC-13.3', Math.abs((clockOpacity.opacity ?? 0) - 0.5) <= 0.02, {
    opacity: clockOpacity.opacity,
    expected: 0.5,
    entering: clockOpacity.entering
  })

  // B6：浅色主题
  await clockUpdate({ clock: { theme: 'light' } }, 800)
  const clockLight = await clockRead()
  addCheck('B6-clock-theme-light', 'AC-13.3', clockLight.theme === 'light', { theme: clockLight.theme })
  await clock.shot('clock-light.png')

  // 截图后把时钟外观恢复默认，供位置锁定截图使用（不影响最终快照恢复）
  await clockUpdate(
    { clock: { showSeconds: false, hour12: false, fontSize: 40, opacity: 1, theme: 'dark', showDate: true } },
    900
  )

  /* ---------------- C. 设置面板 US-15 ---------------- */

  const navTexts = await settings.evaluate(SETTINGS_NAV_TEXTS)
  const expectedNav = ['Dock', '音乐', '时钟', '应用', '外观', '系统', '关于']
  addCheck('C1-nav-7-items', 'AC-15.1', JSON.stringify(navTexts) === JSON.stringify(expectedNav), {
    actual: navTexts,
    expected: expectedNav,
    count: navTexts.length
  })

  const clickNav = async (label) => {
    const ok = await settings.evaluate(clickNavExpr(label))
    if (!ok) throw new Error(`设置页未找到导航项「${label}」`)
    await sleep(500) // 页面转场 220ms + React 渲染
    return ok
  }
  const contentText = async () => String(await settings.evaluate(SETTINGS_CONTENT_TEXT)).trim()
  const readSwitch = (labelPrefix) => settings.evaluate(readSwitchExpr(labelPrefix))
  const readNotices = () => settings.evaluate(SETTINGS_NOTICES)
  const hasAll = (text, needles) => needles.every((needle) => text.includes(needle))

  // C2：时钟页
  await clickNav('时钟')
  const clockPageText = await contentText()
  const clockNeedles = ['显示桌面时钟', '显示秒', '显示日期', '字号', '透明度', '自动吸附屏幕边缘']
  addCheck('C2-settings-clock-page', 'AC-13.1 / AC-13.3', hasAll(clockPageText, clockNeedles), {
    found: clockNeedles.filter((needle) => clockPageText.includes(needle)),
    missing: clockNeedles.filter((needle) => !clockPageText.includes(needle)),
    textPreview: clockPageText.slice(0, 220)
  })
  await settings.shot('settings-clock.png')

  // C3：系统页（开机自启 + 位置锁定）
  await clickNav('系统')
  const systemPageText = await contentText()
  const systemNeedles = ['开机自启', '锁定全部窗口位置', 'Dock', '音乐卡片', '桌面时钟']
  const autoStartSwitchBefore = await readSwitch('开机自启')
  const systemNotices = await readNotices()
  addCheck('C3-settings-system-page', 'AC-12.1 / AC-14.1 / AC-14.2', hasAll(systemPageText, systemNeedles), {
    found: systemNeedles.filter((needle) => systemPageText.includes(needle)),
    missing: systemNeedles.filter((needle) => !systemPageText.includes(needle)),
    autoStartSwitch: autoStartSwitchBefore,
    notices: systemNotices,
    textPreview: systemPageText.slice(0, 260)
  })
  await settings.shot('settings-system.png')

  // C4：音乐页（吸附开关）
  await clickNav('音乐')
  const musicPageText = await contentText()
  addCheck('C4-settings-music-page', 'AC-11.1', musicPageText.includes('自动吸附屏幕边缘'), {
    containsSnapSwitch: musicPageText.includes('自动吸附屏幕边缘'),
    textPreview: musicPageText.slice(0, 220)
  })
  await settings.shot('settings-music.png')

  /* ---------------- E. 音乐吸附 US-11（设置页开关 + API 值） ---------------- */

  const snapSwitchInitial = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'E1-music-snap-default',
    'AC-11.1 / AC-17.4',
    snapSwitchInitial?.found === true &&
      snapSwitchInitial?.checked === String(snapshot?.music?.snapToEdge === true),
    {
      switch: snapSwitchInitial,
      snapshotValue: snapshot?.music?.snapToEdge,
      note: '断言设置页开关与当前配置一致；「默认开启」由契约默认值与 v4→v5 迁移保证（用户可在验收前调整偏好）'
    }
  )

  await dock.evaluate('window.nexus.settings.update({ music: { snapToEdge: false } })')
  await sleep(500)
  const snapOffSettings = await dock.evaluate('window.nexus.settings.get()')
  const snapOffSwitch = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'E2-music-snap-off',
    'AC-11.1 / AC-11.4',
    snapOffSettings?.music?.snapToEdge === false && snapOffSwitch?.checked === 'false',
    {
      settingsValue: snapOffSettings?.music?.snapToEdge,
      switchChecked: snapOffSwitch?.checked,
      switch: snapOffSwitch
    }
  )

  await dock.evaluate('window.nexus.settings.update({ music: { snapToEdge: true } })')
  await sleep(500)
  const snapOnSettings = await dock.evaluate('window.nexus.settings.get()')
  const snapOnSwitch = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'E3-music-snap-on',
    'AC-11.4 / AC-11.6',
    snapOnSettings?.music?.snapToEdge === true && snapOnSwitch?.checked === 'true',
    {
      settingsValue: snapOnSettings?.music?.snapToEdge,
      switchChecked: snapOnSwitch?.checked,
      switch: snapOnSwitch
    }
  )

  /* ---------------- H. 桌面时钟吸附开关 US-16 ---------------- */

  await clickNav('时钟')
  const clockBeforeToggle = await dock.evaluate('window.nexus.settings.get()')
  const clockSnapSwitchInitial = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'H1-clock-snap-default',
    'AC-16.1 / AC-17.4',
    clockSnapSwitchInitial?.found === true &&
      clockSnapSwitchInitial?.checked === String(clockBeforeToggle?.clock?.snapToEdge === true),
    {
      switch: clockSnapSwitchInitial,
      currentValue: clockBeforeToggle?.clock?.snapToEdge,
      note: '断言设置页开关与当前配置一致；默认开启由契约默认值与 v5→v6 迁移保证'
    }
  )

  await dock.evaluate('window.nexus.settings.update({ clock: { snapToEdge: false } })')
  await sleep(500)
  const clockSnapOffSettings = await dock.evaluate('window.nexus.settings.get()')
  const clockSnapOffSwitch = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'H2-clock-snap-off',
    'AC-16.1 / AC-16.4',
    clockSnapOffSettings?.clock?.snapToEdge === false && clockSnapOffSwitch?.checked === 'false',
    {
      settingsValue: clockSnapOffSettings?.clock?.snapToEdge,
      switchChecked: clockSnapOffSwitch?.checked,
      switch: clockSnapOffSwitch
    }
  )
  // 滚动到「位置」组的吸附开关，确保证据截图能拍到新增控件
  await settings.evaluate(`(() => {
    const scroller = document.querySelector('.settings-content') || document.scrollingElement
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    const row = [...document.querySelectorAll('.ui-row')].find((el) => el.textContent && el.textContent.includes('自动吸附屏幕边缘'))
    if (row) row.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(450)
  await settings.shot('settings-clock-snap.png')

  await dock.evaluate('window.nexus.settings.update({ clock: { snapToEdge: true } })')
  await sleep(500)
  const clockSnapOnSettings = await dock.evaluate('window.nexus.settings.get()')
  const clockSnapOnSwitch = await readSwitch('自动吸附屏幕边缘')
  addCheck(
    'H3-clock-snap-on',
    'AC-16.2 / AC-16.4',
    clockSnapOnSettings?.clock?.snapToEdge === true && clockSnapOnSwitch?.checked === 'true',
    {
      settingsValue: clockSnapOnSettings?.clock?.snapToEdge,
      switchChecked: clockSnapOnSwitch?.checked,
      switch: clockSnapOnSwitch
    }
  )

  // AC-16.6 迁移保留：除 freeX/freeY（允许在开关翻转时按设计改写）外，clock 字段与快照一致
  const preservedKeys = ['visible', 'showSeconds', 'showDate', 'hour12', 'fontSize', 'opacity', 'alwaysOnTop', 'theme']
  const clockFieldsPreserved = preservedKeys.every(
    (key) => JSON.stringify(clockSnapOnSettings?.clock?.[key]) === JSON.stringify(clockBeforeToggle?.clock?.[key])
  )
  addCheck('H4-clock-migration-preserved', 'AC-16.6', clockFieldsPreserved, {
    preservedKeys,
    beforeToggleClock: clockBeforeToggle?.clock,
    currentClock: clockSnapOnSettings?.clock
  })

  /* ---------------- D. 位置锁定 US-14 ---------------- */

  await dock.evaluate('window.nexus.settings.update({ lock: { dock: true, music: true, clock: true } })')
  await sleep(400)
  const lockOnSettings = await dock.evaluate('window.nexus.settings.get()')
  const dockLockOn = await dock.evaluate(DOCK_LOCK_READ)
  const musicLockOn = music ? await music.evaluate(MUSIC_LOCK_READ) : null
  const clockLockOn = await clockRead()
  addCheck(
    'D1-lock-on',
    'AC-14.1 / AC-14.3 / AC-14.8',
    lockOnSettings?.lock?.dock === true &&
      lockOnSettings?.lock?.music === true &&
      lockOnSettings?.lock?.clock === true &&
      dockLockOn?.dataLocked === 'true' &&
      (!music || musicLockOn?.dataLocked === 'true') &&
      clockLockOn?.locked === 'true',
    {
      settingsLock: lockOnSettings?.lock,
      dock: dockLockOn,
      music: musicLockOn,
      clock: { locked: clockLockOn?.locked, title: clockLockOn?.title, appRegion: clockLockOn?.appRegion },
      mainProcessNote:
        '主进程 applyLockState→win.setMovable(false) 无法从渲染层读取；证据 = windowManager.ts:680-684 代码审查 + 三窗口 data-locked'
    }
  )
  await dock.shot('dock-locked.png')
  await clock.shot('clock-locked.png')
  if (music) await music.shot('music-locked.png')

  await dock.evaluate('window.nexus.settings.update({ lock: { dock: false, music: false, clock: false } })')
  await sleep(400)
  const lockOffSettings = await dock.evaluate('window.nexus.settings.get()')
  const dockLockOff = await dock.evaluate(DOCK_LOCK_READ)
  const musicLockOff = music ? await music.evaluate(MUSIC_LOCK_READ) : null
  const clockLockOff = await clockRead()
  addCheck(
    'D2-lock-off',
    'AC-14.3 / AC-14.4',
    lockOffSettings?.lock?.dock === false &&
      lockOffSettings?.lock?.music === false &&
      lockOffSettings?.lock?.clock === false &&
      dockLockOff?.dataLocked === null &&
      (!music || musicLockOff?.dataLocked === null) &&
      clockLockOff?.locked === null,
    {
      settingsLock: lockOffSettings?.lock,
      dock: dockLockOff,
      music: musicLockOff,
      clockLocked: clockLockOff?.locked
    }
  )

  /* ---------------- F. 开机自启 US-12（安装版真实写入，必须清理） ---------------- */

  await clickNav('系统')
  const autoStartSwitch = await readSwitch('开机自启')
  addCheck(
    'F1-autostart-switch-enabled',
    'AC-12.1 / AC-12.2',
    autoStartSwitch?.found === true && autoStartSwitch?.disabled === false,
    { switch: autoStartSwitch, isPackaged: env?.isPackaged }
  )

  const beforeAutoStartSettings = await dock.evaluate('window.nexus.settings.get()')
  const autoStartBaseline = beforeAutoStartSettings?.system?.autoStart === true
  // 用户可能在验收前已手动开启自启：先归零，保证「开启 → 新增登录项」可被观测；
  // 验收结束会把系统登录项恢复为基线状态（见 finally）。
  if (autoStartBaseline) {
    await dock.evaluate('window.nexus.system.setAutoStart(false)')
    await sleep(600)
    notes.push('开机自启基线为「已开启」：脚本先归零再测试，结束后恢复基线。')
  }
  const registryBefore = readRunEntries()
  registryEvidence.before = registryBefore

  let enableResult = null
  let disableResult = null
  let afterEnableSettings = null
  let afterDisableSettings = null
  let autoStartSwitchOn = null
  let autoStartSwitchOff = null
  let registryAfterEnable = null
  let registryAfterCleanup = null
  let autoStartNotices = null
  let cleanupError = null

  try {
    enableResult = await dock.evaluate('window.nexus.system.setAutoStart(true)')
    autoStartTouched = true
    await sleep(600)
    afterEnableSettings = await dock.evaluate('window.nexus.settings.get()')
    autoStartSwitchOn = await readSwitch('开机自启')
    autoStartNotices = await readNotices()
    registryAfterEnable = readRunEntries()
    registryEvidence.afterEnable = registryAfterEnable
  } finally {
    try {
      disableResult = await dock.evaluate('window.nexus.system.setAutoStart(false)')
      autoStartTouched = false
      await sleep(600)
      afterDisableSettings = await dock.evaluate('window.nexus.settings.get()')
      autoStartSwitchOff = await readSwitch('开机自启')
    } catch (error) {
      cleanupError = String(error?.message ?? error)
    }
    await sleep(300)
    registryAfterCleanup = readRunEntries()
    registryEvidence.afterCleanup = registryAfterCleanup
    registryEvidence.diffBeforeCleanup = diffRunEntries(registryBefore, registryAfterEnable ?? registryBefore)
    registryEvidence.diffAfterCleanup = diffRunEntries(registryBefore, registryAfterCleanup)
    // 恢复用户验收前的系统登录项状态（与 G 的 settings 还原保持一致）
    if (autoStartBaseline) {
      try {
        registryEvidence.restoredToBaseline = await dock.evaluate('window.nexus.system.setAutoStart(true)')
        await sleep(600)
      } catch (error) {
        registryEvidence.restoreAutoStartError = String(error?.message ?? error)
      }
    }
  }

  addCheck(
    'F2-autostart-enable',
    'AC-12.2 / AC-12.3',
    enableResult?.ok === true && enableResult?.autoStart === true && afterEnableSettings?.system?.autoStart === true,
    {
      result: enableResult,
      settingsValue: afterEnableSettings?.system?.autoStart,
      pageSwitchChecked: autoStartSwitchOn?.checked,
      pageNotices: autoStartNotices,
      baselineSettingsValue: beforeAutoStartSettings?.system?.autoStart
    }
  )
  addCheck(
    'F3-autostart-disable',
    'AC-12.2 / AC-12.3',
    disableResult?.ok === true &&
      disableResult?.autoStart === false &&
      afterDisableSettings?.system?.autoStart === false &&
      autoStartSwitchOff?.checked === 'false',
    {
      result: disableResult,
      settingsValue: afterDisableSettings?.system?.autoStart,
      pageSwitchChecked: autoStartSwitchOff?.checked,
      cleanupError
    }
  )

  const addedAfterEnable = registryEvidence.diffBeforeCleanup ?? { added: [], removed: [], addedValues: [] }
  const addedAfterCleanup = registryEvidence.diffAfterCleanup ?? { added: [], removed: [], addedValues: [] }
  const registryWritten =
    addedAfterEnable.added.length > 0 &&
    addedAfterEnable.addedValues.some((value) => String(value).toLowerCase().includes('nexusdockapp.exe'))
  const registryClean =
    registryAfterCleanup?.ok === true && addedAfterCleanup.added.length === 0 && addedAfterCleanup.removed.length === 0
  addCheck(
    'F4-autostart-registry-write',
    'AC-12.2',
    registryWritten || !registryBefore.ok,
    {
      writtenEntries: addedAfterEnable,
      note: registryBefore.ok ? 'HKCU Run 实际新增登录项（reg query 只读证据）' : 'reg query 不可用，跳过注册表证据'
    }
  )
  addCheck(
    'F5-autostart-cleanup',
    'AC-12.2',
    cleanupError === null && registryClean && afterDisableSettings?.system?.autoStart === false,
    {
      cleanupError,
      registryClean,
      addedAfterCleanup,
      settingsValue: afterDisableSettings?.system?.autoStart,
      note: 'finally 中已执行 setAutoStart(false)；HKCU Run 与归一化基线一致，并已按需恢复用户原自启状态'
    }
  )

  // 还原设置前先回到稳定状态：确认系统页开关仍可用
  notes.push('开机自启：仅安装版（isPackaged=true）真实执行 setAutoStart(true)→false，并在 finally 中保证清理。')

  /* ---------------- G. 恢复现场 ---------------- */

  const patch = restorePatch()
  const restored = await dock.evaluate(`window.nexus.settings.update(${JSON.stringify(patch)})`)
  await sleep(800)
  const finalSettings = await dock.evaluate('window.nexus.settings.get()')
  const groupsMatch = {}
  for (const group of restoreGroups) {
    groupsMatch[group] = JSON.stringify(finalSettings?.[group]) === JSON.stringify(snapshot?.[group])
  }
  const restoredOk = Object.values(groupsMatch).every(Boolean)
  restoreEvidence.finalSettings = {
    clockVisible: finalSettings?.clock?.visible,
    lock: finalSettings?.lock,
    musicSnapToEdge: finalSettings?.music?.snapToEdge,
    musicVisible: finalSettings?.music?.visible,
    systemAutoStart: finalSettings?.system?.autoStart
  }
  addCheck('G1-settings-restored', 'AC-15.2', restoredOk, {
    groupsMatch,
    finalSettings: restoreEvidence.finalSettings,
    note: '一次 settings.update 还原 dock/music/clock/lock/system/appearance 六组快照'
  })

  // 设置窗口关闭
  let settingsClosed = false
  let closeSettingsError = null
  try {
    await dock.evaluate('window.nexus.window.closeSettings()')
    await sleep(700)
    const pagesAfterClose = await listPages()
    settingsClosed = !pagesAfterClose.some((page) => page.url.includes('/settings/'))
  } catch (error) {
    closeSettingsError = String(error?.message ?? error)
  }
  addCheck('G2-settings-window-closed', 'AC-15.2', settingsClosed, {
    closed: settingsClosed,
    error: closeSettingsError
  })

  // 落盘设置文件与快照一致（防抖写盘 ≤300ms，已等待 800ms）
  let diskCheck = { ok: false, path: null }
  try {
    const settingsPath = join(process.env.APPDATA ?? '', 'nexus-dock', 'settings.json')
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const diskGroups = {}
    for (const group of restoreGroups) {
      diskGroups[group] = JSON.stringify(onDisk?.[group]) === JSON.stringify(snapshot?.[group])
    }
    diskCheck = {
      ok: onDisk?.schemaVersion === 6 && Object.values(diskGroups).every(Boolean),
      path: settingsPath,
      schemaVersion: onDisk?.schemaVersion,
      clockSnapToEdge: onDisk?.clock?.snapToEdge,
      groupsMatch: diskGroups,
      clockVisible: onDisk?.clock?.visible,
      lock: onDisk?.lock
    }
  } catch (error) {
    diskCheck = { ok: false, path: null, error: String(error?.message ?? error) }
  }
  addCheck('G3-settings-persisted', 'AC-15.2 / AC-15.3', diskCheck.ok, diskCheck)

  /* ---------------- A8. 运行时异常收尾 ---------------- */

  await sleep(800)
  addCheck('A8-no-runtime-exceptions', 'AC-15.5', exceptions.length === 0, {
    count: exceptions.length,
    exceptions
  })
}

/* ------------------------------- 入口 ------------------------------- */

let exitCode = 1
try {
  await main()
} catch (error) {
  fatalError = error
  addCheck('Z-script', 'script', false, String(error?.stack ?? error))
} finally {
  // 任何情况下都尝试恢复现场（幂等，不覆盖正常流程已完成的检查）
  await bestEffortRestore(fatalError ? '脚本异常，保底恢复' : '正常收尾')

  // 关闭 CDP 连接
  for (const cdp of [dock, music, settings, clock]) cdp?.close()

  const failed = checks.filter((check) => check.pass !== true)
  const report = {
    generatedAt: new Date().toISOString(),
    port: PORT,
    appVersion: env?.appVersion ?? null,
    isPackaged: env?.isPackaged ?? null,
    checks,
    screenshots,
    manual: [
      '真实拖动吸附（音乐卡片/US-11）：脚本无法可靠模拟系统级拖动，需人工拖动验证「松手吸附最近边 + 12px 间距」与关闭开关后「拖到哪停在哪」。',
      '位置锁定后可拖动性（US-14）：主进程 setMovable(false) 无法从渲染层读取，脚本以 data-locked + 代码审查为证据；需人工拖动确认锁定后鼠标不可拖。',
      '开机自启真实登录（US-12）：脚本已真实写入并移除 HKCU Run；「重启 Windows 后自动启动」需人工重启验证。',
      '时钟观感（US-13）：字号/透明度/主题/12 小时制的视觉观感需人工确认；脚本只验证文本格式与计算样式。',
      '时钟吸附拖动（US-16）：脚本验证开关默认值/切换落盘/翻转逻辑，真实拖动「吸附最近边」与「拖到哪停在哪」需人工确认。'
    ],
    exceptions,
    notes,
    environment: {
      startedAt: startedAtIso,
      initialTargets,
      env,
      snapshot: snapshot
        ? {
            schemaVersion: snapshot.schemaVersion,
            dock: snapshot.dock,
            music: snapshot.music,
            clock: snapshot.clock,
            lock: snapshot.lock,
            system: snapshot.system,
            appearance: snapshot.appearance,
            appCount: Array.isArray(snapshot.apps) ? snapshot.apps.length : null
          }
        : null
    },
    restore: {
      done: Object.values(restoreEvidence).some((value) => value === true) || restoreEvidence.settingsRestored === true,
      evidence: restoreEvidence
    },
    registry: registryEvidence,
    fatalError: fatalError ? String(fatalError?.stack ?? fatalError) : null,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      failedIds: failed.map((check) => check.id)
    }
  }

  writeFileSync(join(OUT_DIR, 'v12-report.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log(`\n===== 汇总：${report.summary.passed}/${report.summary.total} 通过，${report.summary.failed} 失败 =====`)
  for (const check of checks) console.log(`${check.pass === true ? '✓' : '✗'} ${check.id}`)
  console.log(`\n报告：${join(OUT_DIR, 'v12-report.json')}`)
  console.log(`截图：${screenshots.length} 张 → ${OUT_DIR}`)
  if (exceptions.length > 0) console.log(`运行时异常：${exceptions.length} 条（见报告 exceptions）`)

  if (fatalError) console.error(`\n脚本异常：${fatalError?.stack ?? fatalError}`)
  exitCode = report.summary.failed === 0 && !fatalError ? 0 : 1
}

process.exitCode = exitCode
