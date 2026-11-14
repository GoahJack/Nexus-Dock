/**
 * Nexus Dock — 共享契约（主进程 / preload / 渲染进程 唯一真源）
 * 修改此文件后必须同步检查：src/main/ipc.ts、src/preload/index.ts、各渲染层。
 *
 * 注意：这里只 `import type` 词库类型（运行时零依赖），词库的纯函数与常量在
 * `src/shared/wordBank.ts`。注册表里的 kind / defaultOptions 必须与
 * `WORD_STUDY_KIND` / `DEFAULT_WORD_STUDY_OPTIONS` 保持一致（契约测试会校验）。
 */
import type { WordBank, WordBankOpenResult, WordBankOpResult, WordEntry, WordProgress } from './wordBank'

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
  /** 手动收起为胶囊，设置与浮窗按钮共享并持久化 */
  collapsed: boolean
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
  /** 手动收起为胶囊，设置与浮窗按钮共享并持久化 */
  collapsed: boolean
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

/** v1.7 桌面状态桥上报的前台窗口状态（协议见 resources/desktop-state.cs） */
export interface DesktopState {
  /** 前台窗口所属进程 ID；0 表示没有前台窗口 */
  foregroundPid: number
  maximized: boolean
  fullscreen: boolean
  desktop: boolean
  className: string
  /**
   * v1.7：前台窗口是否被最小化。
   * Windows「显示桌面」会让所有顶层窗口最小化，但 GetForegroundWindow() 仍可能返回最后一个
   * 前台窗口；此时它并不占据桌面，必须当作「桌面空闲」处理（否则 Dock 的仅在桌面显示永远不恢复）。
   */
  minimized: boolean
  /** v1.7：前台窗口是否可见（显示桌面还可能用 SW_HIDE 隐藏窗口） */
  visible: boolean
}

/**
 * 前台窗口是否「真的占据桌面」：最大化/全屏 + 可见 + 未最小化 + 不是本应用窗口。
 * 纯函数，供主进程判定与契约测试共用（v1.7「显示桌面」bug 的核心判定）。
 */
export function isDesktopBusy(state: DesktopState | null, selfActive: boolean): boolean {
  if (!state || selfActive) return false
  if (state.minimized || state.visible === false) return false
  return state.maximized || state.fullscreen
}

/** v1.7 窗口体系 ================================ */

/** 窗口分类：内置窗口（随应用提供，Dock/音乐/时钟） / 附加窗口（后续接入的功能窗口） */
export type WindowKindCategory = 'builtin' | 'extra'

/**
 * v1.7 附加窗口配置。
 *
 * 模型刻意做成「注册表声明类型 + 配置只存状态」：附加窗口的类型来自
 * `EXTRA_WINDOW_KINDS` 注册表（见文件后部），配置里一个 kind 只对应一个窗口实例，
 * 不需要用户手动增删窗口，也就不用额外的实例管理 UI。
 * 以后新增功能窗口：注册表加一条 + 新建渲染页 + vite 入口，设置页/托盘/显隐/吸附/锁定
 * 全部自动生效（见 docs/window-conventions.md「附加窗口接入」）。
 */
export interface ExtraWindowConfig {
  /** 手动收起为胶囊，设置与浮窗按钮共享并持久化 */
  collapsed: boolean
  /** 注册表 kind，同时是实例唯一键 */
  kind: string
  visible: boolean
  snapToEdge: boolean
  edge: DockEdge
  alongPercent: number
  freeX: number
  freeY: number
  alwaysOnTop: boolean
  onlyOnDesktop: boolean
  locked: boolean
  theme: ThemeMode
  /** 该窗口的独有选项（默认值来自注册表 defaultOptions；只保留 JSON 安全标量） */
  options: Record<string, unknown>
}

/** v1.7 窗口类型描述：注册表条目，是「新增窗口」的唯一登记处 */
export interface WindowKindSpec {
  kind: string
  label: string
  /** 一句话描述，用于设置页/托盘提示 */
  description: string
  category: WindowKindCategory
  /** 渲染页目录名（src/renderer/<page>/index.html），与 electron.vite.config.ts 的 renderer input 同名 */
  page: string
  /** 初始内容尺寸；真实尺寸由渲染层 useContentSize / setOwnContentSize 汇报 */
  defaultSize: Size
  /** 附加窗口默认行为；缺省值见 DEFAULT_EXTRA_WINDOW_BEHAVIOR */
  defaults?: Partial<
    Pick<
      ExtraWindowConfig,
      'visible' | 'snapToEdge' | 'edge' | 'alongPercent' | 'alwaysOnTop' | 'onlyOnDesktop' | 'locked' | 'theme'
    >
  >
  /** 默认停靠边/沿边位置（snapToEdge=true 时生效） */
  placement?: { edge?: DockEdge; alongPercent?: number }
  /** 独有选项默认值 */
  defaultOptions?: Record<string, unknown>
}

/** 附加窗口的缺省行为（未在注册表 defaults 里声明时使用） */
export const DEFAULT_EXTRA_WINDOW_BEHAVIOR = {
  visible: false,
  snapToEdge: true,
  edge: 'top' as DockEdge,
  alongPercent: 50,
  alwaysOnTop: true,
  onlyOnDesktop: false,
  locked: false,
  theme: 'dark' as ThemeMode
} as const

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
  /** v1.7 附加窗口状态（一个注册类型对应一个实例；注册表见 EXTRA_WINDOW_KINDS） */
  extraWindows: ExtraWindowConfig[]
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
  /** v1.7：附加窗口渲染层上报自己的内容尺寸（按 IPC sender 定位窗口，无需知道 kind） */
  windowSetOwnContentSize: 'window:setOwnContentSize',
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
  mediaTracks: 'media:tracks',
  /* v1.8 英语单词学习词库（附加窗口 wordstudy） */
  wordBankGet: 'wordbank:get',
  wordBankSetWords: 'wordbank:setWords',
  wordBankSetProgress: 'wordbank:setProgress',
  wordBankResetWords: 'wordbank:resetWords',
  wordBankResetProgress: 'wordbank:resetProgress',
  wordBankImport: 'wordbank:import',
  wordBankExport: 'wordbank:export',
  wordBankOpenFile: 'wordbank:openFile',
  wordBankReload: 'wordbank:reload',
  wordBankPaths: 'wordbank:paths',
  wordBankChanged: 'wordbank:changed'
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

/* ======================= v1.7 窗口注册表（唯一登记处） =======================
 *
 * 内置窗口（Dock / 音乐卡片 / 桌面时钟）与附加窗口共用同一份元数据：
 * 设置页分组、托盘入口、显隐、吸附、锁定、仅在桌面显示都从这张表驱动。
 *
 * 新增一个「附加窗口」（以后加功能窗口只需要这 4 步，其余全自动）：
 *   1) 在 EXTRA_WINDOW_KINDS 里 push 一条 WindowKindSpec（page = 渲染页目录名）；
 *   2) 新建 src/renderer/<page>/（index.html + main.tsx + 组件 + css）；
 *   3) electron.vite.config.ts 的 renderer.input 增加 <page> 入口；
 *   4) 如需独有选项，在设置页 ExtraWindowsSection 的 EXTRA_WINDOW_SETTINGS 里注册组件。
 * 约束：一个 kind 同时只开一个窗口实例（配置数组按 kind 唯一化，重复/未知 kind 一律丢弃）。
 */

/** 内置窗口元数据（与 DEFAULT_SETTINGS 里的配置一一对应；显隐由各自配置决定） */
export const BUILTIN_WINDOW_SPECS: readonly WindowKindSpec[] = [
  {
    kind: 'dock',
    label: 'Dock',
    description: '应用启动与窗口入口，可停靠任意屏幕边',
    category: 'builtin',
    page: 'dock',
    defaultSize: { width: 640, height: 120 }
  },
  {
    kind: 'music',
    label: '音乐卡片',
    description: '桌面音乐信息窗，跟随 Dock 或自由摆放',
    category: 'builtin',
    page: 'music',
    defaultSize: { width: 340, height: 170 }
  },
  {
    kind: 'clock',
    label: '桌面时钟',
    description: '可拖动的数字时钟悬浮窗',
    category: 'builtin',
    page: 'clock',
    defaultSize: { width: 240, height: 120 }
  }
]

/**
 * 附加窗口注册表（v1.7 建立的接入位；v1.8 起注册第一个功能窗口：英语单词学习）。
 *
 * 新增功能窗口只需在数组里 push 一条 WindowKindSpec + 新建 src/renderer/<page>/ +
 * electron.vite.config.ts 增加同名入口（详见 docs/window-conventions.md §5），
 * 设置页「窗口 → 附加窗口」、托盘/Dock 右键显隐、吸附/锁定/置顶/仅在桌面全部自动生效。
 *
 * 示例（以后接天气卡片时）：
 *   {
 *     kind: 'weather',
 *     label: '天气卡片',
 *     description: '当前城市天气与温度',
 *     category: 'extra',
 *     page: 'weather',
 *     defaultSize: { width: 300, height: 200 },
 *     defaults: { visible: false, alwaysOnTop: true, onlyOnDesktop: false },
 *     placement: { edge: 'top', alongPercent: 72 },
 *     defaultOptions: { city: '北京' }
 *   }
 */
export const EXTRA_WINDOW_KINDS: readonly WindowKindSpec[] = [
  {
    // 与 src/shared/wordBank.ts 的 WORD_STUDY_KIND 一致（契约测试校验）
    kind: 'wordstudy',
    label: '英语单词学习',
    description: '桌面背单词卡片：单词 / 音标 / 释义 / 例句，词库可自由增删改、导入导出',
    category: 'extra',
    page: 'wordstudy',
    defaultSize: { width: 360, height: 236 },
    defaults: {
      // 首次升级即显示：用户明确要求新增这个窗口，隐藏反而会以为没生效
      visible: true,
      snapToEdge: true,
      alwaysOnTop: true,
      onlyOnDesktop: false,
      locked: false,
      theme: 'dark'
    },
    placement: { edge: 'right', alongPercent: 32 },
    // 窗口独有选项（与 DEFAULT_WORD_STUDY_OPTIONS 一致）：全部是 JSON 标量
    defaultOptions: {
      showPhonetic: true,
      showExample: true,
      hideMeaning: true,
      shuffle: false,
      autoNext: true,
      // v1.9：记忆曲线复习（与 DEFAULT_WORD_STUDY_OPTIONS 保持一致）
      reviewFirst: true,
      showSchedule: true
    }
  }
]

/** 按 kind 查注册表（内置 + 附加都查） */
export function findWindowKind(kind: string): WindowKindSpec | null {
  const all = [...BUILTIN_WINDOW_SPECS, ...EXTRA_WINDOW_KINDS]
  return all.find((spec) => spec.kind === kind) ?? null
}

/** 该 kind 是否是已注册的附加窗口类型 */
export function isExtraWindowKind(kind: string): boolean {
  return EXTRA_WINDOW_KINDS.some((spec) => spec.kind === kind)
}

/** 附加窗口的默认配置（注册表 defaults / placement 驱动；不是注册类型返回 null） */
export function defaultExtraWindowConfig(kind: string): ExtraWindowConfig | null {
  const spec = EXTRA_WINDOW_KINDS.find((item) => item.kind === kind)
  if (!spec) return null
  const d = spec.defaults ?? {}
  const b = DEFAULT_EXTRA_WINDOW_BEHAVIOR
  return {
    kind: spec.kind,
    collapsed: false,
    visible: d.visible ?? b.visible,
    snapToEdge: d.snapToEdge ?? b.snapToEdge,
    edge: d.edge ?? spec.placement?.edge ?? b.edge,
    alongPercent: spec.placement?.alongPercent ?? b.alongPercent,
    freeX: -1,
    freeY: -1,
    alwaysOnTop: d.alwaysOnTop ?? b.alwaysOnTop,
    onlyOnDesktop: d.onlyOnDesktop ?? b.onlyOnDesktop,
    locked: d.locked ?? b.locked,
    theme: d.theme ?? b.theme,
    options: sanitizeWindowOptions(spec.defaultOptions, spec.defaultOptions)
  }
}

/** 所有已注册附加窗口的默认配置（启动/Settings 默认值使用） */
export function defaultExtraWindowConfigs(): ExtraWindowConfig[] {
  return EXTRA_WINDOW_KINDS.flatMap((spec) => {
    const config = defaultExtraWindowConfig(spec.kind)
    return config ? [config] : []
  })
}

/**
 * 收敛附加窗口独有选项：只保留 JSON 安全标量（字符串截断到 2000 字符），
 * 未知键丢弃。注册表可在以后为某个窗口补更严格的校验，这里保证不会把脏数据写进 settings.json。
 */
export function sanitizeWindowOptions(
  raw: unknown,
  defaults?: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (defaults && typeof defaults === 'object') {
    for (const [key, value] of Object.entries(defaults)) {
      if (typeof key === 'string' && key.length <= 64) out[key] = value
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length > 64) continue
      if (value === null || typeof value === 'boolean') out[key] = value
      else if (typeof value === 'string') out[key] = value.slice(0, 2000)
      else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    }
  }
  return out
}

/**
 * 收敛附加窗口配置：以注册表为准，逐 kind 生成配置并丢弃未知/重复 kind。
 * 未注册类型（用户配置里残留的历史 kind）不会恢复；新增类型自动获得默认配置。
 */
export function normalizeExtraWindows(raw: unknown): ExtraWindowConfig[] {
  const entries = Array.isArray(raw) ? raw : []
  const byKind = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    if (typeof value.kind !== 'string' || byKind.has(value.kind)) continue
    byKind.set(value.kind, value)
  }
  return EXTRA_WINDOW_KINDS.flatMap((spec) => {
    const fallback = defaultExtraWindowConfig(spec.kind)
    if (!fallback) return []
    const r = (byKind.get(spec.kind) ?? {}) as Partial<ExtraWindowConfig>
    return [
      {
        kind: spec.kind,
        collapsed: typeof r.collapsed === 'boolean' ? r.collapsed : fallback.collapsed,
        visible: typeof r.visible === 'boolean' ? r.visible : fallback.visible,
        snapToEdge: typeof r.snapToEdge === 'boolean' ? r.snapToEdge : fallback.snapToEdge,
        edge: pick(r.edge, EDGES, fallback.edge),
        alongPercent: clamp(r.alongPercent as number, 0, 100, fallback.alongPercent),
        freeX: clamp(r.freeX as number, -10000, 10000, fallback.freeX),
        freeY: clamp(r.freeY as number, -10000, 10000, fallback.freeY),
        alwaysOnTop: typeof r.alwaysOnTop === 'boolean' ? r.alwaysOnTop : fallback.alwaysOnTop,
        onlyOnDesktop: typeof r.onlyOnDesktop === 'boolean' ? r.onlyOnDesktop : fallback.onlyOnDesktop,
        locked: typeof r.locked === 'boolean' ? r.locked : fallback.locked,
        theme: pick(r.theme, ['dark', 'light'] as const, fallback.theme),
        options: sanitizeWindowOptions(r.options, fallback.options)
      }
    ]
  })
}

/** 是否有任一窗口开启「仅在桌面显示」（决定桌面状态桥要不要常驻） */
export function hasOnlyOnDesktopWindow(settings: Settings): boolean {
  if (settings.dock.onlyOnDesktop || settings.music.onlyOnDesktop || settings.clock.onlyOnDesktop) return true
  return settings.extraWindows.some((item) => item.onlyOnDesktop)
}

/** 锁定状态汇总：内置 3 个窗口 + 所有附加窗口；「锁定全部」开关按此推导（n/N） */
export function windowLockSummary(settings: Settings): { locked: number; total: number; allLocked: boolean } {
  const extras = settings.extraWindows
  const total = 3 + extras.length
  const locked =
    (settings.lock.dock ? 1 : 0) +
    (settings.lock.music ? 1 : 0) +
    (settings.lock.clock ? 1 : 0) +
    extras.filter((item) => item.locked).length
  return { locked, total, allLocked: locked === total }
}

/** 生成「锁定/解锁全部窗口」的补丁（内置 + 附加窗口一起） */
export function withAllWindowsLocked(settings: Settings, locked: boolean): DeepPartial<Settings> {
  return {
    lock: { dock: locked, music: locked, clock: locked },
    extraWindows: settings.extraWindows.map((item) => ({ ...item, locked }))
  }
}

/** 修改单个附加窗口配置（返回新的完整数组，交给 settings.update 整体替换） */
export function patchExtraWindows(
  settings: Settings,
  kind: string,
  patch: Partial<ExtraWindowConfig>
): ExtraWindowConfig[] {
  return settings.extraWindows.map((item) => (item.kind === kind ? { ...item, ...patch } : item))
}

export const DEFAULT_SETTINGS: Settings = {
  // v11（v1.8）：新增英语单词学习附加窗口（注册表登记 kind=wordstudy）与词库文件存储。
  schemaVersion: 11,
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
    opacity: 0.94,
    theme: 'dark'
  },
  music: {
    collapsed: false,
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
    collapsed: false,
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
  apps: DEFAULT_APPS,
  // 附加窗口默认配置由注册表 EXTRA_WINDOW_KINDS 生成（v1.8：英语单词学习）
  extraWindows: defaultExtraWindowConfigs()
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
    collapsed: typeof r.music?.collapsed === 'boolean' ? r.music.collapsed : d.music.collapsed,
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
    collapsed: typeof r.clock?.collapsed === 'boolean' ? r.clock.collapsed : d.clock.collapsed,
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
    apps: apps ?? d.apps,
    // v1.7：附加窗口以注册表为准逐 kind 收敛（未知/重复 kind 丢弃，新注册类型自动补默认配置）
    extraWindows: normalizeExtraWindows(r.extraWindows)
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
    apps: patch.apps ?? base.apps,
    extraWindows: patch.extraWindows ?? base.extraWindows
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
    /**
     * v1.7：附加窗口（注册表驱动）渲染层上报内容尺寸。
     * 主进程按 IPC sender 定位窗口，渲染层不需要知道自己的 kind。
     */
    setOwnContentSize: (size: Size) => void
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
  /**
   * v1.8 英语单词学习词库（附加窗口 wordstudy 与设置页共用）。
   * 词库 / 进度分别落盘到 userData/wordbank.json 与 wordbank-progress.json，
   * 用户可以直接用文本编辑器修改，再用 reloadFromDisk() 让窗口生效。
   */
  wordBank: {
    get: () => Promise<WordBank>
    /** 整体替换词条列表（进度按归一化单词 key 自动保留/丢弃） */
    setWords: (words: WordEntry[]) => Promise<WordBank>
    /** 整体替换学习进度（未知单词 key 丢弃） */
    setProgress: (progress: Record<string, WordProgress>) => Promise<WordBank>
    /** 恢复默认种子词库（清空进度） */
    resetWords: () => Promise<WordBank>
    /** 清空学习进度（词库不变） */
    resetProgress: () => Promise<WordBank>
    /** 从用户选择的 JSON 文件导入词库（替换现有词条，进度按 key 保留） */
    importFromFile: () => Promise<WordBankOpResult>
    /** 把词库导出为 JSON 文件（供备份 / 手工编辑） */
    exportToFile: () => Promise<WordBankOpResult>
    /** 用系统默认程序打开 wordbank.json（便于直接编辑） */
    openFile: () => Promise<WordBankOpenResult>
    /** 重新读取磁盘上的词库 / 进度文件（手工改完文件后点它生效） */
    reloadFromDisk: () => Promise<WordBank>
    /** 词库 / 进度文件的绝对路径（设置页展示「词库文件在哪」） */
    paths: () => Promise<{ words: string; progress: string }>
    onChanged: (cb: (bank: WordBank) => void) => () => void
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
