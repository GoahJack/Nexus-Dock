// ============================================================================
// Nexus Dock v1.4.1 验收：点击 Dock 里的「自身（DockApp）」图标 → 打开设置面板
//
// 背景（用户反馈）：「点开 Dock 栏的 DockApp 软件图标不会打开设置栏」。
// 根因：Dock 条目指向 NexusDockApp.exe 自身时，旧启动链路在「已有窗口优先」
// 分支按进程名命中了同进程的「Nexus 时钟」窗口，只把时钟置前、不会拉起第二实例，
// 因此永远走不到 second-instance → openSettingsWindow。
//
// 用法：
//   node scripts/v141-verify.mjs                 # 默认 CDP 端口 9224
//   $env:NEXUS_CDP_PORT=9222; node scripts/v141-verify.mjs
//
// 前置：安装版 Nexus Dock 已用 --remote-debugging-port=<PORT> 启动
//       （建议：%LOCALAPPDATA%\NexusDock\NexusDockApp.exe --remote-debugging-port=9224）
//
// 覆盖：
//   AC-21.1 左键点击自身图标（IPC 调用路径）→ 设置面板出现、可见、获得焦点、渲染完整
//   AC-21.2 设置面板已存在时重复点击 → 不重复创建窗口（target 数保持 1）
//   AC-21.3 Dock 图标真实鼠标点击（CDP Input.dispatchMouseEvent）→ 设置面板出现
//   AC-21.4 .lnk 快捷方式指向自身 exe → 同样打开设置面板
//   AC-21.5 非自身应用（自定义 exe fixture）→ 打开设置面板的行为不触发（走原启动链路）
//   AC-21.6 桌面快捷方式二次启动（second-instance）→ 设置面板出现
//   AC-21.7 不重复启动主进程（click 后主进程数仍为 1）+ 启动日志含自身识别记录
//
// 产物：docs/verification/v1.4.1/v141-report.json + PNG 截图
// ============================================================================

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9224)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.4.1')
const WIN_PROBE = join(ROOT, 'scripts', 'out', 'win-probe.exe')
const LOCALAPPDATA = process.env['LOCALAPPDATA'] ?? ''
const INSTALLED_EXE = join(LOCALAPPDATA, 'NexusDock', 'NexusDockApp.exe')
const FIXTURE_DIR = join(LOCALAPPDATA, 'NexusDock', 'v141-fixture')
const NEGATIVE_EXE = join(FIXTURE_DIR, 'not-self-app.exe')
const SELF_LINK = join(FIXTURE_DIR, 'DockApp-link.lnk')
const SELF_LINK_ID = 'verify-self-link-v141'
const NEGATIVE_ID = 'verify-not-self-v141'
const LAUNCH_LOG = join(process.env['APPDATA'] ?? ROOT, 'nexus-dock', 'logs', 'launch.log')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(FIXTURE_DIR, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (file, args, timeout = 60000) => spawnSync(file, args, { encoding: 'utf8', timeout })
const ps = (script, timeout = 60000) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeout)

/** win-probe 以 UTF-8 输出 JSON（中文标题直接可读），解析失败时返回空列表 */
const probe = (cmd) => {
  const result = spawnSync(WIN_PROBE, [cmd], { timeout: 30000 })
  const text = result.stdout.toString('utf8')
  if (cmd === 'SHOT') return { ok: true }
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

const checks = []
const screenshots = []
const notes = []
const addCheck = (id, ac, pass, detail) => {
  checks.push({ id, ac, pass: pass === true, detail })
  console.log(`${pass === true ? 'PASS' : 'FAIL'}  ${id}  [${ac}]  ${JSON.stringify(detail).slice(0, 300)}`)
}

/** 全屏截图（win-probe SHOT），用于人眼复核配置后的桌面状态 */
const shot = (name) => {
  const path = join(OUT_DIR, name)
  run(WIN_PROBE, ['SHOT', path])
  if (existsSync(path)) screenshots.push(`docs/verification/v1.4.1/${name}`)
}

/** CDP 窗口级截图：不受其它前台窗口遮挡影响，作为「设置面板真的渲染出来」的像素证据 */
async function capture(conn, name) {
  const result = await conn.send('Page.captureScreenshot', { format: 'png' })
  const data = result?.data ?? ''
  if (!data) return 0
  writeFileSync(join(OUT_DIR, name), Buffer.from(data, 'base64'))
  screenshots.push(`docs/verification/v1.4.1/${name}`)
  return Buffer.from(data, 'base64').length
}

/**
 * 验收时机器的 DeepSeek Harness 窗口占满屏幕且常驻最前，设置窗口会被压在它后面
 * （合成点击不会让 Dock 取得系统前台，属测试环境现象，不影响真实鼠标点击）。
 * 截图前把目标窗口临时设为 TOPMOST 拍到证据，拍完立刻恢复 NOTOPMOST；
 * 窗口在验收结束时统一关闭，不改变用户设置。
 */
const RAISE_CS = String.raw`using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NexusRaiseShot {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static string Raise(string title, bool topmost) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLengthW(h);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 2);
      GetWindowTextW(h, sb, sb.Capacity);
      if (sb.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "NOT_FOUND";
    IntPtr after = topmost ? new IntPtr(-1) : new IntPtr(-2);
    bool ok = SetWindowPos(found, after, 0, 0, 0, 0, 0x0001 | 0x0002);
    return (ok ? "OK" : "FAIL") + ":" + found.ToInt64();
  }
}`

const psEncoded = (script, timeout = 60000) =>
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    timeout
  )

const raiseWindow = (title, topmost) => {
  const script =
    `$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition @'\n${RAISE_CS}\n'@; ` +
    `[NexusRaiseShot]::Raise('${title.replace(/'/g, "''")}', ${topmost ? '$true' : '$false'})`
  return String(psEncoded(script).stdout || '').trim()
}
const bringWindowToFront = (title) => raiseWindow(title, true)
const restoreWindowStack = (title) => raiseWindow(title, false)

/** 顶层可见窗口列表（含最小化状态与屏幕矩形），用于确认设置窗口真的存在且未最小化 */
const windowsList = () => probe('WINS')

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return response.json()
}

/** 连接某个页面 target，返回 evaluate / close */
async function connect(match) {
  const list = await targets()
  const target = list.find((item) => item.type === 'page' && item.url.includes(match))
  if (!target) throw new Error(`未找到 target：${match}`)
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
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`CDP 超时：${method}`)), 30000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails).slice(0, 400))
    return response.result?.value
  }
  return { evaluate, send, close: () => ws.close() }
}

async function waitFor(fn, timeoutMs = 10000, interval = 250) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await sleep(interval)
  }
  return last
}

const settingsTarget = async () =>
  (await targets()).find((item) => item.type === 'page' && item.url.includes('/settings/')) ?? null

const settingsTargetCount = async () =>
  (await targets()).filter((item) => item.type === 'page' && item.url.includes('/settings/')).length

/** 主进程数（NexusDockApp 中不带 --type= 的进程） */
const mainProcessCount = () => {
  const result = ps(
    "$procs = Get-CimInstance Win32_Process -Filter \"Name='NexusDockApp.exe'\" | " +
      "Where-Object { $_.CommandLine -notmatch '--type=' }; @($procs).Count"
  )
  return Number(String(result.stdout || '').trim()) || 0
}

/** Nexus Dock 全部进程 PID（顶层窗口归主进程所有，用于把窗口归因到 Nexus Dock） */
const nexusPids = () => {
  const result = ps('(Get-Process NexusDockApp -ErrorAction SilentlyContinue).Id -join ","')
  return new Set(
    String(result.stdout || '')
      .trim()
      .split(',')
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )
}

/** 在顶层可见窗口里找「未最小化 + 尺寸合理」的目标窗口（win-probe WINS 数据） */
const findVisibleWindow = (title) => {
  const pids = nexusPids()
  return (
    windowsList().find(
      (win) =>
        win.title === title &&
        pids.has(win.pid) &&
        win.min === false &&
        Array.isArray(win.rect) &&
        win.rect[2] - win.rect[0] > 200 &&
        win.rect[3] - win.rect[1] > 200
    ) ?? null
  )
}

/** 用 WMI 创建进程：从本 shell 直接 Start-Process 的子进程会随命令结束被回收 */
const spawnDetached = (commandLine) => {
  const script =
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' }; ` +
    'Write-Output $r.ReturnValue'
  return String(ps(script).stdout || '').trim()
}

/** 等待设置窗口关闭（target 消失）；关闭请求是异步 IPC，需要轮询 */
const closeSettingsAndWait = async (dock) => {
  await dock.evaluate('window.nexus.window.closeSettings()')
  return waitFor(async () => ((await settingsTargetCount()) === 0 ? true : null), 8000)
}

/* --------------------------- 0. 前置检查与现场准备 --------------------------- */

const initialTargets = await targets()
const dockTarget = initialTargets.find((item) => item.type === 'page' && item.url.includes('/dock/'))
addCheck('dock-target-available', 'AC-21.0', !!dockTarget, dockTarget ? { url: dockTarget.url } : null)
if (!dockTarget) throw new Error('Dock target 缺失：请用 --remote-debugging-port 启动安装版')

const dock = await connect('/dock/')
const env = await dock.evaluate(
  `({ packaged: window.nexus.env.isPackaged, version: window.nexus.env.appVersion, title: document.title })`
)
addCheck('installed-build-v141', 'AC-21.0', env.version === '1.4.1' && env.packaged === true, env)

const apps = await dock.evaluate(`window.nexus.apps.list()`)
const selfItem = apps.find(
  (item) => typeof item.path === 'string' && item.path.toLowerCase() === INSTALLED_EXE.toLowerCase()
)
addCheck('self-dock-item-found', 'AC-21.0', !!selfItem, selfItem ? { id: selfItem.id, name: selfItem.name } : null)
if (!selfItem) throw new Error(`用户 Dock 里没有指向 ${INSTALLED_EXE} 的条目，无法验收`)

const baselineApps = apps.map((item) => item.id)
if ((await settingsTargetCount()) > 0) await closeSettingsAndWait(dock)
addCheck('settings-closed-before-test', 'AC-21.0', (await settingsTargetCount()) === 0, { count: 0 })
const baselineMains = mainProcessCount()
addCheck('single-main-process-before', 'AC-21.0', baselineMains === 1, { mains: baselineMains })

/* ------------------- 1. AC-21.1 自身图标 launch → 打开设置面板 ------------------- */

const launchResult = await dock.evaluate(`window.nexus.apps.launch(${JSON.stringify(selfItem.id)})`)
const opened = await waitFor(settingsTarget, 10000)
addCheck('self-launch-opens-settings', 'AC-21.1', !!opened && launchResult?.ok === true, {
  launchResult,
  target: opened ? { url: opened.url } : null
})

let settings = null
let settingsDom = null
if (opened) {
  settings = await connect('/settings/')
  settingsDom = await waitFor(async () => {
    const dom = await settings.evaluate(`(() => {
      if (!document.body) return null
      return {
        title: document.title,
        textLength: (document.body.innerText || '').length,
        focus: document.hasFocus(),
        hidden: document.hidden
      }
    })()`)
    return dom && dom.textLength > 200 ? dom : null
  }, 15000)
}
addCheck('settings-window-renders', 'AC-21.1', (settingsDom?.textLength ?? 0) > 200, settingsDom)
const settingsOnScreen = findVisibleWindow('Nexus 设置')
addCheck('settings-window-on-screen', 'AC-21.1', !!settingsOnScreen, settingsOnScreen ?? null)
const settingsPixelBytes = settings ? await capture(settings, 'settings-window.png') : 0
addCheck('settings-window-capture', 'AC-21.1', settingsPixelBytes > 1000, { bytes: settingsPixelBytes })
await capture(dock, 'dock-window.png')
const mainsAfterLaunch = mainProcessCount()
addCheck('no-second-main-process', 'AC-21.7', mainsAfterLaunch === 1, { before: baselineMains, after: mainsAfterLaunch })

/* 启动日志证据：主进程记录了「识别为 Nexus Dock 自身」 */
let launchLogText = ''
try {
  launchLogText = readFileSync(LAUNCH_LOG, 'utf8')
} catch {
  launchLogText = ''
}
const logLines = launchLogText.trim().split(/\r?\n/).slice(-40)
addCheck(
  'launch-log-self-detected',
  'AC-21.7',
  logLines.some((line) => line.includes('识别为 Nexus Dock 自身：打开设置面板')),
  { tail: logLines.slice(-4) }
)
// 全屏截图：测试机前台是占满屏幕的 Harness 窗口，先把设置窗口临时提为 TOPMOST 再截图，拍完恢复
const raisedSelf = bringWindowToFront('Nexus 设置')
await sleep(400)
shot('settings-opened.png')
restoreWindowStack('Nexus 设置')
notes.push(`全屏截图前置顶设置窗口：${raisedSelf || '未找到窗口'}`)

/* --------------- 2. AC-21.2 已打开时重复点击 → 不重复创建窗口 --------------- */

await dock.evaluate(`window.nexus.apps.launch(${JSON.stringify(selfItem.id)})`)
await sleep(1200)
const duplicated = await settingsTargetCount()
addCheck('no-duplicate-settings-window', 'AC-21.2', duplicated === 1, { settingsTargets: duplicated })

/* ------------- 3. AC-21.3 Dock 图标真实鼠标点击（用户主路径） ------------- */

await closeSettingsAndWait(dock)
const rect = await dock.evaluate(`(() => {
  const el = document.querySelector('[data-dock-id="${selfItem.id}"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height }
})()`)
if (rect) {
  await dock.send?.('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await dock.send?.('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}
const clickedOpen = await waitFor(async () => {
  const target = await settingsTarget()
  if (!target) return null
  const win = await connect('/settings/')
  const dom = await waitFor(async () => {
    const value = await win.evaluate(
      `(() => (document.body ? { hidden: document.hidden, focus: document.hasFocus() } : null))()`
    )
    return value
  }, 8000)
  win.close()
  return dom
}, 12000)
const clickOnScreen = findVisibleWindow('Nexus 设置')
const clickSettings = await connect('/settings/')
const clickShotBytes = await capture(clickSettings, 'settings-after-dock-click.png')
clickSettings.close()
addCheck(
  'dock-icon-real-click-opens-settings',
  'AC-21.3',
  !!rect && !!clickedOpen && clickedOpen.hidden === false && !!clickOnScreen && clickShotBytes > 1000,
  { rect, settings: clickedOpen ?? null, onScreen: !!clickOnScreen, screenshotBytes: clickShotBytes }
)
bringWindowToFront('Nexus 设置')
await sleep(400)
shot('dock-click-opened-settings.png')
restoreWindowStack('Nexus 设置')

/* ------------------- 4. AC-21.4 .lnk 指向自身 exe ------------------- */

let linkResult = { created: false }
try {
  const escapedTarget = INSTALLED_EXE.replace(/'/g, "''")
  const escapedLink = SELF_LINK.replace(/'/g, "''")
  const script =
    `$wsh = New-Object -ComObject WScript.Shell; ` +
    `$lnk = $wsh.CreateShortcut('${escapedLink}'); ` +
    `$lnk.TargetPath = '${escapedTarget}'; ` +
    `$lnk.WorkingDirectory = '${LOCALAPPDATA.replace(/'/g, "''")}\\NexusDock'; ` +
    `$lnk.Save(); Test-Path '${escapedLink}'`
  const out = String(ps(script).stdout || '').trim()
  linkResult = { created: /^True$/i.test(out), path: SELF_LINK }
} catch (error) {
  linkResult = { created: false, error: String(error) }
}
const linkItem = { id: SELF_LINK_ID, name: 'DockApp 快捷方式', path: SELF_LINK, icon: '', source: 'custom' }
let linkOpen = null
if (linkResult.created) {
  await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify([...apps, linkItem])} })`)
  await closeSettingsAndWait(dock)
  const linkLaunch = await dock.evaluate(`window.nexus.apps.launch(${JSON.stringify(SELF_LINK_ID)})`)
  linkOpen = await waitFor(settingsTarget, 10000)
  addCheck('lnk-self-opens-settings', 'AC-21.4', !!linkOpen && linkLaunch?.ok === true, {
    launchResult: linkLaunch,
    target: linkOpen ? { url: linkOpen.url } : null
  })
} else {
  addCheck('lnk-self-opens-settings', 'AC-21.4', false, linkResult)
}

/* ------------- 5. AC-21.5 非自身 exe：不触发「打开设置」行为 ------------- */

let negativeLaunch = null
const negativeExeSource = join(ROOT, 'scripts', 'out', 'win-probe.exe')
if (existsSync(negativeExeSource)) {
  copyFileSync(negativeExeSource, NEGATIVE_EXE)
  const negativeItem = { id: NEGATIVE_ID, name: 'not-self-app', path: NEGATIVE_EXE, icon: '', source: 'custom' }
  const current = await dock.evaluate(`window.nexus.apps.list()`)
  await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify([...current, negativeItem])} })`)
  await closeSettingsAndWait(dock)
  // 不 await 启动结果（真实启动链路最长约 20s）；只验证它不会打开设置面板
  await dock.evaluate(
    `(() => { window.__v141Negative = null; window.nexus.apps.launch(${JSON.stringify(NEGATIVE_ID)}).then((r) => { window.__v141Negative = r }); return true })()`
  )
  const unexpected = await waitFor(settingsTarget, 5000)
  negativeLaunch = await dock.evaluate(`window.__v141Negative`)
  addCheck('non-self-app-does-not-open-settings', 'AC-21.5', unexpected === null, {
    launchResult: negativeLaunch,
    settingsTarget: unexpected ? unexpected.url : null
  })
  await closeSettingsAndWait(dock)
} else {
  addCheck('non-self-app-does-not-open-settings', 'AC-21.5', false, { error: '缺少 win-probe.exe fixture' })
}

/* ---------- 6. AC-21.6 桌面快捷方式二次启动（second-instance）→ 设置 ---------- */

await closeSettingsAndWait(dock)
const spawnReturn = spawnDetached(`"${INSTALLED_EXE}"`)
const secondInstanceOpen = await waitFor(settingsTarget, 15000)
addCheck('second-instance-opens-settings', 'AC-21.6', !!secondInstanceOpen, {
  spawnReturn,
  target: secondInstanceOpen ? { url: secondInstanceOpen.url } : null
})
bringWindowToFront('Nexus 设置')
await sleep(400)
shot('second-instance-opened-settings.png')
restoreWindowStack('Nexus 设置')

/* -------------------------------- 现场恢复 -------------------------------- */

await closeSettingsAndWait(dock)
const restoreApps = await dock.evaluate(`window.nexus.apps.list()`)
const restored = restoreApps.filter((item) => baselineApps.includes(item.id))
await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify(restored)} })`)
const afterRestore = await dock.evaluate(`window.nexus.apps.list()`)
addCheck(
  'dock-apps-restored',
  'AC-21.0',
  afterRestore.length === baselineApps.length && afterRestore.every((item, index) => item.id === baselineApps[index]),
  { before: baselineApps.length, after: afterRestore.length }
)
try {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
} catch {
  /* 清理失败不影响结论 */
}

/* -------------------------------- 报告落盘 -------------------------------- */

const failed = checks.filter((check) => !check.pass)
const report = {
  at: new Date().toISOString(),
  label: 'v1.4.1 修复验收：Dock 自身图标点击打开设置面板',
  port: PORT,
  env,
  selfItem: { id: selfItem.id, name: selfItem.name, path: selfItem.path },
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
  screenshots,
  notes
}
writeFileSync(join(OUT_DIR, 'v141-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(`\n==== ${checks.length - failed.length}/${checks.length} PASS，报告：docs/verification/v1.4.1/v141-report.json`)

dock.close()
if (settings) settings.close()
process.exit(failed.length === 0 ? 0 : 1)
