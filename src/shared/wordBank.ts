/**
 * Nexus Dock — v1.8 英语单词学习（附加窗口 `wordstudy`）共享契约。
 *
 * 本文件是「词库」的唯一真源，**纯函数、零依赖**（不 import electron / 不 import 其他共享模块），
 * 因此主进程、preload、单词窗口、设置页与 `npm test` 契约测试可以共用同一份收敛逻辑。
 *
 * 存储模型（用户可自由修改）：
 *   - userData/wordbank.json          { version, words: [{ word, phonetic, meaning, example }] }
 *   - userData/wordbank-progress.json { version, progress: { "<单词key>": { status, seen, remembered, lastSeenAt } } }
 * 两个文件都能被用户直接用文本编辑器改；界面上也提供导入 / 导出 / 恢复默认 / 重新读取文件。
 * 进度按「单词归一化 key」关联，词条只有 word 一个必填字段：手写 JSON 时写
 *   [{"word":"apple","meaning":"苹果"}] 或 {"words":[...]} 都能被识别。
 */

/** 附加窗口注册表 kind（同时是 settings.extraWindows 里的实例键） */
export const WORD_STUDY_KIND = 'wordstudy'
/** 词库文件（words 列表，可自由替换） */
export const WORD_BANK_FILE = 'wordbank.json'
/** 学习进度文件（与词库分离，换词库不影响学习记录结构） */
export const WORD_PROGRESS_FILE = 'wordbank-progress.json'
/** 词库文件格式版本（向后兼容扩展用，非 settings.schemaVersion） */
export const WORD_BANK_VERSION = 1
export const WORD_PROGRESS_VERSION = 1

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

/** 单个词的学习进度 */
export interface WordProgress {
  status: WordStatus
  /** 出现次数 */
  seen: number
  /** 记住次数（「认识」点了几次） */
  remembered: number
  /** 最近一次学习时间戳（ms） */
  lastSeenAt: number
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
  autoNext: true
} as const

export interface WordStudyOptions {
  showPhonetic: boolean
  showExample: boolean
  hideMeaning: boolean
  shuffle: boolean
  autoNext: boolean
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
    autoNext: pick('autoNext')
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

/** 收敛单条进度 */
export function sanitizeWordProgress(raw: unknown): WordProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = toCount(r.seen)
  return {
    status: toStatus(r.status),
    seen,
    // 兜底一致性：记住次数不可能超过出现次数（手改 JSON 也不会写出矛盾数据）
    remembered: Math.min(toCount(r.remembered), seen),
    lastSeenAt: toTimestamp(r.lastSeenAt)
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
    // 没有任何学习记录（seen=0）的条目视为「未学」：不落盘，保持文件精简
    if (progress.seen === 0) continue
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
