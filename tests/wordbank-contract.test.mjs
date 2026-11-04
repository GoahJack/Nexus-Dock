/**
 * v1.8 契约测试：英语单词学习词库（src/shared/wordBank.ts）。
 *
 * 目的：用户要「词库可以自由修改」，所以词库文件是手写友好的（裸数组 / {words} 都行、
 * 只有 word 必填），同时**任何脏数据都不能抛错**、不能把设置撑爆：
 *   - 词条收敛：去控制字符、截断、按归一化单词去重、上限 5000；
 *   - 进度收敛：未知单词丢弃、负数/NaN 归零、status 非法回落 new、remembered ≤ seen；
 *   - 默认词库：50+ 词条、key 唯一、统计正确；
 *   - 窗口选项：任意脏 options 收敛为布尔默认值。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WORD_STUDY_OPTIONS,
  DEFAULT_WORDS,
  WORD_BANK_VERSION,
  WORD_LIMITS,
  WORD_STUDY_KIND,
  combineWordBank,
  defaultWordBank,
  normalizeWordKey,
  orderWordsForStudy,
  parseWordBankDocument,
  parseWordBankFile,
  resolveWordStudyOptions,
  sanitizeWordEntries,
  sanitizeWordEntry,
  sanitizeWordProgress,
  sanitizeWordProgressMap,
  wordBankStats
} from '../src/shared/wordBank.ts'

test('默认词库：50+ 词条且 key 唯一、可被 sanitize 幂等收敛', () => {
  assert.ok(DEFAULT_WORDS.length >= 50, `默认词库至少 50 词，实际 ${DEFAULT_WORDS.length}`)
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

test('sanitizeWordProgressMap：未知词丢弃、数值夹紧、status 回落', () => {
  const words = [{ word: 'apple' }, { word: 'give up' }]
  const progress = sanitizeWordProgressMap(
    {
      progress: {
        Apple: { status: 'mastered', seen: 3, remembered: 9, lastSeenAt: 1234 },
        'give up': { status: 'learning', seen: -2, remembered: -5, lastSeenAt: 'x' },
        ghost: { status: 'mastered', seen: 2 },
        'not a word': { status: 'learning', seen: 1 }
      }
    },
    words
  )
  assert.deepEqual(Object.keys(progress).sort(), ['apple'])
  assert.deepEqual(progress.apple, { status: 'mastered', seen: 3, remembered: 3, lastSeenAt: 1234 })
  // give up 全为脏值 → status 保持 learning 但 seen=0 → 该条被视作「无进展」丢弃
  assert.equal('give up' in progress, false)
  // 非法 status 回落 new
  assert.equal(sanitizeWordProgress({ status: 'weird' }).status, 'new')
  assert.deepEqual(sanitizeWordProgress(null), { status: 'new', seen: 0, remembered: 0, lastSeenAt: 0 })
  // 裸进度表（没有 progress 包裹）也能识别
  const bare = sanitizeWordProgressMap({ apple: { status: 'learning', seen: 1 } }, words)
  assert.deepEqual(bare, { apple: { status: 'learning', seen: 1, remembered: 0, lastSeenAt: 0 } })
  // 垃圾输入不抛错
  assert.deepEqual(sanitizeWordProgressMap(null, words), {})
  assert.deepEqual(sanitizeWordProgressMap('x', words), {})
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
  // 用户把词库换成只剩 apple：进度只保留 apple
  const narrowed = combineWordBank(bank.words.filter((entry) => entry.word === 'apple'), bank.progress)
  assert.deepEqual(Object.keys(narrowed.progress), ['apple'])
  // 统计
  assert.deepEqual(wordBankStats(narrowed), { total: 1, mastered: 1, learning: 0, untouched: 0 })
})

test('parseWordBankDocument：支持自包含 JSON（词条 + 可选进度）', () => {
  const bank = parseWordBankDocument({
    version: 9,
    words: [{ word: 'apple', meaning: '苹果' }],
    progress: { apple: { status: 'learning', seen: 2, remembered: 1, lastSeenAt: 42 } }
  })
  assert.equal(bank.version, WORD_BANK_VERSION, '外部 version 不覆盖当前格式版本')
  assert.equal(bank.words.length, 1)
  assert.deepEqual(bank.progress, {
    apple: { status: 'learning', seen: 2, remembered: 1, lastSeenAt: 42 }
  })
  // 无进度字段 → 空进度
  assert.deepEqual(parseWordBankDocument({ words: [{ word: 'x' }] }).progress, {})
  assert.deepEqual(parseWordBankDocument(null).words, [])
})

test('resolveWordStudyOptions：脏 options 收敛为布尔默认值', () => {
  assert.deepEqual(resolveWordStudyOptions(undefined), { ...DEFAULT_WORD_STUDY_OPTIONS })
  assert.deepEqual(resolveWordStudyOptions(null), { ...DEFAULT_WORD_STUDY_OPTIONS })
  assert.deepEqual(resolveWordStudyOptions({ showPhonetic: 'yes', shuffle: true, hideMeaning: false }), {
    showPhonetic: true,
    showExample: true,
    hideMeaning: false,
    shuffle: true,
    autoNext: true
  })
  // 数值/对象等非布尔值一律回落默认值
  assert.equal(resolveWordStudyOptions({ autoNext: 0 }).autoNext, true)
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

test('词库窗口 kind 与存储常量稳定（渲染页目录名与 vite 入口必须一致）', () => {
  assert.equal(WORD_STUDY_KIND, 'wordstudy')
  assert.ok(WORD_LIMITS.maxWords > 0 && WORD_LIMITS.word > 0)
})
