/**
 * Nexus Dock — v1.8 英语单词学习（附加窗口 `wordstudy`）共享契约。
 *
 * 本文件是「词库」的唯一真源，**纯函数、零依赖**（不 import electron / 不 import 其他共享模块），
 * 因此主进程、preload、单词窗口、设置页与 `npm test` 契约测试可以共用同一份收敛逻辑。
 *
 * 存储模型（用户可自由修改）：
 *   - userData/wordbank.json          { version, words: [{ word, phonetic, meaning, example }] }
 *   - userData/wordbank-progress.json { version, progress: { "<单词key>": { status, seen, remembered,
 *                                       lastSeenAt, dueAt, intervalDays, ease, streak, lapses } } }
 * 两个文件都能被用户直接用文本编辑器改；界面上也提供导入 / 导出 / 恢复默认 / 重新读取文件。
 * 进度按「单词归一化 key」关联，词条只有 word 一个必填字段：手写 JSON 时写
 *   [{"word":"apple","meaning":"苹果"}] 或 {"words":[...]} 都能被识别。
 *
 * v1.9 起进度文件升级为 v2：新增遗忘曲线（间隔复习）字段。旧 v1 进度读入时由
 * `sanitizeWordProgress` 自动补默认值（已学过的词立即进入复习队列），不需要手动迁移。
 */

/** 附加窗口注册表 kind（同时是 settings.extraWindows 里的实例键） */
export const WORD_STUDY_KIND = 'wordstudy'
/** 词库文件（words 列表，可自由替换） */
export const WORD_BANK_FILE = 'wordbank.json'
/** 学习进度文件（与词库分离，换词库不影响学习记录结构） */
export const WORD_PROGRESS_FILE = 'wordbank-progress.json'
/** 词库文件格式版本（向后兼容扩展用，非 settings.schemaVersion） */
export const WORD_BANK_VERSION = 1
/** 进度文件格式版本：v1 = 仅状态统计；v2（v1.9）= 增加遗忘曲线排期字段 */
export const WORD_PROGRESS_VERSION = 2

/** 词条长度上限（防止脏数据/超长文本把设置与窗口撑爆） */
export const WORD_LIMITS = {
  /** 最多词条数 */
  maxWords: 5000,
  word: 64,
  phonetic: 64,
  meaning: 200,
  example: 300
} as const

/** 学习状态：未学 / 学习中 / 已掌握 */
export const WORD_STATUSES = ['new', 'learning', 'mastered'] as const
export type WordStatus = (typeof WORD_STATUSES)[number]

/** 状态中文名（窗口 / 设置页共用，避免两处硬编码） */
export const WORD_STATUS_LABELS: Record<WordStatus, string> = {
  new: '未学',
  learning: '学习中',
  mastered: '已掌握'
}

/* ---------------------------- 遗忘曲线（间隔复习） ---------------------------- */

/**
 * 记忆评级：不认识 / 模糊 / 认识。
 * 对应学习卡片底部的三个按钮；`reviewWord` 按 SM-2 简化算法换算下次复习时间。
 */
export const WORD_REVIEW_GRADES = ['again', 'hard', 'good'] as const
export type WordReviewGrade = (typeof WORD_REVIEW_GRADES)[number]

export const WORD_REVIEW_GRADE_LABELS: Record<WordReviewGrade, string> = {
  again: '不认识',
  hard: '模糊',
  good: '认识'
}

/** 记忆难度系数（SM-2 的 ease，越大间隔增长越快） */
export const WORD_EASE_DEFAULT = 2.5
export const WORD_EASE_MIN = 1.3
export const WORD_EASE_MAX = 2.8
/** 评级「不认识」后的重练间隔：10 分钟（当天内再遇到） */
export const WORD_AGAIN_DELAY_MS = 10 * 60 * 1000
/** 间隔天数上限（约一年），避免长期不复习后一次跳到几年后 */
export const WORD_MAX_INTERVAL_DAYS = 365

/** 单词表筛选口径（按认识状态整理） */
export const WORD_FILTERS = ['all', 'due', 'new', 'learning', 'mastered'] as const
export type WordFilter = (typeof WORD_FILTERS)[number]
export const WORD_FILTER_LABELS: Record<WordFilter, string> = {
  all: '全部',
  due: '待复习',
  new: '未学',
  learning: '学习中',
  mastered: '已掌握'
}

/** 单词表排序口径 */
export const WORD_SORTS = ['bank', 'due', 'alpha'] as const
export type WordSort = (typeof WORD_SORTS)[number]
export const WORD_SORT_LABELS: Record<WordSort, string> = {
  bank: '词库顺序',
  due: '到期优先',
  alpha: '字母 A→Z'
}

/** 单个词条在单词表里的一行（渲染层只读视图模型） */
export interface WordListItem {
  /** normalizeWordKey(word) */
  key: string
  entry: WordEntry
  /** 没有进度记录时为 null（等价于「未学」） */
  progress: WordProgress | null
  status: WordStatus
  /** 现在是否到期待复习 */
  due: boolean
  /** 复习计划短标签：待复习 / 3 天后 / 未学 … */
  dueLabel: string
}

/** 词库复习统计（比 WordBankStats 多一个「待复习」口径） */
export interface WordBankReviewStats extends WordBankStats {
  due: number
}


/** 词条：只有 word 必填，其余可空（手写词库最省事） */
export interface WordEntry {
  word: string
  /** 音标（如 /ˈæpl/），可空 */
  phonetic: string
  /** 中文释义，可空（界面上提示「未填写释义」） */
  meaning: string
  /** 例句，可空 */
  example: string
}

/** 单个词的学习进度（v1.9 起含遗忘曲线排期字段） */
export interface WordProgress {
  status: WordStatus
  /** 出现次数 */
  seen: number
  /** 记住次数（「认识」点了几次） */
  remembered: number
  /** 最近一次学习时间戳（ms） */
  lastSeenAt: number
  /** 下次复习到期时间戳（ms）；0 表示未排期（未学或旧数据尚未复习过） */
  dueAt: number
  /** 当前复习间隔（天）；0 表示「10 分钟后重练」级别 */
  intervalDays: number
  /** 记忆难度系数（1.3–2.8，越大越容易记牢） */
  ease: number
  /** 连续「认识」次数（不认识/模糊会清零） */
  streak: number
  /** 遗忘次数（点「不认识」的次数） */
  lapses: number
}

/** 渲染层 / preload / IPC 传输的完整词库快照 */
export interface WordBank {
  version: number
  words: WordEntry[]
  /** key = normalizeWordKey(word) */
  progress: Record<string, WordProgress>
}

/** 词库统计（卡片与设置页共用） */
export interface WordBankStats {
  total: number
  mastered: number
  learning: number
  untouched: number
}

/** 导入 / 导出结果 */
export interface WordBankOpResult {
  ok: boolean
  canceled: boolean
  error?: string
  path?: string
  /** 成功时的词条数 */
  count?: number
}

/** 打开词库文件 / 数据目录的结果 */
export interface WordBankOpenResult {
  ok: boolean
  path: string
  error?: string
}

/** 窗口独有选项（存在 settings.extraWindows[].options，仅 JSON 标量） */
export const DEFAULT_WORD_STUDY_OPTIONS = {
  /** 显示音标 */
  showPhonetic: true,
  /** 显示例句 */
  showExample: true,
  /** 先遮住释义，点击 / 空格再显示（自测模式） */
  hideMeaning: true,
  /** 随机顺序学习 */
  shuffle: false,
  /** 标记「认识/不认识」后自动切下一个 */
  autoNext: true,
  /** 优先复习到期单词（打开卡片先过一遍遗忘曲线排到的词） */
  reviewFirst: true,
  /** 卡片上显示下次复习时间与记忆强度 */
  showSchedule: true
} as const

export interface WordStudyOptions {
  showPhonetic: boolean
  showExample: boolean
  hideMeaning: boolean
  shuffle: boolean
  autoNext: boolean
  reviewFirst: boolean
  showSchedule: boolean
}

/** 把 options（任意脏数据）收敛为窗口可直接使用的选项，缺失字段回落到默认值 */
export function resolveWordStudyOptions(
  options: Record<string, unknown> | null | undefined
): WordStudyOptions {
  const source = options ?? {}
  const pick = (key: keyof WordStudyOptions): boolean => {
    const value = source[key]
    return typeof value === 'boolean' ? value : DEFAULT_WORD_STUDY_OPTIONS[key]
  }
  return {
    showPhonetic: pick('showPhonetic'),
    showExample: pick('showExample'),
    hideMeaning: pick('hideMeaning'),
    shuffle: pick('shuffle'),
    autoNext: pick('autoNext'),
    reviewFirst: pick('reviewFirst'),
    showSchedule: pick('showSchedule')
  }
}

/* ------------------------------ 文本工具 ------------------------------ */

/** 去掉控制字符（保留换行 → 统一折叠为单个空格），与 types.ts 的 customName 处理一致 */
function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const withoutControl = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const collapsed = withoutControl.replace(/\s+/g, ' ').trim()
  return collapsed.slice(0, maxLength)
}

/**
 * 单词归一化 key：小写 + 折叠空白。
 * 进度文件与去重都以它为键，所以手写词库时大小写/多空格不影响学习记录。
 */
export function normalizeWordKey(word: string): string {
  return (typeof word === 'string' ? word : '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/* ------------------------------ 词条收敛 ------------------------------ */

/** 收敛单个词条；word 为空或超长时返回 null（调用方丢弃） */
export function sanitizeWordEntry(raw: unknown): WordEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const word = cleanText(r.word, WORD_LIMITS.word)
  if (word.length === 0) return null
  return {
    word,
    phonetic: cleanText(r.phonetic, WORD_LIMITS.phonetic),
    meaning: cleanText(r.meaning, WORD_LIMITS.meaning),
    example: cleanText(r.example, WORD_LIMITS.example)
  }
}

/**
 * 收敛词条列表：丢弃非法项、按归一化 key 去重（先出现者保留）、最多 maxWords 条。
 * 输入可以是数组，也可以是 `{ words: [...] }`（兼容直接传词库文件内容）。
 */
export function sanitizeWordEntries(raw: unknown): WordEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { words?: unknown }).words)
      ? ((raw as { words: unknown[] }).words)
      : []
  const out: WordEntry[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const entry = sanitizeWordEntry(item)
    if (!entry) continue
    const key = normalizeWordKey(entry.word)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= WORD_LIMITS.maxWords) break
  }
  return out
}

/**
 * 解析磁盘上的词库文件内容 → 词条列表。
 * 兼容三种写法（方便用户手改）：裸数组 / { words } / { version, words }。
 */
export function parseWordBankFile(raw: unknown): WordEntry[] {
  return sanitizeWordEntries(raw)
}

/* ------------------------------ 进度收敛 ------------------------------ */

function toCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1_000_000, Math.round(value)))
}

function toTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function toStatus(value: unknown): WordStatus {
  return WORD_STATUSES.includes(value as WordStatus) ? (value as WordStatus) : 'new'
}

function toEase(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(WORD_EASE_MIN, Math.min(WORD_EASE_MAX, Math.round(value * 100) / 100))
}

function toIntervalDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(WORD_MAX_INTERVAL_DAYS, Math.round(value)))
}

function toStreak(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(10_000, Math.round(value)))
}

/**
 * 收敛单条进度：v1（只有 status/seen/remembered/lastSeenAt）读入时自动迁移到 v2。
 * 迁移语义：已学过的词视为「立即到期」，让升级后第一次打开卡片就能复习旧词；
 * ease 用默认 2.5、streak/lapses 从 0 起算，不影响已有掌握状态。
 */
export function sanitizeWordProgress(raw: unknown): WordProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = toCount(r.seen)
  const status = toStatus(r.status)
  const lastSeenAt = toTimestamp(r.lastSeenAt)
  const legacy = typeof r.dueAt !== 'number'
  const ease = toEase(r.ease, WORD_EASE_DEFAULT)
  const intervalDays = toIntervalDays(r.intervalDays)
  const streak = status === 'new' ? 0 : toStreak(r.streak)
  const lapses = toCount(r.lapses)
  let dueAt: number
  if (status === 'new') dueAt = 0
  else if (legacy) dueAt = lastSeenAt
  else dueAt = toTimestamp(r.dueAt)
  return {
    status,
    seen,
    // 兜底一致性：记住次数不可能超过出现次数（手改 JSON 也不会写出矛盾数据）
    remembered: Math.min(toCount(r.remembered), seen),
    lastSeenAt,
    dueAt,
    intervalDays: status === 'new' ? 0 : intervalDays,
    ease,
    streak,
    lapses
  }
}

/**
 * 进度文件内容 → 进度表对象。兼容两种写法：
 *   { progress: { apple: {...} } }（wordbank-progress.json 正常形态）
 *   { apple: {...} }（用户手写的裸表）
 */
function progressSource(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const nested = record['progress']
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return record
}

/**
 * 收敛进度表：键必须是「当前词库里存在的归一化单词 key」，未知键丢弃；
 * 没有任何学习记录（seen=0）的条目也丢弃（保持文件精简，读出来按需补默认值）。
 */
export function sanitizeWordProgressMap(
  raw: unknown,
  words: readonly WordEntry[]
): Record<string, WordProgress> {
  const source = progressSource(raw)
  const valid = new Set(words.map((entry) => normalizeWordKey(entry.word)))
  const out: Record<string, WordProgress> = {}
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeWordKey(key)
    if (!valid.has(normalized)) continue
    const progress = sanitizeWordProgress(value)
    // 「未学」且没有学习记录的条目视为空进度：不落盘，保持文件精简。
    // 手动标成「学习中/已掌握」的词即使 seen=0 也要保留（v1.9 单词表可直接改状态）。
    if (progress.seen === 0 && progress.status === 'new') continue
    out[normalized] = progress
  }
  return out
}

/* ------------------------------ 组合与默认值 ------------------------------ */

/** 用词条 + 进度拼出完整词库（版本号固定为当前格式版本） */
export function combineWordBank(words: unknown, progress: unknown): WordBank {
  const entries = sanitizeWordEntries(words)
  return {
    version: WORD_BANK_VERSION,
    words: entries,
    progress: sanitizeWordProgressMap(progress, entries)
  }
}

/** 解析完整的词库文件（词条 + 可选进度），用于导入一个自包含的 JSON */
export function parseWordBankDocument(raw: unknown): WordBank {
  const words = parseWordBankFile(raw)
  const progress = raw && typeof raw === 'object' ? (raw as { progress?: unknown }).progress : undefined
  return combineWordBank(words, progress)
}

/** 默认种子词库（首次运行 / 恢复默认词库时写入磁盘） */
export function defaultWordBank(): WordBank {
  return combineWordBank(DEFAULT_WORDS, {})
}

/** 统计：已掌握 / 学习中 / 未学（没有进度记录的都算未学） */
export function wordBankStats(bank: WordBank): WordBankStats {
  let mastered = 0
  let learning = 0
  for (const entry of bank.words) {
    const progress = bank.progress[normalizeWordKey(entry.word)]
    if (!progress) continue
    if (progress.status === 'mastered') mastered += 1
    else if (progress.status === 'learning') learning += 1
  }
  const total = bank.words.length
  return { total, mastered, learning, untouched: Math.max(0, total - mastered - learning) }
}

/** 学习顺序：按词库顺序或随机；同一份词库稳定可复现（随机由调用方传种子/洗牌结果） */
export function orderWordsForStudy(bank: WordBank, shuffle: boolean): WordEntry[] {
  const words = [...bank.words]
  if (!shuffle) return words
  // Fisher-Yates：窗口每次打开/每轮重新洗牌由调用方决定，这里只做一次纯函数洗牌
  for (let i = words.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = words[i]
    words[i] = words[j]
    words[j] = tmp
  }
  return words
}

/* ---------------------------- 遗忘曲线计算 ---------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000

function safeNow(now: number): number {
  return typeof now === 'number' && Number.isFinite(now) ? Math.max(0, Math.round(now)) : 0
}

function toGrade(value: unknown): WordReviewGrade {
  return WORD_REVIEW_GRADES.includes(value as WordReviewGrade) ? (value as WordReviewGrade) : 'good'
}

/** 间隔天数 → 人类可读标签（卡片 toast 与单词表共用） */
export function formatReviewInterval(days: number): string {
  const d = typeof days === 'number' && Number.isFinite(days) ? Math.max(0, Math.round(days)) : 0
  if (d === 0) return '10 分钟后'
  if (d === 1) return '明天'
  if (d < 30) return `${d} 天后`
  if (d < 365) return `${Math.round(d / 30)} 个月后`
  return '一年后'
}

/** 到期时间戳 → 人类可读标签（到期后统一显示「待复习」） */
export function formatDueAt(dueAt: number, now: number): string {
  const at = safeNow(now)
  const due = typeof dueAt === 'number' && Number.isFinite(dueAt) ? Math.max(0, Math.round(dueAt)) : 0
  if (due <= at) return '待复习'
  const diff = due - at
  if (diff < 3_600_000) return `${Math.max(1, Math.ceil(diff / 60_000))} 分钟后`
  if (diff < DAY_MS) return `${Math.ceil(diff / 3_600_000)} 小时后`
  const days = Math.ceil(diff / DAY_MS)
  if (days < 30) return `${days} 天后`
  if (days < 365) return `${Math.round(days / 30)} 个月后`
  return '一年后'
}

/**
 * 核心遗忘曲线计算（SM-2 简化版，纯函数、可复现）：
 *   - 不认识（again）：立即回到「学习中」，10 分钟后重练，ease -0.2，遗忘次数 +1
 *   - 模糊（hard）：仍算「学习中」，间隔缩短到 60%，至少 1 天，ease -0.1
 *   - 认识（good）：算「已掌握」，间隔按 1 → 3 → 7 → 15 → 30 … 递增（×ease），ease +0.1
 * 任何评级都会把最近学习时间更新为 now，并写回 dueAt。
 */
export function reviewWord(
  prev: WordProgress | null | undefined,
  grade: WordReviewGrade,
  now: number
): WordProgress {
  const base = sanitizeWordProgress(prev ?? {})
  const at = safeNow(now)
  const g = toGrade(grade)
  const seen = base.seen + 1

  if (g === 'again') {
    return {
      status: 'learning',
      seen,
      remembered: base.remembered,
      lastSeenAt: at,
      dueAt: at + WORD_AGAIN_DELAY_MS,
      intervalDays: 0,
      ease: Math.max(WORD_EASE_MIN, Math.round((base.ease - 0.2) * 100) / 100),
      streak: 0,
      lapses: base.lapses + 1
    }
  }

  if (g === 'hard') {
    const intervalDays =
      base.intervalDays < 1 ? 1 : Math.max(1, Math.round(base.intervalDays * 0.6))
    return {
      status: 'learning',
      seen,
      remembered: base.remembered,
      lastSeenAt: at,
      dueAt: at + intervalDays * DAY_MS,
      intervalDays: Math.min(WORD_MAX_INTERVAL_DAYS, intervalDays),
      ease: Math.max(WORD_EASE_MIN, Math.round((base.ease - 0.1) * 100) / 100),
      streak: 0,
      lapses: base.lapses
    }
  }

  const streak = base.streak + 1
  let intervalDays: number
  if (streak <= 1) intervalDays = 1
  else if (streak === 2) intervalDays = 3
  else if (streak === 3) intervalDays = 7
  else {
    intervalDays = Math.max(
      base.intervalDays + 1,
      Math.round(base.intervalDays * base.ease)
    )
  }
  intervalDays = Math.max(1, Math.min(WORD_MAX_INTERVAL_DAYS, intervalDays))
  return {
    status: 'mastered',
    seen,
    remembered: base.remembered + 1,
    lastSeenAt: at,
    dueAt: at + intervalDays * DAY_MS,
    intervalDays,
    ease: Math.min(WORD_EASE_MAX, Math.round((base.ease + 0.1) * 100) / 100),
    streak,
    lapses: base.lapses
  }
}

/**
 * 手动改学习状态（单词表里的状态下拉用，不当作一次复习）：
 *   - 未学：清空该词进度（由进度表丢弃，回到 untouched）
 *   - 学习中：立即到期，下一轮复习优先出现
 *   - 已掌握：明天起按 1 天间隔排期，streak 至少记 1
 */
export function setWordStatus(
  prev: WordProgress | null | undefined,
  status: WordStatus,
  now: number
): WordProgress {
  const base = sanitizeWordProgress(prev ?? {})
  const at = safeNow(now)
  if (status === 'new') return sanitizeWordProgress({})
  if (status === 'learning') {
    return { ...base, status: 'learning', streak: 0, intervalDays: 0, dueAt: at }
  }
  const intervalDays = Math.max(1, base.intervalDays)
  return {
    ...base,
    status: 'mastered',
    streak: Math.max(1, base.streak),
    intervalDays,
    dueAt: at + intervalDays * DAY_MS
  }
}

/** 现在是否到期待复习（未学 / 无进度不算待复习） */
export function isWordDue(progress: WordProgress | null | undefined, now: number): boolean {
  if (!progress || progress.status === 'new') return false
  return progress.dueAt <= safeNow(now)
}

/** 复习计划短标签：未学 / 待复习 / 3 天后 … */
export function wordDueLabel(progress: WordProgress | null | undefined, now: number): string {
  if (!progress || progress.status === 'new') return '未学'
  if (isWordDue(progress, now)) return '待复习'
  return formatDueAt(progress.dueAt, now)
}

/** 复习统计：在 WordBankStats 基础上加「待复习」口径 */
export function wordBankReviewStats(bank: WordBank, now: number): WordBankReviewStats {
  const base = wordBankStats(bank)
  let due = 0
  for (const entry of bank.words) {
    const progress = bank.progress[normalizeWordKey(entry.word)]
    if (isWordDue(progress, now)) due += 1
  }
  return { ...base, due }
}

/**
 * 按状态整理单词表：筛选 + 关键词（单词 / 释义，大小写不敏感）。
 * 返回顺序与词库一致，调用方再用 `sortWordList` 排序。
 */
export function filterWordBank(
  bank: WordBank,
  filter: WordFilter,
  now: number,
  query = ''
): WordListItem[] {
  const at = safeNow(now)
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const items: WordListItem[] = []
  for (const entry of bank.words) {
    const key = normalizeWordKey(entry.word)
    const progress = bank.progress[key] ?? null
    const status = progress?.status ?? 'new'
    const due = isWordDue(progress, at)
    if (filter === 'due' && !due) continue
    if (filter === 'new' && status !== 'new') continue
    if (filter === 'learning' && status !== 'learning') continue
    if (filter === 'mastered' && status !== 'mastered') continue
    if (needle.length > 0) {
      const haystack = `${entry.word} ${entry.meaning}`.toLowerCase()
      if (!haystack.includes(needle)) continue
    }
    items.push({
      key,
      entry,
      progress,
      status,
      due,
      dueLabel: wordDueLabel(progress, at)
    })
  }
  return items
}

/**
 * 单词表排序：词库顺序 / 到期优先（到期的排最前，按 dueAt 升序）/ 字母 A→Z。
 * 返回新数组，不修改入参。
 */
export function sortWordList(items: readonly WordListItem[], sort: WordSort): WordListItem[] {
  const copy = [...items]
  if (sort === 'alpha') {
    return copy.sort((a, b) =>
      a.entry.word.localeCompare(b.entry.word, 'en', { sensitivity: 'base' })
    )
  }
  if (sort === 'due') {
    const indexOf = new Map(copy.map((item, index) => [item.key, index]))
    return copy.sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1
      if (a.due && b.due) {
        const diff = (a.progress?.dueAt ?? 0) - (b.progress?.dueAt ?? 0)
        if (diff !== 0) return diff
      }
      return (indexOf.get(a.key) ?? 0) - (indexOf.get(b.key) ?? 0)
    })
  }
  return copy
}

/**
 * 学习队列（返回归一化 key 列表）：
 *   - onlyDue=true：只排到期待复习的词，按到期时间从早到晚
 *   - options.reviewFirst=true：到期的词排前面，其余保持词库 / 随机顺序
 * 渲染层只在「词库变化 / 选项变化 / 手动切换复习模式」时重排，标记单词不重排队列
 * （否则当前词位置会跳动）。
 */
export function studyQueueKeys(
  bank: WordBank,
  options: Pick<WordStudyOptions, 'shuffle' | 'reviewFirst'>,
  now: number,
  onlyDue = false
): string[] {
  const at = safeNow(now)
  const entries = orderWordsForStudy(bank, options.shuffle)
  const dueEntries: { key: string; dueAt: number }[] = []
  const restKeys: string[] = []
  for (const entry of entries) {
    const key = normalizeWordKey(entry.word)
    const progress = bank.progress[key]
    if (isWordDue(progress, at)) dueEntries.push({ key, dueAt: progress?.dueAt ?? 0 })
    else restKeys.push(key)
  }
  dueEntries.sort((a, b) => a.dueAt - b.dueAt || a.key.localeCompare(b.key))
  const dueKeys = dueEntries.map((item) => item.key)
  if (onlyDue) return dueKeys
  // 不优先复习时保持词库 / 随机顺序（到期词不提前）
  if (!options.reviewFirst) return entries.map((entry) => normalizeWordKey(entry.word))
  return [...dueKeys, ...restKeys]
}

/** 在词库快照上应用一次复习评级，返回新快照（纯函数，渲染层乐观更新用） */
export function applyWordReview(
  bank: WordBank,
  key: string,
  grade: WordReviewGrade,
  now: number
): WordBank {
  const normalized = normalizeWordKey(key)
  return {
    ...bank,
    progress: {
      ...bank.progress,
      [normalized]: reviewWord(bank.progress[normalized], grade, now)
    }
  }
}

/** 在词库快照上手动设置状态，返回新快照（未学 = 删除进度条目） */
export function applyWordStatus(
  bank: WordBank,
  key: string,
  status: WordStatus,
  now: number
): WordBank {
  const normalized = normalizeWordKey(key)
  const progress = { ...bank.progress }
  if (status === 'new') {
    delete progress[normalized]
  } else {
    progress[normalized] = setWordStatus(bank.progress[normalized], status, now)
  }
  return { ...bank, progress }
}

/**
 * 默认词库：59 个高频英语单词（含音标 / 中文释义 / 例句）。
 * 用户可整体替换 wordbank.json，这里的种子只在「首次运行 / 恢复默认词库」时使用。
 */
export const DEFAULT_WORDS: readonly WordEntry[] = Object.freeze([
  { word: 'ability', phonetic: '/əˈbɪləti/', meaning: 'n. 能力；才能', example: 'She has the ability to learn quickly.' },
  { word: 'achieve', phonetic: '/əˈtʃiːv/', meaning: 'v. 实现；达到', example: 'He worked hard to achieve his goal.' },
  { word: 'adapt', phonetic: '/əˈdæpt/', meaning: 'v. 适应；改编', example: 'It takes time to adapt to a new job.' },
  { word: 'advantage', phonetic: '/ədˈvɑːntɪdʒ/', meaning: 'n. 优势；好处', example: 'Speaking two languages is a big advantage.' },
  { word: 'approach', phonetic: '/əˈprəʊtʃ/', meaning: 'n. 方法 v. 接近', example: 'We need a different approach to this problem.' },
  { word: 'benefit', phonetic: '/ˈbenɪfɪt/', meaning: 'n. 益处 v. 受益', example: 'Regular exercise benefits your health.' },
  { word: 'challenge', phonetic: '/ˈtʃælɪndʒ/', meaning: 'n. 挑战 v. 质疑', example: 'Learning English is a fun challenge.' },
  { word: 'communicate', phonetic: '/kəˈmjuːnɪkeɪt/', meaning: 'v. 交流；传达', example: 'We communicate by email every day.' },
  { word: 'compare', phonetic: '/kəmˈpeə(r)/', meaning: 'v. 比较；对比', example: 'Compare the two answers before you choose.' },
  { word: 'concentrate', phonetic: '/ˈkɒnsntreɪt/', meaning: 'v. 集中；专注', example: 'It is hard to concentrate in a noisy room.' },
  { word: 'confident', phonetic: '/ˈkɒnfɪdənt/', meaning: 'adj. 自信的', example: 'She feels confident about the interview.' },
  { word: 'consider', phonetic: '/kənˈsɪdə(r)/', meaning: 'v. 考虑；认为', example: 'Please consider my suggestion.' },
  { word: 'contribute', phonetic: '/kənˈtrɪbjuːt/', meaning: 'v. 贡献；促成', example: 'Everyone can contribute to the project.' },
  { word: 'create', phonetic: '/kriˈeɪt/', meaning: 'v. 创造；创建', example: 'They create short videos for the class.' },
  { word: 'curious', phonetic: '/ˈkjʊəriəs/', meaning: 'adj. 好奇的', example: 'Children are curious about the world.' },
  { word: 'decide', phonetic: '/dɪˈsaɪd/', meaning: 'v. 决定', example: 'You should decide before Friday.' },
  { word: 'develop', phonetic: '/dɪˈveləp/', meaning: 'v. 发展；培养', example: 'Reading helps you develop a larger vocabulary.' },
  { word: 'efficient', phonetic: '/ɪˈfɪʃnt/', meaning: 'adj. 高效的', example: 'This is a more efficient way to study.' },
  { word: 'encourage', phonetic: '/ɪnˈkʌrɪdʒ/', meaning: 'v. 鼓励；促进', example: 'My teacher encouraged me to try again.' },
  { word: 'environment', phonetic: '/ɪnˈvaɪrənmənt/', meaning: 'n. 环境', example: 'We should protect the environment.' },
  { word: 'essential', phonetic: '/ɪˈsenʃl/', meaning: 'adj. 必要的；本质的', example: 'Water is essential for life.' },
  { word: 'establish', phonetic: '/ɪˈstæblɪʃ/', meaning: 'v. 建立；确立', example: 'The company was established in 2005.' },
  { word: 'evaluate', phonetic: '/ɪˈvæljueɪt/', meaning: 'v. 评估；评价', example: 'We need to evaluate the results first.' },
  { word: 'evidence', phonetic: '/ˈevɪdəns/', meaning: 'n. 证据', example: 'There is no evidence for that claim.' },
  { word: 'expand', phonetic: '/ɪkˈspænd/', meaning: 'v. 扩大；扩展', example: 'The company plans to expand into Asia.' },
  { word: 'familiar', phonetic: '/fəˈmɪliə(r)/', meaning: 'adj. 熟悉的', example: 'That name sounds familiar to me.' },
  { word: 'flexible', phonetic: '/ˈfleksəbl/', meaning: 'adj. 灵活的；可变通的', example: 'Our schedule is flexible this week.' },
  { word: 'focus', phonetic: '/ˈfəʊkəs/', meaning: 'n./v. 专注；焦点', example: 'Focus on one task at a time.' },
  { word: 'generate', phonetic: '/ˈdʒenəreɪt/', meaning: 'v. 产生；生成', example: 'Solar panels generate electricity.' },
  { word: 'habit', phonetic: '/ˈhæbɪt/', meaning: 'n. 习惯', example: 'Reviewing words daily is a good habit.' },
  { word: 'identify', phonetic: '/aɪˈdentɪfaɪ/', meaning: 'v. 识别；确认', example: 'Can you identify the mistake in this sentence?' },
  { word: 'improve', phonetic: '/ɪmˈpruːv/', meaning: 'v. 改善；提高', example: 'Practice will improve your pronunciation.' },
  { word: 'include', phonetic: '/ɪnˈkluːd/', meaning: 'v. 包括；包含', example: 'The price includes breakfast.' },
  { word: 'influence', phonetic: '/ˈɪnfluəns/', meaning: 'n./v. 影响', example: 'Friends can influence your decisions.' },
  { word: 'inspire', phonetic: '/ɪnˈspaɪə(r)/', meaning: 'v. 激励；启发', example: 'Her story inspired many people.' },
  { word: 'involve', phonetic: '/ɪnˈvɒlv/', meaning: 'v. 涉及；使参与', example: 'The job involves a lot of travel.' },
  { word: 'maintain', phonetic: '/meɪnˈteɪn/', meaning: 'v. 保持；维护', example: 'Maintain a steady pace while running.' },
  { word: 'motivate', phonetic: '/ˈməʊtɪveɪt/', meaning: 'v. 激励；促使', example: 'Small goals motivate us to keep going.' },
  { word: 'opportunity', phonetic: '/ˌɒpəˈtjuːnəti/', meaning: 'n. 机会', example: 'This job is a great opportunity.' },
  { word: 'organize', phonetic: '/ˈɔːɡənaɪz/', meaning: 'v. 组织；整理', example: 'She organized the files by date.' },
  { word: 'participate', phonetic: '/pɑːˈtɪsɪpeɪt/', meaning: 'v. 参加；参与', example: 'Everyone participated in the discussion.' },
  { word: 'perform', phonetic: '/pəˈfɔːm/', meaning: 'v. 表演；执行', example: 'The team performed well under pressure.' },
  { word: 'practical', phonetic: '/ˈpræktɪkl/', meaning: 'adj. 实用的；实际的', example: 'We need a practical solution.' },
  { word: 'prevent', phonetic: '/prɪˈvent/', meaning: 'v. 阻止；预防', example: 'Wash your hands to prevent illness.' },
  { word: 'provide', phonetic: '/prəˈvaɪd/', meaning: 'v. 提供', example: 'The school provides free Wi-Fi.' },
  { word: 'recognize', phonetic: '/ˈrekəɡnaɪz/', meaning: 'v. 认出；承认', example: 'I recognized her voice at once.' },
  { word: 'reduce', phonetic: '/rɪˈdjuːs/', meaning: 'v. 减少；降低', example: 'Try to reduce screen time before bed.' },
  { word: 'reliable', phonetic: '/rɪˈlaɪəbl/', meaning: 'adj. 可靠的', example: 'He is a reliable teammate.' },
  { word: 'require', phonetic: '/rɪˈkwaɪə(r)/', meaning: 'v. 需要；要求', example: 'The job requires good English.' },
  { word: 'respond', phonetic: '/rɪˈspɒnd/', meaning: 'v. 回应；响应', example: 'Please respond to the email today.' },
  { word: 'responsible', phonetic: '/rɪˈspɒnsəbl/', meaning: 'adj. 负责的', example: 'She is responsible for the report.' },
  { word: 'select', phonetic: '/sɪˈlekt/', meaning: 'v. 选择；挑选', example: 'Select the answer that fits best.' },
  { word: 'significant', phonetic: '/sɪɡˈnɪfɪkənt/', meaning: 'adj. 重要的；显著的', example: 'There was a significant change in sales.' },
  { word: 'strategy', phonetic: '/ˈstrætədʒi/', meaning: 'n. 策略；战略', example: 'We need a better study strategy.' },
  { word: 'succeed', phonetic: '/səkˈsiːd/', meaning: 'v. 成功', example: 'You will succeed if you keep trying.' },
  { word: 'support', phonetic: '/səˈpɔːt/', meaning: 'n./v. 支持', example: 'My family supports my decision.' },
  { word: 'survive', phonetic: '/səˈvaɪv/', meaning: 'v. 幸存；挺过', example: 'Few plants survive in the desert.' },
  { word: 'understand', phonetic: '/ˌʌndəˈstænd/', meaning: 'v. 理解；明白', example: 'I understand the question now.' },
  { word: 'value', phonetic: '/ˈvæljuː/', meaning: 'n. 价值 v. 重视', example: 'We value honest feedback.' }
] as readonly WordEntry[])
