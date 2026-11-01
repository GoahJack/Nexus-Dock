// ============================================================================
// Nexus Dock v1.5.0 验收脚本（安装版 + CDP）
//
// 用法：
//   %LOCALAPPDATA%\NexusDock\NexusDockApp.exe --no-sandbox --remote-debugging-port=9333
//   node scripts/v15-verify.mjs
//   $env:NEXUS_CDP_PORT=9333; node scripts/v15-verify.mjs
//
// 覆盖（对照 README「v1.5 更新」逐条）：
//   AC-25.1 版本 1.5.0 + 设置迁移 schemaVersion 7→8 零丢失（应用列表/锁定/位置）
//   AC-25.2 托盘：主进程日志确认托盘创建成功（Shell_NotifyIcon 无报错由调用方核对 stderr）
//   AC-25.3 Dock 渲染层：图标数量、--dock-max-w 上限注入、roving tabindex、aria-haspopup
//   AC-25.4 键盘可用：方向键在图标间移动焦点
//   AC-25.5 命中区：末端音乐/时钟开关 ≥24px
//   AC-25.6 死通道修复：window.nexus.dock.snap() 不再 reject（并还原 Dock 原位置）
//   AC-25.7 音乐卡片：data-theme 生效；空闲态不再无限扫光（无 is-sweeping）
//   AC-25.8 设置面板：无错误提示条、7 个分组、锁定三态含 x/3、恢复默认应用列表文案、音乐主题控件
//   AC-25.9 日志轮转：单文件不超过 1MB 上限（存在 .log.1 备份时同样校验）
//
// 产物：docs/verification/v1.5/v15-report.json + PNG 截图
// ============================================================================
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9333)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.5')
const APPDATA = process.env['APPDATA'] ?? ''
const SETTINGS_PATH = join(APPDATA, 'nexus-dock', 'settings.json')
const LOG_DIR = join(APPDATA, 'nexus-dock', 'logs')

mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const record = (id, title, ok, detail) => {
  results.push({ id, title, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title}${detail ? ` :: ${detail}` : ''}`)
}

/* ------------------------------- CDP helpers ------------------------------- */
async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  if (!res.ok) throw new Error(`CDP /json/list ${res.status}`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => reject(new Error(`WebSocket 连接超时：${wsUrl}`)), 8000)
    ws.onopen = () => {
      clearTimeout(timer)
      resolve(ws)
    }
    ws.onerror = (event) => {
      clearTimeout(timer)
      reject(new Error(`WebSocket 连接失败：${event?.message ?? 'unknown'}`))
    }
  })
}

/** 简易 CDP 客户端：只用到 Runtime.evaluate / Page.captureScreenshot */
function createClient(ws) {
  let seq = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'))
    else entry.resolve(message.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  }
  const screenshot = async (path) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
    return path
  }
  return { send, evaluate, screenshot, close: () => ws.close() }
}

async function openTarget(segment) {
  const targets = await listTargets()
  const target = targets.find((t) => t.type === 'page' && t.url.includes(segment))
  if (!target) return null
  const ws = await connect(target.webSocketDebuggerUrl)
  return { target, client: createClient(ws) }
}

/* --------------------------------- 主流程 --------------------------------- */
const startedAt = Date.now()
let dock = null
let music = null
let settings = null

try {
  dock = await openTarget('/dock/')
  if (!dock) throw new Error('未找到 Dock 页面（确认应用已用 --remote-debugging-port 启动）')

  /* AC-25.1 版本与迁移 */
  const version = await dock.client.evaluate('window.nexus.env.appVersion')
  const settingsNow = await dock.client.evaluate('window.nexus.settings.get()')
  const backupPath = process.env['NEXUS_SETTINGS_BACKUP'] ?? ''
  const backup = backupPath && existsSync(backupPath) ? JSON.parse(readFileSync(backupPath, 'utf8')) : null
  const appsBefore = backup ? backup.apps.length : null
  const migrationOk =
    version === '1.5.0' &&
    settingsNow.schemaVersion === 8 &&
    settingsNow.music.theme === 'dark' &&
    (appsBefore === null || settingsNow.apps.length === appsBefore) &&
    (!backup ||
      (settingsNow.dock.edge === backup.dock.edge &&
        Math.abs(settingsNow.dock.alongPercent - backup.dock.alongPercent) < 0.2))
  record(
    'AC-25.1',
    '版本 1.5.0 且设置 v7→v8 迁移零丢失',
    migrationOk,
    `version=${version} schema=${settingsNow.schemaVersion} musicTheme=${settingsNow.music.theme} apps=${settingsNow.apps.length}` +
      (appsBefore === null ? '' : `（迁移前 ${appsBefore}）`)
  )

  /* AC-25.2 托盘创建 */
  const mainLog = join(LOG_DIR, 'main.log')
  const mainLogText = existsSync(mainLog) ? readFileSync(mainLog, 'utf8') : ''
  const trayCreated = mainLogText.includes('[tray] 托盘图标已创建')
  const trayFailed = mainLogText.includes('[tray] 托盘创建失败') || mainLogText.includes('[tray] 未找到托盘图标资源')
  record('AC-25.2', '托盘图标创建成功', trayCreated && !trayFailed, trayCreated ? '主进程日志确认' : '日志缺少创建记录')

  /* AC-25.3 Dock 渲染层新能力 */
  const dom = await dock.client.evaluate(`(() => {
    const root = document.querySelector('.dock-root')
    const items = [...document.querySelectorAll('.dock-item')]
    const style = root ? getComputedStyle(root) : null
    const toggles = [...document.querySelectorAll('.dock-music-toggle, .dock-clock-toggle')]
      .map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
    return {
      rootFound: !!root,
      maxW: style ? style.getPropertyValue('--dock-max-w').trim() : '',
      maxH: style ? style.getPropertyValue('--dock-max-h').trim() : '',
      itemCount: items.length,
      roving: items.filter((el) => el.getAttribute('tabindex') === '0').length,
      haspopup: items.filter((el) => el.getAttribute('aria-haspopup') === 'menu').length,
      scrollable: root ? root.getAttribute('data-scrollable') : null,
      toggles,
      emptyState: !!document.querySelector('.dock-empty')
    }
  })()`)
  const domOk =
    dom.rootFound &&
    dom.itemCount === settingsNow.apps.length &&
    dom.maxW.length > 0 &&
    dom.roving === 1 &&
    dom.haspopup === dom.itemCount
  record(
    'AC-25.3',
    'Dock 渲染层：上限注入 + roving tabindex + 菜单语义',
    domOk,
    `items=${dom.itemCount}/${settingsNow.apps.length} maxW=${dom.maxW} roving=${dom.roving} haspopup=${dom.haspopup} scrollable=${dom.scrollable}`
  )

  /* AC-25.5 命中区 */
  const minToggle = Math.min(...dom.toggles.map((t) => Math.min(t.w, t.h)))
  record('AC-25.5', '末端开关点击区 ≥24px', dom.toggles.length === 2 && minToggle >= 24, JSON.stringify(dom.toggles))

  /* AC-25.4 键盘方向键 */
  const keyboard = await dock.client.evaluate(`(() => {
    const items = [...document.querySelectorAll('.dock-item')]
    const edge = document.querySelector('.dock-root')?.getAttribute('data-edge') ?? 'bottom'
    if (items.length < 2) return { ok: false, reason: '图标不足 2 个' }
    items[0].focus()
    const before = document.activeElement?.getAttribute('aria-label') ?? ''
    const key = edge === 'left' || edge === 'right' ? 'ArrowDown' : 'ArrowRight'
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    return { ok: true, edge, key, before, after: document.activeElement?.getAttribute('aria-label') ?? '', index: items.indexOf(document.activeElement) }
  })()`)
  record(
    'AC-25.4',
    '方向键在 Dock 图标间移动焦点',
    keyboard.ok && keyboard.index === 1,
    `${keyboard.edge} ${keyboard.key}: ${keyboard.before} → ${keyboard.after}`
  )

  /* AC-25.7 音乐卡片（临时显示卡片，验证后还原） */
  await dock.client.evaluate(`window.nexus.settings.update({ music: { visible: true } })`)
  await sleep(1200)
  music = await openTarget('/music/')
  let musicDetail = '未找到音乐卡片页面'
  let musicOk = false
  if (music) {
    const card = await music.client.evaluate(`(() => {
      const card = document.querySelector('.music-card')
      const progress = document.querySelector('.music-progress')
      return {
        found: !!card,
        theme: card ? card.getAttribute('data-theme') : null,
        empty: !!document.querySelector('.music-card.is-empty, .music-empty'),
        sweeping: progress ? progress.classList.contains('is-sweeping') : null,
        hasProgress: !!progress
      }
    })()`)
    musicOk = card.found && card.theme !== null && card.hasProgress && card.sweeping === false
    musicDetail = JSON.stringify(card)
    await music.client.screenshot(join(OUT_DIR, 'music-card.png'))
    music.client.close()
  }
  await dock.client.evaluate(
    `window.nexus.settings.update({ music: { visible: ${JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')).music.visible === false} } })`
  )
  record('AC-25.7', '音乐卡片 data-theme 生效且空闲态不扫光', musicOk, musicDetail)

  /* AC-25.6 dock:snap 死通道（会轻微改变 Dock 位置，之后还原） */
  const originalDock = {
    edge: settingsNow.dock.edge,
    alongPercent: settingsNow.dock.alongPercent,
    freeX: settingsNow.dock.freeX,
    freeY: settingsNow.dock.freeY,
    snapToEdge: settingsNow.dock.snapToEdge
  }
  const snapResult = await dock.client.evaluate(`(async () => {
    try { const v = await window.nexus.dock.snap(); return { ok: true, value: v } }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } }
  })()`)
  await sleep(400)
  // 还原用户原来的 Dock 位置
  await dock.client.evaluate(
    `window.nexus.settings.update({ dock: ${JSON.stringify(originalDock)} })`
  )
  record(
    'AC-25.6',
    'dock:snap 死通道已修复（不再 reject）',
    snapResult.ok === true,
    snapResult.ok ? `返回 ${JSON.stringify(snapResult.value)}` : snapResult.error
  )

  /* Dock 截图留证 */
  await dock.client.screenshot(join(OUT_DIR, 'dock-v1.5.png'))

  /* AC-25.8 设置面板 */
  await dock.client.evaluate('window.nexus.window.openSettings()')
  await sleep(1500)
  settings = await openTarget('/settings/')
  let settingsDetail = '未找到设置窗口'
  let settingsOk = false
  if (settings) {
    const navInfo = await settings.client.evaluate(`(() => {
      const navs = [...document.querySelectorAll('.settings-nav-item')]
      return {
        navCount: navs.length,
        hasErrorBanner: !!document.querySelector('.settings-error-banner'),
        labels: navs.map((b) => (b.textContent ?? '').trim())
      }
    })()`)
    const clickNav = async (label) => {
      const clicked = await settings.client.evaluate(`(() => {
        const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => (b.textContent ?? '').includes(${JSON.stringify(label)}))
        if (!btn) return false
        btn.click()
        return true
      })()`)
      // 分组切换是 220ms 淡入位移转场 + React 重渲染，必须等一拍再读文本
      await sleep(420)
      return clicked
    }
    const readText = () => settings.client.evaluate(`document.querySelector('.settings-content')?.innerText ?? ''`)
    await clickNav('系统')
    const systemText = await readText()
    await clickNav('应用')
    const appsText = await readText()
    await clickNav('音乐')
    const musicText = await readText()
    const info = {
      ...navInfo,
      systemLockLabel: /锁定全部窗口位置[^\n]*[（(]\s*[0-3]\s*\/\s*3\s*[）)]/.test(systemText),
      systemLockTriStateHint: systemText.includes('/3'),
      resetAppList: appsText.includes('恢复默认应用列表'),
      musicTheme: musicText.includes('主题'),
      version: await settings.client.evaluate("document.querySelector('.settings-version')?.textContent ?? ''")
    }
    settingsOk =
      info.navCount === 7 &&
      info.hasErrorBanner === false &&
      info.systemLockLabel === true &&
      info.resetAppList === true &&
      info.musicTheme === true &&
      info.version.includes('1.5.0')
    settingsDetail = JSON.stringify(info)
    await settings.client.screenshot(join(OUT_DIR, 'settings-v1.5.png'))
    settings.client.close()
  }
  record('AC-25.8', '设置面板：7 分组/无错误条/锁定 x/3/恢复默认应用列表/音乐主题', settingsOk, settingsDetail)
  await dock.client.evaluate('window.nexus.window.closeSettings()')

  /* AC-25.9 日志轮转 */
  const logSizes = {}
  let rotationOk = true
  for (const name of ['main.log', 'desktop.log', 'media.log', 'launch.log', 'main.log.1', 'media.log.1']) {
    const path = join(LOG_DIR, name)
    if (!existsSync(path)) continue
    const size = readFileSync(path).length
    logSizes[name] = size
    if (size > 1024 * 1024) rotationOk = false
  }
  record('AC-25.9', '日志单文件 ≤1MB（轮转生效）', rotationOk, JSON.stringify(logSizes))

  /* 内存与进程快照（参考指标，不做断言） */
  let memory = {}
  try {
    const out = execSync(
      'powershell -NoProfile -NonInteractive -Command "Get-Process NexusDockApp -ErrorAction SilentlyContinue | ForEach-Object { $_.Id.ToString() + \',\' + [int]($_.WorkingSet64/1MB) }"',
      { encoding: 'utf8', timeout: 20000 }
    )
    const rows = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split(',').map(Number))
    memory = {
      processCount: rows.length,
      workingSetMb: rows.reduce((sum, [, mb]) => sum + mb, 0),
      perProcess: rows.map(([pid, mb]) => ({ pid, mb }))
    }
  } catch (error) {
    memory = { error: String(error) }
  }
} catch (error) {
  record('FATAL', '验收脚本执行异常', false, String(error && error.message ? error.message : error))
} finally {
  try {
    dock?.client.close()
  } catch {
    /* ignore */
  }
}

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
const report = {
  version: '1.5.0',
  cdpPort: PORT,
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  passed,
  failed,
  results
}
writeFileSync(join(OUT_DIR, 'v15-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(`\n${passed}/${passed + failed} 通过；报告：docs/verification/v1.5/v15-report.json`)
process.exit(failed === 0 ? 0 : 1)
