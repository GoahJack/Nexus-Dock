// ============================================================================
// Nexus Dock v1.3.1 运行时验收：Dock 唤起已运行应用时保持窗口显示状态
//
// 用法：
//   node scripts/v131-verify.mjs                 # 默认 CDP 端口 9224
//   $env:NEXUS_CDP_PORT=9222; node scripts/v131-verify.mjs
//
// 前置：安装版 Nexus Dock 已以 --remote-debugging-port=<PORT> 启动
//
// 做法：向 Dock 临时注入一个测试应用 fixture（独立 WinForms 窗口，标题
// 「Nexus WindowState Probe」），用 Win32 ShowWindow 设置最大化/最小化/普通状态，
// 再通过 Dock 的 apps:launch 唤起，检查窗口状态是否被保持。
// 结束时删除 fixture、恢复用户 apps 列表、只关闭自己启动的测试窗口——
// 不会启动或关闭用户的真实应用。
//
// 产物：docs/verification/v1.3.1/v131-report.json + PNG 截图
// ============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9224)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.3.1')
const PROBE = join(ROOT, 'scripts', 'out', 'win-probe.exe')
const FIXTURE_TITLE = 'Nexus WindowState Probe'
const FIXTURE_ID = 'verify-window-state-v131'
// fixture 放在 LOCALAPPDATA（正常权限、无工作区 Low 完整性标签），只由 Dock 启动并只关闭自己
const FIXTURE_DIR = join(process.env['LOCALAPPDATA'] ?? ROOT, 'NexusDock', 'v131-fixture')
const FIXTURE_SRC = join(FIXTURE_DIR, 'probe.cs')
const FIXTURE_EXE = join(FIXTURE_DIR, 'probe.exe')

mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rel = (file) => relative(ROOT, file).split(sep).join('/')
const run = (file, args) => spawnSync(file, args, { encoding: 'utf8' })
const probe = (cmd, extra = []) => {
  const result = run(PROBE, [cmd, ...extra])
  try {
    const text = String(result.stdout || '').trim()
    return cmd === 'SHOT' ? { ok: true } : JSON.parse(text)
  } catch (error) {
    throw new Error(`win-probe ${cmd} failed: ${result.stdout} ${result.stderr}`)
  }
}
const ps = (script) =>
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script])

const checks = []
const screenshots = []
const notes = []
const addCheck = (id, ac, pass, detail) => {
  checks.push({ id, ac, pass: pass === true, detail })
  console.log(`${pass === true ? 'PASS' : 'FAIL'}  ${id}  [${ac}]  ${JSON.stringify(detail).slice(0, 220)}`)
}
const shot = (name) => {
  const path = join(OUT_DIR, name)
  probe('SHOT', [path])
  screenshots.push(rel(path))
}

async function connect(match) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const target = targets.find((item) => item.type === 'page' && item.url.includes(match))
  if (!target) throw new Error(`未找到 target：${match}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description)
    return result.result.value
  }
  return { evaluate, close: () => ws.close() }
}

/** 查找测试窗口（按标题精确包含，避免命中用户窗口） */
function findFixtureWindow() {
  const windows = probe('WINS')
  const found = windows.filter((item) => String(item.title).includes(FIXTURE_TITLE))
  return found.length > 0 ? found[0] : null
}

/** 通过 hwnd 设置窗口显示状态：3=最大化 6=最小化 1=普通 */
function setWindowState(hwnd, command) {
  ps(
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);' -Name NexusWin -Namespace NexusProbe; [void][NexusProbe.NexusWin]::ShowWindow([IntPtr]${hwnd}, ${command})`
  )
}

const stateOf = (label) => {
  const win = findFixtureWindow()
  return win
    ? { label, title: win.title, pid: win.pid, hwnd: win.hwnd, min: win.min, max: win.max, rect: win.rect }
    : { label, missing: true }
}
const foregroundTitle = () => probe('FG')?.title ?? ''

const writeFixture = () => {
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  } catch {
    /* exe 可能仍被上次 fixture 进程占用，主流程会先杀残留再调用本函数 */
  }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(
    FIXTURE_SRC,
    `using System;
using System.Drawing;
using System.Windows.Forms;
class NexusWindowStateProbe {
  [STAThread]
  static void Main() {
    Application.EnableVisualStyles();
    var form = new Form();
    form.Text = "${FIXTURE_TITLE}";
    form.Width = 760;
    form.Height = 460;
    form.StartPosition = FormStartPosition.CenterScreen;
    form.BackColor = Color.FromArgb(28, 30, 38);
    var label = new Label();
    label.Text = "Nexus window state verification fixture";
    label.ForeColor = Color.White;
    label.AutoSize = true;
    label.Location = new Point(24, 24);
    form.Controls.Add(label);
    Application.Run(form);
  }
}
`,
    'utf8'
  )
  const csc = join(process.env['WINDIR'] ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!existsSync(csc)) throw new Error(`找不到 C# 编译器：${csc}`)
  const result = run(csc, [
    '/nologo',
    '/target:winexe',
    `/out:${FIXTURE_EXE}`,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    FIXTURE_SRC
  ])
  if (result.status !== 0 || !existsSync(FIXTURE_EXE)) {
    throw new Error(`fixture 编译失败：${result.stdout} ${result.stderr}`)
  }
}

let fixturePid = 0
let appsSnapshot = null
let dock = null
const startedAt = new Date().toISOString()
const exceptions = []

async function main() {
  // 先清理上次异常退出可能残留的测试窗口（按标题，只关闭 fixture 自己的进程），避免 exe 被占用
  const staleBefore = findFixtureWindow()
  if (staleBefore?.pid) ps(`Stop-Process -Id ${staleBefore.pid} -Force -ErrorAction SilentlyContinue`)
  await sleep(800)

  writeFixture()
  addCheck('A2-fixture-built', 'AC-20.5', existsSync(FIXTURE_EXE), { path: rel(FIXTURE_EXE) })

  dock = await connect('/dock/')
  const env = await dock.evaluate('window.nexus.env')
  const settings = await dock.evaluate('window.nexus.settings.get()')
  addCheck('A1-app-version', 'AC-20.5', String(env?.appVersion) === '1.3.1' && env?.isPackaged === true, {
    appVersion: env?.appVersion,
    isPackaged: env?.isPackaged,
    schemaVersion: settings?.schemaVersion
  })

  appsSnapshot = settings?.apps ?? []
  const fixtureItem = {
    id: FIXTURE_ID,
    name: FIXTURE_TITLE,
    path: FIXTURE_EXE,
    source: 'custom'
  }
  await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify([...appsSnapshot, fixtureItem])} })`)
  await sleep(700)

  const launch = () => dock.evaluate(`window.nexus.apps.launch(${JSON.stringify(FIXTURE_ID)})`)

  // W1：首次启动测试应用并找到窗口
  const firstLaunch = await launch()
  let win = null
  for (let i = 0; i < 30; i++) {
    await sleep(400)
    win = findFixtureWindow()
    if (win) break
  }
  fixturePid = win?.pid ?? 0
  addCheck('W1-launch-fixture', 'AC-20.4', firstLaunch?.ok === true && !!win, {
    result: firstLaunch,
    window: win ? { title: win.title, pid: win.pid, max: win.max, min: win.min } : null
  })
  if (!win) throw new Error('测试窗口未出现，无法继续窗口状态验收')

  // W2：设置为最大化
  setWindowState(win.hwnd, 3)
  await sleep(900)
  const maximized = stateOf('after-maximize')
  addCheck('W2-fixture-maximized', 'AC-20.1', maximized.max === true && maximized.min === false, maximized)

  // W3（核心）：已运行且最大化时通过 Dock 唤起，状态必须保持最大化
  const secondLaunch = await launch()
  await sleep(2000)
  const afterMaxActivate = stateOf('after-dock-activate')
  const fgAfterMax = foregroundTitle()
  addCheck(
    'W3-activate-keeps-maximized',
    'AC-20.1 / AC-20.2',
    secondLaunch?.ok === true &&
      afterMaxActivate.max === true &&
      afterMaxActivate.min === false &&
      fgAfterMax === FIXTURE_TITLE,
    { result: secondLaunch, state: afterMaxActivate, foregroundTitle: fgAfterMax }
  )
  shot('maximized-preserved.png')

  // W4：最小化后状态应为最小化
  setWindowState(win.hwnd, 6)
  await sleep(900)
  const minimized = stateOf('after-minimize')
  addCheck('W4-fixture-minimized', 'AC-20.3', minimized.min === true, minimized)

  // W5：最小化时通过 Dock 唤起 —— 应恢复显示，且回到最小化之前的最大化状态
  const thirdLaunch = await launch()
  await sleep(2000)
  const afterMinRestore = stateOf('after-dock-restore')
  const fgAfterMin = foregroundTitle()
  addCheck(
    'W5-restore-keeps-maximized',
    'AC-20.3',
    thirdLaunch?.ok === true &&
      afterMinRestore.min === false &&
      afterMinRestore.max === true &&
      fgAfterMin === FIXTURE_TITLE,
    { result: thirdLaunch, state: afterMinRestore, foregroundTitle: fgAfterMin }
  )
  shot('minimized-restored-maximized.png')

  // W6：普通窗口状态保持普通（不被误最大化/还原）
  setWindowState(win.hwnd, 1)
  await sleep(900)
  const normalized = stateOf('after-normalize')
  const fourthLaunch = await launch()
  await sleep(2000)
  const afterNormalActivate = stateOf('after-dock-activate-normal')
  addCheck(
    'W6-normal-stays-normal',
    'AC-20.4',
    normalized.max === false &&
      normalized.min === false &&
      fourthLaunch?.ok === true &&
      afterNormalActivate.max === false &&
      afterNormalActivate.min === false,
    { before: normalized, result: fourthLaunch, after: afterNormalActivate }
  )
  await sleep(300)
  addCheck('A9-no-runtime-exceptions', 'AC-20.5', exceptions.length === 0, {
    count: exceptions.length
  })

  // W7：apps 列表恢复
  await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify(appsSnapshot)} })`)
  await sleep(700)
  const restoredApps = await dock.evaluate('window.nexus.settings.get().then((s) => s.apps)')
  const appsRestored =
    Array.isArray(restoredApps) &&
    restoredApps.length === appsSnapshot.length &&
    JSON.stringify(restoredApps) === JSON.stringify(appsSnapshot)
  addCheck('W7-apps-restored', 'AC-20.5', appsRestored, {
    originalCount: appsSnapshot.length,
    restoredCount: Array.isArray(restoredApps) ? restoredApps.length : null
  })

  notes.push('测试使用独立 WinForms fixture 窗口（标题 Nexus WindowState Probe），不启动也不关闭用户的真实应用。')
  notes.push('修复点：Activate-Win 由「无条件 ShowWindow(SW_RESTORE=9)」改为「仅最小化时 SW_RESTORE」，最大化/普通窗口只 BringWindowToTop + SetForegroundWindow。')
  notes.push('W3 是用户报告场景：应用已运行且最大化，点 Dock 后不得先最大化出现再被还原。')
}

let fatalError = null
try {
  await main()
} catch (error) {
  fatalError = error
  addCheck('Z-script', 'script', false, String(error?.stack ?? error))
} finally {
  // 恢复 apps / 清理测试窗口与 fixture 文件
  try {
    if (dock && appsSnapshot) {
      await dock.evaluate(`window.nexus.settings.update({ apps: ${JSON.stringify(appsSnapshot)} })`)
    }
  } catch (error) {
    exceptions.push(`restore apps: ${String(error)}`)
  }
  try {
    if (fixturePid > 0) ps(`Stop-Process -Id ${fixturePid} -Force -ErrorAction SilentlyContinue`)
    const leftover = findFixtureWindow()
    if (leftover?.pid) ps(`Stop-Process -Id ${leftover.pid} -Force -ErrorAction SilentlyContinue`)
    await sleep(500)
  } catch {
    /* ignore */
  }
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  dock?.close()

  const failed = checks.filter((check) => check.pass !== true)
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    port: PORT,
    scope: 'Dock 唤起已运行应用时保持窗口显示状态（v1.3.1）',
    checks,
    screenshots,
    notes,
    exceptions,
    fatalError: fatalError ? String(fatalError?.stack ?? fatalError) : null,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      failedIds: failed.map((check) => check.id)
    }
  }
  const reportPath = join(OUT_DIR, 'v131-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n===== 汇总：${report.summary.passed}/${report.summary.total} 通过，${report.summary.failed} 失败 =====`)
  console.log(`报告：${rel(reportPath)}`)
  console.log(`截图：${screenshots.length} 张 → ${rel(OUT_DIR)}`)
  process.exitCode = report.summary.failed === 0 && !fatalError ? 0 : 1
}
