import { app, dialog, nativeImage, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import {
  normalizeCustomIcon,
  normalizeCustomName,
  type AppCustomPatch,
  type DockItem,
  type LaunchResult,
  type PickIconResult
} from '@shared/types'
import { logToFile } from './logger'
import { iconsDir } from './protocol'
import { getSettings, updateSettings } from './settingsStore'
import { openSettingsWindow } from './windowManager'

const ICON_CACHE = new Map<string, string>()
const EXE_BY_ID = new Map<string, string>()
let runningTimer: NodeJS.Timeout | null = null
/**
 * 运行态检测轮询间隔（v1.4 从 4s 放宽到 10s）：
 * 每次要 spawn 一个 tasklist.exe，4s 间隔≈每天 2.1 万次；10s 降到约 8.6 千次，
 * 指示点延迟 10s 内可接受，且显著减少瞬时进程与 CPU 抖动。
 */
const RUNNING_POLL_INTERVAL_MS = 10_000
/** 当前进程是否以受限（Low）完整性级别运行：此时 Windows 会拒绝启动 UWP/抢前台 */
let lowIntegrity = false

export function isLowIntegrity(): boolean {
  return lowIntegrity
}

const hash = (input: string): string => createHash('sha1').update(input).digest('hex').slice(0, 12)

/** 启动链路日志（排查「点了没反应」），统一走 logger：带 1MB 轮转、异步写、失败静默 */
function logLaunch(message: string): void {
  logToFile('launch', message)
}

/** 子进程可能拿不到完整环境变量（TEMP/ProgramData 为空会让开始菜单路径失效） */
function psEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TEMP: process.env['TEMP'] || tmpdir(),
    TMP: process.env['TMP'] || tmpdir(),
    APPDATA: process.env['APPDATA'] || app.getPath('appData'),
    LOCALAPPDATA: process.env['LOCALAPPDATA'] || app.getPath('appData'),
    ProgramData: process.env['ProgramData'] || 'C:\\ProgramData'
  }
}

/** 用 -EncodedCommand 执行 PowerShell，避免命令行引号/中文转义问题 */
function runPowerShell(script: string, timeoutMs = 20000): Promise<string> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, env: psEnv() }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(stdout)
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (!stdout && stderr) console.warn('[apps] PowerShell 无输出：', stderr.slice(0, 400))
      resolve(stdout)
    })
  })
}

/** 从可执行文件提取大图标，落盘到 userData/icons 并返回 icon:// URL（带缓存） */
export async function ensureIcon(exePath: string): Promise<string> {
  if (!exePath) return ''
  const key = exePath.toLowerCase()
  const cached = ICON_CACHE.get(key)
  if (cached) return cached
  const name = `${hash(key)}.png`
  const file = join(iconsDir(), name)
  if (!existsSync(file)) {
    try {
      const image = await app.getFileIcon(exePath, { size: 'large' })
      if (image.isEmpty()) return ''
      mkdirSync(iconsDir(), { recursive: true })
      writeFileSync(file, image.toPNG())
    } catch (error) {
      console.warn('[apps] 图标提取失败：', exePath, error)
      return ''
    }
  }
  if (!existsSync(file)) return ''
  const url = `icon://${name}`
  ICON_CACHE.set(key, url)
  return url
}

interface StartAppEntry {
  Name?: string
  AppID?: string
}

/* ------------------------- v1.6 自定义显示名称 / 图标 ------------------------- */

/** 用户选择图标的上限：8MB（超过拒绝，避免把一张几十 MB 的壁纸塞进图标缓存） */
const CUSTOM_ICON_MAX_BYTES = 8 * 1024 * 1024
/** 图标规范化的最长边 px：Dock 图标最大 80px，256px 足够 3x 屏且显著减小文件 */
const CUSTOM_ICON_MAX_EDGE = 256
/** nativeImage 解不了、但 Chromium <img> 能直接渲染的位图扩展名（原样复制兜底） */
const RASTER_ICON_EXTENSIONS = new Set(['.ico', '.bmp', '.gif'])

/**
 * 选择一张本地图片作为 Dock 图标。
 * 取消选择返回 { ok:false, error:'canceled' }，UI 据此区分「取消」与「失败」。
 */
export async function pickCustomIcon(): Promise<PickIconResult> {
  const result = await dialog.showOpenDialog({
    title: '选择自定义图标图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'ico', 'gif', 'svg'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'canceled' }
  return importCustomIcon(result.filePaths[0])
}

/**
 * 把用户选择的图片规范化后复制到 userData/icons，返回可直接写入 DockItem.customIcon 的 icon:// URL。
 * 复制而不是引用原路径：原图片被移动/删除后 Dock 图标仍然可用。
 */
export async function importCustomIcon(filePath: string): Promise<PickIconResult> {
  try {
    const info = statSync(filePath)
    if (!info.isFile()) return { ok: false, error: '选择的不是文件' }
    if (info.size <= 0) return { ok: false, error: '图片文件为空' }
    if (info.size > CUSTOM_ICON_MAX_BYTES) return { ok: false, error: '图片超过 8MB，请先压缩后再选择' }
    const ext = extname(filePath).toLowerCase()
    mkdirSync(iconsDir(), { recursive: true })

    // 1) SVG：文本图标原样保存（Chromium 可直接渲染矢量图，缩放不糊）
    if (ext === '.svg') {
      const text = readFileSync(filePath, 'utf8')
      if (!/<svg[\s>]/i.test(text)) return { ok: false, error: 'SVG 文件内容无效' }
      const name = `custom-${createHash('sha1').update(text).digest('hex').slice(0, 12)}.svg`
      writeFileSync(join(iconsDir(), name), text, 'utf8')
      return { ok: true, icon: `icon://${name}` }
    }

    // 2) 常见位图：nativeImage 解码 → 最长边缩到 ≤256px → 统一转 PNG
    const image = nativeImage.createFromPath(filePath)
    if (!image.isEmpty()) {
      const size = image.getSize()
      const longest = Math.max(size.width, size.height)
      const normalized =
        longest > CUSTOM_ICON_MAX_EDGE
          ? image.resize({
              width: Math.max(1, Math.round((size.width * CUSTOM_ICON_MAX_EDGE) / longest)),
              height: Math.max(1, Math.round((size.height * CUSTOM_ICON_MAX_EDGE) / longest)),
              quality: 'best'
            })
          : image
      const png = normalized.toPNG()
      if (png.length === 0) return { ok: false, error: '无法解析该图片' }
      const name = `custom-${createHash('sha1').update(png).digest('hex').slice(0, 12)}.png`
      writeFileSync(join(iconsDir(), name), png)
      logLaunch(`自定义图标已导入：${basename(filePath)} → ${name}（${png.length}B）`)
      return { ok: true, icon: `icon://${name}` }
    }

    // 3) nativeImage 不支持的位图格式（个别 ICO/GIF/BMP）：原样复制，扩展名白名单保证可渲染。
    // PNG/JPG/WebP 若 nativeImage 都解不了，说明文件已损坏 → 走下面的明确报错，不静默复制坏文件。
    if (RASTER_ICON_EXTENSIONS.has(ext)) {
      const bytes = readFileSync(filePath)
      if (bytes.length === 0) return { ok: false, error: '图片文件为空' }
      const name = `custom-${createHash('sha1').update(bytes).digest('hex').slice(0, 12)}${ext}`
      writeFileSync(join(iconsDir(), name), bytes)
      logLaunch(`自定义图标已复制：${basename(filePath)} → ${name}（${bytes.length}B）`)
      return { ok: true, icon: `icon://${name}` }
    }

    return { ok: false, error: '无法解析该图片（文件可能已损坏），请换一张 PNG / JPG / WebP / ICO / SVG' }
  } catch (error) {
    console.warn('[apps] 导入自定义图标失败：', filePath, error)
    return {
      ok: false,
      error: `读取图片失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * 修改单个 Dock 条目的显示名称 / 图标（v1.6）。
 * undefined = 该字段不修改；null / '' = 清空并恢复默认。返回最新的应用列表（所有窗口经广播同步）。
 */
export function updateAppCustom(id: string, patch: AppCustomPatch): DockItem[] {
  const current = getSettings().apps
  const target = current.find((item) => item.id === id)
  if (!target) return current
  const customName =
    patch.customName === undefined ? target.customName : normalizeCustomName(patch.customName)
  const customIcon =
    patch.customIcon === undefined ? target.customIcon : normalizeCustomIcon(patch.customIcon)
  if (customName === target.customName && customIcon === target.customIcon) return current
  const next = current.map((item) => (item.id === id ? { ...item, customName, customIcon } : item))
  logLaunch(
    `自定义显示已更新 id=${id} name=${JSON.stringify(customName ?? '')} icon=${customIcon ?? '(默认)'}`
  )
  return updateSettings({ apps: next }).apps
}

const START_APPS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$items = Get-StartApps | Select-Object Name, AppID
$json = ConvertTo-Json -InputObject @($items) -Compress -Depth 3
# 用 Base64(UTF-8) 输出，规避 PS 5.1 重定向时的 GBK 乱码
[Console]::Out.Write('B64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
`

/** 解码 PowerShell 输出：优先 B64: 前缀（UTF-8 Base64），否则按原样返回 */
function decodePowerShellOutput(output: string): string {
  const text = output.trim()
  if (text.startsWith('B64:')) {
    try {
      return Buffer.from(text.slice(4), 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return text
}

const isExePath = (value: string): boolean => /\.exe$/i.test(value) && /[\\/]/.test(value)

/** .lnk 快捷方式解析成真实目标（解析失败时原样返回，避免把路径判断变成硬失败） */
function resolveShortcutTarget(pathLike: string): string {
  if (!pathLike.toLowerCase().endsWith('.lnk')) return pathLike
  try {
    return shell.readShortcutLink(pathLike).target || pathLike
  } catch {
    return pathLike
  }
}

/** 规范化绝对路径：小写比较，容忍大小写 / 斜杠差异 */
function normalizePath(pathLike: string): string {
  try {
    return resolve(pathLike).toLowerCase()
  } catch {
    return pathLike.toLowerCase()
  }
}

/**
 * 判断 Dock 条目是否指向 Nexus Dock 自身（v1.4.1）。
 *
 * 用户常把安装版 NexusDockApp.exe 自己加进 Dock 当「设置入口」；点击它时
 * 预期是打开设置面板，而不是再拉起一个实例（单实例锁会静默退出）。
 * 用当前进程 exe 路径比对（而非名称猜测），同时兼容 aumid 存 exe 路径与 .lnk 快捷方式。
 */
export function isSelfApp(item: DockItem): boolean {
  const selfPaths = new Set([app.getPath('exe'), process.execPath].filter(Boolean).map(normalizePath))
  const candidates = [item.path, item.aumid].filter(
    (value): value is string =>
      typeof value === 'string' && value.length > 0 && (isExePath(value) || value.toLowerCase().endsWith('.lnk'))
  )
  return candidates.some((candidate) => selfPaths.has(normalizePath(resolveShortcutTarget(candidate))))
}

/**
 * 扫描开始菜单候选应用（用 Get-StartApps，覆盖桌面程序 + UWP + Store 应用）。
 * AppID 统一通过 shell:AppsFolder 启动；若 AppID 本身是 exe 路径则顺便提取图标。
 */
export async function scanStartMenu(): Promise<DockItem[]> {
  const output = decodePowerShellOutput(await runPowerShell(START_APPS_SCRIPT))
  let entries: StartAppEntry[] = []
  if (output.trim()) {
    try {
      const parsed = JSON.parse(output.trim())
      entries = Array.isArray(parsed) ? (parsed as StartAppEntry[]) : [parsed as StartAppEntry]
    } catch (error) {
      console.warn('[apps] Get-StartApps 解析失败', error)
      entries = []
    }
  }
  const noise = /(uninstall|卸载|readme|帮助|help|documentation|website|官网|license|changelog|quick start)/i
  const seenNames = new Set<string>()
  const items: DockItem[] = []
  for (const entry of entries) {
    const name = String(entry?.Name ?? '').trim()
    const appId = String(entry?.AppID ?? '').trim()
    if (!name || !appId) continue
    if (noise.test(name)) continue
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) continue
    seenNames.add(nameKey)
    const id = `sm-${hash(`${name}|${appId}`.toLowerCase())}`
    const executable = isExePath(appId) ? appId : ''
    if (executable) EXE_BY_ID.set(id, executable)
    items.push({
      id,
      name,
      path: executable,
      aumid: appId,
      icon: executable ? await ensureIcon(executable) : '',
      source: 'startmenu'
    })
    if (items.length >= 200) break
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  if (items.length === 0) {
    console.warn('[apps] Get-StartApps 为空，回退到开始菜单快捷方式扫描')
    return scanShortcutsFallback()
  }
  return items
}

interface ShortcutEntry {
  lnk: string
  name: string
  target: string
  args?: string
}

const RESOLVE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell
$dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
$items = New-Object System.Collections.Generic.List[object]
foreach ($dir in $dirs) {
  if (-not (Test-Path $dir)) { continue }
  Get-ChildItem -Path $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if ($items.Count -ge 240) { return }
    $sc = $shell.CreateShortcut($_.FullName)
    if ($sc.TargetPath -and (Test-Path -LiteralPath $sc.TargetPath)) {
      $items.Add([pscustomobject]@{
        lnk    = $_.FullName
        name   = $_.BaseName
        target = $sc.TargetPath
        args   = [string]$sc.Arguments
      })
    }
  }
}
ConvertTo-Json -InputObject @($items) -Compress -Depth 4
`
// 兜底脚本同样用 Base64 输出，避免中文乱码
const RESOLVE_SCRIPT_B64 = RESOLVE_SCRIPT.replace(
  'ConvertTo-Json -InputObject @($items) -Compress -Depth 4',
  "$json = ConvertTo-Json -InputObject @($items) -Compress -Depth 4\n[Console]::Out.Write('B64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))"
)

/** 兜底：直接扫描开始菜单 .lnk（Get-StartApps 不可用时） */
async function scanShortcutsFallback(): Promise<DockItem[]> {
  const output = decodePowerShellOutput(await runPowerShell(RESOLVE_SCRIPT_B64))
  if (!output.trim()) return []
  let parsed: ShortcutEntry | ShortcutEntry[]
  try {
    parsed = JSON.parse(output.trim())
  } catch (error) {
    console.warn('[apps] 开始菜单 JSON 解析失败', error)
    return []
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  const noise = /(uninstall|卸载|readme|帮助|help|documentation|website|官网|license|changelog)/i
  const seen = new Set<string>()
  const items: DockItem[] = []
  for (const entry of entries) {
    if (!entry?.lnk || !entry.target) continue
    if (noise.test(entry.name) || noise.test(entry.target)) continue
    const exeName = basename(entry.target).toLowerCase()
    if (exeName === 'explorer.exe') continue
    const id = `sm-${hash(entry.lnk.toLowerCase())}`
    if (seen.has(id)) continue
    seen.add(id)
    EXE_BY_ID.set(id, entry.target)
    items.push({
      id,
      name: entry.name,
      path: entry.lnk,
      args: entry.args ? entry.args.split(/\s+/).filter(Boolean) : undefined,
      icon: await ensureIcon(entry.target),
      source: 'startmenu'
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return items
}

/** 通过文件对话框添加应用（.exe / .lnk） */
export async function pickAppFiles(): Promise<DockItem[]> {
  const result = await dialog.showOpenDialog({
    title: '选择要添加到 Dock 的应用',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '应用程序 / 快捷方式', extensions: ['exe', 'lnk'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (result.canceled) return []
  const added: DockItem[] = []
  for (const filePath of result.filePaths) {
    const id = `custom-${hash(filePath.toLowerCase())}`
    if (getSettings().apps.some((a) => a.id === id)) continue
    added.push({
      id,
      name: basename(filePath, extname(filePath)),
      path: filePath,
      icon: extname(filePath).toLowerCase() === '.exe' ? await ensureIcon(filePath) : '',
      source: 'custom'
    })
  }
  if (added.length > 0) updateSettings({ apps: [...getSettings().apps, ...added] })
  return getSettings().apps
}

export function addStartMenuItem(item: DockItem): DockItem[] {
  const current = getSettings().apps
  if (current.some((a) => a.id === item.id)) return current
  // 若 AppID 本身是 exe 路径，记入运行态检测表
  if (item.aumid && isExePath(item.aumid)) EXE_BY_ID.set(item.id, item.aumid)
  return updateSettings({ apps: [...current, item] }).apps
}

export function removeApp(id: string): DockItem[] {
  return updateSettings({ apps: getSettings().apps.filter((a) => a.id !== id) }).apps
}

export function reorderApps(ids: string[]): DockItem[] {
  const map = new Map(getSettings().apps.map((a) => [a.id, a]))
  const next: DockItem[] = []
  for (const id of ids) {
    const item = map.get(id)
    if (item) {
      next.push(item)
      map.delete(id)
    }
  }
  for (const item of map.values()) next.push(item)
  return updateSettings({ apps: next }).apps
}

/** 分离式启动进程；spawn 事件触发即认为成功 */
function spawnDetached(file: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
      let settled = false
      const done = (ok: boolean): void => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      child.once('spawn', () => {
        child.unref()
        setTimeout(() => done(true), 50)
      })
      child.once('error', () => done(false))
      setTimeout(() => done(true), 900)
    } catch {
      resolve(false)
    }
  })
}

/**
 * 启动 + 验证窗口 + 置前（统一封装）。
 *
 * KIND:
 *   - 'appid'   ：用 Shell.Application COM 激活 shell:AppsFolder\<target>
 *   - 'path'    ：用 Shell.Application COM 激活文件路径
 *   - 'verify'  ：只做验证/置前（调用方已用 Electron API 启动）
 *
 * 通过 UIA 轮询顶层窗口：优先按标题 hint 匹配，其次检测「新出现的窗口」，
 * 找到后用 Microsoft.VisualBasic.Interaction.AppActivate 置前。
 * 这样既能确认真的打开了（避免假成功），也满足「点了要叫到前台」的需求。
 */
function launchAndFocus(
  kind: 'appid' | 'path' | 'verify',
  target: string,
  hint: string,
  procName = ''
): Promise<{
  found: boolean
  /** 启动命令已发出但窗口没在时限内被扫描到（不代表启动失败） */
  launchedNoWindow: boolean
  title: string
  activated: boolean
  pid: number
  output: string
}> {
  const escape = (value: string): string => value.replace(/'/g, "''")
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NexusFg2 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
} catch { }

function Get-Wins {
  $list = @()
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $all) {
      try {
        $name = [string]$w.Current.Name
        if (-not $name) { continue }
        $pwid = [int]$w.Current.ProcessId
        $pname = ''
        try { $pname = [string](Get-Process -Id $pwid -ErrorAction SilentlyContinue).ProcessName } catch { }
        $list += [pscustomobject]@{ Pid = $pwid; Name = $name; Hwnd = [int64]$w.Current.NativeWindowHandle; Proc = $pname }
      } catch { }
    }
  } catch { }
  return $list
}

$selfTitles = 'NexusDockApp|Nexus Dock|Nexus Music|Nexus 设置|Nexus 时钟'
# Program Manager 是桌面窗口（属于 explorer 进程），不能被当成资源管理器窗口置前
$badTitles = 'Application Error|应用程序无法正常启动|0xc0000142|^Program Manager$'

function Test-TargetWindow($w, $hint, $procName) {
  if ($w.Name -match $badTitles) { return $false }
  if ($w.Name -match $selfTitles) { return $false }
  if ($procName -and $w.Proc -and ($w.Proc -ieq $procName)) { return $true }
  if ($hint -and ($w.Name -match $hint)) { return $true }
  return $false
}

function Test-Foreground($w) {
  try {
    $fg = [NexusFg2]::GetForegroundWindow()
    if ([int64]$fg -eq [int64]$w.Hwnd) { return $true }
    $fgPid = [uint32]0
    [void][NexusFg2]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    if ([int]$fgPid -eq [int]$w.Pid) { return $true }
  } catch { }
  return $false
}

function Activate-Win($w) {
  for ($i = 0; $i -lt 3; $i++) {
    try {
      $hwnd = [IntPtr]$w.Hwnd
      [void][NexusFg2]::AllowSetForegroundWindow($w.Pid)
      # v1.3.1 修复：只在窗口已最小化时 SW_RESTORE（9）。
      # 旧逻辑无条件 ShowWindow(9) 会把「已最大化」的窗口还原成普通窗口，
      # 表现为点 Dock 图标时先看到最大化窗口、随后又变回普通窗口。
      # 最大化/普通窗口只做置前，不改变显示状态；最小化窗口恢复时 Windows 会自动回到最小化前的最大化状态。
      if ([NexusFg2]::IsIconic($hwnd)) {
        [void][NexusFg2]::ShowWindow($hwnd, 9)
      }
      [void][NexusFg2]::BringWindowToTop($hwnd)
      [void][NexusFg2]::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 140
      if (Test-Foreground $w) { return $true }

      [NexusFg2]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [NexusFg2]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 90
      [void][NexusFg2]::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 140
      if (Test-Foreground $w) { return $true }

      try { [Microsoft.VisualBasic.Interaction]::AppActivate($w.Pid) } catch { }
      Start-Sleep -Milliseconds 160
      if (Test-Foreground $w) { return $true }

      [void][NexusFg2]::SwitchToThisWindow($hwnd, $true)
      Start-Sleep -Milliseconds 160
      if (Test-Foreground $w) { return $true }
    } catch { }
  }
  return $false
}

$kind = '${kind}'
$target = '${escape(target)}'
$hint = '${escape(hint)}'
$procName = '${escape(procName)}'

# 1) 已有窗口（含最小化）：先激活，避免启动第二个实例
$before = Get-Wins
$beforeKeys = @($before | ForEach-Object { "$($_.Pid)|$($_.Name)" })
foreach ($w in $before) {
  if (Test-TargetWindow $w $hint $procName) {
    $fgOk = Activate-Win $w
    [Console]::Out.Write('FOUND:' + $w.Name + '|fg=' + [int]$fgOk + '|pid=' + $w.Pid)
    exit 0
  }
}

# 2) 启动
$attempted = $false
if ($kind -eq 'appid' -or $kind -eq 'path') {
  $attempted = $true
  try {
    $shell = New-Object -ComObject Shell.Application
    if ($kind -eq 'appid') {
      $shell.ShellExecute('shell:AppsFolder\' + $target)
    } else {
      $shell.ShellExecute($target)
    }
  } catch { }
}

# 3) 等待窗口出现（最多约 6 秒）
$found = $null
for ($i = 0; $i -lt 18; $i++) {
  Start-Sleep -Milliseconds 350
  $wins = Get-Wins
  foreach ($w in $wins) {
    if (Test-TargetWindow $w $hint $procName) { $found = $w; break }
  }
  if ($null -ne $found) { break }
}

if ($null -eq $found) {
  if ($attempted) { [Console]::Out.Write('LAUNCHED_NO_WINDOW') } else { [Console]::Out.Write('NONE') }
} else {
  $fgOk = Activate-Win $found
  [Console]::Out.Write('FOUND:' + $found.Name + '|fg=' + [int]$fgOk + '|pid=' + $found.Pid)
}
`
  return runPowerShell(script, 16000)
    .then((output) => {
      const match = /FOUND:([\s\S]*?)\|fg=([01])\|pid=(\d+)/i.exec(output)
      return {
        found: !!match,
        launchedNoWindow: !match && /LAUNCHED_NO_WINDOW/.test(output),
        title: match ? match[1].trim() : '',
        activated: match ? match[2] === '1' : false,
        pid: match ? Number(match[3]) : 0,
        output
      }
    })
    .catch((error: unknown) => ({
      found: false,
      launchedNoWindow: false,
      title: '',
      activated: false,
      pid: 0,
      output: String(error)
    }))
}

/** 判断某个 exe 是否已经在运行（用于避免重复启动造成权限冲突弹窗） */
async function isProcessRunning(exePath: string): Promise<boolean> {
  const name = basename(exePath, extname(exePath))
  if (!name) return false
  const output = await runPowerShell(
    `$ErrorActionPreference='SilentlyContinue'; @(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Count`,
    8000
  )
  const count = Number(String(output).trim())
  return Number.isFinite(count) && count > 0
}
/** 根据应用名称给出窗口标题匹配用的正则（窗口标题通常和显示名不同） */
function titleHintFor(item: DockItem): string {
  const map: Record<string, string> = {
    explorer: '此电脑|文件资源管理器|Explorer|File Explorer|主文件夹|快速访问|下载|文档|桌面|Home',
    notepad: '记事本|Notepad',
    calc: '计算器|Calculator',
    paint: '画图|Paint',
    settings: '设置|Settings',
    cmd: '命令提示符|Command Prompt|cmd',
    weixin: '微信|WeChat|Weixin',
    msedge: 'Edge'
  }
  const key = item.name.toLowerCase()
  const byId = map[item.id]
  if (byId) return byId
  for (const [name, hint] of Object.entries(map)) {
    if (key.includes(name)) return hint
  }
  // 兜底：用应用名本身
  return item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 启动应用并尽量把窗口置前；返回真实结果（找不到窗口则 ok:false，不再假成功）。
 */
export async function launchApp(id: string): Promise<LaunchResult> {
  const item = getSettings().apps.find((a) => a.id === id)
  if (!item) {
    logLaunch(`launch id=${id} → 应用不存在`)
    return { ok: false, error: '应用不存在' }
  }
  logLaunch(`launch id=${id} name=${item.name} path=${item.path} aumid=${item.aumid ?? ''}`)
  // 自身图标（NexusDockApp.exe）：进程已在运行，再启动会被单实例锁静默退出；
  // 用户把它加进 Dock 当「设置入口」，点击预期是打开设置面板（v1.4.1）。
  if (isSelfApp(item)) {
    logLaunch('  → 识别为 Nexus Dock 自身：打开设置面板')
    openSettingsWindow()
    return { ok: true }
  }
  const errors: string[] = []
  const hint = titleHintFor(item)
  const procNameFor = (p: string): string => (p ? basename(p, extname(p)) : '')

  const aumidIsExePath = !!item.aumid && isExePath(item.aumid)
  const realAppId = item.aumid && !aumidIsExePath ? item.aumid : ''
  const exePath = item.path || (aumidIsExePath ? (item.aumid as string) : '')

  const tryFocus = async (label: string): Promise<boolean> => {
    const result = await launchAndFocus('verify', '', hint, procNameFor(exePath))
    logLaunch(`  ${label} 窗口校验: found=${result.found} title=${result.title} activated=${result.activated}`)
    return result.found
  }

  // 0) 系统应用专用路径
  if (item.id === 'explorer') {
    // 通过 Shell.Application COM 打开文件夹（复用已有 Explorer，避免 0xc0000142）
    // 注意：这里不能按进程名匹配，否则会命中属于 explorer.exe 的桌面窗口（Program Manager）
    const comFolder = await launchAndFocus('path', 'C:\\', hint, '')
    logLaunch(`  explorer COM folder found=${comFolder.found} title=${comFolder.title} launched=${comFolder.launchedNoWindow}`)
    if (comFolder.found || comFolder.launchedNoWindow) return { ok: true }
    try {
      const error = await shell.openPath('C:\\')
      logLaunch(`  explorer fallback openPath=${JSON.stringify(error)}`)
      const focused = await launchAndFocus('verify', '', hint, '')
      logLaunch(`  explorer fallback focus found=${focused.found} title=${focused.title}`)
      if (focused.found) return { ok: true }
      if (!error) return { ok: true }
    } catch (error) {
      logLaunch(`  explorer fallback 异常 ${String(error)}`)
    }
    errors.push('未能打开文件资源管理器窗口')
  }
  if (item.id === 'settings') {
    const comSettings = await launchAndFocus('path', 'ms-settings:', hint)
    logLaunch(`  settings COM found=${comSettings.found} title=${comSettings.title} launched=${comSettings.launchedNoWindow}`)
    if (comSettings.found || comSettings.launchedNoWindow) return { ok: true }
    try {
      await shell.openExternal('ms-settings:')
      logLaunch('  ms-settings: openExternal 已调用')
      await tryFocus('settings')
      return { ok: true }
    } catch (error) {
      logLaunch(`  ms-settings: 失败 ${String(error)}`)
    }
    errors.push('打开系统设置失败')
  }

  // 1) UWP / Store：AppID 激活 + 校验 + 置前
  if (realAppId && item.id !== 'explorer' && item.id !== 'settings') {
    const result = await launchAndFocus('appid', realAppId, hint)
    logLaunch(`  AppID launch appId=${realAppId} found=${result.found} title=${result.title} activated=${result.activated}`)
    if (result.found) return { ok: true }
    // 兜底：shell.openPath 应用 exe（部分应用可用）
    if (exePath && existsSync(exePath)) {
      const error = await shell.openPath(exePath)
      logLaunch(`  openPath(fallback) result=${JSON.stringify(error)}`)
      if (await tryFocus('fallback')) return { ok: true }
    }
    // 激活命令已发出、窗口只是没在时限内被窗口扫描发现：按成功处理，避免误报
    if (result.launchedNoWindow) {
      logLaunch('  AppID 已激活（窗口未在时限内被扫描到，按成功处理）')
      return { ok: true }
    }
    errors.push('系统未检测到应用窗口')
  }

  // 2) 普通程序：先用 Shell.Application COM（explorer 代理，权限一致），再退回 Electron API
  if (exePath) {
    const com = await launchAndFocus('path', exePath, hint, procNameFor(exePath))
    logLaunch(`  COM(path) found=${com.found} title=${com.title} activated=${com.activated}`)
    if (com.found) return { ok: true }
  }

  // 2b) .lnk
  if (exePath && exePath.toLowerCase().endsWith('.lnk')) {
    const error = await shell.openPath(exePath)
    logLaunch(`  openPath(.lnk) result=${JSON.stringify(error)}`)
    if (await tryFocus('.lnk')) return { ok: true }
    if (error) errors.push(error)
  }

  // 3) 带参数
  if (exePath && item.args && item.args.length > 0) {
    if (await spawnDetached(exePath, item.args)) {
      logLaunch('  spawn(args) ok')
      if (await tryFocus('args')) return { ok: true }
    }
    errors.push('带参数启动失败')
  }

  // 4) 普通 exe：openPath → 校验/置前；失败再走 COM；再失败 spawn
  if (!realAppId && exePath && exePath.toLowerCase().endsWith('.exe')) {
    const error = await shell.openPath(exePath)
    logLaunch(`  openPath(.exe) result=${JSON.stringify(error)}`)
    if (await tryFocus('exe')) return { ok: true }

    const com = await launchAndFocus('path', exePath, hint, procNameFor(exePath))
    logLaunch(`  COM ShellExecute found=${com.found} title=${com.title} activated=${com.activated} launched=${com.launchedNoWindow}`)
    if (com.found || com.launchedNoWindow) return { ok: true }

    // 进程已在运行（微信/Edge 等常驻托盘）：再次 ShellExecute 已让单实例应用自行前置，
    // 不把「窗口扫描没命中」当成失败，避免用户点击时弹错误提示。
    if (await isProcessRunning(exePath)) {
      logLaunch('  检测到进程已在运行，已请求前置（按成功处理）')
      return { ok: true }
    }
    if (existsSync(exePath) && (await spawnDetached(exePath, []))) {
      logLaunch('  spawn(exe) ok')
      await tryFocus('spawn')
      return { ok: true }
    }
    errors.push('启动后未检测到窗口')
  }

  if (!realAppId && !exePath) errors.push('未配置启动路径')

  logLaunch(`  FAILED id=${id} errors=${errors.join('；')}`)
  const lowHint = lowIntegrity ? '（当前为受限权限运行：请从桌面快捷方式启动 Nexus Dock）' : ''
  return {
    ok: false,
    error: (errors.length > 0 ? errors.join('；') : '无法启动该应用（可能被系统策略或权限阻止）') + lowHint
  }
}

/** 清理旧版本误产生的「explorer.exe - Application Error」残留弹窗 */
export async function cleanupErrorDialogs(): Promise<void> {
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$closed = 0
foreach ($w in $wins) {
  try {
    if ($w.Current.Name -match 'Application Error|应用程序无法正常启动') {
      $buttons = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
      foreach ($b in $buttons) {
        try {
          if ($b.Current.Name -match '确定|OK') {
            $p = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $p.Invoke()
            $closed = $closed + 1
          }
        } catch { }
      }
    }
  } catch { }
}
[Console]::Out.Write('CLOSED=' + $closed)
`
  const output = await runPowerShell(script, 8000)
  logLaunch(`cleanupErrorDialogs: ${output.trim()}`)
}
/** 启动时记录运行环境（Low 权限下 UWP 启动/窗口置前会被系统拒绝） */
export async function probeEnvironment(): Promise<void> {
  const output = await runPowerShell(
    "$ErrorActionPreference='SilentlyContinue'; whoami /groups | Select-String 'Mandatory Label' | Out-String",
    8000
  )
  lowIntegrity = /Low Mandatory|S-1-16-4096/i.test(output)
  logLaunch(`env: lowIntegrity=${lowIntegrity}`)
  if (lowIntegrity) {
    console.warn('[apps] 当前进程为 Low 完整性级别：UWP 应用启动与窗口置前会被系统拒绝，请从桌面快捷方式启动')
  }
}

/** 补齐内置/快捷方式应用的图标（首次启动时调用一次） */
export async function hydrateIcons(): Promise<DockItem[]> {
  const apps = getSettings().apps
  let changed = false
  const next = await Promise.all(
    apps.map(async (item) => {
      if (item.icon) return item
      const fromPath = item.path && item.path.toLowerCase().endsWith('.exe') ? item.path : ''
      const fromAumid = item.aumid && isExePath(item.aumid) ? item.aumid : ''
      const executable = EXE_BY_ID.get(item.id) || fromPath || fromAumid
      if (!executable) return item
      const icon = await ensureIcon(executable)
      if (!icon) return item
      changed = true
      return { ...item, icon }
    })
  )
  if (changed) updateSettings({ apps: next })
  return getSettings().apps
}

/** 用 tasklist 一次性拿到进程名列表（比 PowerShell 快，且不受低权限 Get-Process 限制更少） */
function listTasklistNames(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true })
    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => resolve([]))
    child.on('close', () => {
      const names: string[] = []
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^"([^"]+)"/.exec(line.trim())
        // tasklist 输出的是带 .exe 的映像名，统一去掉后缀再比对
        if (match?.[1]) names.push(match[1].replace(/\.exe$/i, ''))
      }
      resolve(names)
    })
  })
}

/** UWP / 商店应用的进程名与显示名不同，这里补齐映射（用于运行指示点） */
const PROCESS_NAME_HINTS: Record<string, string[]> = {
  explorer: ['explorer'],
  notepad: ['notepad'],
  calc: ['calculatorapp', 'calculator'],
  paint: ['mspaint', 'paintapp'],
  settings: ['systemsettings'],
  cmd: ['cmd']
}

function processNamesFor(item: DockItem): string[] {
  const names = new Set<string>()
  for (const name of PROCESS_NAME_HINTS[item.id] ?? []) names.add(name)
  const remembered = EXE_BY_ID.get(item.id)
  const candidates = [remembered, item.path, item.aumid && isExePath(item.aumid) ? item.aumid : '']
  for (const candidate of candidates) {
    if (candidate) names.add(basename(candidate, extname(candidate)).toLowerCase())
  }
  const key = item.name.toLowerCase()
  if (/计算器|calculator/.test(key)) names.add('calculatorapp')
  if (/记事本|notepad/.test(key)) names.add('notepad')
  if (/画图|paint/.test(key)) names.add('mspaint')
  if (/设置|settings/.test(key)) names.add('systemsettings')
  if (/资源管理器|explorer/.test(key)) names.add('explorer')
  if (/微信|wechat|weixin/.test(key)) {
    names.add('weixin')
    names.add('wechat')
  }
  if (/edge/.test(key)) names.add('msedge')
  names.delete('')
  return [...names]
}

/** 轮询运行进程，返回 { appId: 是否运行 } */
async function collectRunning(): Promise<Record<string, boolean>> {
  const allNames = await listTasklistNames()
  // 进程列表异常（沙盒下可能只看到极少数进程）时宁可不上报，也不要把指示点全部误判为「未运行」
  if (allNames.length < 5) {
    console.warn('[apps] 进程列表过少（仅', allNames.length, '项），跳过本次运行态更新')
    return {}
  }
  const names = new Set(allNames.map((name) => name.toLowerCase()))
  const result: Record<string, boolean> = {}
  for (const item of getSettings().apps) {
    result[item.id] = processNamesFor(item).some((name) => names.has(name))
  }
  return result
}

export function startRunningMonitor(emit: (running: Record<string, boolean>) => void): void {
  const tick = async (): Promise<void> => {
    try {
      const running = await collectRunning()
      // 采集失败（空表）时跳过本次广播，避免把指示点全部误清空
      if (Object.keys(running).length > 0) emit(running)
    } catch (error) {
      console.warn('[apps] 运行态检测失败', error)
    }
  }
  void tick()
  if (runningTimer) clearInterval(runningTimer)
  runningTimer = setInterval(() => {
    void tick()
  }, RUNNING_POLL_INTERVAL_MS)
}

export function stopRunningMonitor(): void {
  if (runningTimer) {
    clearInterval(runningTimer)
    runningTimer = null
  }
}

export function rememberExe(id: string, exePath: string): void {
  EXE_BY_ID.set(id, exePath)
}
