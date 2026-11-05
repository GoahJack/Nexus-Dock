/**
 * v1.9 契约测试：英语单词学习词库（src/shared/wordBank.ts）。
 *
 * 目的：用户要「词库可以自由修改」，所以词库文件是手写友好的（裸数组 / {words} 都行、
 * 只有 word 必填），同时**任何脏数据都不能抛错**、不能把设置撑爆：
 *   - 词条收敛：去控制字符、截断、按归一化单词去重、上限 5000；
 *   - 进度收敛：未知单词丢弃、负数/NaN 归零、status 非法回落 new、remembered ≤ seen；
 *   - v1.8 进度（只有 status/seen/remembered/lastSeenAt）读入时迁移到 v2 遗忘曲线字段；
 *   - 遗忘曲线：again/hard/good 三档评级、ease 夹紧、间隔上限、手动改状态；
 *   - 复习计划：到期判定、复习统计、状态筛选、排序、学习队列；
 *   - 默认词库：59 词条、key 唯一、统计正确；
 *   - 窗口选项：任意脏 options 收敛为 7 个布尔默认值。
 *
 * 全部时间计算使用固定 NOW，避免 Date.now() 让断言漂移。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WORD_STUDY_OPTIONS,
  DEFAULT_WORDS,
  WORD_AGAIN_DELAY_MS,
  WORD_BANK_VERSION,
  WORD_EASE_DEFAULT,
  WORD_EASE_MAX,
  WORD_EASE_MIN,
  WORD_FILTERS,
  WORD_FILTER_LABELS,
  WORD_LIMITS,
  WORD_MAX_INTERVAL_DAYS,
  WORD_PROGRESS_VERSION,
  WORD_REVIEW_GRADES,
  WORD_REVIEW_GRADE_LABELS,
  WORD_SORTS,
  WORD_SORT_LABELS,
  WORD_STATUS_LABELS,
  WORD_STATUSES,
  WORD_STUDY_KIND,
  applyWordReview,
  applyWordStatus,
  combineWordBank,
  defaultWordBank,
  filterWordBank,
  formatDueAt,
  formatReviewInterval,
  isWordDue,
  normalizeWordKey,
  orderWordsForStudy,
  parseWordBankDocument,
  parseWordBankFile,
  resolveWordStudyOptions,
  reviewWord,
  sanitizeWordEntries,
  sanitizeWordEntry,
  sanitizeWordProgress,
  sanitizeWordProgressMap,
  setWordStatus,
  sortWordList,
  studyQueueKeys,
  wordBankReviewStats,
  wordBankStats,
  wordDueLabel
} from '../src/shared/wordBank.ts'

/** 固定「现在」：所有到期 / 排期断言都基于它，保证可复现 */
const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

/** 构造一条完整 v2 进度（默认「学习中、已到期」），按需覆盖字段 */
function progressOf(overrides = {}) {
  return {
    status: 'learning',
    seen: 1,
    remembered: 1,
    lastSeenAt: NOW,
    dueAt: NOW,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0,
    ...overrides
  }
}

test('默认词库：恰好 59 词条且 key 唯一、可被 sanitize 幂等收敛', () => {
  assert.equal(DEFAULT_WORDS.length, 59, `默认词库应为 59 词，实际 ${DEFAULT_WORDS.length}`)
  const keys = DEFAULT_WORDS.map((entry) => normalizeWordKey(entry.word))
  assert.equal(new Set(keys).size, keys.length, '默认词库存在重复单词')
  const bank = defaultWordBank()
  assert.equal(bank.version, WORD_BANK_VERSION)
  assert.equal(bank.words.length, DEFAULT_WORDS.length)
  assert.deepEqual(bank.progress, {})
  // 幂等：默认词库再收敛一次不变
  assert.deepEqual(combineWordBank(bank.words, bank.progress), bank)
  // 每个词条都有释义（种子词库质量底线）
  for (const entry of bank.words) {
    assert.ok(entry.word.length > 0)
    assert.ok(entry.meaning.length > 0, `${entry.word} 缺少释义`)
  }
  const stats = wordBankStats(bank)
  assert.deepEqual(stats, { total: bank.words.length, mastered: 0, learning: 0, untouched: bank.words.length })
})

test('sanitizeWordEntry：word 必填、文本去控制字符并截断', () => {
  assert.equal(sanitizeWordEntry(null), null)
  assert.equal(sanitizeWordEntry({ word: '' }), null)
  assert.equal(sanitizeWordEntry({ word: '   ' }), null)
  assert.equal(sanitizeWordEntry({ word: 123 }), null)
  assert.equal(sanitizeWordEntry(['apple']), null)
  const entry = sanitizeWordEntry({
    word: '  apple  ',
    phonetic: ' /ˈæpl/ ',
    meaning: 'n. \u0000苹果',
    example: 'a\u007f red apple',
    extra: 'ignored'
  })
  assert.deepEqual(entry, {
    word: 'apple',
    phonetic: '/ˈæpl/',
    meaning: 'n. 苹果',
    example: 'a red apple'
  })
  // 超长字段截断到上限，不抛错
  const long = sanitizeWordEntry({ word: 'w'.repeat(500), meaning: 'm'.repeat(500) })
  assert.equal(long.word.length, WORD_LIMITS.word)
  assert.equal(long.meaning.length, WORD_LIMITS.meaning)
  // 多词短语保留（按空格归一化 key）
  assert.equal(normalizeWordKey('  Give   Up '), 'give up')
})

test('sanitizeWordEntries：兼容裸数组 / {words} / {version,words}，去重且限流', () => {
  for (const raw of [undefined, null, 0, 'x', {}, { words: 'nope' }, [null, 1, 'x']]) {
    assert.deepEqual(sanitizeWordEntries(raw), [], `sanitizeWordEntries(${JSON.stringify(raw)})`)
  }
  const list = [
    { word: 'Apple', meaning: '苹果' },
    { word: 'apple', meaning: '重复项（大小写不同）' },
    { word: '  BANANA ', meaning: '香蕉' },
    { word: '', meaning: '无单词' }
  ]
  const entries = sanitizeWordEntries(list)
  assert.deepEqual(
    entries.map((entry) => entry.word),
    ['Apple', 'BANANA'],
    '按归一化 key 去重，保留先出现者（原文大小写）'
  )
  // { words } / { version, words } 与裸数组等价
  assert.deepEqual(sanitizeWordEntries({ words: list }), entries)
  assert.deepEqual(sanitizeWordEntries({ version: 1, words: list }), entries)
  assert.deepEqual(parseWordBankFile({ words: list }), entries)
  // 上限：5001 条 → 5000 条
  const many = Array.from({ length: WORD_LIMITS.maxWords + 1 }, (_, i) => ({ word: `w${i}` }))
  assert.equal(sanitizeWordEntries(many).length, WORD_LIMITS.maxWords)
})

test('sanitizeWordProgressMap：未知词丢弃、数值夹紧、手动状态保留', () => {
  const words = [{ word: 'apple' }, { word: 'give up' }, { word: 'pear' }]
  const progress = sanitizeWordProgressMap(
    {
      progress: {
        Apple: { status: 'mastered', seen: 3, remembered: 9, lastSeenAt: 1234 },
        'give up': { status: 'learning', seen: -2, remembered: -5, lastSeenAt: 'x' },
        pear: { status: 'new', seen: 0 },
        ghost: { status: 'mastered', seen: 2 },
        'not a word': { status: 'learning', seen: 1 }
      }
    },
    words
  )
  assert.deepEqual(Object.keys(progress).sort(), ['apple', 'give up'])
  assert.deepEqual(progress.apple, {
    status: 'mastered',
    seen: 3,
    remembered: 3,
    lastSeenAt: 1234,
    dueAt: 1234,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0
  })
  // v1.9：手动标成 learning 的词即使 seen=0 也保留（不再是「无进展」被丢弃）
  assert.deepEqual(progress['give up'], {
    status: 'learning',
    seen: 0,
    remembered: 0,
    lastSeenAt: 0,
    dueAt: 0,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0
  })
  // 真正未学（new + seen=0）的条目不落盘
  assert.equal('pear' in progress, false)
  // 手动改状态可直接持久化
  const manual = sanitizeWordProgressMap({ pear: { status: 'mastered' } }, words)
  assert.deepEqual(Object.keys(manual), ['pear'])
  assert.equal(manual.pear.status, 'mastered')
  assert.equal(manual.pear.seen, 0)
  // 非法 status 回落 new
  assert.equal(sanitizeWordProgress({ status: 'weird' }).status, 'new')
  assert.deepEqual(sanitizeWordProgress(null), {
    status: 'new',
    seen: 0,
    remembered: 0,
    lastSeenAt: 0,
    dueAt: 0,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0
  })
  // 裸进度表（没有 progress 包裹）也能识别
  const bare = sanitizeWordProgressMap({ apple: { status: 'learning', seen: 1 } }, words)
  assert.deepEqual(bare, {
    apple: {
      status: 'learning',
      seen: 1,
      remembered: 0,
      lastSeenAt: 0,
      dueAt: 0,
      intervalDays: 0,
      ease: WORD_EASE_DEFAULT,
      streak: 0,
      lapses: 0
    }
  })
  // 垃圾输入不抛错
  assert.deepEqual(sanitizeWordProgressMap(null, words), {})
  assert.deepEqual(sanitizeWordProgressMap('x', words), {})
})

test('进度字段形状：v2 固定 9 个字段，缺字段全部补齐', () => {
  assert.deepEqual(Object.keys(sanitizeWordProgress({})).sort(), [
    'dueAt',
    'ease',
    'intervalDays',
    'lapses',
    'lastSeenAt',
    'remembered',
    'seen',
    'status',
    'streak'
  ])
})

test('combineWordBank：进度按当前词库收敛，未知 key 丢弃；换词库保留同名词进度', () => {
  const bank = combineWordBank(
    [{ word: 'apple' }, { word: 'banana' }],
    {
      apple: { status: 'mastered', seen: 2, remembered: 2, lastSeenAt: 1 },
      banana: { status: 'learning', seen: 1, remembered: 0, lastSeenAt: 2 },
      cherry: { status: 'mastered', seen: 1, remembered: 1, lastSeenAt: 3 }
    }
  )
  assert.deepEqual(Object.keys(bank.progress).sort(), ['apple', 'banana'])
  assert.deepEqual(bank.words.map((entry) => entry.word), ['apple', 'banana'])
  // v1 进度被自动迁移为 v2（已学词升级后立即到期，便于第一次打开就复习）
  assert.deepEqual(bank.progress.apple, {
    status: 'mastered',
    seen: 2,
    remembered: 2,
    lastSeenAt: 1,
    dueAt: 1,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0
  })
  // 用户把词库换成只剩 apple：进度只保留 apple
  const narrowed = combineWordBank(bank.words.filter((entry) => entry.word === 'apple'), bank.progress)
  assert.deepEqual(Object.keys(narrowed.progress), ['apple'])
  // 统计
  assert.deepEqual(wordBankStats(narrowed), { total: 1, mastered: 1, learning: 0, untouched: 0 })
})

test('parseWordBankDocument：支持自包含 JSON（词条 + 可选进度），旧进度自动补 v2 字段', () => {
  const bank = parseWordBankDocument({
    version: 9,
    words: [{ word: 'apple', meaning: '苹果' }],
    progress: { apple: { status: 'learning', seen: 2, remembered: 1, lastSeenAt: 42 } }
  })
  assert.equal(bank.version, WORD_BANK_VERSION, '外部 version 不覆盖当前格式版本')
  assert.equal(bank.words.length, 1)
  assert.deepEqual(bank.progress, {
    apple: {
      status: 'learning',
      seen: 2,
      remembered: 1,
      lastSeenAt: 42,
      dueAt: 42,
      intervalDays: 0,
      ease: WORD_EASE_DEFAULT,
      streak: 0,
      lapses: 0
    }
  })
  // 显式 v2 字段原样保留
  const v2 = parseWordBankDocument({
    words: [{ word: 'apple' }],
    progress: {
      apple: progressOf({
        status: 'mastered',
        seen: 3,
        remembered: 3,
        lastSeenAt: NOW - DAY,
        dueAt: NOW + 3 * DAY,
        intervalDays: 3,
        ease: 2.7,
        streak: 2
      })
    }
  })
  assert.deepEqual(v2.progress.apple, {
    status: 'mastered',
    seen: 3,
    remembered: 3,
    lastSeenAt: NOW - DAY,
    dueAt: NOW + 3 * DAY,
    intervalDays: 3,
    ease: 2.7,
    streak: 2,
    lapses: 0
  })
  // 无进度字段 → 空进度
  assert.deepEqual(parseWordBankDocument({ words: [{ word: 'x' }] }).progress, {})
  assert.deepEqual(parseWordBankDocument(null).words, [])
})

test('resolveWordStudyOptions：脏 options 收敛为 7 个布尔默认值', () => {
  assert.deepEqual(resolveWordStudyOptions(undefined), { ...DEFAULT_WORD_STUDY_OPTIONS })
  assert.deepEqual(resolveWordStudyOptions(null), { ...DEFAULT_WORD_STUDY_OPTIONS })
  assert.deepEqual(resolveWordStudyOptions({ showPhonetic: 'yes', shuffle: true, hideMeaning: false }), {
    showPhonetic: true,
    showExample: true,
    hideMeaning: false,
    shuffle: true,
    autoNext: true,
    reviewFirst: true,
    showSchedule: true
  })
  // 数值/对象等非布尔值一律回落默认值
  assert.equal(resolveWordStudyOptions({ autoNext: 0 }).autoNext, true)
  // v1.9 新选项：显式 false 生效，脏值回落 true
  const disabled = resolveWordStudyOptions({ reviewFirst: false, showSchedule: false })
  assert.equal(disabled.reviewFirst, false)
  assert.equal(disabled.showSchedule, false)
  assert.equal(resolveWordStudyOptions({ reviewFirst: 'yes', showSchedule: 1 }).reviewFirst, true)
  assert.equal(resolveWordStudyOptions({ reviewFirst: 'yes', showSchedule: 1 }).showSchedule, true)
  // 选项闭包：默认值恰好 7 个键，设置页 7 个开关据此渲染
  assert.deepEqual(Object.keys(DEFAULT_WORD_STUDY_OPTIONS).sort(), [
    'autoNext',
    'hideMeaning',
    'reviewFirst',
    'showExample',
    'showPhonetic',
    'showSchedule',
    'shuffle'
  ])
})

test('orderWordsForStudy：非随机保持词库顺序，随机保持同一集合', () => {
  const bank = defaultWordBank()
  const ordered = orderWordsForStudy(bank, false)
  assert.deepEqual(
    ordered.map((entry) => normalizeWordKey(entry.word)),
    bank.words.map((entry) => normalizeWordKey(entry.word))
  )
  assert.notEqual(ordered, bank.words, '必须返回新数组，不能污染词库状态')
  const shuffled = orderWordsForStudy(bank, true)
  assert.equal(shuffled.length, bank.words.length)
  assert.deepEqual(
    shuffled.map((entry) => normalizeWordKey(entry.word)).sort(),
    bank.words.map((entry) => normalizeWordKey(entry.word)).sort()
  )
})

test('v1.9 常量门禁：kind / 版本 / 枚举 / 标签 / 数值上限', () => {
  assert.equal(WORD_STUDY_KIND, 'wordstudy')
  assert.equal(WORD_BANK_VERSION, 1)
  assert.equal(WORD_PROGRESS_VERSION, 2, '进度格式升级到 v2（遗忘曲线字段）')
  assert.deepEqual([...WORD_STATUSES], ['new', 'learning', 'mastered'])
  assert.deepEqual([...WORD_REVIEW_GRADES], ['again', 'hard', 'good'])
  assert.deepEqual([...WORD_FILTERS], ['all', 'due', 'new', 'learning', 'mastered'])
  assert.deepEqual([...WORD_SORTS], ['bank', 'due', 'alpha'])
  // 每个枚举都有中文标签（UI 下拉 / 筛选按钮直接渲染）
  assert.deepEqual(WORD_STATUS_LABELS, { new: '未学', learning: '学习中', mastered: '已掌握' })
  assert.deepEqual(WORD_REVIEW_GRADE_LABELS, { again: '不认识', hard: '模糊', good: '认识' })
  assert.deepEqual(WORD_FILTER_LABELS, {
    all: '全部',
    due: '待复习',
    new: '未学',
    learning: '学习中',
    mastered: '已掌握'
  })
  assert.deepEqual(WORD_SORT_LABELS, { bank: '词库顺序', due: '到期优先', alpha: '字母 A→Z' })
  // 遗忘曲线参数
  assert.equal(WORD_EASE_DEFAULT, 2.5)
  assert.equal(WORD_EASE_MIN, 1.3)
  assert.equal(WORD_EASE_MAX, 2.8)
  assert.equal(WORD_AGAIN_DELAY_MS, 10 * 60 * 1000)
  assert.equal(WORD_MAX_INTERVAL_DAYS, 365)
  assert.deepEqual(WORD_LIMITS, { maxWords: 5000, word: 64, phonetic: 64, meaning: 200, example: 300 })
})

test('v1.8 → v1.9 进度迁移：已学词立即到期、显式 v2 字段不覆盖、ease/间隔夹紧', () => {
  // 旧进度没有 dueAt → dueAt 取 lastSeenAt（升级后第一次打开即可复习）
  assert.deepEqual(sanitizeWordProgress({ status: 'mastered', seen: 3, remembered: 2, lastSeenAt: 123 }), {
    status: 'mastered',
    seen: 3,
    remembered: 2,
    lastSeenAt: 123,
    dueAt: 123,
    intervalDays: 0,
    ease: WORD_EASE_DEFAULT,
    streak: 0,
    lapses: 0
  })
  const bank = combineWordBank([{ word: 'apple' }, { word: 'banana' }], {
    apple: { status: 'mastered', seen: 3, remembered: 2, lastSeenAt: 123 },
    banana: { status: 'new', seen: 0 }
  })
  assert.equal(isWordDue(bank.progress.apple, NOW), true, '迁移后的已学词应进入待复习')
  assert.equal(wordBankReviewStats(bank, NOW).due, 1)
  // 显式 v2 dueAt 不被迁移逻辑覆盖
  const explicit = sanitizeWordProgress({
    status: 'learning',
    seen: 1,
    remembered: 0,
    lastSeenAt: 10,
    dueAt: NOW,
    intervalDays: 2,
    ease: 2.2,
    streak: 1,
    lapses: 2
  })
  assert.equal(explicit.dueAt, NOW)
  assert.equal(explicit.intervalDays, 2)
  assert.equal(explicit.ease, 2.2)
  // 未学强制清空排期
  const fresh = sanitizeWordProgress({
    status: 'new',
    seen: 4,
    remembered: 2,
    lastSeenAt: 99,
    dueAt: 12345,
    intervalDays: 9,
    streak: 3
  })
  assert.equal(fresh.dueAt, 0)
  assert.equal(fresh.intervalDays, 0)
  assert.equal(fresh.streak, 0)
  // ease 夹紧在 1.3–2.8
  assert.equal(sanitizeWordProgress({ status: 'learning', ease: 9 }).ease, WORD_EASE_MAX)
  assert.equal(sanitizeWordProgress({ status: 'learning', ease: 0 }).ease, WORD_EASE_MIN)
  // 间隔天数夹紧在 0–365
  assert.equal(
    sanitizeWordProgress({ status: 'learning', seen: 1, dueAt: 1, intervalDays: 9999 }).intervalDays,
    WORD_MAX_INTERVAL_DAYS
  )
  assert.equal(sanitizeWordProgress({ status: 'learning', seen: 1, dueAt: 1, intervalDays: -3 }).intervalDays, 0)
})

test('reviewWord(good)：1 → 3 → 7 → ×ease 的间隔阶梯，ease 封顶 2.8', () => {
  // 第一次「认识」：明天再复习
  const first = reviewWord(null, 'good', NOW)
  assert.deepEqual(first, {
    status: 'mastered',
    seen: 1,
    remembered: 1,
    lastSeenAt: NOW,
    dueAt: NOW + DAY,
    intervalDays: 1,
    ease: 2.6,
    streak: 1,
    lapses: 0
  })
  // 第二次：3 天后
  const second = reviewWord(first, 'good', NOW)
  assert.equal(second.intervalDays, 3)
  assert.equal(second.streak, 2)
  assert.equal(second.ease, 2.7)
  assert.equal(second.remembered, 2)
  assert.equal(second.seen, 2)
  assert.equal(second.dueAt, NOW + 3 * DAY)
  // 第三次：7 天后
  const third = reviewWord(second, 'good', NOW)
  assert.equal(third.intervalDays, 7)
  assert.equal(third.streak, 3)
  assert.equal(third.ease, 2.8)
  assert.equal(third.remembered, 3)
  assert.equal(third.dueAt, NOW + 7 * DAY)
  // 第四次：7 × 2.8 = 19.6 → 20 天后，ease 不越过上限
  const fourth = reviewWord(third, 'good', NOW)
  assert.equal(fourth.intervalDays, 20)
  assert.equal(fourth.streak, 4)
  assert.equal(fourth.ease, WORD_EASE_MAX)
  assert.equal(fourth.remembered, 4)
  assert.equal(fourth.seen, 4)
  assert.equal(fourth.dueAt, NOW + 20 * DAY)
  // 间隔上限 365 天
  const capped = reviewWord(
    progressOf({ status: 'mastered', seen: 9, remembered: 9, streak: 7, intervalDays: 300, ease: WORD_EASE_MAX }),
    'good',
    NOW
  )
  assert.equal(capped.intervalDays, WORD_MAX_INTERVAL_DAYS)
  assert.equal(capped.dueAt, NOW + WORD_MAX_INTERVAL_DAYS * DAY)
  assert.equal(capped.streak, 8)
  // v1 旧进度（无 v2 字段）也能继续复习
  const legacy = reviewWord({ status: 'mastered', seen: 3, remembered: 2, lastSeenAt: 123 }, 'good', NOW)
  assert.equal(legacy.seen, 4)
  assert.equal(legacy.remembered, 3)
  assert.equal(legacy.intervalDays, 1)
  assert.equal(legacy.ease, 2.6)
  assert.equal(legacy.dueAt, NOW + DAY)
})

test('reviewWord(again)：回到学习中、10 分钟后重练、ease -0.2、lapses +1', () => {
  const mastered = progressOf({
    status: 'mastered',
    seen: 5,
    remembered: 4,
    streak: 3,
    intervalDays: 7,
    ease: 2.8,
    dueAt: NOW + 7 * DAY
  })
  assert.deepEqual(reviewWord(mastered, 'again', NOW), {
    status: 'learning',
    seen: 6,
    remembered: 4,
    lastSeenAt: NOW,
    dueAt: NOW + WORD_AGAIN_DELAY_MS,
    intervalDays: 0,
    ease: 2.6,
    streak: 0,
    lapses: 1
  })
  // ease 下限 1.3
  assert.equal(reviewWord(progressOf({ ease: WORD_EASE_MIN }), 'again', NOW).ease, WORD_EASE_MIN)
  // 没有进度也能直接记录
  const first = reviewWord(null, 'again', NOW)
  assert.equal(first.status, 'learning')
  assert.equal(first.seen, 1)
  assert.equal(first.remembered, 0)
  assert.equal(first.ease, 2.3)
  assert.equal(first.dueAt, NOW + WORD_AGAIN_DELAY_MS)
  assert.equal(first.intervalDays, 0)
  assert.equal(first.streak, 0)
  assert.equal(first.lapses, 1)
})

test('reviewWord(hard)：仍为学习中、间隔缩短到 60%（至少 1 天）、ease -0.1', () => {
  const mastered = progressOf({
    status: 'mastered',
    seen: 4,
    remembered: 3,
    streak: 2,
    intervalDays: 7,
    ease: 2.6,
    dueAt: NOW + 7 * DAY
  })
  assert.deepEqual(reviewWord(mastered, 'hard', NOW), {
    status: 'learning',
    seen: 5,
    remembered: 3,
    lastSeenAt: NOW,
    dueAt: NOW + 4 * DAY,
    intervalDays: 4,
    ease: 2.5,
    streak: 0,
    lapses: 0
  })
  // 没有进度：至少 1 天后
  const first = reviewWord(null, 'hard', NOW)
  assert.equal(first.status, 'learning')
  assert.equal(first.intervalDays, 1)
  assert.equal(first.dueAt, NOW + DAY)
  assert.equal(first.ease, 2.4)
  // 1 天间隔收缩后仍 ≥ 1 天
  assert.equal(reviewWord(progressOf({ status: 'mastered', intervalDays: 1 }), 'hard', NOW).intervalDays, 1)
  // ease 下限 1.3
  assert.equal(reviewWord(progressOf({ ease: WORD_EASE_MIN }), 'hard', NOW).ease, WORD_EASE_MIN)
})

test('setWordStatus：手动改状态——未学清空、学习中立即到期、已掌握至少 1 天', () => {
  const mastered = progressOf({
    status: 'mastered',
    seen: 5,
    remembered: 4,
    streak: 3,
    intervalDays: 7,
    ease: 2.8,
    dueAt: NOW + 7 * DAY,
    lapses: 1
  })
  assert.deepEqual(setWordStatus(mastered, 'new', NOW), sanitizeWordProgress({}))
  assert.deepEqual(setWordStatus(mastered, 'learning', NOW), {
    status: 'learning',
    seen: 5,
    remembered: 4,
    lastSeenAt: NOW,
    dueAt: NOW,
    intervalDays: 0,
    ease: 2.8,
    streak: 0,
    lapses: 1
  })
  // 未学词直接标已掌握：明天复习，streak 记 1
  assert.deepEqual(setWordStatus(null, 'mastered', NOW), {
    status: 'mastered',
    seen: 0,
    remembered: 0,
    lastSeenAt: 0,
    dueAt: NOW + DAY,
    intervalDays: 1,
    ease: WORD_EASE_DEFAULT,
    streak: 1,
    lapses: 0
  })
  // 已有间隔保留（learning interval=3 → mastered 仍按 3 天排）
  const next = setWordStatus(
    progressOf({ status: 'learning', seen: 2, remembered: 1, intervalDays: 3, streak: 0, dueAt: NOW }),
    'mastered',
    NOW
  )
  assert.equal(next.status, 'mastered')
  assert.equal(next.intervalDays, 3)
  assert.equal(next.dueAt, NOW + 3 * DAY)
  assert.equal(next.streak, 1)
})

test('formatReviewInterval / formatDueAt：复习计划标签的边界值', () => {
  assert.equal(formatReviewInterval(0), '10 分钟后')
  assert.equal(formatReviewInterval(1), '明天')
  assert.equal(formatReviewInterval(2), '2 天后')
  assert.equal(formatReviewInterval(29), '29 天后')
  assert.equal(formatReviewInterval(30), '1 个月后')
  assert.equal(formatReviewInterval(60), '2 个月后')
  assert.equal(formatReviewInterval(364), '12 个月后')
  assert.equal(formatReviewInterval(365), '一年后')
  assert.equal(formatReviewInterval(-5), '10 分钟后')
  assert.equal(formatReviewInterval(Number.NaN), '10 分钟后')

  assert.equal(formatDueAt(NOW, NOW), '待复习')
  assert.equal(formatDueAt(NOW - 1, NOW), '待复习')
  assert.equal(formatDueAt(0, NOW), '待复习')
  assert.equal(formatDueAt(NOW + 60_000, NOW), '1 分钟后')
  assert.equal(formatDueAt(NOW + 30_000, NOW), '1 分钟后')
  assert.equal(formatDueAt(NOW + 90_000, NOW), '2 分钟后')
  assert.equal(formatDueAt(NOW + 3_600_000, NOW), '1 小时后')
  assert.equal(formatDueAt(NOW + 2 * 3_600_000, NOW), '2 小时后')
  assert.equal(formatDueAt(NOW + DAY, NOW), '1 天后')
  assert.equal(formatDueAt(NOW + 3 * DAY, NOW), '3 天后')
  assert.equal(formatDueAt(NOW + 29 * DAY, NOW), '29 天后')
  assert.equal(formatDueAt(NOW + 30 * DAY, NOW), '1 个月后')
  assert.equal(formatDueAt(NOW + 60 * DAY, NOW), '2 个月后')
  assert.equal(formatDueAt(NOW + 365 * DAY, NOW), '一年后')
  assert.equal(formatDueAt(Number.NaN, NOW), '待复习')
})

test('isWordDue / wordDueLabel：未学不算到期，到期边界含等号', () => {
  assert.equal(isWordDue(null, NOW), false)
  assert.equal(isWordDue(sanitizeWordProgress({}), NOW), false)
  assert.equal(isWordDue(progressOf({ dueAt: NOW }), NOW), true, 'dueAt === now 即到期')
  assert.equal(isWordDue(progressOf({ dueAt: NOW + 1 }), NOW), false)
  // status 为 new 时即使 dueAt 过去也不算到期
  assert.equal(isWordDue(progressOf({ status: 'new', dueAt: NOW - 1 }), NOW), false)

  assert.equal(wordDueLabel(null, NOW), '未学')
  assert.equal(wordDueLabel(sanitizeWordProgress({}), NOW), '未学')
  assert.equal(wordDueLabel(progressOf({ dueAt: NOW }), NOW), '待复习')
  const future = progressOf({ status: 'mastered', intervalDays: 3, streak: 2, dueAt: NOW + 3 * DAY })
  assert.equal(wordDueLabel(future, NOW), '3 天后')
})

test('wordBankReviewStats：在掌握/学习统计上追加「待复习」口径', () => {
  const bank = combineWordBank(
    [{ word: 'alpha' }, { word: 'beta' }, { word: 'gamma' }, { word: 'delta' }, { word: 'epsilon' }],
    {
      beta: progressOf({ dueAt: NOW - 1000, seen: 2, remembered: 0, lapses: 1 }),
      gamma: progressOf({ status: 'mastered', seen: 3, remembered: 3, dueAt: NOW, intervalDays: 1, ease: 2.6, streak: 1 }),
      delta: progressOf({ dueAt: NOW + 1, seen: 1, remembered: 0, intervalDays: 1 }),
      epsilon: progressOf({
        status: 'mastered',
        seen: 2,
        remembered: 2,
        dueAt: NOW - 1,
        intervalDays: 1,
        ease: 2.6,
        streak: 1
      })
    }
  )
  // alpha 无进度；beta/delta learning；gamma/epsilon mastered
  // 到期：beta（过去）、gamma（NOW 边界）、epsilon（过去）；delta 未来
  assert.deepEqual(wordBankReviewStats(bank, NOW), {
    total: 5,
    mastered: 2,
    learning: 2,
    untouched: 1,
    due: 3
  })
  // 手工构造的 status=new 进度即使 dueAt<=now 也不计入 due
  const manual = combineWordBank([{ word: 'x' }, { word: 'y' }], {
    x: progressOf({ status: 'new', seen: 1, dueAt: 0 }),
    y: progressOf({ status: 'mastered', seen: 1, remembered: 1, dueAt: NOW, intervalDays: 1 })
  })
  assert.deepEqual(wordBankReviewStats(manual, NOW), {
    total: 2,
    mastered: 1,
    learning: 0,
    untouched: 1,
    due: 1
  })
})

test('filterWordBank：按状态 / 到期 / 关键词筛选，返回带复习标签的列表项', () => {
  const bank = combineWordBank(
    [
      { word: 'apple', meaning: 'n. 苹果' },
      { word: 'Banana', meaning: 'n. 香蕉' },
      { word: 'cherry', meaning: 'n. 樱桃' },
      { word: 'date', meaning: 'n. 枣' },
      { word: 'egg', meaning: 'n. 鸡蛋' }
    ],
    {
      banana: progressOf({ dueAt: NOW - 1000, seen: 2, remembered: 1, ease: 2.4, lapses: 1 }),
      cherry: progressOf({
        status: 'mastered',
        seen: 3,
        remembered: 3,
        dueAt: NOW + 3 * DAY,
        intervalDays: 3,
        ease: 2.8,
        streak: 3
      }),
      date: progressOf({ dueAt: NOW + 5 * DAY, seen: 1, remembered: 0, intervalDays: 5, ease: 2.4 }),
      egg: progressOf({
        status: 'mastered',
        seen: 4,
        remembered: 4,
        dueAt: NOW - 10,
        intervalDays: 1,
        ease: 2.7,
        streak: 4
      })
    }
  )
  const keysOf = (items) => items.map((item) => item.key)
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW)), ['apple', 'banana', 'cherry', 'date', 'egg'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'due', NOW)), ['banana', 'egg'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'new', NOW)), ['apple'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'learning', NOW)), ['banana', 'date'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'mastered', NOW)), ['cherry', 'egg'])
  // 列表项形状（单词表渲染契约）
  const all = filterWordBank(bank, 'all', NOW)
  assert.deepEqual(
    { key: all[0].key, status: all[0].status, due: all[0].due, progress: all[0].progress, dueLabel: all[0].dueLabel },
    { key: 'apple', status: 'new', due: false, progress: null, dueLabel: '未学' }
  )
  assert.equal(all[1].dueLabel, '待复习')
  assert.equal(all[2].dueLabel, '3 天后')
  // 关键词：单词 / 释义、大小写不敏感、去首尾空白
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW, 'APPLE')), ['apple'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW, '  banana  ')), ['banana'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW, '樱桃')), ['cherry'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW, '鸡蛋')), ['egg'])
  assert.deepEqual(keysOf(filterWordBank(bank, 'all', NOW, 'zzz')), [])
  // 筛选 + 关键词组合
  assert.deepEqual(keysOf(filterWordBank(bank, 'due', NOW, 'egg')), ['egg'])
  // 返回新数组、不改词库
  const filtered = filterWordBank(bank, 'all', NOW)
  assert.notEqual(filtered, bank.words)
  assert.equal(bank.words.length, 5)
})

test('sortWordList：词库顺序 / 到期优先（dueAt 升序、其余保序）/ 字母不区分大小写', () => {
  const bank = combineWordBank(
    [
      { word: 'apple', meaning: '苹果' },
      { word: 'Banana', meaning: '香蕉' },
      { word: 'cherry', meaning: '樱桃' },
      { word: 'date', meaning: '枣' },
      { word: 'egg', meaning: '鸡蛋' }
    ],
    {
      banana: progressOf({ dueAt: NOW - 1000, seen: 2, remembered: 1 }),
      cherry: progressOf({ status: 'mastered', seen: 3, remembered: 3, dueAt: NOW + 3 * DAY, intervalDays: 3 }),
      date: progressOf({ dueAt: NOW + 5 * DAY, seen: 1, remembered: 0, intervalDays: 5 }),
      egg: progressOf({ status: 'mastered', seen: 4, remembered: 4, dueAt: NOW - 10, intervalDays: 1 })
    }
  )
  const items = filterWordBank(bank, 'all', NOW)
  const keysOf = (list) => list.map((item) => item.key)

  const bankOrder = sortWordList(items, 'bank')
  assert.deepEqual(keysOf(bankOrder), ['apple', 'banana', 'cherry', 'date', 'egg'])
  assert.notEqual(bankOrder, items, '排序必须返回新数组')

  // 到期的 banana / egg 按 dueAt 升序排最前，其余保持词库相对顺序
  assert.deepEqual(keysOf(sortWordList(items, 'due')), ['banana', 'egg', 'apple', 'cherry', 'date'])

  // 字母序不区分大小写（Banana 排在 apple 与 cherry 之间）
  assert.deepEqual(
    sortWordList(items, 'alpha').map((item) => item.entry.word),
    ['apple', 'Banana', 'cherry', 'date', 'egg']
  )
  // 不改入参
  assert.deepEqual(keysOf(items), ['apple', 'banana', 'cherry', 'date', 'egg'])
})

test('studyQueueKeys：到期优先 / 只排到期 / 不优先时保持词库顺序', () => {
  const bank = combineWordBank(
    [{ word: 'alpha' }, { word: 'bravo' }, { word: 'charlie' }, { word: 'delta' }, { word: 'echo' }],
    {
      bravo: progressOf({ dueAt: NOW - 1000, seen: 1, remembered: 0 }),
      delta: progressOf({ dueAt: NOW - 500, seen: 1, remembered: 0 }),
      charlie: progressOf({ status: 'mastered', seen: 2, remembered: 2, dueAt: NOW + 3 * DAY, intervalDays: 3 }),
      echo: progressOf({ dueAt: NOW + 10 * DAY, seen: 1, remembered: 0, intervalDays: 10 })
    }
  )
  const options = { shuffle: false, reviewFirst: true }
  // 到期词（bravo 早于 delta）排最前，其余按词库顺序
  assert.deepEqual(studyQueueKeys(bank, options, NOW), ['bravo', 'delta', 'alpha', 'charlie', 'echo'])
  // 不优先复习：完全保持词库顺序
  assert.deepEqual(studyQueueKeys(bank, { shuffle: false, reviewFirst: false }, NOW), [
    'alpha',
    'bravo',
    'charlie',
    'delta',
    'echo'
  ])
  // 只排到期词（两种 reviewFirst 结果一致）
  assert.deepEqual(studyQueueKeys(bank, options, NOW, true), ['bravo', 'delta'])
  assert.deepEqual(studyQueueKeys(bank, { shuffle: false, reviewFirst: false }, NOW, true), ['bravo', 'delta'])
  // 空词库 / 没有到期词
  assert.deepEqual(studyQueueKeys(combineWordBank([], {}), options, NOW), [])
  assert.deepEqual(studyQueueKeys(combineWordBank([{ word: 'only' }], {}), options, NOW, true), [])
})

test('applyWordReview / applyWordStatus：返回新快照、桥接归一化 key、绝不修改入参', () => {
  const bank = combineWordBank([{ word: 'apple' }, { word: 'banana' }], {
    apple: progressOf({ seen: 1, remembered: 0, dueAt: NOW - 500 })
  })
  const snapshot = JSON.parse(JSON.stringify(bank))

  // 复习：已学词 good → 已掌握、明天复习
  const reviewed = applyWordReview(bank, 'Apple', 'good', NOW)
  assert.notEqual(reviewed, bank)
  assert.notEqual(reviewed.progress, bank.progress)
  assert.notEqual(reviewed.progress.apple, bank.progress.apple)
  assert.equal(reviewed.progress.apple.status, 'mastered')
  assert.equal(reviewed.progress.apple.intervalDays, 1)
  assert.equal(reviewed.progress.apple.dueAt, NOW + DAY)
  // 未学词也能直接记录
  const fresh = applyWordReview(bank, 'banana', 'again', NOW)
  assert.equal(fresh.progress.banana.status, 'learning')
  assert.equal(fresh.progress.banana.seen, 1)
  assert.equal(bank.progress.banana, undefined)

  // 改状态：未学 = 删除进度条目
  const cleared = applyWordStatus(bank, 'apple', 'new', NOW)
  assert.notEqual(cleared, bank)
  assert.equal('apple' in cleared.progress, false)
  // 未学词标已掌握：明天复习，streak 记 1
  const mastered = applyWordStatus(bank, 'banana', 'mastered', NOW)
  assert.deepEqual(mastered.progress.banana, {
    status: 'mastered',
    seen: 0,
    remembered: 0,
    lastSeenAt: 0,
    dueAt: NOW + DAY,
    intervalDays: 1,
    ease: WORD_EASE_DEFAULT,
    streak: 1,
    lapses: 0
  })
  // 已学词标学习中：立即到期、清 streak
  const learning = applyWordStatus(bank, 'apple', 'learning', NOW)
  assert.equal(learning.progress.apple.status, 'learning')
  assert.equal(learning.progress.apple.dueAt, NOW)
  assert.equal(learning.progress.apple.streak, 0)

  // 所有操作结束后原词库快照未被修改
  assert.deepEqual(bank, snapshot, 'applyWordReview / applyWordStatus 不得修改入参')
  assert.equal(bank.progress.banana, undefined)
})
