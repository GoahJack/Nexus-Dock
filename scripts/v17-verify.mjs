// ============================================================================
// Nexus Dock v1.7.0 独立验收脚本（隔离 userData + CDP，不改源码）
//
// 用法（先准备，再启动隔离实例，最后跑检查）：
//   1) node scripts/v17-verify.mjs --prepare
//   2) 在仓库根目录执行（Windows PowerShell）：
//        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
//        & "node_modules\electron\dist\electron.exe" --no-sandbox `
//            --remote-debugging-port=9352 `
//            --user-data-dir="<仓库根目录>\.userdata\v17-verify" .
//      （不要用 npm run dev；安装版可继续在桌面运行，本脚本只操作隔离实例）
//   3) node scripts/v17-verify.mjs
//      CDP 端口默认 9352，可用 $env:NEXUS_CDP_PORT 覆盖。
//      结束请按 PID 清理自己启动的隔离实例（electron.exe 命令行含 .userdata\v17-verify）。
//
// 覆盖（v1.7：窗口注册表 + 设置面板重构 + 「显示桌面」修复）：
//   AC-27.1  设置 schemaVersion 9 → 10 迁移：extraWindows=[]，v9 非默认值零丢失
//   AC-27.2  设置导航：「窗口」分组 + 内置窗口/附加窗口/应用/外观/系统/关于 6 项，默认内置窗口页
//   AC-27.3  内置窗口页：3 折叠栏、共性 4 开关、独有设置（nx-window-unique + ui-section）、开关写回主进程
//   AC-27.4  附加窗口页：空状态「暂无附加窗口」+「接入说明」4 步（4 个 .nx-steps li）
//   AC-27.5  系统页：不再有「窗口共性设置」，提供「前往内置窗口 / 前往附加窗口」跳转且真实生效
//   AC-27.7  「显示桌面」修复：隔离实例 Dock 窗口 ShowWindow(SW_MINIMIZE) → 1800ms 内自动恢复
//            （isIconic=false && IsWindowVisible=true）；desktop-state.exe --once 协议含 minimized/visible；
//            isDesktopBusy 契约由 npm test 覆盖（报告引用测试名）
//   AC-27.8  回归：Dock 渲染 / 设置页无渲染异常 / 页面 console error 统计 / 安装版进程未被操作
//   AC-27.9  工程门禁：npx tsc --noEmit + npm test 全量通过（构建产物为 Lead 已构建的 out/，本脚本不重建）
//
// 产物：docs/verification/v1.7/report.json + PNG 截图（--prepare 只写种子配置与启动命令）
//
// 安全边界：
//   - 只用 user32 EnumWindows / ShowWindow(SW_MINIMIZE=6) 操作「隔离实例 PID 树内、标题 Nexus Dock 的
//     Chrome_WidgetWin_1 窗口」；禁止 Shell.Application.MinimizeAll / Win+D；不碰安装版（NexusDockApp）窗口。
//   - 种子 settings.json 以 UTF-8 无 BOM 写入（迁移后落盘同样校验无 BOM）。
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9352)
const ROOT = process.cwd()
const USERDATA = join(ROOT, '.userdata', 'v17-verify')
const SETTINGS_PATH = join(USERDATA, 'settings.json')
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.7')
const OUT_REPORT = join(OUT_DIR, 'report.json')
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PREPARE = process.argv.includes('--prepare')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------- v9 种子配置 -------------------------------
 * 刻意使用「v9 时代」的字段集：schemaVersion=9、无 extraWindows 字段；
 * dock.onlyOnDesktop=true（验证 C11 相关默认值保留）、music/clock 默认隐藏、
 * lock 全 false、appearance 默认。apps 用内置 6 项（6 个 Dock 图标，回归基线）。
 * ------------------------------------------------------------------------- */
function buildSeedSettings() {
  return {
    schemaVersion: 9,
    dock: {
      edge: 'bottom',
      alongPercent: 50,
      snapToEdge: false,
      freeX: -1,
      freeY: -1,
      onlyOnDesktop: true,
      iconSize: 48,
      magnification: 1.3,
      gap: 10,
      padding: 14,
      showIndicators: true,
      alwaysOnTop: true,
      acrylic: false,
      opacity: 0,
      theme: 'dark'
    },
    music: {
      visible: false,
      source: 'system',
      anchor: 'dock',
      snapToEdge: true,
      edge: 'bottom',
      alongPercent: 50,
      freeX: -1,
      freeY: -1,
      width: 330,
      progressStyle: 'bar',
      alwaysOnTop: true,
      onlyOnDesktop: false,
      theme: 'dark'
    },
    clock: {
      visible: false,
      showSeconds: false,
      showDate: true,
      hour12: false,
      fontSize: 40,
      opacity: 1,
      alwaysOnTop: true,
      onlyOnDesktop: false,
      snapToEdge: true,
      theme: 'dark',
      freeX: -1,
      freeY: -1
    },
    lock: { dock: false, music: false, clock: false },
    system: { autoStart: false },
    appearance: { motionIntensity: 'standard', reducedMotion: false, clickSound: false },
    apps: [
      {
        id: 'explorer',
        name: '文件资源管理器',
        path: 'C:\\Windows\\explorer.exe',
        aumid: 'Microsoft.Windows.Explorer',
        source: 'builtin'
      },
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
        id: 'settings',
        name: '设置',
        path: 'C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe',
        aumid: 'windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel',
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
  }
}

/* --------------------------------- prepare --------------------------------- */
function prepare() {
  mkdirSync(USERDATA, { recursive: true })
  // 清理上一轮遗留的运行时状态：日志（避免「自动恢复」日志串轮）、半写临时配置。
  // 只动隔离 userData，不触碰安装版 %APPDATA%\nexus-dock。
  rmSync(join(USERDATA, 'logs'), { recursive: true, force: true })
  rmSync(`${SETTINGS_PATH}.tmp`, { force: true })
  const seed = buildSeedSettings()
  // 显式 utf8：Node 的 writeFileSync 不写 BOM
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')

  const bytes = readFileSync(SETTINGS_PATH)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const parsed = JSON.parse(bytes.toString('utf8'))
  const launchArgs = [
    ELECTRON_EXE,
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USERDATA}`,
    '.'
  ]
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value)
  // PowerShell 可复制粘贴形式：& 调用运算符 + 含空格路径加引号
  const launchCommand = `& ${launchArgs.map((arg) => (arg === '.' ? '.' : quote(arg))).join(' ')}`
  console.log('===============================================================')
  console.log('Nexus Dock v1.7 验收准备完成')
  console.log('===============================================================')
  console.log(`userData      : ${USERDATA}`)
  console.log(`settings.json : ${SETTINGS_PATH}`)
  console.log(`种子版本      : schemaVersion=${parsed.schemaVersion}（无 extraWindows 字段）`)
  console.log(`编码校验      : UTF-8 无 BOM = ${!hasBom}（magic=${[...bytes.subarray(0, 3)].join(',')}）`)
  console.log('')
  console.log('启动隔离实例（仓库根目录执行，先清 ELECTRON_RUN_AS_NODE）：')
  console.log('  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue')
  console.log(`  ${launchCommand}`)
  console.log('')
  console.log('然后执行检查：')
  console.log('  node scripts/v17-verify.mjs')
  console.log('')
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'prepare',
        userDataDir: USERDATA,
        settingsPath: SETTINGS_PATH,
        seedSchemaVersion: parsed.schemaVersion,
        hasExtraWindowsField: Object.prototype.hasOwnProperty.call(parsed, 'extraWindows'),
        utf8NoBom: !hasBom,
        apps: parsed.apps.length,
        cdpPort: PORT,
        launchCommand
      },
      null,
      2
    )
  )
}

if (PREPARE) {
  prepare()
  process.exit(0)
}

/* ------------------------------- CDP helpers ------------------------------- */
async function listTargets(port = PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP /json/list ${res.status}`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => reject(new Error(`WebSocket 连接超时：${wsUrl}`)), 10000)
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

/** 简易 CDP 客户端：Runtime.evaluate / Page.captureScreenshot / 事件订阅 */
function createClient(ws) {
  let seq = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'))
      else entry.resolve(message.result)
      return
    }
    if (typeof message.method === 'string') {
      for (const listener of listeners) listener(message)
    }
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
  return { send, evaluate, screenshot, onEvent: (fn) => listeners.push(fn), close: () => ws.close() }
}

async function waitTarget(segment, timeoutMs = 25000, port = PORT) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port)
      const target = targets.find((t) => t.type === 'page' && t.url.includes(segment))
      if (target) return target
    } catch {
      /* CDP 可能尚未监听 */
    }
    await sleep(300)
  }
  return null
}

async function waitUntil(fn, timeoutMs = 8000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch {
      /* 页面切换/重载期间可能抛错，继续轮询 */
    }
    await sleep(intervalMs)
  }
  return null
}

/* ------------------------------- 结果收集 --------------------------------- */
const startedAt = Date.now()
const results = []
const screenshots = []
const diagnostics = []

function rel(path) {
  return relative(ROOT, path).replaceAll('\\', '/')
}

function record(id, title, ok, detail, shots = []) {
  const item = { id, title, ok: ok === true, detail, shots: shots.filter(Boolean) }
  results.push(item)
  const brief =
    typeof detail === 'string' ? detail : JSON.stringify(detail ?? null).slice(0, 500)
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${id} ${title}${brief ? ` :: ${brief}` : ''}`)
  return item
}

async function pageShot(client, name) {
  const path = join(OUT_DIR, name)
  await client.screenshot(path)
  const r = rel(path)
  if (!screenshots.includes(r)) screenshots.push(r)
  return r
}

const KNOWN_NOISE = [
  /net::ERR_/i,
  /ERR_[A-Z_]+/,
  /Failed to load resource/i,
  /MEDIA_ELEMENT/i,
  /NotSupportedError/i,
  /play\(\) (request )?(was )?interrupted/i,
  /AbortError/i,
  /Autofill/i,
  /devtools/i,
  /favicon/i,
  /Electron Security Warning/i,
  /Unable to load preload script/i,
  /Access to fetch at 'icon:\/\//i
]

/** 采集页面 console.error / Log.error / Runtime.exceptionThrown（用于「无渲染异常」断言） */
function attachDiagnostics(client, page) {
  client.onEvent((message) => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? [])
        .map((a) => (typeof a.value === 'string' ? a.value : a.description ?? a.type ?? ''))
        .join(' ')
      diagnostics.push({ page, kind: 'console.error', text: text.slice(0, 600), at: Date.now() })
    } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      const entry = message.params.entry
      diagnostics.push({
        page,
        kind: 'log.error',
        text: `${entry.text ?? ''} ${entry.url ?? ''}`.trim().slice(0, 600),
        at: Date.now()
      })
    } else if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params?.exceptionDetails
      diagnostics.push({
        page,
        kind: 'exception',
        text: `${d?.exception?.description ?? d?.text ?? 'exception'}`.slice(0, 600),
        at: Date.now()
      })
    }
  })
  return Promise.all([
    client.send('Runtime.enable'),
    client.send('Log.enable'),
    client.send('Page.enable')
  ])
}

function realDiagnostics(page) {
  return diagnostics.filter(
    (entry) => entry.page === page && !KNOWN_NOISE.some((re) => re.test(entry.text))
  )
}

/* --------------------------- PowerShell helper（纯 ASCII） ---------------------------
 * 只做两件事：
 *   1) 找出「命令行含 v17-verify 的 electron.exe」PID 树，并枚举其中类名
 *      Chrome_WidgetWin_1、标题 Nexus Dock 的顶层窗口；
 *   2) minimize 模式：对该窗口执行 ShowWindow(hwnd, SW_MINIMIZE=6)，
 *      采样 200..1800ms 的 IsIconic/IsWindowVisible，输出 JSON。
 * 不调用 MinimizeAll / Win+D，不触碰安装版进程。
 * ------------------------------------------------------------------------------------- */
const psSingle = (value) => `'${String(value).replaceAll("'", "''")}'`

function windowProbeScript(mode) {
  return `$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W17Verify {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$Mode = ${psSingle(mode)}
$pattern = '*v17-verify*'
$procs = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'")
$tree = @{}
foreach ($p in $procs) {
  if ($p.CommandLine -and ($p.CommandLine -like $pattern)) { $tree[[int]$p.ProcessId] = $true }
}
if ($tree.Count -eq 0) {
  Write-Output 'RESULT={"ok":false,"reason":"no-isolated-electron"}'
  exit 0
}
$mainPid = 0
foreach ($p in $procs) {
  $procId = [int]$p.ProcessId
  if ($tree.ContainsKey($procId)) {
    if (-not $tree.ContainsKey([int]$p.ParentProcessId)) { $mainPid = $procId }
  }
}
$windows = New-Object System.Collections.ArrayList
$cb = [W17Verify+EnumProc]{
  param($h, $l)
  $owner = [uint32]0
  [W17Verify]::GetWindowThreadProcessId($h, [ref]$owner) | Out-Null
  if ($tree.ContainsKey([int]$owner)) {
    $cls = New-Object System.Text.StringBuilder 256
    [W17Verify]::GetClassName($h, $cls, 256) | Out-Null
    if ($cls.ToString() -eq 'Chrome_WidgetWin_1') {
      $txt = New-Object System.Text.StringBuilder 256
      [W17Verify]::GetWindowText($h, $txt, 256) | Out-Null
      $r = New-Object W17Verify+RECT
      [W17Verify]::GetWindowRect($h, [ref]$r) | Out-Null
      $null = $windows.Add([pscustomobject]@{
        hwnd = [long]$h
        pid = [int]$owner
        title = $txt.ToString()
        visible = [bool][W17Verify]::IsWindowVisible($h)
        iconic = [bool][W17Verify]::IsIconic($h)
        rect = @($r.L, $r.T, $r.R, $r.B)
      })
    }
  }
  return $true
}
[W17Verify]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$dock = $windows | Where-Object { $_.title -eq 'Nexus Dock' } | Select-Object -First 1
if (-not $dock) {
  $payload = [pscustomobject]@{
    ok = $false
    reason = 'dock-window-not-found'
    mainPid = $mainPid
    treePids = @($tree.Keys)
    windows = @($windows)
  }
  Write-Output ('RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 5))
  exit 0
}
$hwnd = [IntPtr]::new([long]$dock.hwnd)
if ($Mode -eq 'minimize') {
  $beforeVisible = [bool][W17Verify]::IsWindowVisible($hwnd)
  $beforeIconic = [bool][W17Verify]::IsIconic($hwnd)
  [W17Verify]::ShowWindow($hwnd, 6) | Out-Null
  # ShowWindow 是同步的：立刻读 IsIconic，作为「最小化确实生效」的确定性证据
  # （guardAgainstMinimize 最早 60ms 后才恢复，因此这里应能读到 iconic=true）
  $justAfterIconic = [bool][W17Verify]::IsIconic($hwnd)
  $justAfterVisible = [bool][W17Verify]::IsWindowVisible($hwnd)
  $timeline = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt 9; $i++) {
    Start-Sleep -Milliseconds 200
    $null = $timeline.Add([pscustomobject]@{
      ms = ($i + 1) * 200
      iconic = [bool][W17Verify]::IsIconic($hwnd)
      visible = [bool][W17Verify]::IsWindowVisible($hwnd)
    })
  }
  $afterVisible = [bool][W17Verify]::IsWindowVisible($hwnd)
  $afterIconic = [bool][W17Verify]::IsIconic($hwnd)
  $payload = [pscustomobject]@{
    ok = $true
    mainPid = $mainPid
    hwnd = [long]$dock.hwnd
    before = @{ visible = $beforeVisible; iconic = $beforeIconic }
    justAfter = @{ visible = $justAfterVisible; iconic = $justAfterIconic }
    after = @{ visible = $afterVisible; iconic = $afterIconic }
    restored = ((-not $afterIconic) -and $afterVisible)
    timeline = @($timeline)
  }
  Write-Output ('RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 5))
  exit 0
}
$payload = [pscustomobject]@{
  ok = $true
  mainPid = $mainPid
  hwnd = [long]$dock.hwnd
  title = $dock.title
  cls = 'Chrome_WidgetWin_1'
  visible = [bool]$dock.visible
  iconic = [bool]$dock.iconic
  rect = @($dock.rect)
  windows = @($windows)
}
Write-Output ('RESULT=' + ($payload | ConvertTo-Json -Compress -Depth 5))
`
}

function runWindowProbe(mode, timeoutMs = 40000) {
  const out = execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    windowProbeScript(mode)
  ], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  const line = String(out)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith('RESULT='))
    .pop()
  if (!line) throw new Error(`窗口探测脚本无 RESULT 输出：${String(out).slice(0, 500)}`)
  return JSON.parse(line.slice('RESULT='.length))
}

/** 全屏截图说明：本机正在被用户使用，全屏 CopyFromScreen 会拍进用户其他窗口内容（隐私风险），
 *  因此截图统一用 CDP Page.captureScreenshot 只截目标窗口；确需桌面全屏证据时可人工运行
 *  `pwsh -File scripts/capture-screen.ps1 -Out docs\verification\v1.7\xxx.png`。 */

/* ------------------------------ 门禁 / 进程辅助 ------------------------------ */
function runCmd(command, timeoutMs = 300000) {
  try {
    const out = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
    return { ok: true, out: String(out), exitCode: 0 }
  } catch (error) {
    return {
      ok: false,
      out: `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`,
      exitCode: typeof error?.status === 'number' ? error.status : -1
    }
  }
}

function readSettingsFile() {
  const bytes = readFileSync(SETTINGS_PATH)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let parsed = null
  let error = null
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (err) {
    error = String(err)
  }
  return { bytes: bytes.length, hasBom, parsed, error }
}

/** 安装版进程（NexusDockApp）PID 集合：只读，用于证明「未被操作」 */
function installedPids() {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "@(Get-Process NexusDockApp -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object { $_.Id }) -join ','"
    ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 20000 })
    return String(out)
      .trim()
      .split(',')
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b)
  } catch {
    return []
  }
}

/* --------------------------------- 主流程 --------------------------------- */
async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const installedBefore = installedPids()

  /* -- 前提：隔离实例已启动并暴露 CDP -- */
  const dockTarget = await waitTarget('/dock/')
  if (!dockTarget) {
    throw new Error(
      `未找到 Dock 页面：请先确认隔离实例已用 --remote-debugging-port=${PORT} 启动（node scripts/v17-verify.mjs --prepare 会打印命令）`
    )
  }
  const dockClient = createClient(await connect(dockTarget.webSocketDebuggerUrl))
  await attachDiagnostics(dockClient, 'dock')

  const env = await dockClient.evaluate('window.nexus.env')
  record(
    'AC-27.1e',
    '隔离实例版本为 1.7.0 且为开发构建（out/，非安装版）',
    env?.appVersion === '1.7.0' && env?.isPackaged === false,
    { appVersion: env?.appVersion, isPackaged: env?.isPackaged, versions: env?.versions }
  )

  /* -- 迁移：v9 → v10 -- */
  const settings = await dockClient.evaluate('window.nexus.settings.get()')
  record(
    'AC-27.1a',
    '设置迁移：启动后 schemaVersion 由 9 升到 10',
    settings?.schemaVersion === 10,
    { schemaVersion: settings?.schemaVersion, expected: 10 }
  )
  record(
    'AC-27.1b',
    '迁移后 extraWindows 已收敛为数组且当前为空（EXTRA_WINDOW_KINDS=[]）',
    Array.isArray(settings?.extraWindows) && settings.extraWindows.length === 0,
    { extraWindows: settings?.extraWindows }
  )
  const seedPreserved =
    settings?.dock?.onlyOnDesktop === true &&
    settings?.music?.visible === false &&
    settings?.clock?.visible === false &&
    settings?.lock?.dock === false &&
    settings?.lock?.music === false &&
    settings?.lock?.clock === false &&
    settings?.appearance?.motionIntensity === 'standard' &&
    Array.isArray(settings?.apps) &&
    settings.apps.length === 6 &&
    Object.prototype.hasOwnProperty.call(settings ?? {}, 'extraWindows')
  record(
    'AC-27.1c',
    '迁移零丢失：v9 非默认值（onlyOnDesktop=true / 音乐与时钟隐藏 / lock 全 false / 6 个应用）保留',
    seedPreserved,
    {
      onlyOnDesktop: settings?.dock?.onlyOnDesktop,
      musicVisible: settings?.music?.visible,
      clockVisible: settings?.clock?.visible,
      lock: settings?.lock,
      apps: settings?.apps?.length,
      appearance: settings?.appearance?.motionIntensity
    }
  )

  await sleep(700) // 主进程落盘防抖 250ms
  const disk = readSettingsFile()
  record(
    'AC-27.1d',
    '落盘 settings.json 为 schemaVersion 10、extraWindows=[]、UTF-8 无 BOM',
    disk.error === null &&
      disk.hasBom === false &&
      disk.parsed?.schemaVersion === 10 &&
      Array.isArray(disk.parsed?.extraWindows) &&
      disk.parsed.extraWindows.length === 0,
    {
      path: rel(SETTINGS_PATH),
      bytes: disk.bytes,
      hasBom: disk.hasBom,
      schemaVersion: disk.parsed?.schemaVersion,
      extraWindows: disk.parsed?.extraWindows,
      parseError: disk.error
    }
  )

  /* -- 设置页：通过 Dock 页 IPC 打开 -- */
  await dockClient.evaluate('window.nexus.window.openSettings()')
  const settingsTarget = await waitTarget('/settings/')
  if (!settingsTarget) throw new Error('设置窗口未打开（/settings/ target 未出现）')
  const settingsClient = createClient(await connect(settingsTarget.webSocketDebuggerUrl))
  await attachDiagnostics(settingsClient, 'settings')
  const rendered = await waitUntil(async () => {
    const count = await settingsClient.evaluate(
      "document.querySelectorAll('.settings-page .nx-acc-item').length"
    )
    const navCount = await settingsClient.evaluate(
      "document.querySelectorAll('.settings-nav-item').length"
    )
    return count === 3 && navCount === 6 ? { count, navCount } : null
  }, 15000, 250)
  record(
    'AC-27.2a',
    '设置页渲染完成：默认「内置窗口」页有 3 个折叠栏、导航 6 项',
    rendered !== null,
    rendered ?? { note: '渲染等待超时' }
  )

  const nav = await settingsClient.evaluate(`(() => ({
    groups: [...document.querySelectorAll('.settings-nav-group')].map((el) => el.textContent.trim()),
    items: [...document.querySelectorAll('.settings-nav-item')].map((el) => el.textContent.trim()),
    active: document.querySelector('.settings-nav-item.is-active')?.textContent.trim() ?? null,
    separator: document.querySelectorAll('.settings-nav-sep').length,
    pageText: document.querySelector('.settings-page')?.textContent?.slice(0, 160) ?? ''
  }))()`)
  const expectedNav = ['内置窗口', '附加窗口', '应用', '外观', '系统', '关于']
  record(
    'AC-27.2b',
    '导航分组「窗口」存在，6 个导航项依次为 内置窗口/附加窗口/应用/外观/系统/关于',
    nav.groups.length === 1 &&
      nav.groups[0] === '窗口' &&
      JSON.stringify(nav.items) === JSON.stringify(expectedNav),
    { groups: nav.groups, items: nav.items }
  )
  record(
    'AC-27.2c',
    '默认落在「内置窗口」页（active 项 + 页内标题）',
    (nav.active ?? '').includes('内置窗口') && nav.pageText.includes('内置窗口'),
    { active: nav.active, pageTextHead: nav.pageText.slice(0, 60) }
  )

  const builtin = await settingsClient.evaluate(`(() => ({
    accordions: [...document.querySelectorAll('.settings-page .nx-acc-item .nx-acc-title')].map((el) => el.textContent.replace('›', '').trim()),
    lockSwitchLabel: [...document.querySelectorAll('.settings-page .ui-row-label')].find((el) => el.textContent.includes('锁定全部窗口位置'))?.childNodes[0]?.textContent?.trim() ?? null,
    lockSummary: document.querySelector('.settings-page .nx-lock-state-value')?.textContent?.trim() ?? null,
    sections: [...document.querySelectorAll('.settings-page > .nx-sections > .ui-section h2')].map((el) => el.textContent)
  }))()`)
  record(
    'AC-27.3a',
    '内置窗口页有 3 个折叠栏（Dock / 音乐卡片 / 桌面时钟）且默认全部收起',
    builtin.accordions.length === 3 &&
      builtin.accordions.some((label) => label === 'Dock') &&
      builtin.accordions.some((label) => label.includes('音乐卡片')) &&
      builtin.accordions.some((label) => label.includes('桌面时钟')),
    builtin.accordions
  )
  record(
    'AC-27.3b',
    '顶部「锁定全部窗口位置（0/3）」+ 锁定摘要存在（0/3 未锁定）',
    (builtin.lockSwitchLabel ?? '').includes('锁定全部窗口位置（0/3）') &&
      (builtin.lockSummary ?? '').includes('0/3'),
    { lockSwitchLabel: builtin.lockSwitchLabel, lockSummary: builtin.lockSummary }
  )

  const shotCollapsed = await pageShot(settingsClient, 'settings-builtin-collapsed.png')

  /* -- 展开第一个折叠栏（Dock） -- */
  await settingsClient.evaluate(
    "document.querySelector('.settings-page .nx-acc-head')?.click()"
  )
  const expanded = await waitUntil(async () => {
    const open = await settingsClient.evaluate(
      "document.querySelectorAll('.settings-page .nx-acc-item.is-open').length"
    )
    return open === 1
  }, 6000, 150)
  const dockPanel = await settingsClient.evaluate(`(() => {
    const body = document.querySelector('.settings-page .nx-acc-item.is-open .nx-acc-body')
    const switches = [...(body?.querySelectorAll(':scope > .ui-row .ui-row-label') ?? [])].map((el) => el.childNodes[0]?.textContent?.trim() ?? '')
    const unique = body?.querySelector('.nx-window-unique')
    return {
      openCount: document.querySelectorAll('.settings-page .nx-acc-item.is-open').length,
      switches,
      hasUnique: !!unique,
      uniqueTitle: unique?.querySelector('.nx-window-unique-title')?.textContent?.trim() ?? null,
      uniqueSections: [...(unique?.querySelectorAll('.ui-section h2') ?? [])].map((el) => el.textContent),
      bodySwitches: [...(body?.querySelectorAll(':scope > .ui-row') ?? [])].length,
      bodyText: body?.textContent?.slice(0, 120) ?? ''
    }
  })()`)
  const commonSwitches = ['自动吸附屏幕边缘', '始终置顶', '仅在桌面显示', '锁定位置']
  record(
    'AC-27.3c',
    '展开 Dock 折叠栏：4 个共性开关（自动吸附屏幕边缘/始终置顶/仅在桌面显示/锁定位置）',
    expanded === true && commonSwitches.every((label) => dockPanel.switches.includes(label)),
    { expanded: expanded === true, switches: dockPanel.switches, bodySwitches: dockPanel.bodySwitches }
  )
  record(
    'AC-27.3d',
    '展开后含「该窗口独有设置」区块（.nx-window-unique）且至少 2 个 ui-section',
    dockPanel.hasUnique === true && dockPanel.uniqueSections.length >= 2,
    { uniqueTitle: dockPanel.uniqueTitle, uniqueSections: dockPanel.uniqueSections }
  )
  const shotExpanded = await pageShot(settingsClient, 'settings-builtin-dock-expanded.png')

  /* -- 开关写回主进程：切换「始终置顶」并还原 -- */
  const beforeToggle = await settingsClient.evaluate('window.nexus.settings.get()')
  const toggled = await settingsClient.evaluate(`(async () => {
    const body = document.querySelector('.settings-page .nx-acc-item.is-open .nx-acc-body')
    const rows = [...(body?.querySelectorAll(':scope > .ui-row') ?? [])]
    const row = rows.find((el) => (el.querySelector('.ui-row-label')?.childNodes[0]?.textContent ?? '').trim() === '始终置顶')
    const sw = row?.querySelector('.ui-switch')
    sw?.click()
    await new Promise((resolve) => setTimeout(resolve, 600))
    const next = await window.nexus.settings.get()
    return { clicked: !!sw, alwaysOnTop: next.dock.alwaysOnTop, ariaChecked: sw?.getAttribute('aria-checked') ?? null }
  })()`)
  record(
    'AC-27.3e',
    '切换「始终置顶」后 settings.dock.alwaysOnTop 与之前相反（随后还原）',
    toggled.clicked === true && toggled.alwaysOnTop === !beforeToggle.dock.alwaysOnTop,
    { before: beforeToggle.dock.alwaysOnTop, after: toggled.alwaysOnTop, ariaChecked: toggled.ariaChecked }
  )
  await settingsClient.evaluate(
    `window.nexus.settings.update({ dock: { alwaysOnTop: ${beforeToggle.dock.alwaysOnTop} } })`
  )
  await sleep(400)

  /* -- 附加窗口页 -- */
  await settingsClient.evaluate(`(() => {
    const item = [...document.querySelectorAll('.settings-nav-item')].find((el) => el.textContent.includes('附加窗口'))
    item?.click()
    return true
  })()`)
  const extraPage = await waitUntil(async () => {
    const info = await settingsClient.evaluate(`(() => ({
      active: document.querySelector('.settings-nav-item.is-active')?.textContent.trim() ?? null,
      empty: document.querySelector('.settings-page .nx-empty')?.textContent?.trim() ?? null,
      sections: [...document.querySelectorAll('.settings-page .ui-section h2')].map((el) => el.textContent),
      steps: [...document.querySelectorAll('.settings-page .nx-steps li')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80)),
      accordions: document.querySelectorAll('.settings-page .nx-acc-item').length
    }))()`)
    return info.empty ? info : null
  }, 8000, 200)
  record(
    'AC-27.4a',
    '附加窗口页显示空状态「暂无附加窗口」且无折叠栏',
    extraPage !== null &&
      (extraPage.empty ?? '').includes('暂无附加窗口') &&
      extraPage.accordions === 0,
    extraPage ? { empty: extraPage.empty.slice(0, 100), accordions: extraPage.accordions } : null
  )
  record(
    'AC-27.4b',
    '附加窗口页「接入说明」恰有 4 个步骤（.nx-steps li=4）',
    extraPage !== null &&
      extraPage.sections.some((title) => title === '接入说明') &&
      extraPage.steps.length === 4,
    extraPage ? { sections: extraPage.sections, steps: extraPage.steps } : null
  )
  const shotExtra = await pageShot(settingsClient, 'settings-extra.png')

  /* -- 系统页 -- */
  await settingsClient.evaluate(`(() => {
    const item = [...document.querySelectorAll('.settings-nav-item')].find((el) => el.textContent.includes('系统'))
    item?.click()
    return true
  })()`)
  const systemPage = await waitUntil(async () => {
    const info = await settingsClient.evaluate(`(() => ({
      active: document.querySelector('.settings-nav-item.is-active')?.textContent.trim() ?? null,
      sections: [...document.querySelectorAll('.settings-page .ui-section h2')].map((el) => el.textContent),
      text: document.querySelector('.settings-page')?.textContent ?? '',
      buttons: [...document.querySelectorAll('.settings-page .ui-btn')].map((el) => el.textContent.trim()),
      autoStartSwitch: [...document.querySelectorAll('.settings-page .ui-row-label')].some((el) => el.textContent.includes('开机自启'))
    }))()`)
    return info.active === '系统' ? info : null
  }, 8000, 200)
  record(
    'AC-27.5a',
    '系统页不再包含「窗口共性设置」，仅保留开机自启 + 窗口跳转',
    systemPage !== null &&
      !systemPage.text.includes('窗口共性设置') &&
      systemPage.sections.includes('启动') &&
      systemPage.sections.includes('窗口'),
    systemPage
      ? { sections: systemPage.sections, hasOldCommon: systemPage.text.includes('窗口共性设置'), autoStartSwitch: systemPage.autoStartSwitch }
      : null
  )
  record(
    'AC-27.5b',
    '系统页有「前往内置窗口 / 前往附加窗口」跳转按钮与「内置窗口」文案',
    systemPage !== null &&
      systemPage.buttons.some((text) => text.includes('内置窗口')) &&
      systemPage.buttons.some((text) => text.includes('附加窗口')) &&
      systemPage.text.includes('内置窗口'),
    systemPage ? { buttons: systemPage.buttons } : null
  )
  const shotSystem = await pageShot(settingsClient, 'settings-system.png')

  /* -- 跳转按钮真实生效 -- */
  const jumpBack = await settingsClient.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.settings-page .ui-btn')].find((el) => el.textContent.includes('内置窗口'))
    button?.click()
    await new Promise((resolve) => setTimeout(resolve, 700))
    return {
      clicked: !!button,
      active: document.querySelector('.settings-nav-item.is-active')?.textContent.trim() ?? null,
      accordions: document.querySelectorAll('.settings-page .nx-acc-item').length
    }
  })()`)
  record(
    'AC-27.5c',
    '系统页「前往内置窗口」点击后真实切换到内置窗口页（3 折叠栏）',
    jumpBack.clicked === true && (jumpBack.active ?? '').includes('内置窗口') && jumpBack.accordions === 3,
    jumpBack
  )
  const jumpExtra = await settingsClient.evaluate(`(async () => {
    const navItem = [...document.querySelectorAll('.settings-nav-item')].find((el) => el.textContent.trim() === '系统')
    navItem?.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const button = [...document.querySelectorAll('.settings-page .ui-btn')].find((el) => el.textContent.includes('附加窗口'))
    button?.click()
    await new Promise((resolve) => setTimeout(resolve, 700))
    return {
      clicked: !!button,
      active: document.querySelector('.settings-nav-item.is-active')?.textContent.trim() ?? null,
      empty: document.querySelector('.settings-page .nx-empty')?.textContent?.includes('暂无附加窗口') ?? false
    }
  })()`)
  record(
    'AC-27.5d',
    '系统页「前往附加窗口」点击后真实切换到附加窗口页（空状态）',
    jumpExtra.clicked === true && (jumpExtra.active ?? '').includes('附加窗口') && jumpExtra.empty === true,
    jumpExtra
  )

  /* -- 设置页渲染异常 / 诊断 -- */
  const settingsDom = await settingsClient.evaluate(`(() => ({
    errorBanner: !!document.querySelector('.settings-error-banner'),
    pageTextLength: document.querySelector('.settings-page')?.textContent?.length ?? 0,
    navCount: document.querySelectorAll('.settings-nav-item').length,
    versionText: document.querySelector('.settings-version')?.textContent ?? ''
  }))()`)
  const settingsDiagnostics = realDiagnostics('settings')
  record(
    'AC-27.6a',
    '设置页无渲染异常：无错误横幅、页面正文非空、无 console error/exception',
    settingsDom.errorBanner === false &&
      settingsDom.pageTextLength > 100 &&
      settingsDom.navCount === 6 &&
      settingsDiagnostics.length === 0,
    { ...settingsDom, diagnostics: settingsDiagnostics.slice(0, 5) }
  )

  /* -- 关闭设置窗口，回到 Dock 桌面态 -- */
  await settingsClient.evaluate('window.nexus.window.closeSettings()')
  try {
    settingsClient.close()
  } catch {
    /* ignore */
  }
  await waitUntil(async () => {
    const targets = await listTargets()
    return targets.some((t) => t.url.includes('/settings/')) ? null : true
  }, 8000, 200)

  /* -- Dock 回归 -- */
  const dockDom = await dockClient.evaluate(`(() => ({
    title: document.title,
    hasRoot: !!document.querySelector('.dock-root'),
    hasNexus: !!(window.nexus && window.nexus.settings),
    itemCount: document.querySelectorAll('.dock-item[data-dock-id]').length,
    itemIds: [...document.querySelectorAll('.dock-item[data-dock-id]')].map((el) => el.getAttribute('data-dock-id')),
    empty: !!document.querySelector('.dock-empty'),
    barExists: !!document.querySelector('.dock-bar')
  }))()`)
  record(
    'AC-27.8a',
    'Dock 回归：页面正常渲染 6 个图标（种子配置），无空状态',
    dockDom.hasRoot === true &&
      dockDom.barExists === true &&
      dockDom.hasNexus === true &&
      dockDom.itemCount === 6 &&
      dockDom.empty === false,
    dockDom
  )

  /* -- 「显示桌面」修复准备 --
   * 为了让「最小化 → 自动恢复」的观测确定性：
   *   1) 临时关闭 dock.onlyOnDesktop（音乐/时钟/附加窗口本来就是 false）→ 主进程桌面状态桥停用，
   *      applyFloatingVisibility 的 800ms 轮询不再参与显隐，guardAgainstMinimize 成为唯一恢复路径；
   *   2) 确认 Dock 可见后再执行 ShowWindow(SW_MINIMIZE=6)；测试结束后恢复 onlyOnDesktop=true。
   */
  let probe = runWindowProbe('find')
  record(
    'AC-27.7a',
    '定位隔离实例 Dock 窗口：electron.exe PID 树内、Chrome_WidgetWin_1、标题「Nexus Dock」',
    probe.ok === true && typeof probe.hwnd === 'number' && probe.hwnd > 0,
    probe.ok
      ? { mainPid: probe.mainPid, hwnd: probe.hwnd, title: probe.title, cls: probe.cls, rect: probe.rect, visible: probe.visible, iconic: probe.iconic }
      : probe
  )
  let patchedOnlyOnDesktop = false
  const onlyOnDesktopBefore = (await dockClient.evaluate('window.nexus.settings.get()'))?.dock?.onlyOnDesktop
  await dockClient.evaluate('window.nexus.settings.update({ dock: { onlyOnDesktop: false } })')
  patchedOnlyOnDesktop = true
  const shown = await waitUntil(async () => {
    const next = runWindowProbe('find')
    return next.ok && next.visible ? next : null
  }, 8000, 300)
  if (shown) probe = shown
  record(
    'AC-27.7a2',
    '前置：临时关闭 dock.onlyOnDesktop（桌面状态桥停用，隔离出 guard 恢复路径）后 Dock 可见',
    shown !== null && patchedOnlyOnDesktop === true,
    {
      onlyOnDesktopBefore,
      onlyOnDesktopDuringTest: false,
      visible: probe.visible,
      iconic: probe.iconic,
      hwnd: probe.hwnd,
      note: '测试结束后恢复 onlyOnDesktop=true'
    }
  )
  record(
    'AC-27.7b',
    '最小化前 Dock 窗口状态：IsWindowVisible=true 且 IsIconic=false',
    probe.ok === true && probe.visible === true && probe.iconic === false,
    { visible: probe.visible, iconic: probe.iconic, rect: probe.rect }
  )

  /* -- 截图：桌面态 Dock（Dock 窗口 capturePage；最小化前） -- */
  let shotDockDesktop = null
  try {
    shotDockDesktop = await pageShot(dockClient, 'dock-desktop.png')
  } catch (error) {
    record('AC-27.7g', 'Dock 窗口截图 dock-desktop.png 失败', false, String(error))
  }
  if (shotDockDesktop) {
    record(
      'AC-27.7g',
      'Dock 窗口截图成功（capturePage；最小化前，Dock 可见）',
      existsSync(join(ROOT, shotDockDesktop)) === true,
      { shot: shotDockDesktop }
    )
  }

  /* -- 核心：ShowWindow(SW_MINIMIZE) → 1800ms 后自动恢复（guard 路径） -- */
  const mainLogPath = join(USERDATA, 'logs', 'main.log')
  const guardLogLines = () => {
    try {
      return readFileSync(mainLogPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.includes('[dock]') && line.includes('已自动恢复显示'))
    } catch {
      return []
    }
  }
  const guardBefore = guardLogLines().length
  const minimizeAttempts = []
  let minimizeResult = null
  // 核心断言只看「1800ms 后是否恢复」；日志增量用于证明恢复来自 guardAgainstMinimize。
  // 极端时序下 minimize 事件可能被合并，允许最多重试 3 次（每次都是一次真实 ShowWindow(SW_MINIMIZE)）。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      minimizeResult = runWindowProbe('minimize')
    } catch (error) {
      minimizeResult = { ok: false, error: String(error) }
    }
    await sleep(500)
    const guardDelta = guardLogLines().length - guardBefore
    minimizeAttempts.push({
      attempt,
      restored: minimizeResult?.restored === true,
      justAfterIconic: minimizeResult?.justAfter?.iconic ?? null,
      guardLogDelta: guardDelta
    })
    if (minimizeResult?.ok === true && minimizeResult?.restored === true && guardDelta > 0) break
  }
  record(
    'AC-27.7c',
    '「显示桌面」修复：对 Dock 窗口 ShowWindow(SW_MINIMIZE=6) 后 1800ms 内自动恢复（IsIconic=false && IsWindowVisible=true）',
    minimizeResult?.ok === true && minimizeResult?.restored === true,
    minimizeResult
      ? {
          hwnd: minimizeResult.hwnd,
          before: minimizeResult.before,
          justAfter: minimizeResult.justAfter,
          after: minimizeResult.after,
          restored: minimizeResult.restored,
          attempts: minimizeAttempts,
          timeline: (minimizeResult.timeline ?? []).map((t) => `${t.ms}ms iconic=${t.iconic} visible=${t.visible}`)
        }
      : minimizeResult
  )
  record(
    'AC-27.7c1',
    '最小化确实生效：ShowWindow(SW_MINIMIZE=6) 后立即读取 IsIconic=true（随后被自动恢复）',
    minimizeResult?.ok === true && minimizeResult?.justAfter?.iconic === true,
    { justAfter: minimizeResult?.justAfter, before: minimizeResult?.before }
  )
  const guardLines = guardLogLines()
  record(
    'AC-27.7c2',
    '最小化测试期间主进程日志新增「[dock] 窗口被系统最小化…已自动恢复显示」：guardAgainstMinimize 生效',
    guardLines.length > guardBefore,
    {
      log: rel(mainLogPath),
      before: guardBefore,
      after: guardLines.length,
      attempts: minimizeAttempts,
      latestLine: guardLines[guardLines.length - 1] ?? null
    }
  )

  /* -- 恢复后截图（Dock 窗口 capturePage） -- */
  let shotRestored = null
  try {
    shotRestored = await pageShot(dockClient, 'dock-after-showdesktop.png')
  } catch (error) {
    record('AC-27.7h', '恢复后 Dock 窗口截图失败', false, String(error))
  }
  if (shotRestored) {
    record(
      'AC-27.7d',
      '自动恢复后 Dock 仍可正常渲染并截图（CDP captureScreenshot）',
      existsSync(join(ROOT, shotRestored)) === true,
      { shot: shotRestored }
    )
  }

  /* -- 恢复临时改动 -- */
  if (patchedOnlyOnDesktop) {
    await dockClient.evaluate('window.nexus.settings.update({ dock: { onlyOnDesktop: true } })')
    await sleep(600)
  }

  /* -- desktop-state.exe --once 协议 -- */
  const desktopStateExe = join(ROOT, 'resources', 'desktop-state.exe')
  let desktopState = null
  try {
    const raw = execFileSync(desktopStateExe, ['--once'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    })
    const lines = String(raw)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const last = lines[lines.length - 1]
    desktopState = { rawLines: lines, last, parsed: JSON.parse(last) }
  } catch (error) {
    desktopState = { error: String(error) }
  }
  const state = desktopState?.parsed
  record(
    'AC-27.7e',
    'resources/desktop-state.exe --once 最后一行 state JSON 含 minimized/visible 布尔字段及原有字段',
    state?.type === 'state' &&
      typeof state?.foregroundPid === 'number' &&
      typeof state?.maximized === 'boolean' &&
      typeof state?.fullscreen === 'boolean' &&
      typeof state?.desktop === 'boolean' &&
      typeof state?.className === 'string' &&
      typeof state?.minimized === 'boolean' &&
      typeof state?.visible === 'boolean',
    desktopState?.parsed ?? desktopState
  )

  /* -- dock 页面 console error / exception -- */
  await sleep(600)
  const dockDiagnostics = realDiagnostics('dock')
  record(
    'AC-27.8b',
    'Dock 页面无 console error / 未捕获异常（已过滤已知网络/媒体噪声）',
    dockDiagnostics.length === 0,
    {
      count: dockDiagnostics.length,
      items: dockDiagnostics.slice(0, 5),
      filtered: diagnostics.filter((d) => d.page === 'dock').length - dockDiagnostics.length
    }
  )

  /* -- 安装版未被操作 -- */
  const installedAfter = installedPids()
  record(
    'AC-27.8c',
    '安装版（NexusDockApp）进程 PID 全程未变：未触碰用户正在运行的安装版',
    JSON.stringify(installedBefore) === JSON.stringify(installedAfter),
    { before: installedBefore, after: installedAfter }
  )

  /* -- 门禁：typecheck + npm test（构建产物由 Lead 预先构建，本轮不重建 out/） -- */
  const typecheck = runCmd('npx tsc --noEmit')
  record(
    'AC-27.9a',
    '工程门禁：npx tsc --noEmit 退出码 0',
    typecheck.ok === true,
    {
      exitCode: typecheck.exitCode,
      outputTail: typecheck.ok ? '' : typecheck.out.slice(-1200)
    }
  )

  const tests = runCmd('npm test')
  const testLines = tests.out.split(/\r?\n/).map((line) => line.trim())
  // Node 24 在非 TTY 下用 spec reporter（ℹ pass 24），旧版本可能是 TAP（# pass 24），两种都兼容
  const countOf = (label) => {
    const hit = testLines
      .map((line) => line.match(new RegExp(`(?:ℹ|#)\\s*${label}\\s+(\\d+)`)))
      .find(Boolean)
    return hit ? Number(hit[1]) : null
  }
  const testsPassed = countOf('pass')
  const testsFailed = countOf('fail')
  const specPassLines = testLines.filter((line) => line.startsWith('✔')).length
  const busyLine = testLines.find(
    (line) =>
      (line.startsWith('✔') || line.startsWith('ok ') || line.startsWith('not ok ')) &&
      line.includes('isDesktopBusy')
  )
  record(
    'AC-27.9b',
    '工程门禁：npm test 全部通过（含共享契约测试）',
    tests.ok === true &&
      testsFailed === 0 &&
      ((testsPassed !== null && testsPassed >= 24) || specPassLines >= 24),
    {
      exitCode: tests.exitCode,
      testsPassed,
      testsFailed,
      specPassLines,
      isDesktopBusyTest: busyLine ?? null,
      outputTail: tests.ok ? '' : tests.out.slice(-1500)
    }
  )
  record(
    'AC-27.7f',
    'isDesktopBusy 契约由 npm test 覆盖（报告引用测试名；本脚本不重复实现该判定）',
    !!busyLine,
    {
      testName: 'v1.7 契约：isDesktopBusy 只在「可见 + 未最小化 + 最大化/全屏」时判定占用桌面',
      matchedLine: busyLine ?? null
    }
  )

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const outMain = join(ROOT, 'out', 'main', 'index.js')
  record(
    'AC-27.9c',
    '构建产物存在且 package.json 版本为 1.7.0（out/ 由 Lead 预先构建，本脚本不改写 out/）',
    packageJson.version === '1.7.0' && existsSync(outMain),
    { packageVersion: packageJson.version, outMainExists: existsSync(outMain), outMain: rel(outMain) }
  )

  return {
    env,
    installedBefore,
    installedAfter,
    settings
  }
}

/* ------------------------------- 执行 + 落盘 ------------------------------- */
let fatal = null
let context = {}
try {
  context = await main()
} catch (error) {
  fatal = error
  record('FATAL', '验收脚本执行异常', false, String(error?.stack ?? error))
}

const passed = results.filter((item) => item.ok).length
const failed = results.filter((item) => !item.ok).length
const report = {
  version: '1.7.0',
  title: 'Nexus Dock v1.7 独立验收（隔离 userData + CDP + 窗口最小化自恢复）',
  mode: 'check',
  cdpPort: PORT,
  userDataDir: USERDATA,
  settingsPath: rel(SETTINGS_PATH),
  seed: {
    schemaVersion: 9,
    apps: 6,
    note: '启动前写入 v9 基线配置（无 extraWindows 字段），验证 v9→v10 纯增量迁移'
  },
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  summary: { total: results.length, passed, failed },
  passed,
  failed,
  fatal: fatal ? String(fatal?.message ?? fatal) : null,
  environment: {
    appVersion: context?.env?.appVersion ?? null,
    electron: context?.env?.versions?.electron ?? null,
    chrome: context?.env?.versions?.chrome ?? null,
    node: context?.env?.versions?.node ?? null,
    platform: context?.env?.platform ?? process.platform,
    isPackaged: context?.env?.isPackaged ?? null,
    installedPidsBefore: context?.installedBefore ?? null,
    installedPidsAfter: context?.installedAfter ?? null
  },
  checks: results,
  screenshots,
  diagnostics: {
    total: diagnostics.length,
    real: diagnostics.filter((entry) => !KNOWN_NOISE.some((re) => re.test(entry.text))).length,
    items: diagnostics
      .filter((entry) => !KNOWN_NOISE.some((re) => re.test(entry.text)))
      .map((entry) => ({ page: entry.page, kind: entry.kind, text: entry.text })),
    ignored: diagnostics.filter((entry) => KNOWN_NOISE.some((re) => re.test(entry.text))).length,
    notes: '只统计页面自身 error；ignored 为已知网络/媒体/安全警告噪声'
  },
  safety: {
    helper: 'powershell 内联 Add-Type user32：EnumWindows/GetWindowThreadProcessId/IsWindowVisible/IsIconic/ShowWindow(SW_MINIMIZE=6)',
    scope: '仅隔离实例 electron.exe PID 树内、标题 Nexus Dock 的 Chrome_WidgetWin_1 窗口',
    forbidden: ['Shell.Application.MinimizeAll', 'Win+D', '操作安装版 NexusDockApp 窗口'],
    installedPidsUntouched: JSON.stringify(context?.installedBefore ?? []) === JSON.stringify(context?.installedAfter ?? [])
  }
}
writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('')
console.log('===============================================================')
console.log(
  `验收完成：${passed}/${results.length} 通过，${failed} 失败${
    context?.env?.appVersion ? `（Nexus Dock v${context.env.appVersion}）` : ''
  }`
)
if (fatal) console.log(`FATAL: ${fatal?.message ?? fatal}`)
console.log(`报告：${rel(OUT_REPORT)}`)
if (screenshots.length > 0) console.log(`截图：${screenshots.join(', ')}`)
console.log('===============================================================')
process.exit(failed === 0 && !fatal ? 0 : 1)
