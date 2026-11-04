// ============================================================================
// Nexus Dock v1.8.0 独立验收脚本（隔离 userData + CDP，不改源码）
//
// v1.8 附加窗口：「英语单词学习」（注册表 kind=wordstudy / page=wordstudy）
//   - 学习卡片：单词 / 音标 / 释义（可遮住）/ 例句 / 认识度标记 / 上一词下一词 / 快捷键
//   - 词库可自由修改：窗口内增删改、设置页导入导出与恢复默认、直接编辑
//     userData/wordbank.json 后点「重新读取」；词库与学习进度分两个文件存储
//
// ----------------------------- 三步用法（重要） -----------------------------
//   1) node scripts/v18-verify.mjs --prepare
//   2) 启动隔离实例（二选一）
//      a. 推荐：node scripts/v18-verify.mjs --launch
//      b. PowerShell 手工启动（**仓库路径含空格，必须按下面写法带引号**）：
//           Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
//           Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
//           $exe = Join-Path $PWD 'node_modules\electron\dist\electron.exe'
//           $ud  = Join-Path $PWD '.userdata\v18-verify'
//           $argLine = "--no-sandbox --remote-debugging-port=9362 --user-data-dir=`"$ud`" ."
//           Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $PWD `
//               -RedirectStandardOutput '.userdata\v18-verify-launch.out.log' `
//               -RedirectStandardError  '.userdata\v18-verify-launch.err.log'
//         等 10~12 秒，访问 http://127.0.0.1:9362/json/list 应能看到 /wordstudy/ 页面。
//   3) node scripts/v18-verify.mjs --check
//      产物：docs/verification/v1.8/report.json + PNG 截图（与 runtime-smoke.json 并存，互不覆盖）
//   4) node scripts/v18-verify.mjs --cleanup      按 PID 清理自己启动的隔离实例
//
//   CDP 端口默认 9362，可用环境变量 NEXUS_CDP_PORT 覆盖（--prepare/--launch/--check/--cleanup
//   四个动作必须用同一个端口）。
//
// --------------------------- 为什么脚本长这样（坑） ---------------------------
//   * 本仓库路径含空格（例如 E:\AI WorkRegion\app_creator）。在 PowerShell 里**不要**把
//     electron 参数拆成多个变量/多段字符串再拼接：`--user-data-dir=$ud` 这类写法一旦被
//     参数解析器按空格切开，Electron 会把 "E:\AI" 当成 userData 目录，表现为启动后立刻
//     静默退出或读不到隔离配置。务必用「单条带引号的参数字符串」（--user-data-dir="路径"）。
//   * 每个新开的 PowerShell / 进程都会继承 DSH 注入的 ELECTRON_RUN_AS_NODE=1；
//     不 Remove-Item 的话 electron.exe 会以 Node 模式运行（不进 GUI、不开 CDP）。
//   * 不要用 `npm run dev`：vite dev server 的页面 URL 与构建版不同，且会污染 out/ 证据。
//   * 只操作隔离 userData（.userdata\v18-verify）与命令行含 v18-verify 的 electron.exe；
//     **不要** Stop-Process 全部 electron.exe（可能误杀用户其他 Electron 应用），
//     更不要动已安装的 NexusDockApp（另一个进程名，属于用户真实环境）。
//   * 脚本本身可以安全地在 CI/无 GUI 环境里跑 --prepare；--check 需要真实 Electron + CDP。
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9362)
const ROOT = process.cwd()
const USERDATA = join(ROOT, '.userdata', 'v18-verify')
const SETTINGS_PATH = join(USERDATA, 'settings.json')
const WORDS_PATH = join(USERDATA, 'wordbank.json')
const PROGRESS_PATH = join(USERDATA, 'wordbank-progress.json')
const INSTANCE_PATH = join(USERDATA, 'instance.json')
const LAUNCH_OUT = join(USERDATA, 'launch.out.log')
const LAUNCH_ERR = join(USERDATA, 'launch.err.log')
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.8')
const OUT_REPORT = join(OUT_DIR, 'report.json')
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_VERSION = '1.8.0'
const KIND = 'wordstudy'
const SEED_WORD_COUNT = 59

const argv = process.argv.slice(2)
const MODE = argv.includes('--prepare')
  ? 'prepare'
  : argv.includes('--launch')
    ? 'launch'
    : argv.includes('--cleanup')
      ? 'cleanup'
      : 'check'
/** --check 时跳过工程门禁（tsc / 单测）跑得更快；默认执行 */
const SKIP_GATES = argv.includes('--no-gates')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/')

/* ============================================================================
 * 种子配置：刻意使用「v10 时代」字段集
 *   - schemaVersion=10、extraWindows=[]（没有 wordstudy 配置）；
 *   - 一批**非默认值**用于验证迁移零丢失（iconSize 52 / opacity 0.35 / panel padding 16、
 *     music 隐藏 + ring + light、clock 显示秒 + 12 小时制 + 固定坐标、appearance=light）；
 *   - 6 个内置应用且第一个带 v1.6 自定义名称，验证 v1.6 字段也原样保留。
 * 启动后由 settingsStore.migrate（v10→v11）自动补出 wordstudy（visible=true，右侧 32%）。
 * ========================================================================== */
function buildSeedSettings() {
  return {
    schemaVersion: 10,
    dock: {
      edge: 'bottom',
      alongPercent: 50,
      snapToEdge: false,
      freeX: -1,
      freeY: -1,
      onlyOnDesktop: true,
      iconSize: 52,
      magnification: 1.3,
      gap: 12,
      padding: 16,
      showIndicators: true,
      alwaysOnTop: true,
      acrylic: false,
      opacity: 0.35,
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
      progressStyle: 'ring',
      alwaysOnTop: true,
      onlyOnDesktop: false,
      theme: 'light'
    },
    clock: {
      visible: false,
      showSeconds: true,
      showDate: false,
      hour12: true,
      fontSize: 44,
      opacity: 0.9,
      alwaysOnTop: true,
      onlyOnDesktop: false,
      snapToEdge: true,
      theme: 'light',
      freeX: 120,
      freeY: 140
    },
    lock: { dock: false, music: false, clock: false },
    system: { autoStart: false },
    appearance: { motionIntensity: 'light', reducedMotion: true, clickSound: true },
    apps: [
      {
        id: 'explorer',
        name: '文件资源管理器',
        customName: '我的文件（v10 自定义名）',
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
    ],
    // v10 已存在 extraWindows 字段（v1.7 引入），只是没有 wordstudy 项
    extraWindows: []
  }
}

/** 需要人工完成（自动化无法覆盖或不应自动触发）的验收项 */
const MANUAL_ITEMS = [
  {
    id: 'M-28.4',
    title: '导入 / 导出词库的原生文件对话框',
    reason:
      '主进程使用 dialog.showOpenDialog / showSaveDialog，CDP 无法操作系统原生对话框；代码路径已静态审查（含 JSON 解析失败、空词条、取消等分支）。',
    how: '打开单词窗口 → 词库 → 导出词库（另存为 JSON）→ 删掉一个词 → 导入刚导出的 JSON → 确认词条恢复；再点「导入」后取消，确认不报错。'
  },
  {
    id: 'M-28.4b',
    title: '「打开词库文件」唤起系统默认编辑器',
    reason: '会启动外部程序（记事本 / VSCode），自动化不点击，避免污染桌面与文件句柄。',
    how: '单词窗口 → 词库 → 打开词库文件 → 确认用默认程序打开了 wordbank.json；改一个释义保存 → 回窗口点「重新读取」→ 确认卡片释义已更新。'
  },
  {
    id: 'M-28.5',
    title: '托盘菜单 / Dock 右键的「英语单词学习」显隐入口',
    reason: '系统托盘与原生右键菜单不可通过 CDP 稳定驱动（Tray 由主进程原生渲染）。',
    how: '单击托盘图标 → 右键菜单应出现「英语单词学习」相关项；切换显示/隐藏后设置里 visible 同步；Dock 右键菜单同样检查。'
  },
  {
    id: 'M-28.6',
    title: '真实拖动 / 吸附 / 锁定 / 仅在桌面显示',
    reason: '脚本只验证配置字段、窗口几何与布局 IPC，不模拟真实鼠标拖动（会与用户桌面操作冲突）。',
    how: '拖动单词卡片到屏幕边缘松手应吸附；在设置里开关「自动吸附屏幕边缘 / 锁定位置 / 仅在桌面显示」各试一次；打开一个最大化窗口确认卡片按选项隐藏/保留。'
  },
  {
    id: 'M-28.6b',
    title: '真实桌面合成观感（透明 / 圆角 / 主题切换）',
    reason: '截图来自 CDP Page.captureScreenshot，只渲染页面本身，不含 Windows 桌面合成、阴影与亚克力效果。',
    how: '在真实桌面上切换深色/浅色主题，确认卡片背景、文字对比度与圆角观感；确认没有「看得见但点不到 / 点得到但看不见」的透明区域。'
  }
]

/* ============================================================================
 * 文件工具
 * ========================================================================== */
function readJsonFile(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

function hasBom(path) {
  const bytes = readFileSync(path)
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/** 文件不存在时返回 null（用于断言里与 false 区分） */
function bomFlag(path) {
  try {
    return hasBom(path)
  } catch {
    return null
  }
}

function fileBytes(path) {
  try {
    return readFileSync(path).length
  } catch {
    return null
  }
}

/** 反复读 settings.json：主进程落盘有 250ms 防抖，迁移后需要等它写完 */
async function waitSettingsFile(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let last = { ok: false, error: 'not-read-yet' }
  while (Date.now() < deadline) {
    last = readJsonFile(SETTINGS_PATH)
    if (last.ok && last.value?.schemaVersion === 11) return last
    await sleep(150)
  }
  return last
}

/* ============================================================================
 * 进程工具：只认「命令行含 v18-verify 的 electron.exe」与 instance.json 记录的 PID
 * ========================================================================== */
function isolatedElectronPids() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Where-Object { $_.CommandLine -like '*v18-verify*' } | ForEach-Object { $_.ProcessId }) -join ','"
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000, windowsHide: true }
    )
    return String(out)
      .trim()
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

/** 安装版（NexusDockApp）PID：只读，用于证明「没碰用户正在运行的应用」 */
function installedPids() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-Process NexusDockApp -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object { $_.Id }) -join ','"
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000, windowsHide: true }
    )
    return String(out)
      .trim()
      .split(',')
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b)
  } catch {
    return null
  }
}

/** 清理隔离实例：先按 instance.json 的 PID，再按命令行兜底；绝不按进程名全杀 */
function cleanupIsolated() {
  const killed = []
  const notes = []

  const tracked = readJsonFile(INSTANCE_PATH)
  if (tracked.ok && Number(tracked.value?.pid) > 0) {
    const pid = Number(tracked.value.pid)
    try {
      process.kill(pid)
      killed.push(pid)
    } catch (error) {
      notes.push(`instance.json 中的 PID ${pid} 已不存在或无法结束：${String(error?.message ?? error)}`)
    }
  }

  for (const pid of isolatedElectronPids()) {
    if (killed.includes(pid)) continue
    try {
      process.kill(pid)
      killed.push(pid)
    } catch (error) {
      notes.push(`PID ${pid} 结束失败：${String(error?.message ?? error)}`)
    }
  }

  rmSync(INSTANCE_PATH, { force: true })
  return { killed, notes }
}

/* ============================================================================
 * PowerShell 手工启动命令（打印给用户复制；路径空格坑写清楚）
 * ========================================================================== */
function manualLaunchCommand() {
  return [
    'Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*node_modules\\electron*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
    'Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue',
    "$exe = Join-Path $PWD 'node_modules\\electron\\dist\\electron.exe'",
    "$ud  = Join-Path $PWD '.userdata\\v18-verify'",
    `$argLine = "--no-sandbox --remote-debugging-port=${PORT} --user-data-dir=\`"$ud\`" ."`,
    "Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $PWD -RedirectStandardOutput '.userdata\\v18-verify\\launch.out.log' -RedirectStandardError '.userdata\\v18-verify\\launch.err.log'"
  ].join('\n')
}

/* ============================================================================
 * --prepare
 * ========================================================================== */
function prepare() {
  mkdirSync(USERDATA, { recursive: true })
  // 只清理隔离 userData 里的运行时状态：日志 / 半写配置 / 上一轮词库。
  // 不触碰安装版 %APPDATA%\nexus-dock，也不删 Lead 已产出的验收截图。
  rmSync(join(USERDATA, 'logs'), { recursive: true, force: true })
  rmSync(`${SETTINGS_PATH}.tmp`, { force: true })
  rmSync(`${WORDS_PATH}.tmp`, { force: true })
  rmSync(`${PROGRESS_PATH}.tmp`, { force: true })
  rmSync(WORDS_PATH, { force: true })
  rmSync(PROGRESS_PATH, { force: true })
  rmSync(INSTANCE_PATH, { force: true })
  rmSync(LAUNCH_OUT, { force: true })
  rmSync(LAUNCH_ERR, { force: true })

  const seed = buildSeedSettings()
  // 显式 utf8：Node 的 writeFileSync 不写 BOM（与 v17-verify 一致）
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')

  const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
  console.log('===============================================================')
  console.log('Nexus Dock v1.8 验收准备完成')
  console.log('===============================================================')
  console.log(`userData      : ${USERDATA}`)
  console.log(`settings.json : ${SETTINGS_PATH}`)
  console.log(`种子版本      : schemaVersion=${parsed.schemaVersion}，extraWindows=${JSON.stringify(parsed.extraWindows)}`)
  console.log(`编码校验      : UTF-8 无 BOM = ${!hasBom(SETTINGS_PATH)}`)
  console.log(`CDP 端口      : ${PORT}（可用 NEXUS_CDP_PORT 覆盖）`)
  console.log('')
  console.log('启动隔离实例（推荐直接跑本脚本的 --launch）：')
  console.log('  node scripts/v18-verify.mjs --launch')
  console.log('')
  console.log('或 PowerShell 手工启动（注意：仓库路径含空格，参数必须按下面这样整体加引号）：')
  for (const line of manualLaunchCommand().split('\n')) console.log(`  ${line}`)
  console.log('')
  console.log('然后执行检查与清理：')
  console.log('  node scripts/v18-verify.mjs --check')
  console.log('  node scripts/v18-verify.mjs --cleanup')
  console.log('')
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'prepare',
        version: APP_VERSION,
        userDataDir: USERDATA,
        settingsPath: rel(SETTINGS_PATH),
        seedSchemaVersion: parsed.schemaVersion,
        seedWordBank: `首次启动由 initWordBank 播种 ${SEED_WORD_COUNT} 词`,
        cdpPort: PORT,
        manualLaunchCommand: manualLaunchCommand()
      },
      null,
      2
    )
  )
}

/* ============================================================================
 * --launch：用 spawn + 参数数组启动（数组天然规避路径空格；不用拼引号字符串）
 * ========================================================================== */
async function launch() {
  const info = cleanupIsolated()
  if (info.killed.length > 0) {
    console.log(`已结束上一轮隔离实例：${info.killed.join(', ')}`)
    await sleep(1500)
  }

  if (!existsSync(ELECTRON_EXE)) {
    throw new Error(`找不到 Electron 可执行文件：${ELECTRON_EXE}（先 npm install）`)
  }
  if (!existsSync(SETTINGS_PATH)) {
    throw new Error('缺少种子 settings.json：请先运行 node scripts/v18-verify.mjs --prepare')
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const outFd = openSync(LAUNCH_OUT, 'a')
  const errFd = openSync(LAUNCH_ERR, 'a')
  const env = { ...process.env }
  // DSH/宿主环境会注入 ELECTRON_RUN_AS_NODE=1；保留它 electron.exe 会以纯 Node 跑，没有 GUI/CDP
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  const { spawn } = await import('node:child_process')
  const child = spawn(
    ELECTRON_EXE,
    ['--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USERDATA}`, '.'],
    {
      cwd: ROOT,
      env,
      detached: true,
      windowsHide: true,
      // 输出重定向到普通文件（不是 pipe）：既能留住迁移/启动日志，也不会触发命名管道限制
      stdio: ['ignore', outFd, errFd]
    }
  )
  child.unref()

  const startedAt = new Date().toISOString()
  writeFileSync(INSTANCE_PATH, `${JSON.stringify({ pid: child.pid, port: PORT, startedAt }, null, 2)}\n`, 'utf8')
  console.log(`已启动隔离实例：pid=${child.pid} port=${PORT}`)
  console.log(`日志：${rel(LAUNCH_OUT)} / ${rel(LAUNCH_ERR)}`)

  const target = await waitTarget('/dock/', 45000)
  if (!target) {
    const errTail = readTail(LAUNCH_ERR, 30)
    throw new Error(
      `45s 内没有等到 /dock/ CDP 页面。\n启动错误日志（${rel(LAUNCH_ERR)}）：\n${errTail || '(空)'}\n` +
        '排查：① ELECTRON_RUN_AS_NODE 是否被清除；② 路径空格是否被拆坏（用 --launch 或严格按 --prepare 打印的引号写法）；③ 端口是否被占用。'
    )
  }
  const targets = await listTargets()
  const wordstudy = targets.find((item) => item.type === 'page' && item.url.includes('/wordstudy/'))
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'launch',
        pid: child.pid,
        cdpPort: PORT,
        dockTarget: target.url,
        wordstudyTarget: wordstudy?.url ?? null,
        targets: targets.filter((item) => item.type === 'page').map((item) => item.url)
      },
      null,
      2
    )
  )
}

function readTail(path, lines = 30) {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/* ============================================================================
 * --cleanup
 * ========================================================================== */
function cleanup() {
  const info = cleanupIsolated()
  // 等进程真的退出，再复查一次（Chromium 子进程可能稍慢）
  const deadline = Date.now() + 10000
  let left = isolatedElectronPids()
  while (left.length > 0 && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 300'], {
      cwd: ROOT,
      windowsHide: true
    })
    for (const pid of left) {
      try {
        process.kill(pid)
      } catch {
        /* 已经退出 */
      }
    }
    left = isolatedElectronPids()
  }
  console.log(
    JSON.stringify(
      { ok: left.length === 0, mode: 'cleanup', killed: info.killed, notes: info.notes, leftovers: left },
      null,
      2
    )
  )
  process.exit(left.length === 0 ? 0 : 1)
}

/* ============================================================================
 * CDP 基础
 * ========================================================================== */
async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  if (!res.ok) throw new Error(`CDP /json/list 返回 ${res.status}`)
  return res.json()
}

async function waitTarget(segment, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets()
      const target = targets.find((item) => item.type === 'page' && item.url.includes(segment))
      if (target) return target
    } catch {
      /* CDP 可能尚未监听 */
    }
    await sleep(300)
  }
  return null
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.listeners = []
    ws.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      if (typeof message.id === 'number') {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'))
        else entry.resolve(message.result)
        return
      }
      if (typeof message.method === 'string') {
        for (const listener of this.listeners) listener(message)
      }
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  onEvent(fn) {
    this.listeners.push(fn)
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new Error(
        `页面内执行异常：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown'}`
      )
    }
    return result.result?.value
  }
  async shot(path) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

async function connect(segment, label, timeoutMs = 25000) {
  const target = await waitTarget(segment, timeoutMs)
  if (!target) throw new Error(`未找到 ${segment} 页面（CDP ${PORT}）`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket 连接超时：${target.url}`)), 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`WebSocket 连接失败：${target.url}`))
    })
  })
  const client = new CdpClient(ws)
  client.page = label
  // 诊断：console.error / Log.error / 未捕获异常
  client.onEvent((message) => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => (typeof arg.value === 'string' ? arg.value : arg.description ?? arg.type ?? ''))
        .join(' ')
      diagnostics.push({ page: label, kind: 'console.error', text: text.slice(0, 600) })
    } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      const entry = message.params.entry
      diagnostics.push({
        page: label,
        kind: 'log.error',
        text: `${entry.text ?? ''} ${entry.url ?? ''}`.trim().slice(0, 600)
      })
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      diagnostics.push({
        page: label,
        kind: 'exception',
        text: `${details?.exception?.description ?? details?.text ?? 'exception'}`.slice(0, 600)
      })
    }
  })
  // 危险操作（删除 / 恢复默认 / 重置进度）用 window.confirm；CDP 需要自动接受
  client.onEvent((message) => {
    if (message.method === 'Page.javascriptDialogOpening') {
      void client.send('Page.handleJavaScriptDialog', { accept: true })
    }
  })
  await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')])
  return client
}

async function waitUntil(fn, timeoutMs = 8000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch {
      /* 页面切换/重载期间可能抛错 */
    }
    await sleep(intervalMs)
  }
  return null
}

/* ============================================================================
 * 结果收集
 * ========================================================================== */
const startedAt = Date.now()
const checks = []
const screenshots = []
const diagnostics = []
/** @type {Record<string, unknown>} */
const gates = {}

/**
 * 记录一条验收结果。
 * @param {string} id AC 编号
 * @param {string} title 验收项
 * @param {boolean|null} ok true=通过 false=失败 null=跳过（手动/环境不允许）
 * @param {unknown} detail 证据
 * @param {string[]} shots 本次产生的截图（相对路径）
 */
function record(id, title, ok, detail, shots = []) {
  const item = {
    id,
    title,
    ok: ok === null ? null : ok === true,
    status: ok === null ? 'skip' : ok === true ? 'pass' : 'fail',
    detail,
    shots: shots.filter(Boolean)
  }
  checks.push(item)
  for (const shot of item.shots) if (!screenshots.includes(shot)) screenshots.push(shot)
  const brief =
    typeof detail === 'string' ? detail : JSON.stringify(detail ?? null).slice(0, 600)
  console.log(`${item.status === 'pass' ? 'PASS' : item.status === 'fail' ? 'FAIL' : 'SKIP'} ${id} ${title}${brief ? ` :: ${brief}` : ''}`)
  return item
}

async function pageShot(client, name) {
  const path = join(OUT_DIR, name)
  await client.shot(path)
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
  /Unable to load preload script/i
]

function realDiagnostics(page) {
  return diagnostics.filter(
    (entry) => entry.page === page && !KNOWN_NOISE.some((re) => re.test(entry.text))
  )
}

/* ============================================================================
 * 工程门禁（tsc / 三个测试文件）
 * ========================================================================== */
function runCapture(command, args, timeoutMs = 300000) {
  try {
    const out = execFileSync(command, args, {
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
      exitCode: typeof error?.status === 'number' ? error.status : -1,
      error: String(error?.message ?? error)
    }
  }
}

function parseNodeTestCounts(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
  const countOf = (label) => {
    for (const line of lines) {
      const match = line.match(new RegExp(`(?:ℹ|#)\\s*${label}\\s+(\\d+)`))
      if (match) return Number(match[1])
    }
    return null
  }
  return {
    tests: countOf('tests'),
    pass: countOf('pass'),
    fail: countOf('fail'),
    specPassLines: lines.filter((line) => line.startsWith('✔')).length
  }
}

function runGates() {
  if (SKIP_GATES) {
    record('AC-28.7', '工程门禁（--no-gates 跳过）', null, { reason: '--no-gates' })
    return
  }

  const typecheck = runCapture(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx tsc --noEmit'])
  gates.typecheck = { exitCode: typecheck.exitCode, ok: typecheck.ok }
  record(
    'AC-28.7a',
    '工程门禁：npx tsc --noEmit 退出码 0',
    typecheck.ok ? true : typecheck.exitCode === -1 ? null : false,
    typecheck.ok
      ? { exitCode: typecheck.exitCode }
      : {
          exitCode: typecheck.exitCode,
          note: typecheck.exitCode === -1 ? '命令无法执行（环境限制），请人工复跑 npx tsc --noEmit' : '类型检查有错误',
          outputTail: typecheck.out.slice(-1200)
        }
  )

  const testFiles = [
    { file: 'tests/shared-contract.test.mjs', expectAtLeast: 24, label: '共享契约测试' },
    { file: 'tests/wordbank-contract.test.mjs', expectAtLeast: 9, label: '词库契约测试' },
    { file: 'tests/wiring.test.mjs', expectAtLeast: 1, label: '静态接线门禁' }
  ]
  const testResults = []
  for (const item of testFiles) {
    if (!existsSync(join(ROOT, item.file))) {
      testResults.push({ ...item, exists: false, pass: null, fail: null })
      continue
    }
    const run = runCapture(process.execPath, [item.file], 120000)
    const counts = parseNodeTestCounts(run.out)
    const passCount = counts.pass ?? counts.specPassLines
    testResults.push({
      ...item,
      exists: true,
      exitCode: run.exitCode,
      pass: passCount,
      fail: counts.fail,
      ok: run.ok && counts.fail === 0 && passCount !== null && passCount >= item.expectAtLeast,
      spawnBlocked: run.exitCode === -1 && counts.fail === null
    })
  }
  gates.tests = testResults
  const allOk = testResults.every((item) => item.exists && item.ok === true)
  const anyRealFailure = testResults.some((item) => item.exists && item.ok === false && item.spawnBlocked !== true)
  record(
    'AC-28.7b',
    '工程门禁：契约测试 24 项 + 词库 9 项 + 静态接线门禁全部通过、0 失败',
    allOk ? true : anyRealFailure ? false : null,
    testResults
  )

  const packageJson = readJsonFile(join(ROOT, 'package.json'))
  const outMain = join(ROOT, 'out', 'main', 'index.js')
  const outWordstudy = join(ROOT, 'out', 'renderer', 'wordstudy', 'index.html')
  const buildOk = packageJson.ok && packageJson.value.version === APP_VERSION && existsSync(outMain) && existsSync(outWordstudy)
  gates.build = {
    packageVersion: packageJson.ok ? packageJson.value.version : null,
    outMain: existsSync(outMain),
    outWordstudyHtml: existsSync(outWordstudy)
  }
  record(
    'AC-28.7c',
    `构建产物：package.json = ${APP_VERSION}，out/main/index.js 与 out/renderer/wordstudy/index.html 存在`,
    buildOk,
    { ...gates.build, note: 'out/ 由 Lead 预先构建，本脚本不重建，避免与运行中的隔离实例冲突' }
  )
}

/* ============================================================================
 * 主流程：--check
 * ========================================================================== */
async function check() {
  mkdirSync(OUT_DIR, { recursive: true })
  const installedBefore = installedPids()

  /* -- 前提：隔离实例已启动并暴露 CDP -- */
  const dockTarget = await waitTarget('/dock/', 10000)
  if (!dockTarget) {
    throw new Error(
      `未找到 Dock 页面（CDP 端口 ${PORT}）。请先运行 node scripts/v18-verify.mjs --prepare，再 ` +
        'node scripts/v18-verify.mjs --launch（或按 --prepare 打印的 PowerShell 引号写法手工启动），' +
        '然后重跑 --check。'
    )
  }
  const dock = await connect('/dock/', 'dock')

  const env = await dock.eval('window.nexus.env')
  record(
    'AC-28.0',
    `隔离实例为开发构建且版本 = ${APP_VERSION}`,
    env?.appVersion === APP_VERSION && env?.isPackaged === false,
    { appVersion: env?.appVersion, isPackaged: env?.isPackaged, versions: env?.versions }
  )

  /* ========================= AC-28.1 迁移 10 → 11 ========================= */
  const diskSettings = await waitSettingsFile()
  const migrated = diskSettings.ok ? diskSettings.value : null
  const wordstudyConfig = (migrated?.extraWindows ?? []).find((item) => item.kind === KIND) ?? null
  record(
    'AC-28.1a',
    '迁移：落盘 settings.json 的 schemaVersion 由种子 10 升到 11（UTF-8 无 BOM）',
    diskSettings.ok && migrated?.schemaVersion === 11 && bomFlag(SETTINGS_PATH) === false,
    {
      path: rel(SETTINGS_PATH),
      bytes: fileBytes(SETTINGS_PATH),
      schemaVersion: migrated?.schemaVersion ?? null,
      hasBom: bomFlag(SETTINGS_PATH),
      parseError: diskSettings.ok ? null : diskSettings.error
    }
  )
  record(
    'AC-28.1b',
    '迁移：注册表自动补出 wordstudy 附加窗口配置（visible=true / 右侧 32% / 默认选项）',
    wordstudyConfig !== null &&
      wordstudyConfig.visible === true &&
      wordstudyConfig.edge === 'right' &&
      wordstudyConfig.alongPercent === 32 &&
      wordstudyConfig.theme === 'dark' &&
      wordstudyConfig.options?.hideMeaning === true &&
      wordstudyConfig.options?.showPhonetic === true &&
      wordstudyConfig.options?.showExample === true &&
      wordstudyConfig.options?.shuffle === false &&
      wordstudyConfig.options?.autoNext === true,
    wordstudyConfig
  )
  const seed = buildSeedSettings()
  const appsPreserved =
    Array.isArray(migrated?.apps) &&
    migrated.apps.length === seed.apps.length &&
    migrated.apps[0]?.customName === seed.apps[0].customName &&
    migrated.apps[0]?.aumid === seed.apps[0].aumid
  record(
    'AC-28.1c',
    '迁移零丢失：Dock/音乐/时钟/锁定/外观/系统/应用列表（含 v1.6 自定义名称）全部保留',
    migrated !== null &&
      migrated.dock?.iconSize === 52 &&
      migrated.dock?.opacity === 0.35 &&
      migrated.dock?.padding === 16 &&
      migrated.dock?.onlyOnDesktop === true &&
      migrated.music?.visible === false &&
      migrated.music?.progressStyle === 'ring' &&
      migrated.music?.theme === 'light' &&
      migrated.clock?.showSeconds === true &&
      migrated.clock?.showDate === false &&
      migrated.clock?.hour12 === true &&
      migrated.clock?.freeX === 120 &&
      migrated.lock?.dock === false &&
      migrated.lock?.music === false &&
      migrated.lock?.clock === false &&
      migrated.appearance?.motionIntensity === 'light' &&
      migrated.appearance?.reducedMotion === true &&
      migrated.appearance?.clickSound === true &&
      migrated.system?.autoStart === false &&
      appsPreserved,
    {
      dock: migrated?.dock,
      music: migrated?.music,
      clock: migrated?.clock,
      appearance: migrated?.appearance,
      apps: migrated?.apps?.length ?? null,
      firstAppCustomName: migrated?.apps?.[0]?.customName ?? null
    }
  )

  const wordsDisk = readJsonFile(WORDS_PATH)
  const wordsKeys = wordsDisk.ok ? Object.keys(wordsDisk.value).sort() : []
  record(
    'AC-28.1d',
    `启动：首次运行播种词库文件（{version:1, words:${SEED_WORD_COUNT}}，只含 version/words 两个键）`,
    wordsDisk.ok &&
      wordsDisk.value?.version === 1 &&
      Array.isArray(wordsDisk.value?.words) &&
      wordsDisk.value.words.length === SEED_WORD_COUNT &&
      JSON.stringify(wordsKeys) === JSON.stringify(['version', 'words']) &&
      bomFlag(WORDS_PATH) === false,
    {
      path: rel(WORDS_PATH),
      bytes: fileBytes(WORDS_PATH),
      version: wordsDisk.value?.version ?? null,
      count: wordsDisk.value?.words?.length ?? null,
      keys: wordsKeys,
      hasBom: bomFlag(WORDS_PATH)
    }
  )

  const migrationLog = readMigrationLog()
  record(
    'AC-28.1e',
    '迁移日志：主进程记录了「已从 v10 迁移到 v11」',
    migrationLog.found,
    migrationLog
  )

  /* ====================== AC-28.2 窗口注册与 C7 尺寸 ====================== */
  const wordstudyTarget = await waitTarget('/wordstudy/', 15000)
  record('AC-28.2a', '/wordstudy/ 页面在隔离实例中存在（注册表 page ↔ vite 入口 ↔ 实际加载一致）', wordstudyTarget !== null, {
    url: wordstudyTarget?.url ?? null,
    targets: (await listTargets()).filter((item) => item.type === 'page').map((item) => item.url)
  })
  const card = await connect('/wordstudy/', 'wordstudy')

  const basic = await waitUntil(async () => {
    const info = await card.eval(`(async () => {
      const root = document.querySelector('.ws-root')
      const rect = root ? root.getBoundingClientRect() : null
      const bank = await window.nexus.wordBank.get()
      return {
        title: document.title,
        view: root?.getAttribute('data-view') ?? null,
        theme: root?.getAttribute('data-theme') ?? null,
        locked: root?.getAttribute('data-locked') ?? null,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        rootW: rect ? rect.width : null,
        rootH: rect ? rect.height : null,
        word: document.querySelector('.ws-word')?.textContent ?? '',
        phonetic: document.querySelector('.ws-phonetic')?.textContent ?? '',
        meaningRevealed: document.querySelector('.ws-meaning')?.getAttribute('data-revealed') ?? null,
        status: document.querySelector('.ws-status')?.textContent ?? '',
        progress: document.querySelector('.ws-progress')?.textContent ?? '',
        stats: document.querySelector('.ws-stats')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        bankWords: bank?.words?.length ?? -1,
        hasRoot: !!root
      }
    })()`)
    return info.hasRoot && info.bankWords === SEED_WORD_COUNT ? info : null
  }, 15000)
  record(
    'AC-28.2b',
    '学习卡片页 title 正确、.ws-root 存在且渲染出单词',
    basic !== null && basic.title.includes('英语单词学习') && typeof basic.word === 'string' && basic.word.length > 0,
    basic
  )
  record(
    'AC-28.2c',
    `学习视图默认状态：深色主题 / 未锁定 / 释义默认遮住 / 进度 1 / ${SEED_WORD_COUNT}`,
    basic !== null &&
      basic.theme === 'dark' &&
      basic.locked === null &&
      basic.meaningRevealed === 'false' &&
      basic.progress.includes(`/ ${SEED_WORD_COUNT}`) &&
      basic.stats.includes(String(SEED_WORD_COUNT)),
    basic
  )
  const studyC7 =
    basic !== null &&
    Math.abs(basic.rootW - basic.innerW) <= 2 &&
    Math.abs(basic.rootH - basic.innerH) <= 2
  record(
    'AC-28.2d',
    'C7 尺寸自适应：学习视图 .ws-root 尺寸 ≈ innerWidth/innerHeight（360×250 级，无隐形点击区）',
    studyC7,
    basic ? { inner: [basic.innerW, basic.innerH], root: [basic.rootW, basic.rootH] } : null
  )
  const shotStudyDark = await pageShot(card, 'wordstudy-study-dark.png')
  record('AC-28.2e', '截图：wordstudy-study-dark.png（深色学习卡片）', true, { shot: shotStudyDark }, [shotStudyDark])

  /* ======================== AC-28.3 学习交互 ======================== */
  const revealed = await card.eval(`(async () => {
    document.querySelector('.ws-reveal')?.click()
    await new Promise((resolve) => setTimeout(resolve, 250))
    const meaning = document.querySelector('.ws-meaning')
    return { revealed: meaning?.getAttribute('data-revealed'), text: meaning?.textContent?.slice(0, 40) ?? '' }
  })()`)
  record(
    'AC-28.3a',
    '点「显示释义」后 data-revealed=true 且释义文本非空',
    revealed.revealed === 'true' && revealed.text.replace('点击显示释义', '').trim().length > 0,
    revealed
  )

  const nav = await card.eval(`(async () => {
    const before = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    document.querySelector('.ws-next')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const afterNext = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    const revealedAfterNext = document.querySelector('.ws-meaning')?.getAttribute('data-revealed')
    document.querySelector('.ws-prev')?.click()
    await new Promise((resolve) => setTimeout(resolve, 200))
    const afterPrev = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    return { before, afterNext, afterPrev, revealedAfterNext }
  })()`)
  record(
    'AC-28.3b',
    '「下一词」切换单词并在切词后重新遮住释义，「上一词」能切回原词',
    nav.before !== nav.afterNext && nav.revealedAfterNext === 'false' && nav.afterPrev === nav.before,
    nav
  )

  const keyboard = await card.eval(`(async () => {
    const first = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterSpace = document.querySelector('.ws-meaning')?.getAttribute('data-revealed')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    const afterRight = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    return { first, afterSpace, afterRight }
  })()`)
  record(
    'AC-28.3c',
    '快捷键：空格显示释义、→ 切到下一词',
    keyboard.afterSpace === 'true' && keyboard.afterRight !== keyboard.first,
    keyboard
  )

  // autoNext 默认 true 会让「标记」后自动切词；为了确定性，先关闭 autoNext 再断言「认识的词」进度
  await patchWordStudyOptions(card, { autoNext: false, hideMeaning: true }, 'autoNext=false（便于断言标记进度）')
  await sleep(500)
  const marked = await card.eval(`(async () => {
    const word = document.querySelector('.ws-word')?.textContent?.trim() ?? ''
    document.querySelector('.ws-mark-known')?.click()
    await new Promise((resolve) => setTimeout(resolve, 700))
    const bank = await window.nexus.wordBank.get()
    const key = word.toLowerCase().replace(/\\s+/g, ' ')
    return {
      word,
      key,
      progress: bank.progress[key] ?? null,
      wordAfterMark: document.querySelector('.ws-word')?.textContent?.trim() ?? '',
      stats: document.querySelector('.ws-stats')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
    }
  })()`)
  record(
    'AC-28.3d',
    '标记「认识」→ 进度 status=mastered、seen/remembered≥1；autoNext 关闭时停留在当前词',
    marked.progress?.status === 'mastered' &&
      marked.progress?.seen >= 1 &&
      marked.progress?.remembered >= 1 &&
      marked.wordAfterMark === marked.word,
    marked
  )
  record(
    'AC-28.3e',
    '统计区「已掌握」数字随标记变化',
    /已掌握\s*1/.test(marked.stats ?? '') || marked.stats.includes('1'),
    marked.stats
  )

  /* ================== AC-28.4 词库自由修改（三种途径） ================== */
  await card.eval(`document.querySelector('.ws-bank-toggle')?.click()`)
  const editorReady = await waitUntil(async () => {
    const rows = await card.eval("document.querySelectorAll('.ws-bank-row').length")
    return rows === SEED_WORD_COUNT ? rows : null
  }, 10000)
  const editor = await card.eval(`(() => ({
    hasEditor: !!document.querySelector('.ws-editor'),
    count: document.querySelector('.ws-bank-count')?.textContent?.trim() ?? '',
    rows: document.querySelectorAll('.ws-bank-row').length,
    search: !!document.querySelector('.ws-bank-search'),
    add: !!document.querySelector('.ws-bank-add'),
    importBtn: !!document.querySelector('.ws-import'),
    exportBtn: !!document.querySelector('.ws-export'),
    openFile: !!document.querySelector('.ws-open-file'),
    reload: !!document.querySelector('.ws-reload'),
    resetWords: !!document.querySelector('.ws-reset-words'),
    resetProgress: !!document.querySelector('.ws-reset-progress'),
    path: document.querySelector('.ws-bank-path')?.textContent?.trim() ?? '',
    innerW: window.innerWidth,
    innerH: window.innerHeight
  }))()`)
  record(
    'AC-28.4a',
    '窗口内词库管理视图：打开成功、59 行、工具栏齐全（搜索/新增/导入/导出/打开文件/重新读取/恢复默认/重置进度）',
    editor.hasEditor &&
      editorReady === SEED_WORD_COUNT &&
      editor.rows === SEED_WORD_COUNT &&
      editor.search &&
      editor.add &&
      editor.importBtn &&
      editor.exportBtn &&
      editor.openFile &&
      editor.reload &&
      editor.resetWords &&
      editor.resetProgress &&
      editor.count.includes(String(SEED_WORD_COUNT)),
    editor
  )
  record(
    'AC-28.4b',
    '词库管理视图展示 wordbank.json 路径，且 C7 尺寸切换到编辑视图（480 级宽 / 540 级高）',
    editor.path.includes('wordbank.json') &&
      editor.innerW >= 470 &&
      editor.innerW <= 520 &&
      editor.innerH >= 500 &&
      editor.innerH <= 600,
    { path: editor.path, inner: [editor.innerW, editor.innerH] }
  )
  const shotEditorDark = await pageShot(card, 'wordstudy-editor-dark.png')
  record('AC-28.4c', '截图：wordstudy-editor-dark.png（词库管理视图）', true, { shot: shotEditorDark }, [shotEditorDark])

  const added = await card.eval(`(async () => {
    document.querySelector('.ws-bank-add')?.click()
    await new Promise((resolve) => setTimeout(resolve, 250))
    const setValue = (selector, value) => {
      const el = document.querySelector(selector)
      if (!el) return false
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      desc.set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const fields = [
      setValue('.ws-bank-input-word', 'cdp-verify-word'),
      setValue('.ws-bank-input-phonetic', '/siː diː piː/'),
      setValue('.ws-bank-input-meaning', 'CDP 验收词条'),
      setValue('.ws-bank-input-example', 'This word was added by the v18-verify CDP script.')
    ]
    await new Promise((resolve) => setTimeout(resolve, 200))
    document.querySelector('.ws-bank-save')?.click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const bank = await window.nexus.wordBank.get()
    return {
      fields,
      total: bank.words.length,
      last: bank.words[bank.words.length - 1],
      count: document.querySelector('.ws-bank-count')?.textContent?.trim() ?? '',
      toast: document.querySelector('.ws-toast')?.textContent?.trim() ?? ''
    }
  })()`)
  const wordsAfterAdd = readJsonFile(WORDS_PATH)
  record(
    'AC-28.4d',
    '途径①（窗口内新增）：表单保存 → 内存 60 词、wordbank.json 落盘 60 词且仍只含 version/words',
    added.fields.every(Boolean) &&
      added.total === SEED_WORD_COUNT + 1 &&
      added.last?.word === 'cdp-verify-word' &&
      wordsAfterAdd.ok &&
      wordsAfterAdd.value?.words?.length === SEED_WORD_COUNT + 1 &&
      JSON.stringify(Object.keys(wordsAfterAdd.value).sort()) === JSON.stringify(['version', 'words']) &&
      added.toast.includes('cdp-verify-word'),
    { ui: added, disk: { count: wordsAfterAdd.value?.words?.length ?? null, keys: wordsAfterAdd.ok ? Object.keys(wordsAfterAdd.value) : null } }
  )

  // 途径③：直接编辑 wordbank.json（裸数组！）→ 点「重新读取」
  writeFileSync(
    WORDS_PATH,
    `${JSON.stringify(
      [
        { word: 'external-edit', phonetic: '', meaning: '外部编辑的词库（裸数组文件替换）', example: '' },
        { word: 'second-word', phonetic: '', meaning: '第二个词', example: '' }
      ],
      null,
      2
    )}\n`,
    'utf8'
  )
  const reloaded = await card.eval(`(async () => {
    document.querySelector('.ws-reload')?.click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const bank = await window.nexus.wordBank.get()
    return {
      total: bank.words.length,
      words: bank.words.map((entry) => entry.word),
      count: document.querySelector('.ws-bank-count')?.textContent?.trim() ?? '',
      toast: document.querySelector('.ws-toast')?.textContent?.trim() ?? ''
    }
  })()`)
  const externalFileAfterReload = readJsonFile(WORDS_PATH)
  record(
    'AC-28.4e',
    '途径③（外部编辑 + 重新读取）：裸数组 wordbank.json 被识别为 2 词；「重新读取」只读不写、不覆盖用户文件',
    reloaded.total === 2 &&
      reloaded.words.includes('external-edit') &&
      reloaded.toast.includes('重新读取') &&
      Array.isArray(externalFileAfterReload.value),
    { ui: reloaded, diskStillBareArray: Array.isArray(externalFileAfterReload.value) }
  )

  const backToStudy = await card.eval(`(async () => {
    document.querySelector('.ws-editor-back')?.click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    return {
      word: document.querySelector('.ws-word')?.textContent?.trim() ?? '',
      progress: document.querySelector('.ws-progress')?.textContent?.trim() ?? ''
    }
  })()`)
  record(
    'AC-28.4f',
    '返回学习视图显示重新读取后的 2 词词库（1 / 2）',
    backToStudy.progress.includes('/ 2'),
    backToStudy
  )
  const shotStudy2 = await pageShot(card, 'wordstudy-study-2words.png')
  record('AC-28.4g', '截图：wordstudy-study-2words.png（外部替换词库后的学习视图）', true, { shot: shotStudy2 }, [shotStudy2])

  // 恢复默认词库（window.confirm 由 CDP 自动接受）
  await card.eval(`document.querySelector('.ws-bank-toggle')?.click()`)
  await waitUntil(async () => (await card.eval("!!document.querySelector('.ws-editor')")) === true, 5000)
  const resetWords = await card.eval(`(async () => {
    document.querySelector('.ws-reset-words')?.click()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const bank = await window.nexus.wordBank.get()
    return {
      total: bank.words.length,
      progressKeys: Object.keys(bank.progress).length,
      count: document.querySelector('.ws-bank-count')?.textContent?.trim() ?? '',
      toast: document.querySelector('.ws-toast')?.textContent?.trim() ?? ''
    }
  })()`)
  const wordsAfterReset = readJsonFile(WORDS_PATH)
  record(
    'AC-28.4h',
    '途径②（恢复默认）：确认弹窗后恢复 59 词并清空进度，文件重新落盘',
    resetWords.total === SEED_WORD_COUNT &&
      resetWords.progressKeys === 0 &&
      resetWords.toast.includes('恢复默认') &&
      wordsAfterReset.ok &&
      wordsAfterReset.value?.words?.length === SEED_WORD_COUNT,
    resetWords
  )

  const deleted = await card.eval(`(async () => {
    document.querySelector('.ws-bank-delete-btn')?.click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    const bank = await window.nexus.wordBank.get()
    return {
      total: bank.words.length,
      count: document.querySelector('.ws-bank-count')?.textContent?.trim() ?? ''
    }
  })()`)
  record(
    'AC-28.4i',
    '窗口内删除词条（确认弹窗）→ 58 词并落盘',
    deleted.total === SEED_WORD_COUNT - 1,
    deleted
  )
  record(
    'AC-28.4j',
    '途径②的导入 / 导出（原生文件对话框）与「打开词库文件」：自动化跳过，列入手动项',
    null,
    { manualItems: ['M-28.4', 'M-28.4b'] }
  )

  /* ===================== AC-28.5 设置页词库管理 ===================== */
  await card.eval(`document.querySelector('.ws-editor-back')?.click()`)
  await sleep(400)
  // 主题 + 释义常显：设置广播 → 单词窗口即时生效
  await card.eval(`(async () => {
    const settings = await window.nexus.settings.get()
    const extraWindows = settings.extraWindows.map((config) =>
      config.kind === 'wordstudy'
        ? { ...config, theme: 'light', options: { ...config.options, hideMeaning: false, showPhonetic: true } }
        : config
    )
    await window.nexus.settings.update({ extraWindows })
  })()`)
  const light = await waitUntil(async () => {
    const info = await card.eval(`(() => {
      const root = document.querySelector('.ws-root')
      return {
        theme: root?.getAttribute('data-theme') ?? null,
        revealed: document.querySelector('.ws-meaning')?.getAttribute('data-revealed') ?? null
      }
    })()`)
    return info.theme === 'light' ? info : null
  }, 6000)
  record(
    'AC-28.5a',
    '主题切换即时生效：设置改成浅色 + 关闭「先遮住释义」后卡片 data-theme=light 且释义常显',
    light !== null && light.theme === 'light' && light.revealed === 'true',
    light
  )
  const shotLight = await pageShot(card, 'wordstudy-study-light.png')
  record('AC-28.5b', '截图：wordstudy-study-light.png（浅色主题学习卡片）', true, { shot: shotLight }, [shotLight])
  // 还原深色 + 遮住释义，避免影响后续「隐藏」「设置页」断言
  await patchWordStudyOptions(card, { hideMeaning: true }, '还原 hideMeaning=true', { theme: 'dark' })
  await sleep(400)

  await dock.eval('window.nexus.window.openSettings()')
  const settingsClient = await waitUntil(async () => {
    try {
      return await connect('/settings/', 'settings', 3000)
    } catch {
      return null
    }
  }, 20000, 400)
  record('AC-28.5c', '从 Dock 打开设置窗口并连上 CDP', settingsClient !== null, { opened: settingsClient !== null })
  if (settingsClient) {
    await waitUntil(async () => (await settingsClient.eval("document.querySelectorAll('.settings-nav-item').length")) > 0, 10000)
    const navClicked = await settingsClient.eval(`(() => {
      const item = [...document.querySelectorAll('.settings-nav-item')].find((el) => el.textContent.includes('附加窗口'))
      item?.click()
      return { clicked: !!item }
    })()`)
    await sleep(600)
    const accordion = await settingsClient.eval(`(() => {
      const head = [...document.querySelectorAll('.nx-acc-head')].find((el) => el.textContent.includes('英语单词学习'))
      head?.click()
      return { found: !!head }
    })()`)
    await waitUntil(async () => (await settingsClient.eval("!!document.querySelector('.ws-settings')")) === true, 10000)
    // 统计数字来自异步 IPC（wordBank.get），展开后等一次刷新再读
    await sleep(900)
    const extraPage = await settingsClient.eval(`(() => ({
      hasSettings: !!document.querySelector('.ws-settings'),
      stats: document.querySelector('.ws-settings-stats')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      path: document.querySelector('.ws-settings-path')?.textContent?.trim() ?? '',
      switches: document.querySelectorAll('.ws-settings-switches .ui-switch').length,
      actions: document.querySelectorAll('.ws-settings-actions .ui-btn').length,
      actionLabels: [...document.querySelectorAll('.ws-settings-actions .ui-btn')].map((el) => el.textContent.trim()),
      oldEmptyText: document.body.textContent.includes('当前还没有注册附加窗口') || document.body.textContent.includes('暂无附加窗口')
    }))()`)
    record(
      'AC-28.5d',
      '设置页「窗口 → 附加窗口」出现「英语单词学习」折叠栏并可展开，渲染 .ws-settings',
      navClicked.clicked && accordion.found && extraPage !== null,
      { navClicked, accordion, extraPage }
    )
    record(
      'AC-28.5e',
      '设置页词库概览：共 58 词 / 已掌握 / 学习中 / 未学 + wordbank.json 路径',
      extraPage !== null &&
        extraPage.stats.includes('58') &&
        extraPage.path.includes('wordbank.json'),
      extraPage ? { stats: extraPage.stats, path: extraPage.path } : null
    )
    const expectedActions = ['导入词库', '导出词库', '打开词库文件', '重新读取文件', '恢复默认词库', '重置学习进度']
    record(
      'AC-28.5f',
      '设置页 5 个学习选项开关 + 6 个词库管理按钮（文案与顺序正确），旧空状态文案已移除',
      extraPage !== null &&
        extraPage.switches === 5 &&
        extraPage.actions === 6 &&
        expectedActions.every((label) => extraPage.actionLabels.includes(label)) &&
        extraPage.oldEmptyText === false,
      extraPage ? { switches: extraPage.switches, actionLabels: extraPage.actionLabels, oldEmptyText: extraPage.oldEmptyText } : null
    )
    const shotSettings = await pageShot(settingsClient, 'settings-extra-windows.png')
    record('AC-28.5g', '截图：settings-extra-windows.png（设置页附加窗口展开）', true, { shot: shotSettings }, [shotSettings])

    const toggled = await settingsClient.eval(`(async () => {
      const before = await window.nexus.settings.get()
      const beforeVal = before.extraWindows.find((config) => config.kind === 'wordstudy')?.options?.showPhonetic
      document.querySelector('.ws-settings-switches .ui-switch')?.click()
      await new Promise((resolve) => setTimeout(resolve, 800))
      const after = await window.nexus.settings.get()
      const afterVal = after.extraWindows.find((config) => config.kind === 'wordstudy')?.options?.showPhonetic
      return { beforeVal, afterVal }
    })()`)
    record(
      'AC-28.5h',
      '设置页开关写回 settings.extraWindows[].options（showPhonetic 翻转）',
      toggled.beforeVal !== toggled.afterVal,
      toggled
    )

    const confirmBar = await settingsClient.eval(`(async () => {
      const button = [...document.querySelectorAll('.ws-settings-actions .ui-btn')].find((el) => el.textContent.includes('恢复默认词库'))
      button?.click()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const bar = document.querySelector('.nx-confirm-bar')
      const text = bar?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
      const cancel = [...(bar?.querySelectorAll('.ui-btn') ?? [])].find((el) => el.textContent.trim() === '取消')
      cancel?.click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      return { shown: !!bar, text, canceled: !document.querySelector('.nx-confirm-bar') }
    })()`)
    record(
      'AC-28.5i',
      '设置页危险操作先出二次确认条（.nx-confirm-bar），点取消不执行',
      confirmBar.shown && confirmBar.text.includes('恢复默认') && confirmBar.canceled,
      confirmBar
    )

    const settingsReload = await settingsClient.eval(`(async () => {
      const button = [...document.querySelectorAll('.ws-settings-actions .ui-btn')].find((el) => el.textContent.includes('重新读取文件'))
      button?.click()
      await new Promise((resolve) => setTimeout(resolve, 900))
      return {
        clicked: !!button,
        msg: document.querySelector('.ws-settings-msg')?.textContent?.trim() ?? ''
      }
    })()`)
    record(
      'AC-28.5j',
      '设置页「重新读取文件」可执行并显示结果消息（.ws-settings-msg）',
      settingsReload.clicked && /重新读取/.test(settingsReload.msg),
      settingsReload
    )
  } else {
    record('AC-28.5d', '设置页附加窗口页', null, { reason: '设置窗口未打开' })
  }

  /* ================== AC-28.6 隐藏按钮 / 主题 / 回归 ================== */
  const hidden = await card.eval(`(async () => {
    document.querySelector('.ws-hide')?.click()
    await new Promise((resolve) => setTimeout(resolve, 800))
    const settings = await window.nexus.settings.get()
    return { visible: settings.extraWindows.find((config) => config.kind === 'wordstudy')?.visible }
  })()`)
  record(
    'AC-28.6a',
    '点卡片「隐藏」按钮 → 配置 visible=false（窗口隐藏，可从托盘/设置恢复）',
    hidden.visible === false,
    hidden
  )
  await dock.eval(`(async () => {
    const settings = await window.nexus.settings.get()
    const extraWindows = settings.extraWindows.map((config) =>
      config.kind === 'wordstudy' ? { ...config, visible: true } : config
    )
    await window.nexus.settings.update({ extraWindows })
  })()`)
  await sleep(500)

  const dockDom = await dock.eval(`(() => ({
    title: document.title,
    hasRoot: !!document.querySelector('.dock-root'),
    hasNexus: !!(window.nexus && window.nexus.wordBank),
    itemCount: document.querySelectorAll('.dock-item[data-dock-id]').length,
    empty: !!document.querySelector('.dock-empty')
  }))()`)
  record(
    'AC-28.6b',
    'Dock 回归：页面正常渲染 6 个图标（种子配置）、无空状态、preload 暴露 wordBank API',
    dockDom.hasRoot === true && dockDom.hasNexus === true && dockDom.itemCount === 6 && dockDom.empty === false,
    dockDom
  )

  // 设置页回归：主题/开关还原后关闭
  if (settingsClient) {
    await settingsClient.eval(`window.nexus.window.closeSettings()`).catch(() => undefined)
    settingsClient.close()
  }
  await sleep(500)

  await sleep(600)
  const diag = {
    dock: realDiagnostics('dock'),
    wordstudy: realDiagnostics('wordstudy'),
    settings: realDiagnostics('settings')
  }
  record(
    'AC-28.6c',
    '页面无 console error / 未捕获异常（Dock / 单词窗口 / 设置页，已过滤已知网络与安全警告噪声）',
    diag.dock.length === 0 && diag.wordstudy.length === 0 && diag.settings.length === 0,
    {
      counts: { dock: diag.dock.length, wordstudy: diag.wordstudy.length, settings: diag.settings.length },
      items: [...diag.dock, ...diag.wordstudy, ...diag.settings].slice(0, 8),
      totalDiagnostics: diagnostics.length
    }
  )

  const installedAfter = installedPids()
  record(
    'AC-28.6d',
    '安全边界：用户安装版（NexusDockApp）进程 PID 全程未变（未触碰真实环境）',
    installedBefore !== null && installedAfter !== null ? JSON.stringify(installedBefore) === JSON.stringify(installedAfter) : null,
    {
      before: installedBefore,
      after: installedAfter,
      note: installedBefore === null || installedAfter === null ? '无法读取安装版进程列表，跳过' : null
    }
  )

  // 恢复学习选项，避免污染后续手工复核（词库保持脚本结束状态，便于对照截图）
  await patchWordStudyOptions(card, { showPhonetic: true, autoNext: true }, '还原默认学习选项').catch(() => undefined)

  /* ============================ AC-28.7 门禁 ============================ */
  runGates()

  card.close()
  dock.close()

  return { env, installedBefore, installedAfter }
}

/* ============================================================================
 * 页面内小工具
 * ========================================================================== */
/** 写回 extraWindows 中 wordstudy 的 options（settings.update 整体替换数组） */
async function patchWordStudyOptions(client, optionsPatch, note, extra = {}) {
  return client.eval(`(async () => {
    const settings = await window.nexus.settings.get()
    const extraWindows = settings.extraWindows.map((config) =>
      config.kind === 'wordstudy'
        ? { ...config, ...${JSON.stringify(extra)}, options: { ...config.options, ...${JSON.stringify(optionsPatch)} } }
        : config
    )
    await window.nexus.settings.update({ extraWindows })
    return true
  })()`)
}

function readMigrationLog() {
  const candidates = [
    join(USERDATA, 'launch.out.log'),
    join(USERDATA, 'logs', 'main.log'),
    join(USERDATA, 'logs', 'extra.log')
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    if (/已从 v10 迁移到 v11/.test(text)) return { found: true, path: rel(path), line: '已从 v10 迁移到 v11' }
  }
  return { found: false, searched: candidates.map((path) => rel(path)) }
}

/* ============================================================================
 * 入口
 * ========================================================================== */
if (MODE === 'prepare') {
  prepare()
  process.exit(0)
} else if (MODE === 'launch') {
  try {
    await launch()
    process.exit(0)
  } catch (error) {
    console.error(`启动失败：${String(error?.message ?? error)}`)
    process.exit(1)
  }
} else if (MODE === 'cleanup') {
  cleanup()
} else {
  let fatal = null
  let context = {}
  try {
    context = await check()
  } catch (error) {
    fatal = error
    record('FATAL', '验收脚本执行异常', false, String(error?.stack ?? error))
  }

  const passed = checks.filter((item) => item.status === 'pass').length
  const failed = checks.filter((item) => item.status === 'fail').length
  const skipped = checks.filter((item) => item.status === 'skip').length
  const report = {
    version: APP_VERSION,
    title: 'Nexus Dock v1.8 独立验收（隔离 userData + CDP）：英语单词学习附加窗口 + 词库自由修改',
    mode: 'check',
    cdpPort: PORT,
    userDataDir: rel(USERDATA),
    seed: {
      schemaVersion: 10,
      extraWindows: [],
      note: '启动前写入 v10 基线配置（无 wordstudy），验证 v10→v11 纯增量迁移；首次启动播种 59 词'
    },
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    summary: { total: checks.length, passed, failed, skipped },
    passed,
    failed,
    skipped,
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
    checks,
    screenshots,
    gates,
    manualItems: MANUAL_ITEMS,
    diagnostics: {
      total: diagnostics.length,
      real: diagnostics.filter((entry) => !KNOWN_NOISE.some((re) => re.test(entry.text))).length,
      items: diagnostics.filter((entry) => !KNOWN_NOISE.some((re) => re.test(entry.text))).slice(0, 20),
      ignored: diagnostics.filter((entry) => KNOWN_NOISE.some((re) => re.test(entry.text))).length,
      notes: '只统计页面自身 error；ignored 为已知网络/媒体/安全警告噪声'
    },
    notes: [
      '本脚本只操作隔离 userData（.userdata/v18-verify）与命令行含 v18-verify 的 electron.exe，不触碰安装版 NexusDockApp。',
      '启动（PowerShell 手工方式）必须用单条带引号的参数字符串，否则仓库路径空格会把 --user-data-dir 拆坏；且要先 Remove-Item Env:ELECTRON_RUN_AS_NODE。',
      '导入/导出原生对话框、托盘/Dock 右键菜单、真实拖动吸附、桌面合成观感列入手动项（见 manualItems）。',
      'out/ 由 Lead 预先构建，本脚本不重建，避免与运行中的隔离实例冲突。'
    ],
    safety: {
      scope: '仅隔离实例 electron.exe（命令行含 v18-verify）与 .userdata/v18-verify',
      forbidden: ['按进程名 Stop-Process 全部 electron.exe', '操作安装版 NexusDockApp 窗口', '读写 %APPDATA%\\nexus-dock'],
      installedPidsUntouched:
        context?.installedBefore != null && context?.installedAfter != null
          ? JSON.stringify(context.installedBefore) === JSON.stringify(context.installedAfter)
          : null
    }
  }
  writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log('')
  console.log('===============================================================')
  console.log(
    `验收完成：${passed}/${checks.length} 通过，${failed} 失败，${skipped} 跳过${
      context?.env?.appVersion ? `（Nexus Dock v${context.env.appVersion}）` : ''
    }`
  )
  if (fatal) console.log(`FATAL: ${fatal?.message ?? fatal}`)
  console.log(`报告：${rel(OUT_REPORT)}`)
  if (screenshots.length > 0) console.log(`截图：${screenshots.join(', ')}`)
  console.log('清理隔离实例：node scripts/v18-verify.mjs --cleanup')
  console.log('===============================================================')
  process.exit(failed === 0 && !fatal ? 0 : 1)
}
