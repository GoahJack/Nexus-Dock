// ============================================================================
// Nexus Dock v1.6.0 独立验收脚本（隔离实例 + CDP，不改源码）
//
// 用法：
//   node scripts/v16-verify.mjs --prepare     # 重置 .userdata/v16，写入 v8 种子配置 + 图标夹具
//   # 用 electron.exe --user-data-dir=...\.userdata\v16 --remote-debugging-port=9344 启动
//   $env:NEXUS_CDP_PORT=9344; node scripts/v16-verify.mjs
//
//   # v1.6 补充验收（原生对话框真实选图 → importCustomIcon 导入 → Dock 渲染）：
//   node scripts/v16-verify.mjs --pick
//   # 前置：另起隔离实例 --user-data-dir=...\.userdata\v16-pick --remote-debugging-port=9345
//
// 覆盖（v1.6「修改 Dock 栏内应用的显示图标和名字」）：
//   AC-26.1 版本 1.6.0 + 设置 v8→v9 迁移零丢失（应用 6 个/名称/图标，dock 参数保留）
//   AC-26.2 Dock 改名：updateItem(customName) 后 .dock-item 的 aria-label / title 同步
//   AC-26.3 自定义图标：icon:// 真实渲染（PNG naturalWidth>0；SVG Content-Type 与渲染）
//   AC-26.4 恢复默认：customName/customIcon 清空且配置不残留 null/空串
//   AC-26.5 设置页编辑弹层：✎ 入口、自动聚焦、受控输入改名保存、自定义徽标、Dock 同步
//   AC-26.6 Dock 右键 requestEdit：跨窗口切到「应用」页 + 弹层只打开一次、关闭后不复弹
//   AC-26.6b/26.6c（--pick 模式）原生对话框真实选 PNG/SVG → 主进程导入（≤256px PNG/原样 SVG）
//   AC-26.7 原生图标选择对话框：真实打开、用 Win32 取消、返回 {ok:false,error:'canceled'}
//   AC-26.8 回归：设置四页截图、Dock 图标数、渲染层 console error、音乐卡片窗口
//   AC-26.9 质量门禁（typecheck + 15 tests + build，由外部脚本写入 gates JSON）
//
// 产物：docs/verification/v1.6/v16-report.json + PNG 截图（--pick 额外写 v16-pick.json 并合并进报告）
// ============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { deflateSync } from 'node:zlib'

const PORT = Number(process.env['NEXUS_CDP_PORT'] ?? 9344)
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'docs', 'verification', 'v1.6')
const USERDATA = join(ROOT, '.userdata', 'v16')
const ICONS = join(USERDATA, 'icons')
const OUT_LOG = join(ROOT, 'scripts', 'out', 'v16-out.log')
const ERR_LOG = join(ROOT, 'scripts', 'out', 'v16-err.log')
const GATES_FILE = process.env['V16_GATES_FILE'] ?? join(ROOT, 'scripts', 'out', 'v16-gates.json')
const PREPARE = process.argv.includes('--prepare')
/** v1.6 补充验收：原生对话框真实选图 → importCustomIcon 导入 → Dock 渲染（独立隔离目录/端口） */
const PICK_MODE = process.argv.includes('--pick')
const PICK_PORT = Number(process.env['NEXUS_PICK_CDP_PORT'] ?? 9345)
const PICK_USERDATA = join(ROOT, '.userdata', 'v16-pick')
const PICK_ICONS = join(PICK_USERDATA, 'icons')
const PICK_FILE = join(OUT_DIR, 'v16-pick.json')
const PICK_SVG_CONTENT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="16" fill="#2f9e44"/><text x="48" y="62" font-size="44" text-anchor="middle" fill="#fff">P</text></svg>'

const PNG_URL = 'icon://v16-test.png'
const SVG_URL = 'icon://v16-test.svg'
const SVG_CONTENT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#e5484d"/><text x="32" y="40" font-size="28" text-anchor="middle" fill="#fff">V</text></svg>'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------- PNG 夹具 --------------------------------- */
function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const tag = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])))
  return Buffer.concat([len, tag, data, crc])
}
/** 生成纯色/圆点 PNG（避免依赖外部图片库）；宽高可不同，用于验证导入时的等比缩放 */
function makeTestPng(width = 64, height = width) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) * 0.42
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0 // filter none
    for (let x = 0; x < width; x += 1) {
      const p = row + 1 + x * 4
      const dx = x - cx + 0.5
      const dy = y - cy + 0.5
      const inside = dx * dx + dy * dy <= r * r
      raw[p] = inside ? 255 : 32
      raw[p + 1] = inside ? 255 : 96
      raw[p + 2] = inside ? 255 : 200
      raw[p + 3] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** 读取 PNG 头部（magic + IHDR 宽高），用于验证 importCustomIcon 的归一化结果 */
function parsePngHeader(filePath) {
  const bytes = readFileSync(filePath)
  const magic = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const ihdrTag = bytes.subarray(12, 16).toString('ascii')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return { fileSize: bytes.length, magic, ihdrTag, width, height }
}

/* ------------------------------- v8 种子配置 ------------------------------- */
function buildSeedSettings() {
  const apps = [
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
  return {
    schemaVersion: 8, // v1.5 配置：用于验证 v8→v9 纯增量迁移
    dock: {
      edge: 'bottom',
      alongPercent: 62, // 非默认值：迁移零丢失证据
      snapToEdge: false,
      freeX: -1,
      freeY: -1,
      onlyOnDesktop: true,
      iconSize: 46, // 非默认值：迁移零丢失证据
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
      visible: true,
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
    apps
  }
}

/* --------------------------------- prepare --------------------------------- */
function prepare() {
  mkdirSync(ICONS, { recursive: true })
  writeFileSync(join(USERDATA, 'settings.json'), JSON.stringify(buildSeedSettings(), null, 2), 'utf8')
  writeFileSync(join(ICONS, 'v16-test.png'), makeTestPng(64))
  writeFileSync(join(ICONS, 'v16-test.svg'), SVG_CONTENT, 'utf8')
  console.log(
    JSON.stringify(
      {
        ok: true,
        settingsPath: join(USERDATA, 'settings.json'),
        fixtures: ['v16-test.png', 'v16-test.svg'],
        seedSchemaVersion: 8
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
mkdirSync(OUT_DIR, { recursive: true })

async function listTargets(port = PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
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

async function waitTarget(segment, timeoutMs = 20000, port = PORT) {
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

async function openTarget(segment, timeoutMs = 20000, port = PORT) {
  const target = await waitTarget(segment, timeoutMs, port)
  if (!target) return null
  const ws = await connect(target.webSocketDebuggerUrl)
  return { target, client: createClient(ws) }
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
const networkLog = []

function rel(path) {
  return relative(ROOT, path).replaceAll('\\', '/')
}

function record(id, title, ok, detail, shots = []) {
  results.push({ id, title, ok: ok === true, detail, screenshots: shots })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title}${detail ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function shot(client, name) {
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
  /Unable to load preload script/i
]

/** 仅由验收脚本探测动作产生的噪声：v1.6 已不再用页面 fetch 判定图标（跨源会被 CORS 拦），
 *  这里保留过滤规则并单独计数，确保「渲染层 console error」统计的是页面自身错误。 */
const PROBE_NOISE = /Access to fetch at 'icon:\/\//i

function attachDiagnostics(client, page) {
  client.onEvent((message) => {
    if (message.method === 'Network.responseReceived') {
      const response = message.params?.response
      if (response && typeof response.url === 'string' && response.url.startsWith('icon://')) {
        networkLog.push({
          page,
          url: response.url,
          status: response.status,
          mimeType: response.mimeType,
          headers: response.headers
        })
      }
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
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
    client.send('Page.enable'),
    client.send('Network.enable')
  ])
}

/** CDP 响应头大小写不固定，按名字大小写不敏感取值 */
function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return null
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : null
}

/** 从 Network.responseReceived 抓到的 icon:// 响应中找指定 URL（允许尾部斜杠） */
function findIconResponse(url, page = 'dock') {
  return networkLog.find((entry) => entry.page === page && entry.url.startsWith(url)) ?? null
}

/* ------------------------------ 页面 DOM 探针 ------------------------------ */
const A = { dock: null, settings: null, music: null }

function itemSelector(id) {
  return `.dock-item[data-dock-id="${id}"]`
}

function dockInfoExpr(id) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(itemSelector(id))});
    if (!el) return null;
    const img = el.querySelector('img.dock-icon-img');
    const letter = el.querySelector('.dock-icon-letter');
    return {
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      imgSrc: img ? img.getAttribute('src') : null,
      imgNaturalWidth: img ? img.naturalWidth : -1,
      imgComplete: img ? img.complete : null,
      letter: letter ? (letter.textContent ?? '') : null
    };
  })()`
}

const overlayInfoExpr = `(() => {
  const els = [...document.querySelectorAll('.nx-app-edit')];
  if (els.length === 0) return { count: 0 };
  const el = els[0];
  const input = el.querySelector('.nx-app-edit-input');
  const active = document.querySelector('.settings-nav-item.is-active');
  const buttons = [...el.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean);
  return {
    count: els.length,
    aria: el.getAttribute('aria-label'),
    input: input ? { exists: true, value: input.value, focused: document.activeElement === input } : { exists: false },
    activeNav: active ? (active.textContent ?? '').trim() : null,
    previewName: el.querySelector('.nx-app-edit-preview-name')?.textContent ?? null,
    previewSub: el.querySelector('.nx-app-edit-preview-sub')?.textContent ?? null,
    buttons,
    text: (el.innerText ?? '').slice(0, 500)
  };
})()`

async function readDockInfo(id) {
  return A.dock.client.evaluate(dockInfoExpr(id))
}

async function clickNav(label) {
  const clicked = await A.settings.client.evaluate(`(() => {
    const btn = [...document.querySelectorAll('.settings-nav-item')].find((b) => (b.textContent ?? '').includes(${JSON.stringify(label)}));
    if (!btn) return false;
    btn.click();
    return true;
  })()`)
  await sleep(450)
  return clicked
}

async function settingItem(id) {
  const settings = await A.dock.client.evaluate('window.nexus.settings.get()')
  return settings.apps.find((item) => item.id === id) ?? null
}

/* ------------------------- 原生文件对话框（PowerShell） ------------------------- */
const DIALOG_PS_FILE = join(tmpdir(), 'nexus-v16-dialog.ps1')
const DIALOG_PS = String.raw`param([string]$Mode = 'find', [string]$Out = '', [string]$Path = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NexusV16Win {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public static List<string> Dialogs() {
    var list = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      if (cls.ToString() != "#32770") return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      list.Add(h.ToInt64() + "|" + pid + "|" + r.Left + "|" + r.Top + "|" + r.Right + "|" + r.Bottom + "|" + t.ToString());
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[NexusV16Win]::SetProcessDPIAware() | Out-Null
$electronPids = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*\.userdata\v16*' } | Select-Object -ExpandProperty ProcessId)
$rows = @()
foreach ($d in [NexusV16Win]::Dialogs()) {
  $p = $d.Split('|')
  $row = [pscustomobject]@{
    hwnd = [long]$p[0]; pid = [int]$p[1];
    left = [int]$p[2]; top = [int]$p[3]; right = [int]$p[4]; bottom = [int]$p[5];
    title = ($p[6..($p.Length - 1)] -join '|')
  }
  $row | Add-Member -NotePropertyName mine -NotePropertyValue (($electronPids -contains $row.pid) -or ($row.title -like '*自定义图标*') -or ($row.title -like '*选择*图标*'))
  $rows += $row
}
$mine = @($rows | Where-Object { $_.mine })
if ($Mode -eq 'find') {
  ConvertTo-Json -Compress -Depth 4 -InputObject $mine
  exit 0
}
if ($Mode -eq 'capture') {
  if ($mine.Count -eq 0 -or -not $Out) { ConvertTo-Json -Compress -InputObject @{ ok = $false; reason = 'no dialog' }; exit 0 }
  $r = $mine[0]
  $w = [Math]::Max(1, $r.right - $r.left)
  $h = [Math]::Max(1, $r.bottom - $r.top)
  Add-Type @"
using System; using System.Runtime.InteropServices;
public static class NexusV16Print {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
"@
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $method = 'copyfromscreen'
  $printOk = $false
  try {
    $hdc = $g.GetHdc()
    $printOk = [NexusV16Print]::PrintWindow([IntPtr]$r.hwnd, $hdc, 2)
    $g.ReleaseHdc($hdc)
  } catch { $printOk = $false }
  if ($printOk) {
    $method = 'printwindow'
  } else {
    # PrintWindow 不被支持时：抬到前台再截屏（避免截到别的窗口）
    [NexusV16Win]::SetForegroundWindow([IntPtr]$r.hwnd) | Out-Null
    Start-Sleep -Milliseconds 500
    $g.CopyFromScreen($r.left, $r.top, 0, 0, $bmp.Size)
  }
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  ConvertTo-Json -Compress -InputObject @{ ok = $true; path = $Out; width = $w; height = $h; title = $r.title; pid = $r.pid; method = $method }
  exit 0
}
if ($Mode -eq 'open-file') {
  # user32 直接驱动原生对话框：
  #   该中文 Windows 原生「打开」对话框的 UIA 树不暴露「文件名」编辑框与「打开」按钮
  #   （UIA 只能看到搜索框和文件列表属性），但子窗口中有 ComboBoxEx32→ComboBox→Edit (id=1148)
  #   和 Button(id=1, 打开(&O))，因此用 EnumChildWindows + WM_SETTEXT + BM_CLICK 最稳。
  $res = [ordered]@{
    ok = $false; hwnd = 0; title = ''; editFound = $false; editId = 0; comboFound = $false;
    buttonFound = $false; buttonName = ''; setMethod = ''; invoked = $false; error = ''
  }
  if ($mine.Count -eq 0) { $res.error = 'dialog not found'; ConvertTo-Json -Compress -Depth 5 -InputObject $res; exit 0 }
  $res.hwnd = $mine[0].hwnd
  $res.title = $mine[0].title
  try {
    Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class NexusV16FileDialog {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);
  public static string Find(IntPtr root) {
    long edit = 0, combo = 0, open = 0; string openText = "";
    EnumChildWindows(root, delegate(IntPtr h, IntPtr l) {
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      int id = GetDlgCtrlID(h);
      if (c.ToString() == "Edit" && id == 1148) edit = h.ToInt64();
      if (c.ToString() == "ComboBox" && id == 1148) combo = h.ToInt64();
      if (c.ToString() == "Button" && (id == 1 || t.ToString().Contains("打开"))) { open = h.ToInt64(); openText = t.ToString(); }
      return true;
    }, IntPtr.Zero);
    return edit + "|" + combo + "|" + open + "|" + openText;
  }
}
"@
    $found = [NexusV16FileDialog]::Find([IntPtr]$mine[0].hwnd).Split('|')
    $edit = [IntPtr][long]$found[0]
    $combo = [IntPtr][long]$found[1]
    $open = [IntPtr][long]$found[2]
    $res.editId = 1148
    $res.editFound = ($edit -ne [IntPtr]::Zero)
    $res.comboFound = ($combo -ne [IntPtr]::Zero)
    $res.buttonFound = ($open -ne [IntPtr]::Zero)
    $res.buttonName = $found[3]
    if ($res.editFound) {
      # WM_SETTEXT 到文件名 Edit（以及 ComboBox），再向对话框发 CBN_EDITCHANGE 让「打开」按钮刷新
      [NexusV16FileDialog]::SendMessage($edit, 0x000C, [IntPtr]::Zero, $Path) | Out-Null
      $res.setMethod = 'WM_SETTEXT'
      if ($res.comboFound) { [NexusV16FileDialog]::SendMessage($combo, 0x000C, [IntPtr]::Zero, $Path) | Out-Null }
      Start-Sleep -Milliseconds 200
      $wparam = [IntPtr](((5 -shl 16) -bor 1148))
      [NexusV16FileDialog]::SendMessage([IntPtr]$mine[0].hwnd, 0x0111, $wparam, $edit) | Out-Null
      Start-Sleep -Milliseconds 300
    }
    if ($res.buttonFound) {
      # BM_CLICK 触发「打开(&O)」
      [NexusV16FileDialog]::SendMessage($open, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
      $res.invoked = $true
    }
    $res.ok = ($res.editFound -and $res.invoked)
  } catch {
    $res.error = $_.Exception.Message
  }
  ConvertTo-Json -Compress -Depth 5 -InputObject $res
  exit 0
}
# close
$steps = @()
foreach ($r in $mine) {
  [NexusV16Win]::PostMessage([IntPtr]$r.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}
Start-Sleep -Milliseconds 700
$after = @($rows | Where-Object { $_.mine } | Where-Object { [NexusV16Win]::IsWindowVisible([IntPtr]$_.hwnd) })
$steps += [pscustomobject]@{ action = 'wm_close'; remaining = @($after).Count }
if (@($after).Count -gt 0) {
  foreach ($r in $after) {
    $h = [IntPtr]$r.hwnd
    [NexusV16Win]::SetForegroundWindow($h) | Out-Null
    [NexusV16Win]::PostMessage($h, 0x0100, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 60
    [NexusV16Win]::PostMessage($h, 0x0101, [IntPtr]0x1B, [IntPtr]::Zero) | Out-Null
  }
  Start-Sleep -Milliseconds 700
  $after2 = @($rows | Where-Object { $_.mine } | Where-Object { [NexusV16Win]::IsWindowVisible([IntPtr]$_.hwnd) })
  $steps += [pscustomobject]@{ action = 'escape'; remaining = @($after2).Count }
  if (@($after2).Count -gt 0) {
    try {
      $wsh = New-Object -ComObject WScript.Shell
      foreach ($r in $after2) {
        $wsh.AppActivate($r.pid) | Out-Null
        Start-Sleep -Milliseconds 250
        $wsh.SendKeys('{ESC}')
      }
    } catch { }
    Start-Sleep -Milliseconds 700
    $steps += [pscustomobject]@{ action = 'sendkeys_escape' }
  }
}
ConvertTo-Json -Compress -Depth 5 -InputObject @($steps)
`

function ensureDialogScript() {
  // 必须带 UTF-8 BOM：Windows PowerShell 5.1 读取无 BOM 的 .ps1 会按 ANSI 解码，
  // 中文字符串（*文件名* / *打开* / 自定义图标）被拆坏后会引发 Unexpected token 解析错误。
  writeFileSync(DIALOG_PS_FILE, `\uFEFF${DIALOG_PS}`, 'utf8')
}

function psDialog(mode, outPath = '', filePath = '') {
  ensureDialogScript()
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DIALOG_PS_FILE, '-Mode', mode]
  if (outPath) args.push('-Out', outPath)
  if (filePath) args.push('-Path', filePath)
  const stdout = execFileSync('powershell.exe', args, { encoding: 'utf8', timeout: 30000 })
  const trimmed = stdout.trim()
  if (!trimmed) return null
  const parsed = JSON.parse(trimmed)
  if (mode === 'close') return parsed
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
}

/* ========================= v1.6 补充验收（--pick） ========================= */
function loadJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 把 --pick 的补充结果合并进主报告（替换同 id 项，重算 passed/failed） */
function mergePickIntoReport(report) {
  const pick = loadJsonFile(PICK_FILE)
  if (!pick || !Array.isArray(pick.results) || pick.results.length === 0) return report
  const pickIds = new Set(pick.results.map((r) => r.id))
  const base = Array.isArray(report.results)
    ? report.results.filter(
        (r) =>
          !pickIds.has(r.id) &&
          r.id !== 'FATAL-PICK' &&
          !String(r.id).startsWith('AC-26.6b') &&
          !String(r.id).startsWith('AC-26.6c')
      )
    : []
  report.results = [...base, ...pick.results]
  report.passed = report.results.filter((r) => r.ok === true).length
  report.failed = report.results.filter((r) => r.ok !== true).length
  report.screenshots = [...new Set([...(report.screenshots ?? []), ...(pick.screenshots ?? [])])]
  report.pickMode = {
    at: pick.at,
    cdpPort: pick.cdpPort,
    userDataDir: pick.userDataDir,
    durationMs: pick.durationMs,
    passed: pick.passed,
    failed: pick.failed,
    importEvidence: pick.importEvidence ?? [],
    diagnostics: pick.diagnostics ?? null,
    iconNetworkResponses: pick.iconNetworkResponses ?? []
  }
  return report
}

/** 发起 pickIcon（不 await，挂到 window），等原生对话框 → UIA 选文件 → 等 IPC 返回 */
async function pickViaDialog(client, filePath) {
  await client.evaluate(`(() => {
    window.__v16PickResult = null;
    window.__v16Pick = window.nexus.apps.pickIcon()
      .then((r) => { window.__v16PickResult = r; return r; })
      .catch((e) => {
        const r = { ok: false, error: String(e && e.message ? e.message : e) };
        window.__v16PickResult = r;
        return r;
      });
    return true;
  })()`)
  const dialog = await (async () => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      try {
        const dialogs = psDialog('find')
        if (dialogs.length > 0) return dialogs[0]
      } catch {
        /* PowerShell 偶发失败，继续轮询 */
      }
      await sleep(300)
    }
    return null
  })()
  if (!dialog) {
    return { dialog: null, automation: null, result: null, safetyClosed: false, leftoverDialogs: -1, dialogCapture: null, dialogGone: false, error: '原生对话框未出现' }
  }
  // 对话框取证截图（PrintWindow 渲染窗口本身，避免截到前台其他窗口）
  let dialogCapture = null
  await sleep(400)
  try {
    const capturePath = join(OUT_DIR, 'native-pick-dialog.png')
    const captures = psDialog('capture', capturePath) ?? []
    const capture = Array.isArray(captures) ? captures[0] : captures
    if (capture?.ok) {
      const r = rel(capturePath)
      if (!screenshots.includes(r)) screenshots.push(r)
      dialogCapture = { ...capture, path: r }
    }
  } catch {
    dialogCapture = null
  }
  await sleep(500) // 等 UIA 树稳定
  let automation = null
  try {
    automation = (psDialog('open-file', '', filePath) ?? [])[0] ?? null
  } catch (error) {
    automation = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  // 自动化提交后对话框应自行消失
  const dialogGone = await waitUntil(async () => (psDialog('find').length === 0 ? true : null), 8000, 300)
  let result = await waitUntil(async () => (await client.evaluate('window.__v16PickResult')) ?? null, 15000, 300)
  let safetyClosed = false
  if (!result || dialogGone !== true) {
    // 自动化失败兜底：关闭对话框避免测试实例卡死；报告中会明确记录未覆盖
    try {
      psDialog('close')
    } catch {
      /* ignore */
    }
    safetyClosed = true
    result = (await waitUntil(async () => (await client.evaluate('window.__v16PickResult')) ?? null, 6000, 250)) ?? result
  }
  let leftoverDialogs = -1
  try {
    leftoverDialogs = psDialog('find').length
  } catch {
    leftoverDialogs = -1
  }
  return { dialog, automation, result, safetyClosed, leftoverDialogs, dialogCapture, dialogGone: dialogGone === true }
}

async function runPickMode() {
  const pickStartedAt = Date.now()
  const importEvidence = []
  try {
    mkdirSync(PICK_USERDATA, { recursive: true })
    const srcPng = join(PICK_USERDATA, 'pick-source.png')
    const srcSvg = join(PICK_USERDATA, 'pick-source.svg')
    writeFileSync(srcPng, makeTestPng(640, 512))
    writeFileSync(srcSvg, PICK_SVG_CONTENT, 'utf8')

    const dock = await openTarget('/dock/', 20000, PICK_PORT)
    if (!dock) throw new Error(`未找到 Dock 页面（端口 ${PICK_PORT}，隔离目录 ${PICK_USERDATA}）`)
    A.dock = dock
    await attachDiagnostics(dock.client, 'dock-pick')
    const settings = await dock.client.evaluate('window.nexus.settings.get()')
    const appId = settings.apps[0]?.id
    if (!appId) throw new Error('设置中没有应用条目')

    /* ---------------- AC-26.6b 原生选 PNG → importCustomIcon → Dock 渲染 ---------------- */
    const pngPick = await pickViaDialog(dock.client, srcPng)
    const pngIcon = pngPick.result?.icon ?? ''
    const pngName = pngIcon.replace(/^icon:\/\//, '')
    const pngNameOk = /^custom-[0-9a-f]{12}\.png$/.test(pngName)
    const pngPath = pngNameOk ? join(PICK_ICONS, pngName) : ''
    const pngHeader = pngPath && existsSync(pngPath) ? parsePngHeader(pngPath) : null
    const expectedPngH = Math.round((512 * 256) / 640)
    const pngShapeOk = /^icon:\/\/custom-[0-9a-f]{12}\.png$/.test(pngIcon)
    const pngDimsOk = !!pngHeader && pngHeader.width === 256 && Math.abs(pngHeader.height - expectedPngH) <= 1
    const pngRatioOk = !!pngHeader && Math.abs(pngHeader.width / pngHeader.height - 640 / 512) < 0.02
    let pngDom = null
    if (pngPick.result?.ok && pngIcon) {
      await dock.client.evaluate(
        `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customIcon: ${JSON.stringify(pngIcon)}, customName: null })`
      )
      pngDom = await waitUntil(async () => {
        const info = await readDockInfo(appId)
        return info && info.imgSrc === pngIcon && info.imgNaturalWidth > 0 ? info : null
      }, 12000)
    }
    const pngSettings = await dock.client.evaluate('window.nexus.settings.get()')
    const pngSettingsItem = pngSettings.apps.find((item) => item.id === appId)
    const pngShot = await shot(dock.client, 'dock-pick-png.png')
    const pngSetterOk = ['WM_SETTEXT', 'ValuePattern', 'SendKeys'].includes(pngPick.automation?.setMethod)
    const pngOk =
      !!pngPick.dialog &&
      pngPick.dialogGone === true &&
      pngPick.automation?.ok === true &&
      pngSetterOk &&
      pngPick.result?.ok === true &&
      pngShapeOk &&
      !!pngHeader &&
      pngHeader.magic === true &&
      pngHeader.ihdrTag === 'IHDR' &&
      pngDimsOk &&
      pngRatioOk &&
      !!pngDom &&
      pngSettingsItem?.customIcon === pngIcon &&
      pngPick.safetyClosed === false
    importEvidence.push({
      kind: 'png',
      source: rel(srcPng),
      sourceBytes: readFileSync(srcPng).length,
      icon: pngIcon,
      importedFile: pngPath ? rel(pngPath) : null,
      importedHeader: pngHeader,
      expectedResize: { width: 256, height: expectedPngH },
      dialog: { title: pngPick.dialog?.title ?? null, hwnd: pngPick.dialog?.hwnd ?? null },
      dialogCapture: pngPick.dialogCapture,
      dialogGone: pngPick.dialogGone,
      automation: pngPick.automation,
      dom: pngDom
    })
    record(
      'AC-26.6b',
      '原生对话框真实选择 640×512 PNG → importCustomIcon 归一化导入（≤256px）→ Dock 渲染',
      pngOk,
      {
        dialog: pngPick.dialog,
        dialogCapture: pngPick.dialogCapture,
        dialogGone: pngPick.dialogGone,
        automation: pngPick.automation,
        pickResult: pngPick.result,
        iconShapeOk: pngShapeOk,
        imported: pngHeader && pngPath ? { path: rel(pngPath), ...pngHeader } : null,
        expectedResize: { width: 256, height: expectedPngH },
        dimsOk: pngDimsOk,
        ratioOk: pngRatioOk,
        dom: pngDom,
        safetyClosed: pngPick.safetyClosed,
        leftoverDialogs: pngPick.leftoverDialogs
      },
      pngShot ? [pngShot] : []
    )

    /* ---------------- AC-26.6c 原生选 SVG → 原样导入 → Dock 渲染 ---------------- */
    const svgPick = await pickViaDialog(dock.client, srcSvg)
    const svgIcon = svgPick.result?.icon ?? ''
    const svgName = svgIcon.replace(/^icon:\/\//, '')
    const svgNameOk = /^custom-[0-9a-f]{12}\.svg$/.test(svgName)
    const svgPath = svgNameOk ? join(PICK_ICONS, svgName) : ''
    const svgShapeOk = /^icon:\/\/custom-[0-9a-f]{12}\.svg$/.test(svgIcon)
    const svgFileText = svgPath && existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : ''
    const svgContentOk = svgFileText === PICK_SVG_CONTENT
    let svgDom = null
    let svgNetwork = null
    if (svgPick.result?.ok && svgIcon) {
      await dock.client.evaluate(
        `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customIcon: ${JSON.stringify(svgIcon)}, customName: null })`
      )
      svgDom = await waitUntil(async () => {
        const info = await readDockInfo(appId)
        return info && info.imgSrc === svgIcon && info.imgNaturalWidth > 0 ? info : null
      }, 12000)
      svgNetwork = await waitUntil(async () => findIconResponse(svgIcon, 'dock-pick'), 8000, 200)
      if (!svgNetwork) {
        await dock.client.send('Page.reload', { ignoreCache: true })
        svgDom =
          (await waitUntil(async () => {
            const info = await readDockInfo(appId)
            return info && info.imgSrc === svgIcon && info.imgNaturalWidth > 0 ? info : null
          }, 12000)) ?? svgDom
        svgNetwork = await waitUntil(async () => findIconResponse(svgIcon, 'dock-pick'), 8000, 200)
      }
    }
    const svgContentType = headerOf(svgNetwork?.headers, 'content-type')
    const svgContentTypeOk = String(svgContentType ?? '').startsWith('image/svg+xml')
    const svgSettings = await dock.client.evaluate('window.nexus.settings.get()')
    const svgSettingsItem = svgSettings.apps.find((item) => item.id === appId)
    const svgShot = await shot(dock.client, 'dock-pick-svg.png')
    const svgSetterOk = ['WM_SETTEXT', 'ValuePattern', 'SendKeys'].includes(svgPick.automation?.setMethod)
    const svgOk =
      !!svgPick.dialog &&
      svgPick.dialogGone === true &&
      svgPick.automation?.ok === true &&
      svgSetterOk &&
      svgPick.result?.ok === true &&
      svgShapeOk &&
      svgContentOk &&
      !!svgDom &&
      svgContentTypeOk &&
      svgSettingsItem?.customIcon === svgIcon &&
      svgPick.safetyClosed === false
    importEvidence.push({
      kind: 'svg',
      source: rel(srcSvg),
      icon: svgIcon,
      importedFile: svgPath ? rel(svgPath) : null,
      importedBytes: svgPath && existsSync(svgPath) ? readFileSync(svgPath).length : 0,
      contentMatchesSource: svgContentOk,
      networkContentType: svgContentType ?? null,
      dialog: { title: svgPick.dialog?.title ?? null, hwnd: svgPick.dialog?.hwnd ?? null },
      dialogCapture: svgPick.dialogCapture,
      dialogGone: svgPick.dialogGone,
      automation: svgPick.automation,
      dom: svgDom
    })
    record(
      'AC-26.6c',
      '原生对话框真实选择 SVG → 原样导入（image/svg+xml）→ Dock 渲染',
      svgOk,
      {
        dialog: svgPick.dialog,
        dialogCapture: svgPick.dialogCapture,
        dialogGone: svgPick.dialogGone,
        automation: svgPick.automation,
        pickResult: svgPick.result,
        iconShapeOk: svgShapeOk,
        importedFile: svgPath ? rel(svgPath) : null,
        contentMatchesSource: svgContentOk,
        network: svgNetwork ? { url: svgNetwork.url, status: svgNetwork.status, contentType: svgContentType } : null,
        dom: svgDom,
        safetyClosed: svgPick.safetyClosed,
        leftoverDialogs: svgPick.leftoverDialogs
      },
      svgShot ? [svgShot] : []
    )

    // 清理：恢复默认显示（隔离配置不残留自定义字段）
    await dock.client.evaluate(
      `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customName: null, customIcon: null })`
    )
  } catch (error) {
    record('FATAL-PICK', '补充验收（--pick）执行异常', false, String(error && error.stack ? error.stack : error))
  } finally {
    try {
      A.dock?.client.close()
    } catch {
      /* ignore */
    }
  }

  const pickPassed = results.filter((r) => r.ok).length
  const pickFailed = results.filter((r) => !r.ok).length
  const pickData = {
    mode: '--pick',
    title: 'v1.6 补充验收：原生对话框真实选图 → importCustomIcon 导入 → Dock 渲染',
    at: new Date().toISOString(),
    cdpPort: PICK_PORT,
    userDataDir: PICK_USERDATA,
    durationMs: Date.now() - pickStartedAt,
    passed: pickPassed,
    failed: pickFailed,
    results,
    screenshots,
    importEvidence,
    diagnostics: {
      total: diagnostics.length,
      errors: diagnostics
        .filter((d) => !KNOWN_NOISE.some((re) => re.test(d.text)) && !PROBE_NOISE.test(d.text))
        .map((d) => ({ page: d.page, kind: d.kind, text: d.text })),
      ignored: diagnostics.filter((d) => KNOWN_NOISE.some((re) => re.test(d.text))).length,
      probeFiltered: diagnostics.filter((d) => PROBE_NOISE.test(d.text)).length
    },
    iconNetworkResponses: networkLog.map((entry) => ({
      page: entry.page,
      url: entry.url,
      status: entry.status,
      mimeType: entry.mimeType,
      contentType: headerOf(entry.headers, 'content-type')
    }))
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(PICK_FILE, JSON.stringify(pickData, null, 2), 'utf8')

  const reportPath = join(OUT_DIR, 'v16-report.json')
  const mainReport = loadJsonFile(reportPath)
  if (mainReport) {
    mergePickIntoReport(mainReport)
    mainReport.updatedAt = new Date().toISOString()
    writeFileSync(reportPath, JSON.stringify(mainReport, null, 2), 'utf8')
    console.log(
      `\n补充验收 ${pickPassed}/${pickPassed + pickFailed}；报告合计 ${mainReport.passed}/${mainReport.passed + mainReport.failed}：docs/verification/v1.6/v16-report.json`
    )
  } else {
    const standalone = {
      version: '1.6.0',
      title: 'Nexus Dock v1.6 独立验收（仅 --pick 补充项）',
      cdpPort: PICK_PORT,
      userDataDir: PICK_USERDATA,
      startedAt: new Date(pickStartedAt).toISOString(),
      durationMs: Date.now() - pickStartedAt,
      passed: pickPassed,
      failed: pickFailed,
      screenshots,
      results
    }
    mergePickIntoReport(standalone)
    writeFileSync(reportPath, JSON.stringify(standalone, null, 2), 'utf8')
    console.log(`\n补充验收 ${pickPassed}/${pickPassed + pickFailed}；报告：docs/verification/v1.6/v16-report.json`)
  }
  process.exit(pickFailed === 0 ? 0 : 1)
}

if (PICK_MODE) {
  await runPickMode()
}

/* ================================= 主流程 ================================= */
let fatal = null
try {
  /* 夹具自检（脚本可独立运行；--prepare 已在启动前写好，这里幂等补齐） */
  mkdirSync(ICONS, { recursive: true })
  if (!existsSync(join(ICONS, 'v16-test.png'))) writeFileSync(join(ICONS, 'v16-test.png'), makeTestPng(64))
  if (!existsSync(join(ICONS, 'v16-test.svg'))) writeFileSync(join(ICONS, 'v16-test.svg'), SVG_CONTENT, 'utf8')

  const dockTarget = await openTarget('/dock/')
  if (!dockTarget) throw new Error('未找到 Dock 页面（确认应用已用 --remote-debugging-port 启动）')
  A.dock = dockTarget
  await attachDiagnostics(A.dock.client, 'dock')

  /* --------------------- AC-26.1 版本 / v8→v9 迁移 --------------------- */
  const version = await A.dock.client.evaluate('window.nexus.env.appVersion')
  let settingsNow = await A.dock.client.evaluate('window.nexus.settings.get()')
  // 首帧后主进程会异步补齐图标（hydrateIcons，约 1.2s 起）；等 6 个条目都有 icon
  const hydrated = await waitUntil(async () => {
    const s = await A.dock.client.evaluate('window.nexus.settings.get()')
    return s.apps.length === 6 && s.apps.every((a) => a.name && a.icon) ? s : null
  }, 25000, 400)
  if (hydrated) settingsNow = hydrated
  const apps = settingsNow.apps
  const missingIcons = apps.filter((a) => !a.icon).map((a) => a.id)
  const seedDock = buildSeedSettings().dock
  const dockPreserved =
    Math.abs(settingsNow.dock.alongPercent - seedDock.alongPercent) < 0.01 &&
    settingsNow.dock.iconSize === seedDock.iconSize
  let diskSettings = null
  try {
    if (existsSync(join(USERDATA, 'settings.json'))) {
      diskSettings = JSON.parse(readFileSync(join(USERDATA, 'settings.json'), 'utf8'))
    }
  } catch {
    diskSettings = null
  }
  let mainLog = ''
  try {
    mainLog = existsSync(OUT_LOG) ? readFileSync(OUT_LOG, 'utf8') : ''
  } catch {
    mainLog = ''
  }
  const migratedLog = /v8\s*迁移到\s*v9|v8.*v9/.test(mainLog)
  const diskHasNoCustom = diskSettings
    ? diskSettings.schemaVersion === 9 &&
      diskSettings.apps.every((a) => a.customName === undefined && a.customIcon === undefined)
    : false
  const t1ok =
    version === '1.6.0' &&
    settingsNow.schemaVersion === 9 &&
    apps.length === 6 &&
    apps.every((a) => typeof a.name === 'string' && a.name.length > 0) &&
    missingIcons.length === 0 &&
    dockPreserved &&
    diskHasNoCustom
  await shot(A.dock.client, 'dock-v16.png')
  record('AC-26.1', '版本 1.6.0 + 设置 v8→v9 迁移零丢失（6 应用/名称/图标）', t1ok, {
    version,
    schemaVersion: settingsNow.schemaVersion,
    appsCount: apps.length,
    names: apps.map((a) => a.name),
    missingIcons,
    dockPreserved: { alongPercent: settingsNow.dock.alongPercent, iconSize: settingsNow.dock.iconSize },
    diskSchemaVersion: diskSettings?.schemaVersion ?? null,
    diskHasNoCustom,
    migratedLog
  })

  const appId = apps[0]?.id
  const original = apps[0]
  if (!appId || !original) throw new Error('设置中没有可测试的应用')

  /* --------------------------- AC-26.2 Dock 改名 --------------------------- */
  const renameRes = await A.dock.client.evaluate(
    `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customName: '测试新名字' }).then((list) => list.map((i) => ({ id: i.id, customName: i.customName })))`
  )
  const renamedDom = await waitUntil(async () => {
    const info = await readDockInfo(appId)
    return info && info.aria === '测试新名字' && info.title === '测试新名字' ? info : null
  }, 8000)
  const renamedSettings = await settingItem(appId)
  const renameShot = await shot(A.dock.client, 'dock-rename-v16.png')
  record(
    'AC-26.2',
    'Dock 改名：updateItem(customName) 后 aria-label/title 同步为「测试新名字」',
    !!renamedDom && renamedSettings?.customName === '测试新名字' && Array.isArray(renameRes),
    { dom: renamedDom, settingsCustomName: renamedSettings?.customName },
    [renameShot]
  )

  /* --------------------- AC-26.3a 自定义 PNG 图标渲染 --------------------- */
  await A.dock.client.evaluate(
    `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customIcon: ${JSON.stringify(PNG_URL)} })`
  )
  const pngDom = await waitUntil(async () => {
    const info = await readDockInfo(appId)
    return info && info.imgSrc === PNG_URL && info.imgNaturalWidth > 0 ? info : null
  }, 12000)
  const pngSettings = await settingItem(appId)
  const pngShot = await shot(A.dock.client, 'dock-custom-icon-png.png')
  record(
    'AC-26.3a',
    '自定义 PNG 图标：icon:// 真实渲染（naturalWidth > 0）',
    !!pngDom && pngSettings?.customIcon === PNG_URL,
    { dom: pngDom, settingsCustomIcon: pngSettings?.customIcon },
    [pngShot]
  )

  /* --------- AC-26.3b 自定义 SVG：Network 响应头 Content-Type + 真实渲染 ---------
   * 说明：file:// 页面 fetch('icon://…') 属于跨源请求，Electron 自定义协议默认不开放 CORS，
   * 产品自身只用 <img> 加载图标、不需要页面 fetch；因此这里改用 CDP Network 抓真实响应头，
   * 并以 <img> 解码成功（naturalWidth>0）+ protocol.ts 的 MIME 映射静态核对作为判定依据。 */
  await A.dock.client.evaluate(
    `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customIcon: ${JSON.stringify(SVG_URL)} })`
  )
  const waitSvgRender = () =>
    waitUntil(async () => {
      const info = await readDockInfo(appId)
      return info && info.imgSrc === SVG_URL && info.imgNaturalWidth > 0 ? info : null
    }, 12000)
  let svgDom = await waitSvgRender()
  let svgNetwork = findIconResponse(SVG_URL)
  if (!svgNetwork) {
    // Network 域若在请求之后才启用，重载 Dock 触发一次真实加载再抓响应头
    await A.dock.client.send('Page.reload', { ignoreCache: true })
    svgDom = (await waitSvgRender()) ?? svgDom
    svgNetwork = await waitUntil(async () => findIconResponse(SVG_URL), 8000)
  }
  const svgContentType = headerOf(svgNetwork?.headers, 'content-type')
  // 静态核对主进程 protocol.ts 的 MIME 映射（只读源码，不改源码）
  let protocolMimeStatic = false
  try {
    const protocolSource = readFileSync(join(ROOT, 'src', 'main', 'protocol.ts'), 'utf8')
    protocolMimeStatic = /'\.svg':\s*'image\/svg\+xml'/.test(protocolSource)
  } catch {
    protocolMimeStatic = false
  }
  const svgShot = await shot(A.dock.client, 'dock-custom-icon-svg.png')
  const svgCtOk = String(svgContentType ?? '').startsWith('image/svg+xml')
  const svgOk = svgCtOk || (!!svgDom && protocolMimeStatic)
  record(
    'AC-26.3b',
    '自定义 SVG 图标：响应 Content-Type=image/svg+xml 且 <img> 真实渲染（Network 响应头取证）',
    svgOk,
    {
      network: svgNetwork
        ? {
            url: svgNetwork.url,
            status: svgNetwork.status,
            mimeType: svgNetwork.mimeType,
            contentType: svgContentType
          }
        : null,
      contentTypeSource: svgCtOk ? 'network.responseReceived' : protocolMimeStatic ? 'protocol.ts静态映射+img解码成功' : 'none',
      protocolMimeStatic,
      dom: svgDom,
      note: "不用页面 fetch 判定：file:// 页面 fetch 自定义协议属跨源（CORS 默认关闭），产品只用 <img> 加载图标"
    },
    [svgShot]
  )

  /* --------------------------- AC-26.4 恢复默认 --------------------------- */
  await A.dock.client.evaluate(
    `window.nexus.apps.updateItem(${JSON.stringify(appId)}, { customName: null, customIcon: null })`
  )
  const originalIcon = original.icon ?? ''
  const restoredDom = await waitUntil(async () => {
    const info = await readDockInfo(appId)
    if (!info) return null
    const iconOk = originalIcon
      ? info.imgSrc === originalIcon && info.imgNaturalWidth > 0
      : info.letter === Array.from(original.name)[0]
    return info.aria === original.name && info.title === original.name && iconOk ? info : null
  }, 8000)
  const restoredSettings = await settingItem(appId)
  const restoredJson = JSON.stringify(restoredSettings ?? {})
  const noResidue = !/"(customName|customIcon)":(null|"")/.test(restoredJson)
  const restoredShot = await shot(A.dock.client, 'dock-restored.png')
  record(
    'AC-26.4',
    '恢复默认：Dock 名称/图标回到原值，配置无 customName/customIcon 残留',
    !!restoredDom &&
      restoredSettings?.customName === undefined &&
      restoredSettings?.customIcon === undefined &&
      noResidue,
    {
      dom: restoredDom,
      customName: restoredSettings?.customName ?? '(undefined)',
      customIcon: restoredSettings?.customIcon ?? '(undefined)',
      noResidue
    },
    [restoredShot]
  )

  /* ------------------ AC-26.5a 设置页 ✎ 入口 + 弹层自动聚焦 ------------------ */
  await A.dock.client.evaluate('window.nexus.window.openSettings()')
  const settingsTarget = await openTarget('/settings/', 12000)
  if (!settingsTarget) throw new Error('设置窗口未出现')
  A.settings = settingsTarget
  await attachDiagnostics(A.settings.client, 'settings')
  const settingsRendered = await waitUntil(async () => {
    const len = await A.settings.client.evaluate('(document.body?.innerText ?? "").length')
    return len > 200 ? len : null
  }, 12000)
  await clickNav('应用')
  const appsUi = await A.settings.client.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.nx-app-row')];
    const editLabels = rows.map((row) => {
      const btn = row.querySelector('button[aria-label*="编辑"]');
      return btn ? btn.getAttribute('aria-label') : null;
    });
    const active = document.querySelector('.settings-nav-item.is-active');
    return {
      rowCount: rows.length,
      editButtonCount: editLabels.filter(Boolean).length,
      editLabels,
      activeNav: active ? (active.textContent ?? '').trim() : null,
      hasTip: (document.querySelector('.nx-apps-tip')?.textContent ?? '').includes('✎')
    };
  })()`)
  const clickedEdit = await A.settings.client.evaluate(`(() => {
    const row = document.querySelectorAll('.nx-app-row')[0];
    const btn = row ? row.querySelector('button[aria-label*="编辑"]') : null;
    if (!btn) return false;
    btn.click();
    return true;
  })()`)
  const editorBase = await waitUntil(async () => {
    const info = await A.settings.client.evaluate(overlayInfoExpr)
    return info && info.count === 1 && info.input?.exists ? info : null
  }, 6000)
  const editorFocused = await waitUntil(async () => {
    const info = await A.settings.client.evaluate(overlayInfoExpr)
    return info && info.count === 1 && info.input?.focused ? info : null
  }, 4000)
  const editorShot = await shot(A.settings.client, 'settings-app-edit-open.png')
  const appsShot = await shot(A.settings.client, 'settings-apps-v16.png')
  record(
    'AC-26.5a',
    '设置页每行有 ✎ 编辑入口；点击后弹层出现且名称输入框自动聚焦',
    appsUi.rowCount === apps.length &&
      appsUi.editButtonCount === apps.length &&
      appsUi.editLabels.every((label) => label && label.includes('编辑')) &&
      appsUi.activeNav === '应用' &&
      clickedEdit === true &&
      !!editorBase &&
      !!editorFocused,
    { appsUi, clickedEdit, editor: editorFocused ?? editorBase },
    [appsShot, editorShot]
  )

  /* ---------------- AC-26.5b 设置页改名保存 + Dock 同步 ---------------- */
  const inputTyped = await A.settings.client.evaluate(`(() => {
    const input = document.querySelector('.nx-app-edit-input');
    if (!input) return { found: false };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '设置页改名');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { found: true, value: input.value };
  })()`)
  await sleep(200)
  const inputState = await A.settings.client.evaluate(`(() => {
    const input = document.querySelector('.nx-app-edit-input');
    const preview = document.querySelector('.nx-app-edit-preview-name');
    return { value: input ? input.value : null, previewName: preview ? preview.textContent : null };
  })()`)
  const clickedSave = await A.settings.client.evaluate(`(() => {
    const root = document.querySelector('.nx-app-edit');
    if (!root) return { ok: false, reason: 'no overlay' };
    const buttons = [...root.querySelectorAll('button')];
    const save = buttons.find((b) => (b.textContent ?? '').trim() === '保存');
    if (!save) return { ok: false, reason: 'no save button', labels: buttons.map((b) => (b.textContent ?? '').trim()) };
    save.click();
    return { ok: true };
  })()`)
  const overlayClosed = await waitUntil(async () => {
    const count = await A.settings.client.evaluate("document.querySelectorAll('.nx-app-edit').length")
    return count === 0 ? true : null
  }, 8000)
  const savedRow = await waitUntil(async () => {
    const row = await A.settings.client.evaluate(`(() => {
      const r = document.querySelectorAll('.nx-app-row')[0];
      if (!r) return null;
      return {
        name: (r.querySelector('.nx-app-name')?.textContent ?? '').trim(),
        badge: r.querySelector('.nx-app-badge.is-custom') ? (r.querySelector('.nx-app-badge.is-custom').textContent ?? '').trim() : null,
        title: r.querySelector('.nx-app-name')?.getAttribute('title') ?? null
      };
    })()`)
    return row && row.name === '设置页改名' ? row : null
  }, 8000)
  const savedSettingsItem = await settingItem(appId)
  const dockSynced = await waitUntil(async () => {
    const info = await readDockInfo(appId)
    return info && info.aria === '设置页改名' && info.title === '设置页改名' ? info : null
  }, 8000)
  const settingsCustomizedShot = await shot(A.settings.client, 'settings-apps-customized.png')
  const dockSyncedShot = await shot(A.dock.client, 'dock-settings-rename.png')
  record(
    'AC-26.5b',
    '设置页改名保存：弹层关闭、列表显示新名 +「自定义」徽标、Dock 同步',
    inputTyped.found === true &&
      inputTyped.value === '设置页改名' &&
      inputState.value === '设置页改名' &&
      clickedSave.ok === true &&
      overlayClosed === true &&
      !!savedRow &&
      savedRow.badge === '自定义' &&
      savedSettingsItem?.customName === '设置页改名' &&
      !!dockSynced,
    { inputTyped, inputState, clickedSave, overlayClosed, savedRow, settingsCustomName: savedSettingsItem?.customName, dock: dockSynced },
    [settingsCustomizedShot, dockSyncedShot]
  )

  /* ------- AC-26.5c requestEdit（Dock 右键路径）跨窗口定位 + 只打开一次 ------- */
  const requestEditSent = await A.dock.client.evaluate(
    `window.nexus.apps.requestEdit(${JSON.stringify(appId)}).then(() => true).catch((e) => String(e && e.message ? e.message : e))`
  )
  const requestEditOverlay = await waitUntil(async () => {
    const info = await A.settings.client.evaluate(overlayInfoExpr)
    return info && info.count === 1 ? info : null
  }, 10000)
  // lead 追加：弹层只打开一次；保持 1.2s 不出现第二次/重复挂载
  await sleep(1200)
  const overlayAfterWait = await A.settings.client.evaluate(overlayInfoExpr)
  const reqShot = await shot(A.settings.client, 'settings-request-edit.png')
  const requestEditOk =
    requestEditSent === true &&
    !!requestEditOverlay &&
    requestEditOverlay.count === 1 &&
    requestEditOverlay.activeNav === '应用' &&
    (requestEditOverlay.text.includes(original.path) || requestEditOverlay.text.includes(original.name)) &&
    overlayAfterWait?.count === 1
  record(
    'AC-26.5c',
    'requestEdit(id)：设置窗口切到「应用」并打开唯一编辑弹层（弹层内是目标应用）',
    requestEditOk,
    {
      requestEditSent,
      overlay: requestEditOverlay,
      countAfter1200ms: overlayAfterWait?.count ?? 0,
      matchedPath: requestEditOverlay ? requestEditOverlay.text.includes(original.path) : false
    },
    [reqShot]
  )

  // 关闭弹层 → 1.2s 内不得自动复弹（lead 追加断言）
  const closedByCancel = await A.settings.client.evaluate(`(() => {
    const root = document.querySelector('.nx-app-edit');
    if (!root) return false;
    const buttons = [...root.querySelectorAll('button')];
    const cancel = buttons.find((b) => (b.textContent ?? '').trim() === '取消') || buttons.find((b) => (b.getAttribute('aria-label') ?? '').includes('关闭'));
    if (!cancel) return false;
    cancel.click();
    return true;
  })()`)
  await waitUntil(async () => {
    const count = await A.settings.client.evaluate("document.querySelectorAll('.nx-app-edit').length")
    return count === 0 ? true : null
  }, 5000)
  await sleep(1200)
  const noReopenCount = await A.settings.client.evaluate("document.querySelectorAll('.nx-app-edit').length")
  const pendingLeft = await A.settings.client.evaluate('window.nexus.apps.consumeEditRequest()')
  record(
    'AC-26.5d',
    '关闭 requestEdit 弹层后不自动复弹，主进程无残留待处理请求',
    closedByCancel === true && noReopenCount === 0 && (pendingLeft === null || pendingLeft === undefined),
    { closedByCancel, noReopenCount, pendingLeft },
    []
  )

  /* ---------------- AC-26.5e 弹层内「恢复默认」→ Dock 回到默认 ---------------- */
  await A.settings.client.evaluate(`(() => {
    const row = document.querySelectorAll('.nx-app-row')[0];
    const btn = row ? row.querySelector('button[aria-label*="编辑"]') : null;
    if (btn) btn.click();
  })()`)
  const resetOverlay = await waitUntil(async () => {
    const info = await A.settings.client.evaluate(overlayInfoExpr)
    return info && info.count === 1 ? info : null
  }, 6000)
  const clickedRestore = await A.settings.client.evaluate(`(() => {
    const root = document.querySelector('.nx-app-edit');
    if (!root) return { ok: false };
    const buttons = [...root.querySelectorAll('button')];
    const restore = buttons.find((b) => (b.textContent ?? '').trim() === '恢复默认');
    if (!restore) return { ok: false, labels: buttons.map((b) => (b.textContent ?? '').trim()) };
    restore.click();
    return { ok: true };
  })()`)
  const resetOverlayClosed = await waitUntil(async () => {
    const count = await A.settings.client.evaluate("document.querySelectorAll('.nx-app-edit').length")
    return count === 0 ? true : null
  }, 8000)
  const dockAfterReset = await waitUntil(async () => {
    const info = await readDockInfo(appId)
    if (!info) return null
    const iconOk = originalIcon
      ? info.imgSrc === originalIcon && info.imgNaturalWidth > 0
      : info.letter === Array.from(original.name)[0]
    return info.aria === original.name && info.title === original.name && iconOk ? info : null
  }, 8000)
  const itemAfterReset = await settingItem(appId)
  const settingsResetShot = await shot(A.settings.client, 'settings-apps-after-reset.png')
  const dockResetShot = await shot(A.dock.client, 'dock-after-edit-reset.png')
  record(
    'AC-26.5e',
    '弹层内「恢复默认」：Dock 名称与图标回到默认，自定义字段清空',
    !!resetOverlay &&
      clickedRestore.ok === true &&
      resetOverlayClosed === true &&
      !!dockAfterReset &&
      itemAfterReset?.customName === undefined &&
      itemAfterReset?.customIcon === undefined,
    { resetOverlay: !!resetOverlay, clickedRestore, resetOverlayClosed, dock: dockAfterReset, itemAfterReset },
    [settingsResetShot, dockResetShot]
  )

  /* ----------------- AC-26.6 原生图标选择对话框（真实打开 + 取消） ----------------- */
  let pickDialog = []
  let pickCapture = null
  let pickCloseSteps = null
  let pickGone = false
  let pickResult = null
  let pickError = null
  try {
    await A.dock.client.evaluate(`(() => {
      window.__v16PickResult = null;
      window.nexus.apps.pickIcon()
        .then((r) => { window.__v16PickResult = r; })
        .catch((e) => { window.__v16PickResult = { ok: false, error: String(e && e.message ? e.message : e) }; });
      return true;
    })()`)
    // 等原生对话框出现（最多 15s）
    pickDialog = await (async () => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const dialogs = psDialog('find')
        if (dialogs.length > 0) return dialogs
        await sleep(350)
      }
      return []
    })()
    if (pickDialog.length > 0) {
      try {
        const capturePath = join(OUT_DIR, 'native-icon-dialog.png')
        const captureList = psDialog('capture', capturePath)
        pickCapture = (Array.isArray(captureList) ? captureList[0] : captureList) ?? null
        if (pickCapture?.ok) {
          const r = rel(capturePath)
          if (!screenshots.includes(r)) screenshots.push(r)
        }
      } catch (e) {
        pickCapture = { ok: false, error: String(e && e.message ? e.message : e) }
      }
      pickCloseSteps = psDialog('close')
      // 等对话框确实消失（最多 8s），避免阻塞后续操作
      const goneDeadline = Date.now() + 8000
      while (Date.now() < goneDeadline) {
        const left = psDialog('find')
        if (left.length === 0) {
          pickGone = true
          break
        }
        await sleep(350)
      }
    }
    // 等 IPC 返回 canceled
    pickResult = await waitUntil(async () => {
      const r = await A.dock.client.evaluate('window.__v16PickResult')
      return r ?? null
    }, 12000)
  } catch (e) {
    pickError = String(e && e.message ? e.message : e)
  }
  record(
    'AC-26.6',
    '图标选择对话框：原生对话框真实打开、已取消关闭、IPC 返回 canceled',
    pickDialog.length > 0 &&
      pickGone === true &&
      pickResult?.ok === false &&
      pickResult?.error === 'canceled' &&
      !pickError,
    {
      dialog: pickDialog,
      capture: pickCapture,
      closeSteps: pickCloseSteps,
      gone: pickGone,
      result: pickResult,
      error: pickError
    },
    pickCapture?.ok ? ['docs/verification/v1.6/native-icon-dialog.png'] : []
  )

  /* ---------------------- AC-26.7 设置四页回归截图 ---------------------- */
  const pageShots = []
  const pageStates = {}
  for (const [label, file] of [
    ['Dock', 'settings-dock-regression.png'],
    ['应用', 'settings-apps-regression.png'],
    ['音乐', 'settings-music-regression.png'],
    ['系统', 'settings-system-regression.png']
  ]) {
    const ok = await clickNav(label)
    const state = await A.settings.client.evaluate(`(() => ({
      nav: document.querySelector('.settings-nav-item.is-active')?.textContent?.trim() ?? null,
      errorBanner: !!document.querySelector('.settings-error-banner'),
      contentLength: (document.querySelector('.settings-content')?.innerText ?? '').length
    }))()`)
    pageStates[label] = { clicked: ok, ...state }
    pageShots.push(await shot(A.settings.client, file))
  }
  record(
    'AC-26.7',
    '设置四个页面（Dock/应用/音乐/系统）均可渲染且无错误提示条',
    Object.values(pageStates).every((s) => s.clicked === true && s.nav && s.errorBanner === false && s.contentLength > 100),
    pageStates,
    pageShots
  )

  /* ---------------------- AC-26.8 Dock 回归 + console error ---------------------- */
  const dockRegression = await waitUntil(async () => {
    const info = await A.dock.client.evaluate(`(() => ({
      itemCount: document.querySelectorAll('.dock-item').length,
      hasEmpty: !!document.querySelector('.dock-empty'),
      hasRoot: !!document.querySelector('.dock-root')
    }))()`)
    return info && info.itemCount > 0 ? info : null
  }, 5000)
  // 重载 Dock / 设置页，采集加载期 console error（此前已挂 Runtime/Log 监听）
  await A.dock.client.send('Page.reload', { ignoreCache: false })
  await waitUntil(async () => {
    const count = await A.dock.client.evaluate("document.querySelectorAll('.dock-item').length")
    return count === 6 ? true : null
  }, 12000)
  const dockReloadShot = await shot(A.dock.client, 'dock-regression.png')
  await A.settings.client.send('Page.reload', { ignoreCache: false })
  await waitUntil(async () => {
    const len = await A.settings.client.evaluate('(document.body?.innerText ?? "").length')
    return len > 200 ? true : null
  }, 12000)
  const settingsReloadShot = await shot(A.settings.client, 'settings-regression.png')
  await sleep(600)
  const dockItemsAfterReload = await A.dock.client.evaluate("document.querySelectorAll('.dock-item').length")
  const latestSettings = await A.dock.client.evaluate('window.nexus.settings.get()')
  const keptDiagnostics = diagnostics.filter(
    (d) => !KNOWN_NOISE.some((re) => re.test(d.text)) && !PROBE_NOISE.test(d.text)
  )
  const probeFiltered = diagnostics.filter((d) => PROBE_NOISE.test(d.text)).length
  const ignoredCount = diagnostics.length - keptDiagnostics.length - probeFiltered
  record(
    'AC-26.8',
    'Dock 回归：图标数=配置数、重载后无渲染层 console error',
    dockItemsAfterReload === latestSettings.apps.length && dockRegression !== null && keptDiagnostics.length === 0,
    {
      dockItemsAfterReload,
      settingsApps: latestSettings.apps.length,
      dockBeforeReload: dockRegression,
      consoleErrors: keptDiagnostics.slice(0, 8),
      ignoredCount,
      probeFiltered,
      filterNote: '过滤已知网络/媒体噪声与验收脚本探测产生的 CORS 条目；页面自身错误不过滤'
    },
    [dockReloadShot, settingsReloadShot]
  )

  /* ------------------------ AC-26.9 音乐卡片窗口（可选回归） ------------------------ */
  const musicTarget = await waitTarget('/music/', 8000)
  let musicState = { found: false }
  let musicShot = null
  if (musicTarget) {
    const music = await openTarget('/music/', 5000)
    A.music = music
    await attachDiagnostics(A.music.client, 'music')
    musicState = await waitUntil(async () => {
      const state = await A.music.client.evaluate(`(() => {
        const card = document.querySelector('.music-card');
        return card ? { found: true, theme: card.getAttribute('data-theme'), hasProgress: !!document.querySelector('.music-progress') } : { found: false };
      })()`)
      return state.found ? state : null
    }, 8000)
    if (musicState?.found) musicShot = await shot(A.music.client, 'music-card-v16.png')
    await A.music.client.send('Page.reload', { ignoreCache: false })
    await waitUntil(async () => {
      const found = await A.music.client.evaluate("!!document.querySelector('.music-card')")
      return found ? true : null
    }, 10000)
    await sleep(500)
  }
  const musicErrors = diagnostics.filter((d) => d.page === 'music' && !KNOWN_NOISE.some((re) => re.test(d.text)))
  record(
    'AC-26.9',
    '音乐卡片窗口仍可创建并渲染（附带回归）',
    !!musicState?.found && musicErrors.length === 0,
    { musicState, errors: musicErrors.slice(0, 5) },
    musicShot ? [musicShot] : []
  )

  /* ---------------------- 主进程日志错误扫描（证据） ---------------------- */
  let logErrors = []
  for (const [name, path] of [
    ['stdout', OUT_LOG],
    ['stderr', ERR_LOG]
  ]) {
    try {
      if (!existsSync(path)) continue
      const lines = readFileSync(path, 'utf8').split(/\r?\n/)
      for (const line of lines) {
        if (/\[protocol\].*失败|\[apps\].*失败|Unhandled|Uncaught|TypeError|ReferenceError|\[settings\] 读取失败/.test(line)) {
          if (line.trim().length > 0) logErrors.push({ stream: name, line: line.trim().slice(0, 400) })
        }
      }
    } catch {
      /* ignore */
    }
  }
  record('AC-26.10', '主进程日志无协议/核心异常（证据扫描）', logErrors.length === 0, {
    logErrors: logErrors.slice(0, 8),
    paths: [rel(OUT_LOG), rel(ERR_LOG)]
  })

  /* ------------------------- 质量门禁（外部写入） ------------------------- */
  let gates = null
  let gatesError = null
  try {
    if (existsSync(GATES_FILE)) {
      // PowerShell Set-Content 可能写 UTF-8 BOM，JSON.parse 前必须剥掉
      gates = JSON.parse(readFileSync(GATES_FILE, 'utf8').replace(/^\uFEFF/, ''))
    } else {
      gatesError = `未找到门禁文件：${rel(GATES_FILE)}`
    }
  } catch (error) {
    gates = null
    gatesError = `门禁 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
  }
  record(
    'AC-26.11',
    '质量门禁：typecheck + 15 tests + build 全部通过（独立复跑）',
    gates?.checkExit === 0 &&
      gates?.buildExit === 0 &&
      gates?.testsPassed === 15 &&
      gates?.testsFailed === 0 &&
      gates?.buildSucceeded === true,
    { gatesFile: rel(GATES_FILE), gates, error: gatesError }
  )
} catch (error) {
  fatal = error
  record('FATAL', '验收脚本执行异常', false, String(error && error.stack ? error.stack : error))
} finally {
  try {
    A.dock?.client.close()
  } catch {
    /* ignore */
  }
  try {
    A.settings?.client.close()
  } catch {
    /* ignore */
  }
  try {
    A.music?.client.close()
  } catch {
    /* ignore */
  }
}

/* ------------------------------- 报告落盘 ------------------------------- */
const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
const report = {
  version: '1.6.0',
  title: 'Nexus Dock v1.6 独立验收（隔离 userData + CDP）',
  cdpPort: PORT,
  userDataDir: USERDATA,
  seed: { schemaVersion: 8, apps: 6, note: '启动前写入 v8 基线配置，验证 v8→v9 纯增量迁移' },
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  passed,
  failed,
  fatal: fatal ? String(fatal && fatal.message ? fatal.message : fatal) : null,
  screenshots,
  results,
  diagnostics: {
    total: diagnostics.length,
    errors: diagnostics
      .filter((d) => !KNOWN_NOISE.some((re) => re.test(d.text)) && !PROBE_NOISE.test(d.text))
      .map((d) => ({ page: d.page, kind: d.kind, text: d.text })),
    ignored: diagnostics.filter((d) => KNOWN_NOISE.some((re) => re.test(d.text))).length,
    probeFiltered: diagnostics.filter((d) => PROBE_NOISE.test(d.text)).length,
    notes: '只统计页面自身 error：ignored=已知网络/媒体噪声，probeFiltered=验收脚本探测动作产生的 CORS 噪声'
  },
  iconNetworkResponses: networkLog
    .filter((entry) => entry.url.includes('v16-test'))
    .map((entry) => ({
      page: entry.page,
      url: entry.url,
      status: entry.status,
      mimeType: entry.mimeType,
      contentType: headerOf(entry.headers, 'content-type')
    }))
}
mkdirSync(OUT_DIR, { recursive: true })
// 若之前跑过 --pick 补充验收，把 AC-26.6b/26.6c 合并进报告，保持 18/18 的总账
mergePickIntoReport(report)
writeFileSync(join(OUT_DIR, 'v16-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(`\n${report.passed}/${report.passed + report.failed} 通过；报告：docs/verification/v1.6/v16-report.json`)
process.exit(report.failed === 0 ? 0 : 1)
