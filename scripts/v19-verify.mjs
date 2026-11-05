/* ============================================================================
 * Nexus Dock v1.9 运行时验收（真实 Electron 主路径 + Edge 渲染层对照）
 * ============================================================================
 *
 * 背景（实测纠正）：本会话 `electron --version` 会崩（exit -2147483645 /
 * 0x80000003，疑为无控制台上下文），但 `electron .` 带 --remote-debugging-port
 * 启动是正常的：主进程存活、/json/list 有 wordstudy/music/dock 真实页面、
 * CDP 可 Evaluate/Screenshot。因此 v1.9 的运行时验收以真实 Electron 为主：
 *
 *   - 主路径（scope="electron"）：真实 main 进程 + 真实 preload（window.nexus）
 *     + 真实 IPC + 真实磁盘读写。隔离 userData 为
 *     .userdata/v19-verify/electron-userdata/，里面写 v1 旧格式
 *     wordbank-progress.json 与 8 词测试词库；断言 a)~j) 全部走真实链路，
 *     包含 wordbank-progress.json 落盘校验（version=2 与 5 个复习字段）。
 *   - 对照路径（scope="renderer"，report.renderer）：Edge headless=new +
 *     out/renderer 真实构建产物 + CDP 注入 window.nexus stub。stub 的迁移/统计
 *     调用 src/shared/wordBank.ts 同一份源码（stripTypeScriptTypes 注入），
 *     用于交叉验证渲染层 DOM 行为，但不是主结论。
 *   - 绝不写真实 %APPDATA%\nexus-dock；只操作 .userdata/v19-verify/。
 *
 * 四步命令（全部在仓库根目录执行）：
 *
 *   node scripts/v19-verify.mjs --prepare
 *     # 写隔离 fixture（.userdata/v19-verify/settings.json / wordbank.json /
 *     # wordbank-progress.json v1 旧格式），同时准备 electron-userdata 副本，
 *     # 打印 fixture 与迁移摘要。
 *
 *   node scripts/v19-verify.mjs --launch
 *     # 启动真实 Electron（隔离 userData + CDP 9393），打印页面 target，供人工
 *     # 连 CDP 调试；--check 会自动拉起/关闭 Electron，无需先跑 --launch。
 *
 *   node scripts/v19-verify.mjs --check
 *     # 主路径：启动 Electron → 逐项断言 a)~j) → 落盘校验 → 关进程；
 *     # 对照：Edge + stub 再跑一遍 a)~j)；结果与截图写
 *     # docs/verification/v1.9/report.json。
 *
 *   node scripts/v19-verify.mjs --cleanup
 *     # 杀掉本脚本启动的 electron.exe / msedge.exe（命令行含 v19-verify），
 *     # 删除 .userdata/v19-verify；保留 report.json 与截图；幂等可重跑。
 *
 * 可选环境变量：
 *   NEXUS_V19_HTTP_PORT     静态服务器端口（默认 9380，仅 Edge 对照路径）
 *   NEXUS_V19_CDP_PORT      Edge CDP 端口（默认 9373）
 *   NEXUS_V19_ELECTRON_CDP_PORT  Electron CDP 端口（默认 9393）
 *   NEXUS_V19_EDGE          Edge 可执行文件路径（默认 Program Files (x86) 下）
 *
 * 安全约束：
 *   - 只操作 .userdata/v19-verify/ 与命令行含 v19-verify 的 electron/msedge；
 *   - 不按进程名杀全部 msedge / electron；
 *   - 不改 src/、tests/、package.json；写入范围仅本脚本与
 *     docs/verification/v1.9/**。
 * ========================================================================== */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ================================ 常量 ================================ */

const ROOT = process.cwd()
const SCRIPT_PATH = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const USERDATA = join(ROOT, '.userdata', 'v19-verify')
const SETTINGS_PATH = join(USERDATA, 'settings.json')
const WORDS_PATH = join(USERDATA, 'wordbank.json')
const PROGRESS_PATH = join(USERDATA, 'wordbank-progress.json')
const EDGE_USERDATA = join(USERDATA, 'edge-profile')
const EDGE_INSTANCE_PATH = join(USERDATA, 'edge-instance.json')
const EDGE_OUT_LOG = join(USERDATA, 'edge.out.log')
const EDGE_ERR_LOG = join(USERDATA, 'edge.err.log')
const ELECTRON_USERDATA = join(USERDATA, 'electron-userdata')
const ELECTRON_OUT_LOG = join(USERDATA, 'electron.out.log')
const ELECTRON_ERR_LOG = join(USERDATA, 'electron.err.log')
const ELECTRON_INSTANCE_PATH = join(USERDATA, 'electron-instance.json')
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.9')
const OUT_REPORT = join(OUT_DIR, 'report.json')
const OUT_RENDERER = join(ROOT, 'out', 'renderer')
const WB_TS_PATH = join(ROOT, 'src', 'shared', 'wordBank.ts')
const TYPES_TS_PATH = join(ROOT, 'src', 'shared', 'types.ts')
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const EDGE_EXE =
  process.env.NEXUS_V19_EDGE ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const HTTP_PORT = Number(process.env.NEXUS_V19_HTTP_PORT ?? 9380)
const CDP_PORT = Number(process.env.NEXUS_V19_CDP_PORT ?? 9373)
const ELECTRON_CDP_PORT = Number(process.env.NEXUS_V19_ELECTRON_CDP_PORT ?? 9393)
const APP_VERSION = '1.9.0'
const WORD_COUNT = 8

/** 任务要求的验收项 a–j（用于中断时补齐「未执行」项，保证统计数稳定为 10）。 */
const ELECTRON_ITEM_LABELS = [
  ['a', '迁移后已学词进入待复习（真实磁盘 v1 旧格式 → version 2）'],
  ['b', '学习视图卡片渲染单词/音标/释义（默认遮住）+ 记忆计划条'],
  ['c', '空格显示释义、1/2/3 评分后 IPC 落盘 5 字段并提示含「复习」'],
  ['d', '点头部「单词表」进入 list 视图，出现 5 档筛选与行'],
  ['e', '切「待复习」筛选行数 > 0、切「已掌握」行数 > 0'],
  ['f', '行内状态下拉改「已掌握」后磁盘 status=mastered 且徽标同步'],
  ['g', '▶ 回到 study 视图且当前词为该行单词'],
  ['h', '设置页出现 7 个开关与「待复习」统计'],
  ['i', 'list 视图窗口宽度 480 级、回 study 360 级'],
  ['j', '无 console error / 未捕获异常']
]

const argv = process.argv.slice(2)
const MODE = argv.includes('--prepare')
  ? 'prepare'
  : argv.includes('--launch')
    ? 'launch'
    : argv.includes('--cleanup')
      ? 'cleanup'
      : argv.includes('--check')
        ? 'check'
        : 'usage'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const rel = (path) => relative(ROOT, path).replaceAll('\\', '/')
const hasBom = (path) => {
  try {
    return readFileSync(path).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  } catch {
    return false
  }
}
const tail = (path, lines = 24) => {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/* =========================== 共享模块（同源） =========================== */

/** 运行时 import 共享模块：Node 24 原生剥离 TS 类型；纯函数模块无副作用。 */
async function loadShared() {
  const wordBank = await import(pathToFileURL(WB_TS_PATH).href)
  const types = await import(pathToFileURL(TYPES_TS_PATH).href)
  return { wordBank, types }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 构造隔离 fixture：settings（含 wordstudy 附加窗口）+ 8 词库 + v1 旧进度。 */
function buildFixture(shared) {
  const { wordBank, types } = shared
  const settings = JSON.parse(JSON.stringify(types.DEFAULT_SETTINGS))
  const wordstudy = settings.extraWindows.find((item) => item.kind === wordBank.WORD_STUDY_KIND)
  if (!wordstudy) throw new Error('DEFAULT_SETTINGS.extraWindows 中缺少 wordstudy 配置')
  Object.assign(wordstudy, {
    visible: true,
    snapToEdge: true,
    edge: 'top',
    alongPercent: 50,
    freeX: -1,
    freeY: -1,
    alwaysOnTop: true,
    onlyOnDesktop: false,
    locked: false,
    theme: 'dark'
  })
  wordstudy.options = {
    showPhonetic: true,
    showExample: true,
    hideMeaning: true,
    shuffle: false,
    autoNext: true,
    reviewFirst: true,
    showSchedule: true
  }

  // 真实 59 词词表里裁前 8 个（词条结构与 DEFAULT_WORDS 完全一致）
  const sourceWords = wordBank.DEFAULT_WORDS.slice(0, WORD_COUNT)
  const words = sourceWords.map((entry) => ({
    word: entry.word,
    phonetic: entry.phonetic,
    meaning: entry.meaning,
    example: entry.example
  }))
  const keys = words.map((entry) => wordBank.normalizeWordKey(entry.word))

  // v1 旧格式：version:1，只有 status/seen/remembered/lastSeenAt，
  // 没有 dueAt/intervalDays/ease/streak/lapses —— 由产品 sanitizer 迁移。
  const now = Date.now()
  const legacyProgress = {
    version: 1,
    progress: {
      [keys[0]]: { status: 'learning', seen: 3, remembered: 1, lastSeenAt: now - 3 * DAY_MS },
      [keys[1]]: { status: 'mastered', seen: 5, remembered: 4, lastSeenAt: now - 4 * DAY_MS },
      [keys[2]]: { status: 'learning', seen: 2, remembered: 0, lastSeenAt: now - 2 * DAY_MS },
      [keys[3]]: { status: 'mastered', seen: 4, remembered: 3, lastSeenAt: now - 5 * DAY_MS }
    }
  }

  const paths = {
    words: WORDS_PATH,
    progress: PROGRESS_PATH
  }

  return { settings, words, legacyProgress, paths, wordstudyOptions: wordstudy.options, now }
}

/** prepare 阶段用于 report/摘要的迁移结果（Node 侧，与页面 stub 同源函数）。 */
function previewMigration(shared, fixture) {
  const { wordBank } = shared
  const bank = wordBank.combineWordBank(fixture.words, fixture.legacyProgress)
  const review = wordBank.wordBankReviewStats(bank, Date.now())
  const queue = wordBank.studyQueueKeys(
    bank,
    wordBank.resolveWordStudyOptions(fixture.wordstudyOptions),
    Date.now()
  )
  const legacyKeys = Object.keys(fixture.legacyProgress.progress)
  return {
    legacyVersion: fixture.legacyProgress.version,
    legacyEntries: legacyKeys.length,
    migratedEntries: Object.keys(bank.progress).length,
    stats: review,
    due: review.due,
    expectedQueue: queue.slice(0, 6),
    sample: {
      key: legacyKeys[0],
      legacy: fixture.legacyProgress.progress[legacyKeys[0]],
      migrated: bank.progress[legacyKeys[0]] ?? null
    },
    wordCount: bank.words.length
  }
}

/* ============================ 准备阶段 ============================ */

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function runPrepare() {
  const shared = await loadShared()
  const fixture = buildFixture(shared)
  const migration = previewMigration(shared, fixture)

  mkdirSync(USERDATA, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  writeJson(SETTINGS_PATH, fixture.settings)
  writeJson(WORDS_PATH, { version: 1, words: fixture.words })
  writeJson(PROGRESS_PATH, fixture.legacyProgress)
  const electronFixture = prepareElectronUserData(fixture)

  const summary = {
    ok: true,
    mode: 'prepare',
    userData: rel(USERDATA),
    electronUserData: electronFixture.dir,
    settings: {
      path: rel(SETTINGS_PATH),
      schemaVersion: fixture.settings.schemaVersion,
      extraWindows: fixture.settings.extraWindows.map((item) => ({
        kind: item.kind,
        visible: item.visible,
        options: item.options
      })),
      bytes: statSync(SETTINGS_PATH).size,
      bom: hasBom(SETTINGS_PATH)
    },
    words: {
      path: rel(WORDS_PATH),
      count: fixture.words.length,
      version: 1,
      bytes: statSync(WORDS_PATH).size,
      bom: hasBom(WORDS_PATH)
    },
    progress: {
      path: rel(PROGRESS_PATH),
      version: fixture.legacyProgress.version,
      format: 'v1: 仅 status/seen/remembered/lastSeenAt（无 dueAt/intervalDays/ease/streak/lapses）',
      entries: Object.keys(fixture.legacyProgress.progress).length,
      bytes: statSync(PROGRESS_PATH).size,
      bom: hasBom(PROGRESS_PATH)
    },
    migration,
    next: 'node scripts/v19-verify.mjs --check'
  }
  console.log(JSON.stringify(summary, null, 2))
}

/* ============================ 静态服务器 ============================ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

function startStaticServer(port) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      let pathname = decodeURIComponent(url.pathname)
      if (pathname === '/') pathname = '/index.html'
      const filePath = resolve(OUT_RENDERER, `.${pathname}`)
      const rootWithSep = OUT_RENDERER.endsWith(sep) ? OUT_RENDERER : `${OUT_RENDERER}${sep}`
      if (!filePath.startsWith(rootWithSep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      })
      res.end(readFileSync(filePath))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(String(error?.message ?? error))
    }
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolvePromise(server))
  })
}

/* ================================ Edge ================================ */

async function cdpVersion() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(1500)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
    signal: AbortSignal.timeout(3000)
  })
  if (!res.ok) throw new Error(`CDP /json/list 返回 ${res.status}`)
  return res.json()
}

async function waitCdp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const version = await cdpVersion()
    if (version) return version
    await sleep(300)
  }
  return null
}

async function launchEdge() {
  if (!existsSync(EDGE_EXE)) throw new Error(`找不到 Edge：${EDGE_EXE}`)
  const alive = await cdpVersion()
  if (alive) {
    return { reused: true, version: alive, pid: readEdgePid() }
  }
  mkdirSync(EDGE_USERDATA, { recursive: true })
  const outFd = openSync(EDGE_OUT_LOG, 'a')
  const errFd = openSync(EDGE_ERR_LOG, 'a')
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=520,900',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${EDGE_USERDATA}`,
    'about:blank'
  ]
  const child = spawn(EDGE_EXE, args, {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, errFd]
  })
  child.unref()
  const startedAt = new Date().toISOString()
  writeJson(EDGE_INSTANCE_PATH, { pid: child.pid, port: CDP_PORT, startedAt, userDataDir: EDGE_USERDATA })
  const version = await waitCdp(30000)
  if (!version) {
    const errText = tail(EDGE_ERR_LOG, 24)
    throw new Error(
      `30s 内 Edge CDP 未就绪（port=${CDP_PORT}）。\n${rel(EDGE_ERR_LOG)}：\n${errText || '(空)'}`
    )
  }
  return { reused: false, version, pid: child.pid }
}

function readEdgePid() {
  try {
    return JSON.parse(readFileSync(EDGE_INSTANCE_PATH, 'utf8')).pid ?? null
  } catch {
    return null
  }
}

async function createTarget(url = 'about:blank') {
  const base = `http://127.0.0.1:${CDP_PORT}`
  let created = null
  try {
    const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(5000)
    })
    if (res.ok) created = await res.json()
  } catch {
    /* 老版本只支持 GET，下面兜底 */
  }
  if (!created) {
    try {
      const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) created = await res.json()
    } catch {
      /* ignore */
    }
  }
  if (!created?.id) throw new Error('CDP 创建页面 target 失败（/json/new）')
  const targets = await listTargets()
  const target = targets.find((item) => item.id === created.id)
  if (!target?.webSocketDebuggerUrl) throw new Error('新建 target 缺少 webSocketDebuggerUrl')
  return target
}

/* ============================== CDP 客户端 ============================== */

class CdpClient {
  constructor(ws, label) {
    this.ws = ws
    this.label = label
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
    return new Promise((resolvePromise, reject) => {
      const id = ++this.seq
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  onEvent(fn) {
    this.listeners.push(fn)
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

async function connectTarget(target, label, diagnostics) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket 连接超时：${target.url}`)), 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolvePromise()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`WebSocket 连接失败：${target.url}`))
    })
  })
  const client = new CdpClient(ws, label)
  client.onEvent((message) => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => (typeof arg.value === 'string' ? arg.value : arg.description ?? arg.type ?? ''))
        .join(' ')
      diagnostics.push({ page: label, kind: 'console.error', text: text.slice(0, 700) })
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      diagnostics.push({
        page: label,
        kind: 'exception',
        text: `${details?.exception?.description ?? details?.text ?? 'exception'}`.slice(0, 700)
      })
    } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      const entry = message.params.entry
      diagnostics.push({
        page: label,
        kind: 'log.error',
        text: `${entry.text ?? ''} ${entry.url ?? ''}`.trim().slice(0, 700)
      })
    }
  })
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Page.enable'),
    client.send('Log.enable')
  ])
  return client
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
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

async function waitFor(client, expression, timeoutMs = 10000, intervalMs = 120) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(client, expression)
      if (value) return value
    } catch {
      /* 页面切换/重载期间可能报错 */
    }
    await sleep(intervalMs)
  }
  return null
}

async function pressKey(client, key, code, vk) {
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  })
}

/* ========================== window.nexus stub ========================== */

/**
 * 把 src/shared/wordBank.ts（TypeScript ESM）转换成可同步执行的 classic 脚本：
 * stripTypeScriptTypes 去类型 + 去掉 export 前缀 + 把导出挂到 window.__v19wb。
 * 页面脚本执行前注入，stub 的迁移/统计调用的是同一份产品源码。
 */
function buildInjectedSource(fixture) {
  const raw = readFileSync(WB_TS_PATH, 'utf8')
  const stripped = stripTypeScriptTypes(raw, { mode: 'strip' })
  const names = [
    ...stripped.matchAll(
      /^export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z0-9_$]+)/gm
    )
  ].map((match) => match[1])
  if (names.length === 0) throw new Error('未能从 wordBank.ts 提取导出名')
  const classic = stripped.replace(
    /^export\s+(?=(?:const|let|var|function|class|async\s+function)\b)/gm,
    ''
  )
  if (/^\s*export\s/m.test(classic)) throw new Error('wordBank.ts 转换后仍残留 export 语句')

  const fixtureJson = JSON.stringify({
    settings: fixture.settings,
    words: fixture.words,
    legacyProgress: fixture.legacyProgress,
    paths: fixture.paths
  })

  const body = `
  const FIXTURE = __FIXTURE_JSON__;
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const entries = sanitizeWordEntries(FIXTURE.words);
  const initialBank = combineWordBank(entries, FIXTURE.legacyProgress);
  const v19 = {
    settings: clone(FIXTURE.settings),
    bank: initialBank,
    entries,
    writes: [],
    sizeCalls: [],
    settingsUpdates: [],
    migration: null
  };
  window.__v19 = v19;
  const settingsListeners = new Set();
  const bankListeners = new Set();
  const notify = (listeners, value) => {
    for (const cb of Array.from(listeners)) {
      try {
        cb(clone(value));
      } catch {
        /* stub 回调异常不影响页面 */
      }
    }
  };
  const mergeSettings = (base, patch) => {
    const next = clone(base);
    for (const key of Object.keys(patch || {})) {
      const value = patch[key];
      const current = next[key];
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        current &&
        typeof current === 'object' &&
        !Array.isArray(current)
      ) {
        next[key] = Object.assign({}, current, value);
      } else {
        next[key] = clone(value);
      }
    }
    return next;
  };
  const legacyProgressMap = (FIXTURE.legacyProgress && FIXTURE.legacyProgress.progress) || {};
  const legacyKeys = Object.keys(legacyProgressMap);
  const migratedKeys = Object.keys(initialBank.progress);
  const sampleLegacyKey = legacyKeys[0] || null;
  const sampleMigratedKey =
    sampleLegacyKey && initialBank.progress[sampleLegacyKey] ? sampleLegacyKey : migratedKeys[0] || null;
  const wordstudyConfig =
    (v19.settings.extraWindows || []).find((item) => item.kind === 'wordstudy') || {};
  const studyOptions = resolveWordStudyOptions(wordstudyConfig.options);
  const loadedAt = Date.now();
  const reviewStats = wordBankReviewStats(initialBank, loadedAt);
  v19.migration = {
    loadedAt,
    legacyVersion: FIXTURE.legacyProgress ? FIXTURE.legacyProgress.version : null,
    legacyEntries: legacyKeys.length,
    migratedEntries: migratedKeys.length,
    stats: reviewStats,
    due: reviewStats.due,
    legacySample: sampleLegacyKey ? clone(legacyProgressMap[sampleLegacyKey]) : null,
    migratedSample: sampleMigratedKey ? clone(initialBank.progress[sampleMigratedKey]) : null,
    expectedQueue: studyQueueKeys(initialBank, studyOptions, loadedAt).slice(0, 6),
    studyOptions
  };
  const wordBankApi = {
    get: async () => clone(v19.bank),
    setWords: async () => clone(v19.bank),
    setProgress: async (progress) => {
      const previous = v19.bank.progress;
      const next = combineWordBank(v19.entries, progress);
      const changedKeys = [];
      const keys = new Set(Object.keys(previous).concat(Object.keys(next.progress)));
      for (const key of keys) {
        if (JSON.stringify(previous[key] || null) !== JSON.stringify(next.progress[key] || null)) {
          changedKeys.push(key);
        }
      }
      v19.bank = next;
      v19.writes.push({
        at: Date.now(),
        changedKeys,
        progress: clone(next.progress),
        bank: clone(next)
      });
      notify(bankListeners, next);
      return clone(next);
    },
    resetWords: async () => clone(v19.bank),
    resetProgress: async () => {
      v19.bank = combineWordBank(v19.entries, {});
      notify(bankListeners, v19.bank);
      return clone(v19.bank);
    },
    importFromFile: async () => ({ ok: false, message: 'renderer stub 不支持导入' }),
    exportToFile: async () => ({ ok: false, message: 'renderer stub 不支持导出' }),
    openFile: async () => ({ ok: false, message: 'renderer stub 不支持打开文件' }),
    reloadFromDisk: async () => clone(v19.bank),
    paths: async () => clone(FIXTURE.paths),
    onChanged: (cb) => {
      bankListeners.add(cb);
      return () => bankListeners.delete(cb);
    }
  };
  const settingsApi = {
    get: async () => clone(v19.settings),
    update: async (patch) => {
      v19.settings = mergeSettings(v19.settings, patch);
      v19.settingsUpdates.push(clone(patch));
      notify(settingsListeners, v19.settings);
      return clone(v19.settings);
    },
    reset: async () => {
      v19.settings = clone(FIXTURE.settings);
      notify(settingsListeners, v19.settings);
      return clone(v19.settings);
    },
    onChanged: (cb) => {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    }
  };
  const noop = () => undefined;
  const unsubscribe = () => noop;
  window.nexus = {
    env: {
      platform: 'win32',
      isDev: false,
      isPackaged: true,
      appVersion: '${APP_VERSION}',
      versions: { electron: '44.7.0', chrome: '142.0.0.0', node: '24.21.0' }
    },
    settings: settingsApi,
    wordBank: wordBankApi,
    window: {
      setContentSize: noop,
      setOwnContentSize: (size) => {
        v19.sizeCalls.push({ at: Date.now(), width: size ? size.width : null, height: size ? size.height : null });
      },
      openSettings: noop,
      closeSettings: noop,
      minimizeSettings: noop,
      quit: noop,
      capture: noop,
      setIgnoreMouse: noop
    },
    dock: { snap: async () => ({ ok: true }) },
    apps: {
      list: async () => [],
      launch: async () => ({ ok: false }),
      remove: async () => ({ ok: false }),
      addByDialog: async () => ({ ok: false }),
      reorder: async () => ({ ok: true }),
      menu: async () => ({}),
      dockMenu: async () => ({}),
      scanStartMenu: async () => ({ ok: true, items: [] }),
      addFromStartMenu: async () => ({ ok: false }),
      updateItem: async () => ({ ok: false }),
      pickIcon: async () => ({ ok: false }),
      requestEdit: noop,
      consumeEditRequest: async () => null,
      onEditRequest: unsubscribe,
      onRunning: unsubscribe
    },
    system: { setAutoStart: async () => ({ ok: true }) },
    media: {
      getState: async () => ({ playing: false, title: null, artist: null, position: 0, duration: 0 }),
      control: async () => ({ ok: true }),
      pickFiles: async () => ({ ok: true, tracks: [] }),
      setLocalState: noop,
      onUpdate: unsubscribe,
      onTracks: unsubscribe
    }
  };
`

  return (
    `(() => {\n'use strict';\n` +
    classic +
    `\nwindow.__v19wb = { ${names.join(', ')} };\n` +
    body.split('__FIXTURE_JSON__').join(fixtureJson) +
    `\n})();\n`
  )
}

/* ============================ 截图工具 ============================ */

async function elementRect(client, selector) {
  return evaluate(
    client,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`
  )
}

async function captureElement(client, selector, file, pad = 8) {
  const rect = await elementRect(client, selector)
  if (!rect || rect.width < 2 || rect.height < 2) {
    throw new Error(`截图元素缺失或尺寸异常：${selector}`)
  }
  const clip = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.ceil(rect.width + pad * 2),
    height: Math.ceil(rect.height + pad * 2),
    scale: 1
  }
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip
  })
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return rel(file)
}

async function captureViewportClip(client, clip, file) {
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: Math.max(0, Math.floor(clip.x)),
      y: Math.max(0, Math.floor(clip.y)),
      width: Math.max(1, Math.ceil(clip.width)),
      height: Math.max(1, Math.ceil(clip.height)),
      scale: 1
    }
  })
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return rel(file)
}

/* ========================== Electron（主路径） ========================== */

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** electron --version 在本会话会崩；如实记录，不据此判定 GUI 不可用。 */
function electronVersionCheck() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  const result = spawnSync(ELECTRON_EXE, ['--version'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true
  })
  const code = result.status
  const hex =
    typeof code === 'number'
      ? code < 0
        ? `0x${(code >>> 0).toString(16).toUpperCase()}`
        : `0x${code.toString(16).toUpperCase()}`
      : null
  return {
    exitCode: code ?? null,
    exitHex: hex,
    signal: result.signal ?? null,
    stdout: String(result.stdout ?? '').slice(0, 400),
    stderr: String(result.stderr ?? '').slice(0, 800),
    error: result.error ? String(result.error.message) : null
  }
}

/** Electron 主路径的隔离 userData：每次 check 都从同一份 v1 fixture 重新开始。 */
function prepareElectronUserData(fixture) {
  rmSync(ELECTRON_USERDATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  mkdirSync(ELECTRON_USERDATA, { recursive: true })
  writeJson(join(ELECTRON_USERDATA, 'settings.json'), fixture.settings)
  writeJson(join(ELECTRON_USERDATA, 'wordbank.json'), { version: 1, words: fixture.words })
  writeJson(join(ELECTRON_USERDATA, 'wordbank-progress.json'), fixture.legacyProgress)
  return {
    dir: rel(ELECTRON_USERDATA),
    settings: rel(join(ELECTRON_USERDATA, 'settings.json')),
    words: rel(join(ELECTRON_USERDATA, 'wordbank.json')),
    progress: rel(join(ELECTRON_USERDATA, 'wordbank-progress.json'))
  }
}

async function cdpVersionOn(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function listTargetsOn(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3000)
  })
  if (!res.ok) throw new Error(`CDP /json/list 返回 ${res.status}`)
  return res.json()
}

async function waitCdpOn(port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const version = await cdpVersionOn(port)
    if (version) return version
    await sleep(300)
  }
  return null
}

async function waitForTarget(port, predicate, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await listTargetsOn(port)
      const hit = targets.find((item) => item.type === 'page' && predicate(item))
      if (hit) return hit
    } catch {
      /* CDP 尚未就绪 */
    }
    await sleep(350)
  }
  return null
}

function readElectronPid() {
  return readJsonFile(ELECTRON_INSTANCE_PATH)?.pid ?? null
}

/** 启动真实 Electron（隔离 userData + CDP），返回浏览器版本与 target 列表。 */
async function launchElectronApp() {
  if (!existsSync(ELECTRON_EXE)) throw new Error(`找不到 Electron：${ELECTRON_EXE}`)
  const alive = await cdpVersionOn(ELECTRON_CDP_PORT)
  if (alive) return { reused: true, version: alive, pid: readElectronPid() }

  mkdirSync(USERDATA, { recursive: true })
  mkdirSync(ELECTRON_USERDATA, { recursive: true })
  const outFd = openSync(ELECTRON_OUT_LOG, 'a')
  const errFd = openSync(ELECTRON_ERR_LOG, 'a')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  const child = spawn(
    ELECTRON_EXE,
    [
      '--no-sandbox',
      `--remote-debugging-port=${ELECTRON_CDP_PORT}`,
      `--user-data-dir=${ELECTRON_USERDATA}`,
      '.'
    ],
    {
      cwd: ROOT,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd]
    }
  )
  child.unref()
  writeJson(ELECTRON_INSTANCE_PATH, {
    pid: child.pid,
    port: ELECTRON_CDP_PORT,
    startedAt: new Date().toISOString(),
    userDataDir: ELECTRON_USERDATA
  })
  const version = await waitCdpOn(ELECTRON_CDP_PORT, 40000)
  if (!version) {
    throw new Error(
      `40s 内 Electron CDP 未就绪（port=${ELECTRON_CDP_PORT}）。\n${rel(ELECTRON_ERR_LOG)}：\n${
        tail(ELECTRON_ERR_LOG, 24) || '(空)'
      }`
    )
  }
  return { reused: false, version, pid: child.pid }
}

function isolatedElectronPids() {
  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Where-Object { $_.CommandLine -like '*v19-verify*' } | ForEach-Object { $_.ProcessId }) -join ','"
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000, windowsHide: true }
    ).trim()
    return output
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

async function killElectronIsolated() {
  const instancePid = readElectronPid()
  if (instancePid) {
    try {
      execFileSync('taskkill', ['/PID', String(instancePid), '/T', '/F'], {
        cwd: ROOT,
        windowsHide: true,
        timeout: 20000
      })
    } catch {
      /* 已退出 */
    }
  }
  const deadline = Date.now() + 12000
  let left = isolatedElectronPids()
  while (left.length > 0 && Date.now() < deadline) {
    killPids(left)
    await sleep(300)
    left = isolatedElectronPids()
  }
  return { killed: instancePid ? [instancePid] : [], leftovers: left }
}

/** 读取真实 main 进程写出的 wordbank-progress.json（不带 BOM）。 */
function readElectronProgress() {
  const json = readJsonFile(join(ELECTRON_USERDATA, 'wordbank-progress.json'))
  if (!json || typeof json !== 'object') return null
  return {
    version: json.version ?? null,
    progress: json.progress ?? json
  }
}

async function waitDiskProgress(predicate, timeoutMs = 10000, intervalMs = 120) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = readElectronProgress()
    if (state && predicate(state)) return state
    await sleep(intervalMs)
  }
  return null
}

/**
 * 真实 Electron 主路径验收：真实 main + 真实 preload + 真实 IPC + 真实磁盘。
 * 断言 a)~j)，返回 { environment, items, screenshots }；无论成功失败都关进程。
 */
async function runElectronCheck(fixture, migration, shared) {
  const { wordBank } = shared
  const items = []
  const screenshots = []
  const diagnostics = []
  const record = (id, name, pass, evidence, detail) => {
    const item = { id, name, scope: 'electron', pass: pass === true, evidence, detail }
    items.push(item)
    const brief = JSON.stringify(evidence ?? null).slice(0, 700)
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${id} ${name}${brief && brief !== 'null' ? ` :: ${brief}` : ''}`)
    return item
  }

  const versionCheck = electronVersionCheck()
  const fixtureInfo = prepareElectronUserData(fixture)
  let launch = null
  let targets = []
  let page = null
  let settingsPage = null
  let environment = null
  let failure = null

  try {
    launch = await launchElectronApp()
    const allTargets = await listTargetsOn(ELECTRON_CDP_PORT).catch(() => [])
    targets = allTargets
      .filter((item) => item.type === 'page')
      .map((item) => ({ title: item.title, url: item.url }))

    const wordstudyTarget = await waitForTarget(
      ELECTRON_CDP_PORT,
      (item) => /\/wordstudy\/index\.html/.test(item.url),
      45000
    )
    if (!wordstudyTarget) {
      throw new Error(
        `Electron 已启动但 45s 内没有 wordstudy 页面 target。当前 targets：${JSON.stringify(targets)}`
      )
    }
    page = await connectTarget(wordstudyTarget, 'electron:wordstudy', diagnostics)
    const ready = await waitFor(
      page,
      `(() => Boolean(document.querySelector('.ws-root') && document.querySelector('.ws-word') && document.querySelector('.ws-word').textContent.trim()))()`,
      30000
    )
    if (!ready) {
      const body = await evaluate(page, `document.body ? document.body.innerHTML.slice(0, 1200) : ''`)
      throw new Error(`真实 Electron 学习页 30s 内未就绪。DOM: ${body}`)
    }
    const baseState = await evaluate(
      page,
      `(() => ({
        title: document.title,
        nexus: typeof window.nexus,
        view: document.querySelector('.ws-root').dataset.view,
        error: document.querySelector('.ws-error') ? document.querySelector('.ws-error').textContent.trim() : null,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      }))()`
    )
    const realBank = await evaluate(page, `window.nexus.wordBank.get()`)
    const realPaths = await evaluate(page, `window.nexus.wordBank.paths()`)

    // a) v1 旧进度 → 真实 main 迁移 → 待复习
    const pill = await evaluate(
      page,
      `(() => { const el = document.querySelector('.ws-review-pill'); return el ? el.textContent.trim() : null })()`
    )
    const dueNumber = Number((String(pill ?? '').match(/待复习\s*(\d+)/) ?? [])[1] ?? NaN)
    const sampleKey = Object.keys(fixture.legacyProgress.progress)[0]
    const migratedSample = realBank?.progress?.[sampleKey] ?? null
    const fullFields = ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses'].every(
      (key) => typeof migratedSample?.[key] === 'number'
    )
    record(
      'a',
      'v1 旧进度经真实 main 迁移后已学词进入待复习（dueAt=lastSeenAt）',
      dueNumber > 0 &&
        dueNumber === migration.due &&
        fullFields &&
        (migratedSample?.dueAt ?? -1) === fixture.legacyProgress.progress[sampleKey]?.lastSeenAt,
      {
        pill,
        due: dueNumber,
        expectedDue: migration.due,
        wordsCount: realBank?.words?.length ?? null,
        paths: realPaths,
        legacySample: fixture.legacyProgress.progress[sampleKey],
        migratedSample
      },
      '真实 Electron 读取隔离 userData 里的 v1 wordbank-progress.json（无 dueAt/intervalDays/ease/streak/lapses）；preload→IPC→main 迁移后 pill 显示待复习 n>0，wordBank.get() 返回的条目补齐 5 个字段且 dueAt=lastSeenAt。'
    )

    // b) 学习视图卡片（hideMeaning 先遮住 + 记忆计划条）
    const card = await evaluate(
      page,
      `(() => {
        const text = (selector) => { const el = document.querySelector(selector); return el ? el.textContent.trim() : null };
        const meaning = document.querySelector('.ws-meaning');
        return {
          word: text('.ws-word'),
          phonetic: text('.ws-phonetic'),
          meaning: text('.ws-meaning-text'),
          revealed: meaning ? meaning.dataset.revealed : null,
          cover: Boolean(document.querySelector('.ws-meaning-cover')),
          schedule: text('.ws-schedule-text'),
          status: text('.ws-status'),
          progress: text('.ws-progress')
        };
      })()`
    )
    record(
      'b',
      '学习视图渲染单词/音标/释义，hideMeaning 时先遮住',
      Boolean(card.word) &&
        card.word === migration.expectedQueue[0] &&
        Boolean(card.phonetic) &&
        Boolean(card.meaning) &&
        card.revealed === 'false' &&
        card.cover === true &&
        Boolean(card.schedule),
      { ...card, expectedFirst: migration.expectedQueue[0], hideMeaning: fixture.wordstudyOptions.hideMeaning, baseState },
      'fixture 词库 8 词、reviewFirst=true：队列首位为最早到期词；hideMeaning=true 时 data-revealed=false 且有遮罩；已学词显示记忆计划条。'
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'electron-study.png'), 10))
    const studyWidth = await evaluate(page, `window.innerWidth`)

    // c) 空格显示释义 + 1/2/3 真实标记（落盘校验）
    await pressKey(page, ' ', 'Space', 32)
    const revealed = await waitFor(
      page,
      `(() => { const el = document.querySelector('.ws-meaning'); return el && el.dataset.revealed === 'true' })()`,
      4000
    )
    const revealState = await evaluate(
      page,
      `(() => { const el = document.querySelector('.ws-meaning'); const cover = document.querySelector('.ws-meaning-cover'); return { revealed: el ? el.dataset.revealed : null, cover: Boolean(cover) } })()`
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'electron-study-revealed.png'), 10))

    const markResults = []
    const expectedStatuses = ['learning', 'learning', 'mastered']
    for (const [index, [key, code, vk]] of [
      ['1', 'Digit1', 49],
      ['2', 'Digit2', 50],
      ['3', 'Digit3', 51]
    ].entries()) {
      const beforeWord = await evaluate(page, `document.querySelector('.ws-word').textContent.trim()`)
      const beforeKey = wordBank.normalizeWordKey(beforeWord)
      const beforeToast = await evaluate(
        page,
        `(() => { const el = document.querySelector('.ws-toast'); window.__v19ToastEl = el; return el ? el.textContent.trim() : '' })()`
      )
      await pressKey(page, key, code, vk)
      // toast 由 key={notice.seq} 触发 remount：等到「新节点 + 含复习」才读，避免读到上一次 marking 的旧 toast。
      const toast = await waitFor(
        page,
        `(() => { const el = document.querySelector('.ws-toast'); const text = el ? el.textContent.trim() : ''; return el && el !== window.__v19ToastEl && text.includes('复习') ? text : null })()`,
        8000
      )
      const diskState = await waitDiskProgress(
        (state) => {
          const entry = state.progress[beforeKey]
          return Boolean(entry) && typeof entry.dueAt === 'number' && entry.status === expectedStatuses[index]
        },
        10000
      )
      const entry = diskState?.progress?.[beforeKey] ?? null
      const fields = ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses']
      markResults.push({
        key,
        word: beforeWord,
        normalizedKey: beforeKey,
        status: entry?.status ?? null,
        intervalDays: entry?.intervalDays ?? null,
        toast,
        toastChanged: typeof toast === 'string' && toast !== beforeToast,
        toastNewNode: typeof toast === 'string',
        toastHasReview: typeof toast === 'string' && toast.includes('复习'),
        diskVersion: diskState?.version ?? null,
        fields: Object.fromEntries(fields.map((field) => [field, typeof entry?.[field] === 'number'])),
        fieldsOk: fields.every((field) => typeof entry?.[field] === 'number')
      })
    }
    const versionTwo = markResults.every((result) => result.diskVersion === 2)
    const marksOk =
      markResults.length === 3 &&
      markResults.every(
        (result, index) =>
          result.toastHasReview &&
          result.fieldsOk &&
          result.status === expectedStatuses[index] &&
          result.diskVersion === 2
      )
    record(
      'c',
      '空格显示释义；1/2/3 标记后 toast 含「复习」，wordbank-progress.json 真实落盘 version=2 且 5 字段齐全',
      revealed === true && revealState.revealed === 'true' && revealState.cover === false && versionTwo && marksOk,
      { revealState, marks: markResults },
      '真实渲染层 keydown → applyWordReview → IPC setProgress → main 写 .userdata/v19-verify/electron-userdata/wordbank-progress.json；三次标记（again/hard/good）应依次 learning/learning/mastered，文件 version=2，条目含 dueAt/intervalDays/ease/streak/lapses，toast 文案含「复习」。'
    )

    // d) 单词表视图 + 5 档筛选（同时量测真实窗口宽度）
    const clickedList = await evaluate(
      page,
      `(() => { const btn = document.querySelector('.ws-list-toggle'); if (!btn) return false; btn.click(); return true })()`
    )
    const listReady = await waitFor(
      page,
      `(() => { const root = document.querySelector('.ws-root'); return Boolean(root && root.dataset.view === 'list' && document.querySelectorAll('.ws-list-filter').length === 5 && document.querySelectorAll('.ws-list-row').length > 0) })()`,
      10000
    )
    await sleep(500)
    const listWidth = await evaluate(page, `window.innerWidth`)
    const listInfo = await evaluate(
      page,
      `(() => {
        const filters = Array.from(document.querySelectorAll('.ws-list-filter')).map((el) => el.textContent.trim());
        const rows = document.querySelectorAll('.ws-list-row');
        return {
          view: document.querySelector('.ws-root').dataset.view,
          filters,
          rowCount: rows.length,
          countText: document.querySelector('.ws-list-count') ? document.querySelector('.ws-list-count').textContent.trim() : null,
          innerWidth: window.innerWidth
        };
      })()`
    )
    record(
      'd',
      '点「单词表」进入 list 视图，出现 5 档筛选与行',
      clickedList === true && Boolean(listReady) && listInfo.filters.length === 5 && listInfo.rowCount > 0,
      listInfo,
      '真实窗口内点「单词表」应切到 list 视图，渲染 全部/待复习/未学/学习中/已掌握 5 个筛选与词条行。'
    )

    // e) 待复习 / 已掌握 筛选
    const clickFilter = (label) =>
      evaluate(
        page,
        `(() => { const btn = Array.from(document.querySelectorAll('.ws-list-filter')).find((el) => el.textContent.trim().startsWith(${JSON.stringify(label)})); if (!btn) return false; btn.click(); return true })()`
      )
    await clickFilter('待复习')
    const dueFiltered = await waitFor(
      page,
      `(() => { const rows = Array.from(document.querySelectorAll('.ws-list-row')); return rows.length > 0 && rows.every((row) => row.dataset.status !== undefined && row.querySelector('.ws-list-row-due[data-due="true"]')) })()`,
      6000
    )
    const dueRows = await evaluate(
      page,
      `(() => ({ count: document.querySelectorAll('.ws-list-row').length, statuses: Array.from(document.querySelectorAll('.ws-list-row')).map((row) => row.dataset.status), countText: document.querySelector('.ws-list-count') ? document.querySelector('.ws-list-count').textContent.trim() : null }))()`
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'electron-word-list-due.png'), 10))
    await clickFilter('已掌握')
    const masteredFiltered = await waitFor(
      page,
      `(() => { const rows = Array.from(document.querySelectorAll('.ws-list-row')); return rows.length > 0 && rows.every((row) => row.dataset.status === 'mastered') })()`,
      6000
    )
    const masteredRows = await evaluate(
      page,
      `(() => ({ count: document.querySelectorAll('.ws-list-row').length, statuses: Array.from(document.querySelectorAll('.ws-list-row')).map((row) => row.dataset.status) }))()`
    )
    record(
      'e',
      '待复习筛选行数 > 0；已掌握筛选行数 > 0',
      Boolean(dueFiltered) && dueRows.count > 0 && Boolean(masteredFiltered) && masteredRows.count > 0,
      {
        due: { ...dueRows, allDue: Boolean(dueFiltered) },
        mastered: { ...masteredRows, allMastered: Boolean(masteredFiltered) }
      },
      '真实词库筛选：待复习只剩 due 行（.ws-list-row-due[data-due="true"]），已掌握只剩 data-status=mastered 行。'
    )

    // f) 行内状态下拉改「已掌握」→ 真实落盘 + 徽标同步
    await clickFilter('全部')
    await waitFor(page, `document.querySelectorAll('.ws-list-row').length > 0`, 4000)
    const picked = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.dataset.status !== 'mastered') || rows[0];
        if (!row) return null;
        const word = row.querySelector('.ws-list-row-word').textContent.trim();
        const select = row.querySelector('select.ws-list-status-select');
        if (!select) return { word, hasSelect: false };
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, 'mastered');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { word, hasSelect: true, before: row.dataset.status };
      })()`
    )
    const expectedStatusKey = picked?.word ? wordBank.normalizeWordKey(picked.word) : null
    const statusDisk = picked?.hasSelect
      ? await waitDiskProgress(
          (state) => state.progress?.[expectedStatusKey]?.status === 'mastered',
          10000
        )
      : null
    const statusEntry = statusDisk?.progress?.[expectedStatusKey] ?? null
    const badge = await waitFor(
      page,
      `(() => {
        const row = Array.from(document.querySelectorAll('.ws-list-row')).find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return false;
        const badgeEl = row.querySelector('.ws-list-row-status');
        const select = row.querySelector('select.ws-list-status-select');
        return row.dataset.status === 'mastered' && badgeEl && badgeEl.textContent.includes('已掌握') && select && select.value === 'mastered';
      })()`,
      8000
    )
    const badgeState = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return null;
        return { word: row.querySelector('.ws-list-row-word').textContent.trim(), status: row.dataset.status, badge: row.querySelector('.ws-list-row-status') ? row.querySelector('.ws-list-row-status').textContent.trim() : null, select: row.querySelector('select.ws-list-status-select') ? row.querySelector('select.ws-list-status-select').value : null };
      })()`
    )
    record(
      'f',
      '行内下拉改「已掌握」→ 真实落盘 status=mastered，列表 status 徽标同步',
      picked?.hasSelect === true &&
        Boolean(statusDisk) &&
        statusDisk.version === 2 &&
        statusEntry?.status === 'mastered' &&
        ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses'].every(
          (field) => typeof statusEntry?.[field] === 'number'
        ) &&
        Boolean(badge),
      {
        picked: picked?.word ?? null,
        expectedStatusKey,
        disk: { version: statusDisk?.version ?? null, entry: statusEntry },
        badge: badgeState
      },
      '改状态下拉 → IPC setProgress → main 写盘：目标词 status=mastered、version=2、5 个复习字段齐全；行内 .ws-list-row-status 徽标与 select 同步为「已掌握」。'
    )

    // g) ▶ 回到学习视图且当前词为该行单词
    const clickedStudy = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return false;
        const btn = row.querySelector('.ws-list-study-btn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    )
    const studyBack = clickedStudy
      ? await waitFor(
          page,
          `(() => { const root = document.querySelector('.ws-root'); const word = document.querySelector('.ws-word'); return Boolean(root && root.dataset.view === 'study' && word && word.textContent.trim() === ${JSON.stringify(picked?.word ?? '')}) })()`,
          8000
        )
      : null
    await sleep(500)
    const studyWord = await evaluate(
      page,
      `(() => { const root = document.querySelector('.ws-root'); const word = document.querySelector('.ws-word'); return { view: root ? root.dataset.view : null, word: word ? word.textContent.trim() : null, innerWidth: window.innerWidth } })()`
    )
    record(
      'g',
      '点行内 ▶ 回到 study 视图，且当前词为该行单词',
      clickedStudy === true && Boolean(studyBack) && studyWord.view === 'study' && studyWord.word === (picked?.word ?? null),
      { clicked: clickedStudy, ...studyWord, expected: picked?.word ?? null },
      '点行尾 ▶ 应切回学习视图并把 currentKey 指向该行单词；同时真实 BrowserWindow 内容宽度应从 list 480 级回到 study 360 级。'
    )

    // i) 真实窗口宽度随视图切换（main 收到 setOwnContentSize 后 resize）
    const widths = [studyWidth, listWidth, studyWord.innerWidth]
    const listWidthOk = listWidth >= 470 && listWidth <= 500
    const studyWidthOk = studyWidth >= 350 && studyWidth <= 380 && studyWord.innerWidth >= 350 && studyWord.innerWidth <= 380
    record(
      'i',
      '切 list 视图真实窗口宽度 480 级、回 study 360 级',
      listWidthOk && studyWidthOk,
      { studyWidth, listWidth, backToStudyWidth: studyWord.innerWidth, widths },
      'useOwnContentSize 上报 → preload → main setContentSize 真实改变 BrowserWindow.contentSize：渲染层 innerWidth study≈360、list≈480。'
    )

    // h) 真实设置窗口：7 个开关 + 待复习统计
    await evaluate(page, `window.nexus.window.openSettings()`)
    const settingsTarget = await waitForTarget(
      ELECTRON_CDP_PORT,
      (item) => /\/settings\/index\.html/.test(item.url),
      20000
    )
    if (!settingsTarget) throw new Error('调用 window.nexus.window.openSettings() 后 20s 内没有 settings 页面 target')
    settingsPage = await connectTarget(settingsTarget, 'electron:settings', diagnostics)
    const settingsReady = await waitFor(
      settingsPage,
      `(() => Boolean(document.querySelector('.settings-shell') && document.querySelector('.settings-nav-item')))()`,
      25000
    )
    if (!settingsReady) throw new Error('真实 Electron 设置窗口 25s 内未就绪')
    await evaluate(
      settingsPage,
      `(() => { const item = Array.from(document.querySelectorAll('.settings-nav-item')).find((el) => el.textContent.trim() === '附加窗口'); if (!item) return false; item.click(); return true })()`
    )
    await waitFor(settingsPage, `document.querySelectorAll('.nx-acc-item').length > 0`, 8000)
    await evaluate(
      settingsPage,
      `(() => { const head = document.querySelector('.nx-acc-head'); if (!head) return false; head.click(); return true })()`
    )
    const switchesReady = await waitFor(
      settingsPage,
      `document.querySelectorAll('.ws-settings-switches [role="switch"]').length === 7`,
      10000
    )
    const settingsInfo = await evaluate(
      settingsPage,
      `(() => {
        const switches = Array.from(document.querySelectorAll('.ws-settings-switches [role="switch"]'));
        const labels = switches.map((el) => { const row = el.closest('.ui-row'); const label = row ? row.querySelector('.ui-row-label') : null; return label ? label.textContent.trim().split('\\n')[0].trim() : null });
        const dueStat = document.querySelector('.ws-settings-stat.is-due');
        const reviewStats = document.querySelector('.ws-settings-review-stats');
        return {
          switchCount: switches.length,
          labels,
          dueStatText: dueStat ? dueStat.textContent.trim() : null,
          reviewStatsText: reviewStats ? reviewStats.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300) : null,
          pathVisible: Boolean(document.querySelector('.ws-settings-path'))
        };
      })()`
    )
    record(
      'h',
      '真实设置窗口出现 7 个学习开关与「待复习」统计',
      Boolean(switchesReady) &&
        settingsInfo.switchCount === 7 &&
        (settingsInfo.dueStatText ?? '').includes('待复习') &&
        (settingsInfo.reviewStatsText ?? '').includes('待复习'),
      settingsInfo,
      '从真实学习窗口调用 window.nexus.window.openSettings() → main 创建设置窗口；附加窗口→英语单词学习展开后应有 7 个 Switch，词库概览与记忆曲线区显示「待复习」统计。'
    )

    await evaluate(
      settingsPage,
      `(() => {
        const stats = document.querySelector('.ws-settings-review-stats');
        if (!stats) return false;
        const section = stats.closest('section') || stats;
        section.scrollIntoView({ block: 'start' });
        return true;
      })()`
    )
    await sleep(450)
    const reviewRect = await evaluate(
      settingsPage,
      `(() => {
        const stats = document.querySelector('.ws-settings-review-stats');
        const section = stats ? stats.closest('section') || stats : null;
        if (!section) return null;
        const rect = section.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()`
    )
    if (reviewRect && reviewRect.height > 20) {
      screenshots.push(
        await captureViewportClip(
          settingsPage,
          {
            x: reviewRect.x - 8,
            y: reviewRect.y - 8,
            width: reviewRect.width + 16,
            height: Math.min(reviewRect.height + 16, 900 - Math.max(0, reviewRect.y - 8))
          },
          join(OUT_DIR, 'electron-settings-review-curve.png')
        )
      )
    }

    // j) 真实页面无 console error / 未捕获异常
    const pageErrors = realDiagnostics(diagnostics, 'electron:wordstudy')
    const settingsErrors = realDiagnostics(diagnostics, 'electron:settings')
    record(
      'j',
      '真实 Electron 两个页面均无 console error / 未捕获异常',
      pageErrors.length === 0 && settingsErrors.length === 0,
      { wordstudy: pageErrors, settings: settingsErrors },
      '收集 Runtime.consoleAPICalled(type=error)、Log.entryAdded(level=error)、Runtime.exceptionThrown；忽略 favicon/网络噪声。'
    )

    const finalProgress = readElectronProgress()
    environment = {
      electron:
        versionCheck.exitCode === 0
          ? 'available (electron --version 正常)'
          : `available: electron --version 崩溃（exit ${versionCheck.exitCode} / ${versionCheck.exitHex}，原因不明，疑为无控制台上下文），但 electron . GUI 启动正常、CDP 可用（Electron 44.7.0 / ${launch.version?.Browser ?? 'unknown'}）`,
      versionCheck,
      launch: {
        pid: launch.pid ?? null,
        cdpPort: ELECTRON_CDP_PORT,
        reused: launch.reused === true,
        browser: launch.version?.Browser ?? null,
        userAgent: launch.version?.['User-Agent'] ?? null,
        guiStartedAt: readJsonFile(ELECTRON_INSTANCE_PATH)?.startedAt ?? null
      },
      targets,
      userData: rel(ELECTRON_USERDATA),
      fixture: fixtureInfo,
      progressAfterRun: finalProgress
        ? { version: finalProgress.version, entries: Object.keys(finalProgress.progress).length }
        : null,
      stderrTail: tail(ELECTRON_ERR_LOG, 16),
      stdoutTail: tail(ELECTRON_OUT_LOG, 12)
    }
  } catch (error) {
    failure = error
    console.error(`Electron 主路径执行异常：${String(error?.stack ?? error)}`)
  } finally {
    try {
      page?.close()
    } catch {
      /* ignore */
    }
    try {
      settingsPage?.close()
    } catch {
      /* ignore */
    }
    await killElectronIsolated()
  }

  if (failure) {
    const executed = new Set(items.map((item) => item.id))
    for (const [id, label] of ELECTRON_ITEM_LABELS) {
      if (executed.has(id)) continue
      items.push({
        id,
        name: `${label}（未执行：主路径中断）`,
        scope: 'electron',
        pass: false,
        evidence: { error: String(failure?.message ?? failure) },
        detail: '前序步骤异常导致本项未执行，按未通过统计；详细堆栈见 environment.failure。'
      })
    }
    environment = {
      ...(environment ?? {}),
      electron: `available: electron . GUI 启动正常、CDP 可用，但验收执行异常中断：${String(failure?.message ?? failure)}`,
      failure: { name: String(failure?.name ?? 'Error'), message: String(failure?.message ?? failure), stack: String(failure?.stack ?? '').split('\n').slice(0, 12) }
    }
  }

  return { environment, items, screenshots }
}


/* ============================== 报告 ============================== */

function summarize(items) {
  const pass = items.filter((item) => item.pass === true).length
  const fail = items.filter((item) => item.pass === false).length
  return { total: items.length, pass, fail }
}

function buildReport({ environment, fixtures, items, renderer, screenshots, error }) {
  return {
    version: 'v1.9',
    scope: 'electron',
    generatedAt: new Date().toISOString(),
    environment,
    fixtures,
    summary: summarize(items),
    items,
    renderer: renderer ?? null,
    screenshots,
    ...(error ? { error } : {})
  }
}

/* ================================ 清理 ================================ */

function isolatedEdgePids() {
  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | Where-Object { $_.CommandLine -like '*v19-verify*' } | ForEach-Object { $_.ProcessId }) -join ','"
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 20000, windowsHide: true }
    ).trim()
    return output
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid)
    } catch {
      /* 已退出 */
    }
  }
}

async function cleanup() {
  const electronKill = await killElectronIsolated()

  const instancePid = readEdgePid()
  let pids = isolatedEdgePids()
  if (instancePid && !pids.includes(instancePid)) pids.push(instancePid)
  killPids(pids)

  const deadline = Date.now() + 12000
  let left = isolatedEdgePids()
  while (left.length > 0 && Date.now() < deadline) {
    await sleep(300)
    killPids(left)
    left = isolatedEdgePids()
  }

  let removed = false
  try {
    rmSync(USERDATA, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
    removed = !existsSync(USERDATA)
  } catch (error) {
    removed = false
    console.error(`删除 ${rel(USERDATA)} 失败：${String(error?.message ?? error)}`)
  }

  const output = {
    ok: left.length === 0 && electronKill.leftovers.length === 0 && removed,
    mode: 'cleanup',
    killedElectron: electronKill.killed,
    killedEdge: pids,
    leftovers: { electron: electronKill.leftovers, edge: left },
    removedUserData: removed,
    userData: rel(USERDATA),
    kept: [rel(OUT_DIR) + '/report.json', rel(OUT_DIR) + '/*.png']
  }
  console.log(JSON.stringify(output, null, 2))
  return output.ok ? 0 : 1
}

/* ============================== 验收主体 ============================== */

const KNOWN_NOISE = [
  /net::ERR_/i,
  /ERR_[A-Z_]+/,
  /Failed to load resource/i,
  /favicon/i,
  /devtools/i,
  /Autofill/i,
  /Electron Security Warning/i,
  /Unable to load preload script/i
]

function realDiagnostics(diagnostics, page) {
  return diagnostics
    .filter((entry) => entry.page === page)
    .filter((entry) => !KNOWN_NOISE.some((re) => re.test(entry.text)))
}

/** 对照路径：Edge headless + 构建产物 + CDP 注入 window.nexus stub。 */
async function runRendererCheck(fixture, shared) {
  if (!existsSync(join(OUT_RENDERER, 'wordstudy', 'index.html'))) {
    throw new Error('缺少构建产物 out/renderer/wordstudy/index.html，先执行 npm run build')
  }
  mkdirSync(OUT_DIR, { recursive: true })

  const diagnostics = []
  const items = []
  const screenshots = []
  let server = null
  let edge = null

  const record = (id, name, pass, evidence, detail) => {
    const item = { id, name, scope: 'renderer', pass: pass === true, evidence, detail }
    items.push(item)
    const brief = JSON.stringify(evidence ?? null).slice(0, 500)
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${id} ${name}${brief && brief !== 'null' ? ` :: ${brief}` : ''}`)
    return item
  }

  try {
    // 静态服务器 + Edge（渲染层对照）
    server = await startStaticServer(HTTP_PORT)
    edge = await launchEdge()

    const wordstudyUrl = `http://127.0.0.1:${HTTP_PORT}/wordstudy/index.html`
    const settingsUrl = `http://127.0.0.1:${HTTP_PORT}/settings/index.html`
    const injected = buildInjectedSource(fixture)

    // 3) 英语单词学习页
    const pageTarget = await createTarget('about:blank')
    const page = await connectTarget(pageTarget, 'wordstudy', diagnostics)
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: injected })
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 520,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    await page.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 22, g: 24, b: 32, a: 1 }
    })
    await page.send('Page.navigate', { url: wordstudyUrl })

    const ready = await waitFor(
      page,
      `(() => Boolean(document.querySelector('.ws-root') && document.querySelector('.ws-word') && document.querySelector('.ws-word').textContent.trim() && window.__v19 && window.__v19.migration))()`,
      20000
    )
    if (!ready) {
      const body = await evaluate(page, `document.body ? document.body.innerHTML.slice(0, 1200) : ''`)
      throw new Error(`学习页 20s 内未就绪：${wordstudyUrl}\nDOM: ${body}`)
    }
    const loaded = await evaluate(
      page,
      `(() => ({ view: document.querySelector('.ws-root').dataset.view, migration: window.__v19.migration, error: document.querySelector('.ws-error') ? document.querySelector('.ws-error').textContent.trim() : null }))()`
    )

    // a) 迁移后已学词进入待复习
    const pill = await evaluate(
      page,
      `(() => { const el = document.querySelector('.ws-review-pill'); return el ? el.textContent.trim() : null })()`
    )
    const dueNumber = Number((String(pill ?? '').match(/待复习\s*(\d+)/) ?? [])[1] ?? NaN)
    const migratedSample = loaded.migration.migratedSample ?? {}
    const fullFields = ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses'].every(
      (key) => typeof migratedSample[key] === 'number'
    )
    record(
      'a',
      '迁移后已学词进入待复习（v1 旧进度 → dueAt=lastSeenAt）',
      dueNumber > 0 && loaded.migration.due === dueNumber && fullFields,
      {
        pill,
        due: loaded.migration.due,
        legacySample: loaded.migration.legacySample,
        migratedSample,
        legacyVersion: loaded.migration.legacyVersion
      },
      'fixture 为 8 词 + 4 条 v1 旧进度（learning/mastered）；页面加载后 pill 应显示待复习 n>0，迁移后进度含 dueAt/intervalDays/ease/streak/lapses。'
    )

    // b) 学习视图卡片：单词/音标/释义（hideMeaning 先遮住）
    const card = await evaluate(
      page,
      `(() => {
        const text = (selector) => { const el = document.querySelector(selector); return el ? el.textContent.trim() : null };
        const meaning = document.querySelector('.ws-meaning');
        return {
          word: text('.ws-word'),
          phonetic: text('.ws-phonetic'),
          meaning: text('.ws-meaning-text'),
          revealed: meaning ? meaning.dataset.revealed : null,
          cover: Boolean(document.querySelector('.ws-meaning-cover')),
          schedule: text('.ws-schedule-text'),
          status: text('.ws-status'),
          progress: text('.ws-progress'),
          expectedFirst: window.__v19.migration.expectedQueue[0] ?? null,
          hideMeaning: window.__v19.migration.studyOptions.hideMeaning
        };
      })()`
    )
    record(
      'b',
      '学习视图渲染单词/音标/释义，hideMeaning 时先遮住',
      Boolean(card.word) &&
        card.word === card.expectedFirst &&
        Boolean(card.phonetic) &&
        Boolean(card.meaning) &&
        card.revealed === 'false' &&
        card.cover === true &&
        Boolean(card.schedule),
      card,
      '默认队列首位（reviewFirst 到期优先）应渲染 word/phonetic/meaning；hideMeaning=true 时 data-revealed=false 且有遮罩；非 new 词显示记忆计划条。'
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'study.png'), 10))

    // c) 空格显示释义 + 1/2/3 标记
    await pressKey(page, ' ', 'Space', 32)
    const revealed = await waitFor(
      page,
      `(() => { const el = document.querySelector('.ws-meaning'); return el && el.dataset.revealed === 'true' })()`,
      4000
    )
    const revealState = await evaluate(
      page,
      `(() => { const el = document.querySelector('.ws-meaning'); const cover = document.querySelector('.ws-meaning-cover'); return { revealed: el ? el.dataset.revealed : null, cover: Boolean(cover) } })()`
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'study-revealed.png'), 10))

    const markResults = []
    for (const [key, code, vk] of [
      ['1', 'Digit1', 49],
      ['2', 'Digit2', 50],
      ['3', 'Digit3', 51]
    ]) {
      const before = await evaluate(page, `window.__v19.writes.length`)
      const beforeWord = await evaluate(page, `document.querySelector('.ws-word').textContent.trim()`)
      const beforeToast = await evaluate(
        page,
        `(() => { const el = document.querySelector('.ws-toast'); window.__v19.toastEl = el; return el ? el.textContent.trim() : '' })()`
      )
      await pressKey(page, key, code, vk)
      const wrote = await waitFor(page, `window.__v19.writes.length > ${before}`, 5000)
      const write = await evaluate(
        page,
        `(() => { const list = window.__v19.writes; const w = list[list.length - 1]; if (!w) return null; const key = w.changedKeys[0] || null; return { at: w.at, key, entry: key ? w.progress[key] : null } })()`
      )
      // 等 toast 节点 remount（key={notice.seq}）后再读，避免读到上一次 marking 的旧文案。
      const toast = wrote
        ? await waitFor(
            page,
            `(() => { const el = document.querySelector('.ws-toast'); const text = el ? el.textContent.trim() : ''; return el && el !== window.__v19.toastEl && text.includes('复习') ? text : null })()`,
            4000
          )
        : null
      const entry = write?.entry ?? {}
      const fields = ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses']
      markResults.push({
        key,
        word: beforeWord,
        changedKey: write?.key ?? null,
        status: entry.status ?? null,
        intervalDays: entry.intervalDays ?? null,
        toast,
        toastChanged: typeof toast === 'string' && toast !== beforeToast,
        toastNewNode: typeof toast === 'string',
        toastHasReview: typeof toast === 'string' && toast.includes('复习'),
        fields: Object.fromEntries(fields.map((field) => [field, typeof entry[field] === 'number'])),
        fieldsOk: fields.every((field) => typeof entry[field] === 'number')
      })
      if (!wrote) break
    }
    const marksOk =
      markResults.length === 3 &&
      markResults.every((result) => result.changedKey && result.toastHasReview && result.fieldsOk) &&
      markResults[0].status === 'learning' &&
      markResults[1].status === 'learning' &&
      markResults[2].status === 'mastered'
    record(
      'c',
      '空格显示释义；1/2/3 标记 toast 含「复习」且 setProgress 收到 dueAt/intervalDays/ease/streak/lapses',
      revealed === true &&
        revealState.revealed === 'true' &&
        revealState.cover === false &&
        marksOk,
      { revealState, marks: markResults },
      '空格键应把 data-revealed 置 true 并移除遮罩；三次标记（again/hard/good）各触发一次 setProgress，写入条目必须含 5 个复习字段，toast 文案含「复习」。'
    )

    // d) 单词表视图 + 5 档筛选
    const clickedList = await evaluate(
      page,
      `(() => { const btn = document.querySelector('.ws-list-toggle'); if (!btn) return false; btn.click(); return true })()`
    )
    const listReady = await waitFor(
      page,
      `(() => { const root = document.querySelector('.ws-root'); return Boolean(root && root.dataset.view === 'list' && document.querySelectorAll('.ws-list-filter').length === 5 && document.querySelectorAll('.ws-list-row').length > 0) })()`,
      8000
    )
    const listInfo = await evaluate(
      page,
      `(() => {
        const filters = Array.from(document.querySelectorAll('.ws-list-filter')).map((el) => el.textContent.trim());
        const rows = document.querySelectorAll('.ws-list-row');
        return {
          view: document.querySelector('.ws-root').dataset.view,
          filters,
          rowCount: rows.length,
          countText: document.querySelector('.ws-list-count') ? document.querySelector('.ws-list-count').textContent.trim() : null
        };
      })()`
    )
    record(
      'd',
      '点「单词表」进入 list 视图，出现 5 档筛选与行',
      clickedList === true && Boolean(listReady) && listInfo.filters.length === 5 && listInfo.rowCount > 0,
      listInfo,
      'list 视图应出现 全部/待复习/未学/学习中/已掌握 5 个筛选按钮，并渲染词条行。'
    )

    // e) 待复习 / 已掌握 筛选行数
    const clickFilter = (label) =>
      evaluate(
        page,
        `(() => { const btn = Array.from(document.querySelectorAll('.ws-list-filter')).find((el) => el.textContent.trim().startsWith(${JSON.stringify(label)})); if (!btn) return false; btn.click(); return true })()`
      )
    await clickFilter('待复习')
    const dueFiltered = await waitFor(
      page,
      `(() => { const rows = Array.from(document.querySelectorAll('.ws-list-row')); return rows.length > 0 && rows.every((row) => row.dataset.status !== undefined && row.querySelector('.ws-list-row-due[data-due="true"]')) })()`,
      5000
    )
    const dueRows = await evaluate(
      page,
      `(() => ({ count: document.querySelectorAll('.ws-list-row').length, statuses: Array.from(document.querySelectorAll('.ws-list-row')).map((row) => row.dataset.status), countText: document.querySelector('.ws-list-count') ? document.querySelector('.ws-list-count').textContent.trim() : null }))()`
    )
    screenshots.push(await captureElement(page, '.ws-root', join(OUT_DIR, 'word-list-due.png'), 10))
    await clickFilter('已掌握')
    const masteredFiltered = await waitFor(
      page,
      `(() => { const rows = Array.from(document.querySelectorAll('.ws-list-row')); return rows.length > 0 && rows.every((row) => row.dataset.status === 'mastered') })()`,
      5000
    )
    const masteredRows = await evaluate(
      page,
      `(() => ({ count: document.querySelectorAll('.ws-list-row').length, statuses: Array.from(document.querySelectorAll('.ws-list-row')).map((row) => row.dataset.status) }))()`
    )
    record(
      'e',
      '待复习筛选行数 > 0；已掌握筛选行数 > 0',
      Boolean(dueFiltered) && dueRows.count > 0 && Boolean(masteredFiltered) && masteredRows.count > 0,
      { due: { ...dueRows, allDue: Boolean(dueFiltered) }, mastered: { ...masteredRows, allMastered: Boolean(masteredFiltered) } },
      '待复习筛选应只剩 due 行（行内 .ws-list-row-due[data-due="true"]），已掌握筛选应只剩 data-status=mastered 行。'
    )

    // f) 行内状态下拉改「已掌握」+ 徽标同步
    await clickFilter('全部')
    await waitFor(page, `document.querySelectorAll('.ws-list-row').length > 0`, 4000)
    const writesBefore = await evaluate(page, `window.__v19.writes.length`)
    const picked = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.dataset.status !== 'mastered') || rows[0];
        if (!row) return null;
        const word = row.querySelector('.ws-list-row-word').textContent.trim();
        const select = row.querySelector('select.ws-list-status-select');
        if (!select) return { word, hasSelect: false };
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, 'mastered');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { word, hasSelect: true, before: row.dataset.status };
      })()`
    )
    const wroteStatus = picked?.hasSelect
      ? await waitFor(page, `window.__v19.writes.length > ${writesBefore}`, 5000)
      : null
    const statusWrite = wroteStatus
      ? await evaluate(
          page,
          `(() => { const list = window.__v19.writes; const w = list[list.length - 1]; if (!w) return null; const key = w.changedKeys[0] || null; return { key, entry: key ? w.progress[key] : null } })()`
        )
      : null
    const badge = await waitFor(
      page,
      `(() => {
        const row = Array.from(document.querySelectorAll('.ws-list-row')).find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return false;
        const badgeEl = row.querySelector('.ws-list-row-status');
        const select = row.querySelector('select.ws-list-status-select');
        return row.dataset.status === 'mastered' && badgeEl && badgeEl.textContent.includes('已掌握') && select && select.value === 'mastered';
      })()`,
      5000
    )
    const badgeState = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return null;
        return { word: row.querySelector('.ws-list-row-word').textContent.trim(), status: row.dataset.status, badge: row.querySelector('.ws-list-row-status') ? row.querySelector('.ws-list-row-status').textContent.trim() : null, select: row.querySelector('select.ws-list-status-select') ? row.querySelector('select.ws-list-status-select').value : null };
      })()`
    )
    const statusEntry = statusWrite?.entry ?? {}
    const expectedStatusKey = picked?.word ? shared.wordBank.normalizeWordKey(picked.word) : null
    record(
      'f',
      '行内下拉改「已掌握」→ setProgress status=mastered，列表徽标同步',
      picked?.hasSelect === true &&
        Boolean(wroteStatus) &&
        statusWrite?.key === expectedStatusKey &&
        statusEntry.status === 'mastered' &&
        ['dueAt', 'intervalDays', 'ease', 'streak', 'lapses'].every(
          (field) => typeof statusEntry[field] === 'number'
        ) &&
        Boolean(badge),
      { picked: picked?.word ?? null, expectedStatusKey, write: statusWrite, badge: badgeState },
      '改状态下拉应调用 wordBank.setProgress，写入该词 status=mastered 且含全部复习字段；行内 status 徽标（.ws-list-row-status）与 select 值同步为已掌握。'
    )

    // g) ▶ 回到学习视图且当前词为该行单词
    const clickedStudy = await evaluate(
      page,
      `(() => {
        const rows = Array.from(document.querySelectorAll('.ws-list-row'));
        const row = rows.find((item) => item.querySelector('.ws-list-row-word').textContent.trim() === ${JSON.stringify(picked?.word ?? '')});
        if (!row) return false;
        const btn = row.querySelector('.ws-list-study-btn');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    )
    const studyBack = clickedStudy
      ? await waitFor(
          page,
          `(() => { const root = document.querySelector('.ws-root'); const word = document.querySelector('.ws-word'); return Boolean(root && root.dataset.view === 'study' && word && word.textContent.trim() === ${JSON.stringify(picked?.word ?? '')}) })()`,
          6000
        )
      : null
    const studyWord = await evaluate(
      page,
      `(() => { const root = document.querySelector('.ws-root'); const word = document.querySelector('.ws-word'); return { view: root ? root.dataset.view : null, word: word ? word.textContent.trim() : null } })()`
    )
    record(
      'g',
      '点行内 ▶ 回到 study 视图，且当前词为该行单词',
      clickedStudy === true && Boolean(studyBack) && studyWord.view === 'study' && studyWord.word === (picked?.word ?? null),
      { clicked: clickedStudy, ...studyWord, expected: picked?.word ?? null },
      '点行尾 ▶ 应切回学习视图并把 currentKey 指向该行单词。'
    )

    // i) setOwnContentSize 宽度随视图切换（list 480 / study 360 量测 +1）
    await sleep(600)
    const sizeCalls = await evaluate(page, `window.__v19.sizeCalls`)
    const widths = sizeCalls.map((call) => call.width)
    const listWidthOk = widths.some((width) => typeof width === 'number' && width >= 470 && width <= 495)
    const lastWidth = widths[widths.length - 1]
    const studyWidthOk = typeof lastWidth === 'number' && lastWidth >= 350 && lastWidth <= 375
    record(
      'i',
      '切 list 视图 setOwnContentSize 宽度 480 级、回 study 360 级',
      listWidthOk && studyWidthOk,
      { widths, lastWidth, sizeCalls: sizeCalls.slice(-8) },
      'useOwnContentSize 按 .ws-root 实测宽度 +1 上报：study 360→361，list 480→481；切回 study 后最后一次上报应回到 360 级。'
    )

    // 4) 设置页：7 个开关 + 待复习统计 + 记忆曲线截图
    const settingsTarget = await createTarget('about:blank')
    const settingsPage = await connectTarget(settingsTarget, 'settings', diagnostics)
    await settingsPage.send('Page.addScriptToEvaluateOnNewDocument', { source: injected })
    await settingsPage.send('Emulation.setDeviceMetricsOverride', {
      width: 720,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    await settingsPage.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 22, g: 24, b: 32, a: 1 }
    })
    await settingsPage.send('Page.navigate', { url: settingsUrl })
    const settingsReady = await waitFor(
      settingsPage,
      `(() => Boolean(document.querySelector('.settings-shell') && document.querySelector('.settings-nav-item')))()`,
      20000
    )
    if (!settingsReady) throw new Error(`设置页 20s 内未就绪：${settingsUrl}`)

    await evaluate(
      settingsPage,
      `(() => { const item = Array.from(document.querySelectorAll('.settings-nav-item')).find((el) => el.textContent.trim() === '附加窗口'); if (!item) return false; item.click(); return true })()`
    )
    await waitFor(settingsPage, `document.querySelectorAll('.nx-acc-item').length > 0`, 6000)
    await evaluate(
      settingsPage,
      `(() => { const head = document.querySelector('.nx-acc-head'); if (!head) return false; head.click(); return true })()`
    )
    const switchesReady = await waitFor(settingsPage, `document.querySelectorAll('.ws-settings-switches [role="switch"]').length === 7`, 8000)
    const settingsInfo = await evaluate(
      settingsPage,
      `(() => {
        const switches = Array.from(document.querySelectorAll('.ws-settings-switches [role="switch"]'));
        const labels = switches.map((el) => { const row = el.closest('.ui-row'); const label = row ? row.querySelector('.ui-row-label') : null; return label ? label.textContent.trim().split('\\n')[0].trim() : null });
        const dueStat = document.querySelector('.ws-settings-stat.is-due');
        const reviewStats = document.querySelector('.ws-settings-review-stats');
        return {
          switchCount: switches.length,
          labels,
          dueStatText: dueStat ? dueStat.textContent.trim() : null,
          reviewStatsText: reviewStats ? reviewStats.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300) : null,
          pathVisible: Boolean(document.querySelector('.ws-settings-path'))
        };
      })()`
    )
    record(
      'h',
      '设置页出现 7 个学习开关与「待复习」统计',
      Boolean(switchesReady) &&
        settingsInfo.switchCount === 7 &&
        (settingsInfo.dueStatText ?? '').includes('待复习') &&
        (settingsInfo.reviewStatsText ?? '').includes('待复习'),
      settingsInfo,
      '附加窗口→英语单词学习展开后应有 7 个 Switch，词库概览与记忆曲线区都应显示「待复习」统计。'
    )

    // 设置页截图：滚动到「记忆曲线」区块，截取该区块
    await evaluate(
      settingsPage,
      `(() => {
        const stats = document.querySelector('.ws-settings-review-stats');
        if (!stats) return false;
        const section = stats.closest('section') || stats;
        section.scrollIntoView({ block: 'start' });
        return true;
      })()`
    )
    await sleep(450)
    const reviewRect = await evaluate(
      settingsPage,
      `(() => {
        const stats = document.querySelector('.ws-settings-review-stats');
        const section = stats ? stats.closest('section') || stats : null;
        if (!section) return null;
        const rect = section.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()`
    )
    if (reviewRect && reviewRect.height > 20) {
      screenshots.push(
        await captureViewportClip(
          settingsPage,
          {
            x: reviewRect.x - 8,
            y: reviewRect.y - 8,
            width: reviewRect.width + 16,
            height: Math.min(reviewRect.height + 16, 900 - Math.max(0, reviewRect.y - 8))
          },
          join(OUT_DIR, 'settings-review-curve.png')
        )
      )
    }

    // j) 无 console error / 未捕获异常
    const pageErrors = realDiagnostics(diagnostics, 'wordstudy')
    const settingsErrors = realDiagnostics(diagnostics, 'settings')
    record(
      'j',
      '两个页面均无 console error / 未捕获异常',
      pageErrors.length === 0 && settingsErrors.length === 0,
      { wordstudy: pageErrors, settings: settingsErrors },
      '收集 Runtime.consoleAPICalled(type=error)、Log.entryAdded(level=error)、Runtime.exceptionThrown；忽略 favicon/网络噪声。'
    )

    page.close()
    settingsPage.close()

    return {
      environment: {
        browser: `Edge headless (${edge.version?.Browser ?? 'unknown'})`,
        edge: {
          executable: EDGE_EXE,
          cdpPort: CDP_PORT,
          httpPort: HTTP_PORT,
          reused: edge.reused === true,
          browser: edge.version?.Browser ?? null,
          userDataDir: rel(EDGE_USERDATA)
        },
        note: '对照路径（scope=renderer）：out/renderer 构建产物 + 内置静态服务器 + CDP 注入 window.nexus stub；stub 迁移/统计调用 src/shared/wordBank.ts 同源函数。不是主结论。'
      },
      items,
      screenshots,
      diagnostics
    }
  } finally {
    if (server) server.close()
  }
}

/* ============================== 验收主体 ============================== */

/** report.fixtures：两套隔离 fixture 的文件位置 + v1→v2 迁移摘要。 */
function fixtureReport(fixture, migration) {
  return {
    userData: rel(USERDATA),
    electronUserData: rel(ELECTRON_USERDATA),
    settings: {
      path: rel(SETTINGS_PATH),
      schemaVersion: fixture.settings.schemaVersion,
      wordstudy: fixture.settings.extraWindows.find((item) => item.kind === 'wordstudy'),
      bom: hasBom(SETTINGS_PATH)
    },
    words: {
      path: rel(WORDS_PATH),
      count: fixture.words.length,
      version: 1,
      bom: hasBom(WORDS_PATH)
    },
    progress: {
      path: rel(PROGRESS_PATH),
      version: fixture.legacyProgress.version,
      format: 'v1（仅 status/seen/remembered/lastSeenAt，无 dueAt/intervalDays/ease/streak/lapses）',
      entries: Object.keys(fixture.legacyProgress.progress).length,
      bom: hasBom(PROGRESS_PATH)
    },
    electronProgress: {
      path: rel(join(ELECTRON_USERDATA, 'wordbank-progress.json')),
      seededVersion: fixture.legacyProgress.version,
      entries: Object.keys(fixture.legacyProgress.progress).length,
      format: 'v1 旧格式种子，由产品 main 进程 sanitizer 迁移为 version=2'
    },
    migration
  }
}

/**
 * 主体验收编排：真实 Electron（主）→ Edge+stub（对照，失败不阻塞主结果）。
 * 主路径某项中断时，runElectronCheck 会补齐 a–j 未执行项并返回，报告始终 10 项如实统计。
 */
async function runCheck() {
  const shared = await loadShared()
  if (!existsSync(SETTINGS_PATH) || !existsSync(WORDS_PATH) || !existsSync(PROGRESS_PATH)) {
    throw new Error(`fixture 不存在，先执行：node ${SCRIPT_PATH} --prepare`)
  }
  if (!existsSync(ELECTRON_EXE)) {
    throw new Error(`缺少 Electron：${rel(ELECTRON_EXE)}，先 npm install`)
  }
  const fixture = buildFixture(shared)
  const migration = previewMigration(shared, fixture)
  mkdirSync(OUT_DIR, { recursive: true })

  let electronResult = null
  let rendererResult = null
  let rendererError = null

  try {
    electronResult = await runElectronCheck(fixture, migration, shared)
  } catch (error) {
    console.error(`Electron 主路径启动失败：${error?.stack ?? error}`)
    electronResult = {
      environment: {
        electron: `unavailable: 真实 Electron 主路径无法执行：${String(error?.message ?? error)}`,
        note: '主路径异常，见 error。'
      },
      items: ELECTRON_ITEM_LABELS.map(([id, label]) => ({
        id,
        name: `${label}（未执行：主路径启动失败）`,
        scope: 'electron',
        pass: false,
        evidence: { error: String(error?.message ?? error) },
        detail: '真实 Electron 主路径未能启动，本项未执行，按未通过统计。'
      })),
      screenshots: []
    }
  }

  try {
    rendererResult = await runRendererCheck(fixture, shared)
  } catch (error) {
    rendererError = String(error?.stack ?? error)
    console.error(`Edge 对照路径失败（不影响主结论）：${rendererError}`)
  }

  const report = buildReport({
    environment: {
      electron: electronResult.environment?.electron ?? 'unavailable: 无结果',
      browser: rendererResult?.environment?.browser ?? `Edge headless（对照路径失败）`,
      note: [
        '主结果 scope="electron"：真实 Electron 44.7.0 main + preload + IPC + 磁盘读写，隔离 userData=.userdata/v19-verify/electron-userdata。',
        '`electron --version` 在本会话崩溃（exit 0x80000003，疑为无控制台上下文），但 `electron .` GUI 启动正常、CDP 可用；这是环境事实，如实记录。',
        'renderer 字段是 Edge headless + CDP 注入 window.nexus stub 的对照路径（非主结论）。',
        '未写真实 %APPDATA%\\nexus-dock；只操作 .userdata/v19-verify/；未改 src/、tests/、package.json。'
      ].join(' '),
      electronDetail: electronResult.environment ?? null,
      electronVersion: electronResult.environment?.versionCheck ?? null
    },
    fixtures: fixtureReport(fixture, migration),
    items: electronResult.items,
    renderer: rendererResult
      ? {
          scope: 'renderer',
          summary: summarize(rendererResult.items),
          items: rendererResult.items,
          environment: rendererResult.environment
        }
      : {
          scope: 'renderer',
          summary: { total: 0, pass: 0, fail: 0 },
          items: [],
          error: rendererError
        },
    screenshots: electronResult.screenshots.concat(rendererResult?.screenshots ?? []),
    error:
      electronResult.items.length === 0
        ? (electronResult.environment?.electron ?? 'Electron 主路径无结果')
        : null
  })
  console.log(JSON.stringify(report.summary, null, 2))
  return report
}

/* ============================== 启动入口 ============================== */

async function main() {
  if (MODE === 'usage') {
    console.log(
      [
        'Nexus Dock v1.9 运行时验收（真实 Electron 主路径 + Edge 渲染层对照）',
        '',
        '  node scripts/v19-verify.mjs --prepare   # 写隔离 fixture（v1 旧进度 + 8 词词库）',
        '  node scripts/v19-verify.mjs --launch    # 启动真实 Electron（隔离 userData + CDP 9393）',
        '  node scripts/v19-verify.mjs --check     # 主路径 a–j + Edge 对照，写 report.json 与截图',
        '  node scripts/v19-verify.mjs --cleanup   # 杀隔离进程并删除 .userdata/v19-verify',
        '',
        '可选环境变量：NEXUS_V19_HTTP_PORT / NEXUS_V19_CDP_PORT / NEXUS_V19_ELECTRON_CDP_PORT / NEXUS_V19_EDGE'
      ].join('\n')
    )
    return 0
  }
  if (MODE === 'prepare') {
    await runPrepare()
    return 0
  }
  if (MODE === 'launch') {
    const launched = await launchElectronApp()
    const targets = (await listTargetsOn(ELECTRON_CDP_PORT).catch(() => []))
      .filter((item) => item.type === 'page')
      .map((item) => ({ id: item.id, title: item.title, url: item.url }))
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'launch',
          cdpPort: ELECTRON_CDP_PORT,
          pid: launched.pid ?? null,
          reused: launched.reused === true,
          browser: launched.version?.Browser ?? null,
          targets
        },
        null,
        2
      )
    )
    return 0
  }
  if (MODE === 'cleanup') return await cleanup()

  const report = await runCheck()
  writeJson(OUT_REPORT, report)
  console.log(`报告：${rel(OUT_REPORT)}`)
  console.log(`截图：${report.screenshots.join(', ')}`)
  return report.summary.fail === 0 ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = typeof code === 'number' ? code : 0
  })
  .catch((error) => {
    console.error(`FATAL: ${error?.stack ?? error}`)
    process.exitCode = 1
  })
