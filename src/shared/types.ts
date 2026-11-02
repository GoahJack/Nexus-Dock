/**
 * Nexus Dock — 共享契约（主进程 / preload / 渲染进程 唯一真源）
 * 修改此文件后必须同步检查：src/main/ipc.ts、src/preload/index.ts、各渲染层。
 */

export type DockEdge = 'bottom' | 'top' | 'left' | 'right'
export type ThemeMode = 'dark' | 'light'
export type ProgressStyle = 'bar' | 'ring'
export type MusicAnchor = 'dock' | 'free'
export type MediaSource = 'system' | 'local'
export type PlaybackStatus = 'playing' | 'paused' | 'stopped'
export type WindowTarget = 'dock' | 'music' | 'settings' | 'clock'
export type MediaAction = 'playpause' | 'next' | 'prev' | 'seek'
/** v1.0 动效强度：轻快 / 标准 / 弹性（见 docs/motion-spec.md） */
export type MotionIntensity = 'light' | 'standard' | 'expressive'

/** 开机自启操作结果（v1.1；仅安装版可写系统登录项） */
export interface AutoStartResult {
  ok: boolean
  /** 操作系统实际状态（失败时用于把开关回滚到真实值） */
  autoStart: boolean
  /** 失败原因：dev = 开发模式不可用；os = 写入后回读不一致；其余为异常文本 */
  reason?: string
}

/** 屏幕边距：Dock / 音乐卡片与屏幕边缘的距离（px） */
export const SCREEN_MARGIN = 12

export interface DockItem {
  id: string
  /** 原始名称（添加应用时得到）：用于启动窗口匹配、恢复默认显示名，不要被自定义名称覆盖 */
  name: string
  /**
   * v1.6 自定义显示名称：非空则 Dock / 设置列表显示它；缺省或空字符串 = 使用原始 name。
   * 与 name 分离是为了不破坏标题匹配（titleHintFor）与「恢复默认」能力。
   */
  customName?: string
  /** 可执行文件或 .lnk 快捷方式路径；UWP 应用可为空字符串 */
  path: string
  /** UWP/打包应用的 AppUserModelID（通过 shell:AppsFolder 启动，兼容计算器/记事本等） */
  aumid?: string
  args?: string[]
  /** 图标：'icon://<hash>.png' 或 data URL；空字符串表示使用字母占位图标 */
  icon?: string
  /**
   * v1.6 自定义显示图标：'icon://<hash>.png'（用户选择的图片已复制到 userData/icons）或 data URL；
   * 缺省/空字符串 = 使用 icon（自动提取的应用图标）。恢复默认只需清空该字段。
   */
  customIcon?: string
  source: 'builtin' | 'startmenu' | 'custom'
}

/** v1.6 自定义显示信息补丁：undefined = 不修改，null / '' = 恢复默认 */
export interface AppCustomPatch {
  customName?: string | null
  customIcon?: string | null
}

/** v1.6 选择自定义图标的结果（取消选择时 ok=false 且 error='canceled'） */
export interface PickIconResult {
  ok: boolean
  /** 成功时为可直接写入 DockItem.customIcon 的 icon:// URL */
  icon?: string
  error?: string
}

/** 自定义显示名称最大长度（按 Unicode 码点计，避免截断 emoji） */
export const CUSTOM_NAME_MAX_LENGTH = 48
/** 自定义图标 data URL 长度上限（防止 settings.json 被超大图片撑爆；正常导入走 icon:// 文件） */
export const CUSTOM_ICON_DATA_URL_MAX_LENGTH = 2_000_000

/** 收敛自定义名称：去控制字符 / 首尾空白，空串或非字符串返回 undefined */
export function normalizeCustomName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) return undefined
  return Array.from(cleaned).slice(0, CUSTOM_NAME_MAX_LENGTH).join('')
}

/** 收敛自定义图标：只接受本地图标缓存 icon:// 或 data:image/，其余一律丢弃 */
export function normalizeCustomIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('icon://') && trimmed.length <= 512) return trimmed
  if (trimmed.startsWith('data:image/') && trimmed.length <= CUSTOM_ICON_DATA_URL_MAX_LENGTH) return trimmed
  return undefined
}

/** Dock / 设置列表实际显示的文本：自定义名称优先，回退原始名称 */
export function displayNameOf(item: DockItem): string {
  return normalizeCustomName(item.customName) ?? item.name
}

/** Dock / 设置列表实际显示的图标 URL：自定义图标优先，回退自动提取的图标 */
export function displayIconOf(item: DockItem): string {
  return normalizeCustomIcon(item.customIcon) ?? (typeof item.icon === 'string' ? item.icon.trim() : '')
}

export interface DockConfig {
  edge: DockEdge
  /** 沿停靠边的位置百分比：0 = 左/上端，100 = 右/下端 */
  alongPercent: number
  /** true = 吸附到屏幕边缘；false = 拖到哪停在哪（自由定位，默认） */
  snapToEdge: boolean
  /** 自由定位时的屏幕坐标（窗口左上角，DIP） */
  freeX: number
  freeY: number
  /** 只在桌面（无最大化/全屏窗口）时显示 Dock */
  onlyOnDesktop: boolean
  /** 图标基础尺寸 px */
  iconSize: number
  /** 悬停放大倍率 */
  magnification: number
  /** 图标间距 px */
  gap: number
  /** 底条内边距 px */
  padding: number
  /** 显示运行状态指示点 */
  showIndicators: boolean
  /** 窗口始终置顶 */
  alwaysOnTop: boolean
  /** 系统亚克力材质（Win11 22H2+，开启后为矩形玻璃，可能覆盖圆角） */
  acrylic: boolean
  /** 底条背景不透明度 0–1（0 = 完全透明，只留图标） */
  opacity: number
  theme: ThemeMode
}

export interface MusicConfig {
  visible: boolean
  /** 音乐来源：system = Windows 系统媒体会话(SMTC)；local = 内置本地播放器 */
  source: MediaSource
  /** dock = 跟随 Dock 位置；free = 使用 freeX/freeY 自由定位 */
  anchor: MusicAnchor
  /** 拖动松手后是否吸附到最近屏幕边（v1.1，默认 true = v1.0 既有行为）；false = 拖到哪停在哪 */
  snapToEdge: boolean
  edge: DockEdge
  alongPercent: number
  freeX: number
  freeY: number
  width: number
  progressStyle: ProgressStyle
  /** 窗口始终置顶（v1.3，默认 true；共性项，在设置「系统」页统一管理） */
  alwaysOnTop: boolean
  /** 仅在桌面显示：前台窗口最大化/全屏时自动隐藏（v1.3，默认 false 以保留旧行为） */
  onlyOnDesktop: boolean
  /** 卡片主题（v1.4，默认深色以保持既有观感；与 Dock/时钟同一套 ThemeMode） */
  theme: ThemeMode
}

/** v1.1 桌面时钟配置（v1.2 起所有悬浮窗口都必须提供 snapToEdge 吸附开关，见 docs/window-conventions.md） */
export interface ClockConfig {
  /** 显示桌面时钟窗口（默认隐藏） */
  visible: boolean
  /** 显示秒 */
  showSeconds: boolean
  /** 显示日期 */
  showDate: boolean
  /** 12 小时制（默认 false = 24 小时制） */
  hour12: boolean
  /** 时间字号 px（28–96） */
  fontSize: number
  /** 整体透明度 0.2–1 */
  opacity: number
  /** 始终置顶 */
  alwaysOnTop: boolean
  /** 仅在桌面显示：前台窗口最大化/全屏时自动隐藏（v1.3，默认 false 以保留旧行为） */
  onlyOnDesktop: boolean
  /** 拖动松手后是否吸附到最近屏幕边（v1.2，默认 true）；false = 拖到哪停在哪 */
  snapToEdge: boolean
  theme: ThemeMode
  /** 自由位置（屏幕 DIP，窗口左上角）；-1 = 未定位 → 主屏右上角 */
  freeX: number
  freeY: number
}

/** v1.1 窗口位置锁定：三个悬浮窗独立锁定；「锁定全部」总开关在 UI 层按三者是否全锁推导 */
export interface LockConfig {
  dock: boolean
  music: boolean
  clock: boolean
}

/** v1.1 系统行为配置 */
export interface SystemConfig {
  /** 开机自启：写入 Windows 当前用户登录启动项（仅安装版生效，见 AutoStartResult） */
  autoStart: boolean
}

/** v1.0 外观与动效配置（详见 docs/motion-spec.md） */
export interface AppearanceConfig {
  /** 动效强度：light = 轻快（×0.72、无过冲）/ standard = 标准 / expressive = 弹性（×1.28、明显过冲） */
  motionIntensity: MotionIntensity
  /** 用户强制减少动效（与系统 prefers-reduced-motion 等价） */
  reducedMotion: boolean
  /** 点击音效（WebAudio 合成短音，默认关闭） */
  clickSound: boolean
}

export interface Settings {
  schemaVersion: number
  dock: DockConfig
  music: MusicConfig
  clock: ClockConfig
  lock: LockConfig
  system: SystemConfig
  appearance: AppearanceConfig
  apps: DockItem[]
}

export interface MediaState {
  source: MediaSource
  status: PlaybackStatus
  title: string
  artist: string
  album: string
  /** 封面：data: URL / 'media://' / '' */
  artUrl: string
  positionMs: number
  durationMs: number
  canNext: boolean
  canPrev: boolean
  /** SMTC 播放器 AppId，便于排障 */
  appId: string
  updatedAt: number
}

export interface LocalTrack {
  path: string
  title: string
}

export interface LaunchResult {
  ok: boolean
  error?: string
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const IPC = {
  /* 设置 */
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsChanged: 'settings:changed',
  /* 系统 */
  systemSetAutoStart: 'system:setAutoStart',
  /* 应用 */
  appsList: 'apps:list',
  appsLaunch: 'apps:launch',
  appsRemove: 'apps:remove',
  appsAddByDialog: 'apps:addByDialog',
  appsReorder: 'apps:reorder',
  appsMenu: 'apps:menu',
  appsScanStartMenu: 'apps:scanStartMenu',
  appsAddFromStartMenu: 'apps:addFromStartMenu',
  appsRunning: 'apps:running',
  appsContextMenuDock: 'apps:contextMenuDock',
  /* v1.6 自定义显示名称 / 图标 */
  appsUpdateItem: 'apps:updateItem',
  appsPickIcon: 'apps:pickIcon',
  appsRequestEdit: 'apps:requestEdit',
  appsConsumeEditRequest: 'apps:consumeEditRequest',
  appsEditRequest: 'apps:editRequest',
  /* 窗口 / 布局 */
  windowSetContentSize: 'window:setContentSize',
  windowOpenSettings: 'window:openSettings',
  windowCloseSettings: 'window:closeSettings',
  windowMinimizeSettings: 'window:minimizeSettings',
  windowQuit: 'window:quit',
  windowCapture: 'window:capture',
  windowSetIgnoreMouse: 'window:setIgnoreMouse',
  dockSnap: 'dock:snap',
  /* 媒体 */
  mediaGetState: 'media:getState',
  mediaControl: 'media:control',
  mediaPickFiles: 'media:pickFiles',
  mediaUpdate: 'media:update',
  mediaSetLocalState: 'media:setLocalState',
  mediaTracks: 'media:tracks'
} as const

/** 默认内置应用（AppID 来自本机 Get-StartApps，统一用 shell:AppsFolder 启动最可靠） */
export const DEFAULT_APPS: DockItem[] = [
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

export const DEFAULT_SETTINGS: Settings = {
  // v9（v1.6）：Dock 应用支持自定义显示名称 / 图标（customName / customIcon，可选字段）
  schemaVersion: 9,
  dock: {
    edge: 'bottom',
    alongPercent: 50,
    snapToEdge: false,
    // -1 = 尚未定位：首次运行放在底部居中
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
    visible: true,
    source: 'system',
    anchor: 'dock',
    snapToEdge: true,
    edge: 'bottom',
    alongPercent: 50,
    // -1 = 尚未自由定位：由 anchor / edge / alongPercent 决定落点
    freeX: -1,
    freeY: -1,
    width: 330,
    progressStyle: 'bar',
    // v1.3 共性项：默认置顶（保持旧行为）、不参与仅在桌面显示（保持旧行为）
    alwaysOnTop: true,
    onlyOnDesktop: false,
    // v1.4 主题：默认深色（沿用 v1.3 的深色玻璃观感）
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
    // -1 = 未定位：首次显示在主屏右上角
    freeX: -1,
    freeY: -1
  },
  lock: {
    dock: false,
    music: false,
    clock: false
  },
  system: {
    autoStart: false
  },
  appearance: {
    motionIntensity: 'standard',
    reducedMotion: false,
    clickSound: false
  },
  apps: DEFAULT_APPS
}

export const DEFAULT_MEDIA_STATE: MediaState = {
  source: 'system',
  status: 'stopped',
  title: '',
  artist: '',
  album: '',
  artUrl: '',
  positionMs: 0,
  durationMs: 0,
  canNext: false,
  canPrev: false,
  appId: '',
  updatedAt: 0
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export const isHorizontalEdge = (edge: DockEdge): boolean => edge === 'top' || edge === 'bottom'

const EDGES: DockEdge[] = ['bottom', 'top', 'left', 'right']

const clamp = (n: number, min: number, max: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** 把任意（磁盘上的 / 渲染层传来的）数据收敛为合法 Settings，绝不抛错 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as DeepPartial<Settings>
  const d = DEFAULT_SETTINGS
  const dock: DockConfig = {
    edge: pick(r.dock?.edge, EDGES, d.dock.edge),
    alongPercent: clamp(r.dock?.alongPercent as number, 0, 100, d.dock.alongPercent),
    snapToEdge: typeof r.dock?.snapToEdge === 'boolean' ? r.dock.snapToEdge : d.dock.snapToEdge,
    freeX: clamp(r.dock?.freeX as number, -10000, 10000, d.dock.freeX),
    freeY: clamp(r.dock?.freeY as number, -10000, 10000, d.dock.freeY),
    onlyOnDesktop: typeof r.dock?.onlyOnDesktop === 'boolean' ? r.dock.onlyOnDesktop : d.dock.onlyOnDesktop,
    iconSize: clamp(r.dock?.iconSize as number, 28, 80, d.dock.iconSize),
    magnification: clamp(r.dock?.magnification as number, 1, 1.8, d.dock.magnification),
    gap: clamp(r.dock?.gap as number, 0, 32, d.dock.gap),
    padding: clamp(r.dock?.padding as number, 6, 32, d.dock.padding),
    showIndicators: typeof r.dock?.showIndicators === 'boolean' ? r.dock.showIndicators : d.dock.showIndicators,
    alwaysOnTop: typeof r.dock?.alwaysOnTop === 'boolean' ? r.dock.alwaysOnTop : d.dock.alwaysOnTop,
    acrylic: typeof r.dock?.acrylic === 'boolean' ? r.dock.acrylic : d.dock.acrylic,
    opacity: clamp(r.dock?.opacity as number, 0, 1, d.dock.opacity),
    theme: pick(r.dock?.theme, ['dark', 'light'] as const, d.dock.theme)
  }
  const music: MusicConfig = {
    visible: typeof r.music?.visible === 'boolean' ? r.music.visible : d.music.visible,
    source: pick(r.music?.source, ['system', 'local'] as const, d.music.source),
    anchor: pick(r.music?.anchor, ['dock', 'free'] as const, d.music.anchor),
    snapToEdge: typeof r.music?.snapToEdge === 'boolean' ? r.music.snapToEdge : d.music.snapToEdge,
    edge: pick(r.music?.edge, EDGES, d.music.edge),
    alongPercent: clamp(r.music?.alongPercent as number, 0, 100, d.music.alongPercent),
    freeX: clamp(r.music?.freeX as number, -10000, 10000, d.music.freeX),
    freeY: clamp(r.music?.freeY as number, -10000, 10000, d.music.freeY),
    width: clamp(r.music?.width as number, 240, 520, d.music.width),
    progressStyle: pick(r.music?.progressStyle, ['bar', 'ring'] as const, d.music.progressStyle),
    alwaysOnTop: typeof r.music?.alwaysOnTop === 'boolean' ? r.music.alwaysOnTop : d.music.alwaysOnTop,
    onlyOnDesktop: typeof r.music?.onlyOnDesktop === 'boolean' ? r.music.onlyOnDesktop : d.music.onlyOnDesktop,
    theme: pick(r.music?.theme, ['dark', 'light'] as const, d.music.theme)
  }
  const clock: ClockConfig = {
    visible: typeof r.clock?.visible === 'boolean' ? r.clock.visible : d.clock.visible,
    showSeconds: typeof r.clock?.showSeconds === 'boolean' ? r.clock.showSeconds : d.clock.showSeconds,
    showDate: typeof r.clock?.showDate === 'boolean' ? r.clock.showDate : d.clock.showDate,
    hour12: typeof r.clock?.hour12 === 'boolean' ? r.clock.hour12 : d.clock.hour12,
    fontSize: clamp(r.clock?.fontSize as number, 28, 96, d.clock.fontSize),
    opacity: clamp(r.clock?.opacity as number, 0.2, 1, d.clock.opacity),
    alwaysOnTop: typeof r.clock?.alwaysOnTop === 'boolean' ? r.clock.alwaysOnTop : d.clock.alwaysOnTop,
    onlyOnDesktop: typeof r.clock?.onlyOnDesktop === 'boolean' ? r.clock.onlyOnDesktop : d.clock.onlyOnDesktop,
    snapToEdge: typeof r.clock?.snapToEdge === 'boolean' ? r.clock.snapToEdge : d.clock.snapToEdge,
    theme: pick(r.clock?.theme, ['dark', 'light'] as const, d.clock.theme),
    freeX: clamp(r.clock?.freeX as number, -10000, 10000, d.clock.freeX),
    freeY: clamp(r.clock?.freeY as number, -10000, 10000, d.clock.freeY)
  }
  const lock: LockConfig = {
    dock: typeof r.lock?.dock === 'boolean' ? r.lock.dock : d.lock.dock,
    music: typeof r.lock?.music === 'boolean' ? r.lock.music : d.lock.music,
    clock: typeof r.lock?.clock === 'boolean' ? r.lock.clock : d.lock.clock
  }
  const system: SystemConfig = {
    autoStart: typeof r.system?.autoStart === 'boolean' ? r.system.autoStart : d.system.autoStart
  }
  const appearance: AppearanceConfig = {
    motionIntensity: pick(r.appearance?.motionIntensity, ['light', 'standard', 'expressive'] as const, d.appearance.motionIntensity),
    reducedMotion:
      typeof r.appearance?.reducedMotion === 'boolean' ? r.appearance.reducedMotion : d.appearance.reducedMotion,
    clickSound: typeof r.appearance?.clickSound === 'boolean' ? r.appearance.clickSound : d.appearance.clickSound
  }
  // 关键：区分「字段缺失」与「空数组」——空数组是合法的用户意图（在设置里删光所有应用），
  // 只有 r.apps 根本不是数组时才回退默认应用；否则删到最后一个应用会复活 6 个内置项。
  const apps: DockItem[] | null = Array.isArray(r.apps)
    ? (r.apps as DockItem[])
        .filter(
          (a) =>
            a &&
            typeof a.id === 'string' &&
            typeof a.name === 'string' &&
            (typeof a.path === 'string' || typeof a.aumid === 'string')
        )
        .map((a) => ({
          id: a.id,
          name: a.name,
          customName: normalizeCustomName(a.customName),
          path: typeof a.path === 'string' ? a.path : '',
          aumid: typeof a.aumid === 'string' && a.aumid.length > 0 ? a.aumid : undefined,
          args: Array.isArray(a.args) ? a.args.filter((x): x is string => typeof x === 'string') : undefined,
          icon: typeof a.icon === 'string' ? a.icon : '',
          customIcon: normalizeCustomIcon(a.customIcon),
          source: pick(a.source, ['builtin', 'startmenu', 'custom'] as const, 'custom')
        }))
    : null
  return {
    schemaVersion: d.schemaVersion,
    dock,
    music,
    clock,
    lock,
    system,
    appearance,
    apps: apps ?? d.apps
  }
}

/** 深合并（只覆盖 patch 中出现的键），结果再做一次合法性收敛 */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  if (!patch || typeof patch !== 'object') return base
  const merged: Settings = {
    schemaVersion: base.schemaVersion,
    dock: { ...base.dock, ...(patch.dock ?? {}) },
    music: { ...base.music, ...(patch.music ?? {}) },
    clock: { ...base.clock, ...(patch.clock ?? {}) },
    lock: { ...base.lock, ...(patch.lock ?? {}) },
    system: { ...base.system, ...(patch.system ?? {}) },
    appearance: { ...base.appearance, ...(patch.appearance ?? {}) },
    apps: patch.apps ?? base.apps
  }
  return sanitizeSettings(merged)
}

export interface NexusApi {
  env: {
    platform: string
    isDev: boolean
    /** 是否运行在打包后的安装版（开机自启仅安装版可用） */
    isPackaged: boolean
    appVersion: string
    versions: { electron: string; chrome: string; node: string }
  }
  settings: {
    get: () => Promise<Settings>
    update: (patch: DeepPartial<Settings>) => Promise<Settings>
    reset: () => Promise<Settings>
    onChanged: (cb: (s: Settings) => void) => () => void
  }
  apps: {
    list: () => Promise<DockItem[]>
    launch: (id: string) => Promise<LaunchResult>
    remove: (id: string) => Promise<DockItem[]>
    addByDialog: () => Promise<DockItem[]>
    reorder: (ids: string[]) => Promise<DockItem[]>
    menu: (id: string, point: Point) => Promise<void>
    dockMenu: (point: Point) => Promise<void>
    scanStartMenu: () => Promise<DockItem[]>
    addFromStartMenu: (item: DockItem) => Promise<DockItem[]>
    /** v1.6 修改单个应用的显示名称 / 图标（undefined 不改，null/'' 恢复默认） */
    updateItem: (id: string, patch: AppCustomPatch) => Promise<DockItem[]>
    /** v1.6 选择一张图片作为自定义图标（已复制到 userData/icons 并返回 icon:// URL） */
    pickIcon: () => Promise<PickIconResult>
    /** v1.6 从 Dock 右键菜单打开设置并定位到该应用的编辑弹层 */
    requestEdit: (id: string) => Promise<void>
    /** v1.6 设置窗口挂载时消费一次待处理的编辑请求 */
    consumeEditRequest: () => Promise<string | null>
    /** v1.6 设置窗口已打开时，接收主进程转发的编辑请求 */
    onEditRequest: (cb: (id: string) => void) => () => void
    onRunning: (cb: (running: Record<string, boolean>) => void) => () => void
  }
  window: {
    setContentSize: (target: WindowTarget, size: Size) => void
    openSettings: () => void
    closeSettings: () => void
    minimizeSettings: () => void
    quit: () => void
    capture: (target: WindowTarget) => Promise<string>
    setIgnoreMouse: (ignore: boolean) => void
  }
  dock: {
    snap: () => Promise<void>
  }
  /** v1.1 系统能力 */
  system: {
    /** 写 Windows 当前用户登录启动项（仅安装版）；返回操作系统实际状态 */
    setAutoStart: (enabled: boolean) => Promise<AutoStartResult>
  }
  media: {
    getState: () => Promise<MediaState>
    control: (action: MediaAction, positionMs?: number) => Promise<{ ok: boolean }>
    pickFiles: () => Promise<LocalTrack[]>
    setLocalState: (state: MediaState) => void
    onUpdate: (cb: (state: MediaState) => void) => () => void
    /** 设置面板选择本地文件后，主进程广播给音乐卡片 */
    onTracks: (cb: (tracks: LocalTrack[]) => void) => () => void
  }
}

declare global {
  interface Window {
    nexus: NexusApi
  }
}
