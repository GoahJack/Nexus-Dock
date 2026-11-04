/**
 * v1.8 英语单词学习 — 词库主进程存储层。
 *
 * 设计要点（见 src/shared/wordBank.ts 的共享契约）：
 * - 词库与进度**分两个文件**放在 `app.getPath('userData')` 下：
 *     wordbank.json          { version, words: [{ word, phonetic, meaning, example }] }
 *     wordbank-progress.json { version, progress: { "<归一化单词key>": { status, seen, remembered, lastSeenAt } } }
 *   两个文件都可以被用户直接用文本编辑器修改 / 整体替换（用户明确要求「词库可以自由修改」），
 *   所以 words 文件必须保持纯净的 `{ version, words }` 结构，绝不把进度混进去。
 * - 写盘一律「tmp + rename」原子写、UTF-8 **无 BOM**、JSON pretty 2 空格。
 * - 读取失败（JSON 损坏 / 文件被删）绝不静默覆盖用户文件：
 *     · initWordBank：缺失 → 写入默认种子；损坏 → 先备份为 `<file>.corrupt-<ts>.bak` 再回种子；
 *     · reloadWordBankFromDisk：只读不写，失败时保留当前内存值并记日志。
 * - 所有外部输入先过 shared 的 sanitizer（sanitizeWordEntries / combineWordBank），
 *   任何函数都不向调用方抛错（IPC handler 也就不用担心未捕获异常）。
 */
import { app, dialog, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  WORD_BANK_FILE,
  WORD_BANK_VERSION,
  WORD_PROGRESS_FILE,
  WORD_PROGRESS_VERSION,
  combineWordBank,
  defaultWordBank,
  parseWordBankDocument,
  parseWordBankFile,
  sanitizeWordEntries,
  type WordBank,
  type WordBankOpenResult,
  type WordBankOpResult,
  type WordEntry,
  type WordProgress
} from '@shared/wordBank'
import { logToFile } from './logger'

/** 日志类别：logger.ts 的 LogKind 只有 desktop/media/launch/main/extra，附加窗口功能统一走 extra */
function log(message: string): void {
  logToFile('extra', `[wordbank] ${message}`)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 当前内存快照。initWordBank() 之前先给出默认种子词库（模块加载只用到 shared 纯数据，
 * 不依赖 electron），这样即使初始化异常，IPC 也永远能返回结构合法的词库而不是 undefined。
 * init 之后始终与磁盘内容收敛后的结果一致。
 */
let current: WordBank = defaultWordBank()
const listeners = new Set<(bank: WordBank) => void>()

/**
 * 解析 userData 下的两个文件路径（模块加载阶段不触碰 app，与 initSettings 同一范式）。
 * 每次实时解析而不缓存：userData 理论上稳定，但测试/受限环境可能改路径，缓存会读到过期位置。
 */
function ensurePaths(): { words: string; progress: string } {
  try {
    const dir = app.getPath('userData')
    return { words: join(dir, WORD_BANK_FILE), progress: join(dir, WORD_PROGRESS_FILE) }
  } catch (error) {
    log(`无法解析 userData 目录：${errorText(error)}`)
    return { words: '', progress: '' }
  }
}

/** 词库 / 进度文件的绝对路径（设置页展示「文件在哪」；路径不可用时返回空串） */
export function getWordBankPaths(): { words: string; progress: string } {
  return ensurePaths()
}

/** 当前词库快照（渲染层拿到的是 IPC 结构化克隆，不会反向污染主进程内存） */
export function getWordBank(): WordBank {
  return current
}

/* ------------------------------ 文件读写基础 ------------------------------ */

type JsonReadState = 'missing' | 'ok' | 'corrupt'

interface JsonReadResult {
  state: JsonReadState
  value?: unknown
}

/** Windows 记事本保存的 UTF-8 可能带 BOM，JSON.parse 前先剥掉 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 原子写盘：先写 .tmp 再 rename（与 settingsStore.persist 同一范式），
 * 避免写一半崩溃留下损坏文件；UTF-8 无 BOM。
 */
function writeJsonAtomic(filePath: string, value: unknown): boolean {
  if (!filePath) return false
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, filePath)
    return true
  } catch (error) {
    log(`写入失败（${filePath}）：${errorText(error)}`)
    return false
  }
}

/** 读取并解析 JSON；区分「不存在」与「存在但损坏」，后者交给调用方决定备份策略 */
function readJsonFile(filePath: string): JsonReadResult {
  if (!filePath) return { state: 'missing' }
  if (!existsSync(filePath)) return { state: 'missing' }
  try {
    const text = readFileSync(filePath, 'utf8')
    return { state: 'ok', value: JSON.parse(stripBom(text)) as unknown }
  } catch (error) {
    log(`解析失败（${filePath}）：${errorText(error)}`)
    return { state: 'corrupt' }
  }
}

/**
 * 备份损坏文件为 `<file>.corrupt-<时间戳>.bak`（优先 rename，失败再 copy）。
 * 返回 true 表示原文件已被成功备份，调用方可以安全写入新的干净文件。
 */
function backupCorruptFile(filePath: string): boolean {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${filePath}.corrupt-${stamp}.bak`
  try {
    renameSync(filePath, backup)
    log(`损坏文件已备份为 ${backup}`)
    return true
  } catch (error) {
    log(`重命名备份失败（${filePath}）：${errorText(error)}，尝试复制备份`)
  }
  try {
    copyFileSync(filePath, backup)
    log(`损坏文件已复制备份为 ${backup}`)
    return true
  } catch (error) {
    log(`备份损坏文件失败（${filePath}）：${errorText(error)}，为避免覆盖用户数据将跳过写盘`)
    return false
  }
}

/** 词库文件永远只写 `{ version, words }`：保持纯净、可被用户手工整体替换 */
function writeWordEntriesFile(words: WordEntry[]): boolean {
  const { words: filePath } = ensurePaths()
  if (!filePath) {
    log('词库文件路径不可用，跳过写入')
    return false
  }
  return writeJsonAtomic(filePath, { version: WORD_BANK_VERSION, words })
}

function writeProgressFile(progress: Record<string, WordProgress>): boolean {
  const { progress: filePath } = ensurePaths()
  if (!filePath) {
    log('进度文件路径不可用，跳过写入')
    return false
  }
  return writeJsonAtomic(filePath, { version: WORD_PROGRESS_VERSION, progress })
}

/** 两个文件一起写（词库变化时进度可能被裁剪，必须一起落盘保持一致） */
function writeWordBankFiles(bank: WordBank): void {
  writeWordEntriesFile(bank.words)
  writeProgressFile(bank.progress)
}

/** 通知订阅者；单个监听器异常不影响其他监听器与主流程 */
function emit(bank: WordBank): void {
  for (const listener of listeners) {
    try {
      listener(bank)
    } catch (error) {
      log(`订阅者异常：${errorText(error)}`)
    }
  }
}

/* ------------------------------ 初始化 ------------------------------ */

/**
 * app ready 后调用一次：读取（必要时播种）两个文件，构造内存词库。
 * init 不触发 subscribeWordBank 通知（启动阶段由窗口首次 get() 拉取）。
 */
export function initWordBank(): WordBank {
  const { words: wordsPath, progress: progressPath } = ensurePaths()
  if (!wordsPath || !progressPath) {
    // 极端受限环境（userData 不可解析）：内存里仍给出可用词库，只是不落盘
    current = defaultWordBank()
    log('userData 目录不可用，词库仅保存在内存中')
    return current
  }

  const wordsRead = readJsonFile(wordsPath)
  let words: WordEntry[]
  if (wordsRead.state === 'ok') {
    words = parseWordBankFile(wordsRead.value)
    log(`已读取词库文件：${words.length} 个词条`)
  } else {
    // 缺失 → 写默认种子；损坏 → 先备份再写种子（备份失败则保留用户原文件不动）
    words = defaultWordBank().words
    if (wordsRead.state === 'missing') {
      log(`词库文件不存在，写入默认种子 ${words.length} 个词条`)
      writeJsonAtomic(wordsPath, { version: WORD_BANK_VERSION, words })
    } else {
      const backedUp = backupCorruptFile(wordsPath)
      if (backedUp) {
        log(`词库文件损坏，已备份并写入默认种子 ${words.length} 个词条`)
        writeJsonAtomic(wordsPath, { version: WORD_BANK_VERSION, words })
      } else {
        log('词库文件损坏且备份失败，本次仅使用内存默认词库（不覆盖磁盘文件）')
      }
    }
  }

  const progressRead = readJsonFile(progressPath)
  let progressRaw: unknown = {}
  if (progressRead.state === 'ok') {
    progressRaw = progressRead.value
  } else if (progressRead.state === 'corrupt') {
    progressRaw = {}
    if (backupCorruptFile(progressPath)) {
      log('进度文件损坏，已备份并回退为空进度')
    } else {
      log('进度文件损坏且备份失败，本次使用空进度（不覆盖磁盘文件）')
    }
  } else {
    log('进度文件不存在，使用空进度')
  }

  current = combineWordBank(words, progressRaw)
  log(`词库初始化完成：${current.words.length} 个词条，${Object.keys(current.progress).length} 条学习进度`)
  return current
}

/* ------------------------------ 修改操作 ------------------------------ */

/**
 * 整体替换词条列表（允许清空）。进度按归一化 key 保留仍然存在的单词，
 * 被删除单词的进度随词库裁剪；词库 + 进度两个文件一起写。
 */
export function setWordEntries(raw: unknown): WordBank {
  const words = sanitizeWordEntries(raw)
  // combineWordBank 会用新词条过滤进度表：key 不存在的进度自动丢弃
  current = combineWordBank(words, current.progress)
  writeWordBankFiles(current)
  log(`词条列表已替换：${current.words.length} 个词条，保留 ${Object.keys(current.progress).length} 条进度`)
  emit(current)
  return current
}

/** 整体替换学习进度（未知单词 key 丢弃；只写进度文件，绝不覆盖用户正在编辑的词库文件） */
export function setWordProgress(raw: unknown): WordBank {
  current = combineWordBank(current.words, raw)
  writeProgressFile(current.progress)
  emit(current)
  return current
}

/** 恢复默认种子词库（进度清空） */
export function resetWordEntries(): WordBank {
  current = defaultWordBank()
  writeWordBankFiles(current)
  log(`已恢复默认词库：${current.words.length} 个词条`)
  emit(current)
  return current
}

/** 清空学习进度（词库不变；只写进度文件） */
export function resetWordProgress(): WordBank {
  current = combineWordBank(current.words, {})
  writeProgressFile(current.progress)
  log('已清空学习进度')
  emit(current)
  return current
}

/**
 * 重新读取磁盘上的两个文件（用户手工改完文件后点「重新读取」）。
 * 只读不写：任何解析失败都保留当前内存值并记日志，绝不覆盖 / 删除用户文件。
 */
export function reloadWordBankFromDisk(): WordBank {
  const { words: wordsPath, progress: progressPath } = ensurePaths()
  if (!wordsPath || !progressPath) {
    log('userData 目录不可用，无法重新读取词库文件')
    return current
  }

  const wordsRead = readJsonFile(wordsPath)
  let words = current.words
  let wordsOk = false
  if (wordsRead.state === 'ok') {
    words = parseWordBankFile(wordsRead.value)
    wordsOk = true
  } else if (wordsRead.state === 'missing') {
    log('重新读取：词库文件不存在，保留当前内存词库（不重建文件）')
  } else {
    log('重新读取：词库文件解析失败，保留当前内存词库（不覆盖用户文件）')
  }

  const progressRead = readJsonFile(progressPath)
  let progressRaw: unknown = current.progress
  let progressOk = false
  if (progressRead.state === 'ok') {
    progressRaw = progressRead.value
    progressOk = true
  } else if (progressRead.state === 'missing') {
    // 用户删掉进度文件 = 想清空进度；这是合法状态，不是损坏
    progressRaw = {}
    progressOk = true
  } else {
    log('重新读取：进度文件解析失败，保留当前内存进度（不覆盖用户文件）')
  }

  if (!wordsOk && !progressOk) {
    log('重新读取失败：两个文件都不可用，保留当前内存词库')
    return current
  }

  current = combineWordBank(words, progressRaw)
  log(`已重新读取：${current.words.length} 个词条，${Object.keys(current.progress).length} 条进度`)
  emit(current)
  return current
}

/* ------------------------------ 导入 / 导出 / 打开文件 ------------------------------ */

/** 从用户选择的 JSON 文件导入词库（取消 → canceled；进度按归一化 key 保留） */
export async function importWordBankFromFile(): Promise<WordBankOpResult> {
  let filePaths: string[] = []
  try {
    const result = await dialog.showOpenDialog({
      title: '导入词库文件',
      properties: ['openFile'],
      filters: [
        { name: '词库 JSON', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    filePaths = result.filePaths
  } catch (error) {
    log(`打开导入对话框失败：${errorText(error)}`)
    return { ok: false, canceled: false, error: `无法打开文件选择框：${errorText(error)}` }
  }

  const filePath = filePaths[0]
  if (!filePath) return { ok: false, canceled: true }

  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    log(`读取导入文件失败（${filePath}）：${errorText(error)}`)
    return { ok: false, canceled: false, path: filePath, error: `读取文件失败：${errorText(error)}` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(stripBom(text)) as unknown
  } catch {
    log(`导入文件不是合法 JSON（${filePath}）`)
    return { ok: false, canceled: false, path: filePath, error: '文件不是合法的 JSON' }
  }

  // 兼容裸数组 / { words } / { version, words, progress } 三种写法
  const imported = parseWordBankDocument(raw)
  if (imported.words.length === 0) {
    log(`导入文件没有可用词条（${filePath}）`)
    return { ok: false, canceled: false, error: '文件中没有可用词条' }
  }

  // 进度按 key 保留：先保留现有进度（由 combineWordBank 按新词表裁剪），
  // 导入文件自带 progress 时覆盖同 key 记录（自包含备份文件可完整还原）。
  current = combineWordBank(imported.words, { ...current.progress, ...imported.progress })
  writeWordBankFiles(current)
  log(`已导入词库：${current.words.length} 个词条（${filePath}）`)
  emit(current)
  return { ok: true, canceled: false, path: filePath, count: current.words.length }
}

/** 把词库导出为 JSON 文件（只导出 `{ version, words }`，便于用户手工编辑 / 备份） */
export async function exportWordBankToFile(): Promise<WordBankOpResult> {
  let defaultPath = WORD_BANK_FILE
  try {
    defaultPath = join(app.getPath('documents'), WORD_BANK_FILE)
  } catch {
    /* app 未就绪等极端情况：退回纯文件名 */
  }

  let savePath = ''
  try {
    const result = await dialog.showSaveDialog({
      title: '导出词库文件',
      defaultPath,
      filters: [
        { name: '词库 JSON', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    savePath = result.filePath
  } catch (error) {
    log(`打开导出对话框失败：${errorText(error)}`)
    return { ok: false, canceled: false, error: `无法打开保存对话框：${errorText(error)}` }
  }

  if (!writeJsonAtomic(savePath, { version: WORD_BANK_VERSION, words: current.words })) {
    return { ok: false, canceled: false, path: savePath, error: '写入文件失败' }
  }
  log(`已导出词库：${current.words.length} 个词条（${savePath}）`)
  return { ok: true, canceled: false, path: savePath, count: current.words.length }
}

/**
 * 用系统默认程序打开 wordbank.json（便于用户直接编辑）。
 * 文件缺失时先按当前内存词库重建；系统打不开则退化为在资源管理器中定位。
 */
export async function openWordBankFile(): Promise<WordBankOpenResult> {
  const { words: filePath } = ensurePaths()
  if (!filePath) return { ok: false, path: '', error: '词库文件路径不可用' }

  try {
    if (!existsSync(filePath)) {
      if (!writeJsonAtomic(filePath, { version: WORD_BANK_VERSION, words: current.words })) {
        return { ok: false, path: filePath, error: '词库文件不存在，且重建失败' }
      }
      log(`词库文件不存在，已按当前词库重建（${filePath}）`)
    }
    const error = await shell.openPath(filePath)
    if (error) {
      log(`系统无法打开词库文件（${error}），改为在资源管理器中定位`)
      shell.showItemInFolder(filePath)
      return { ok: false, path: filePath, error }
    }
    return { ok: true, path: filePath }
  } catch (error) {
    log(`打开词库文件失败（${filePath}）：${errorText(error)}`)
    try {
      shell.showItemInFolder(filePath)
    } catch {
      /* 定位也失败：只返回错误 */
    }
    return { ok: false, path: filePath, error: errorText(error) }
  }
}

/* ------------------------------ 订阅 ------------------------------ */

/** 订阅词库变更（set / reset / import / reload 成功后通知；init 不通知） */
export function subscribeWordBank(listener: (bank: WordBank) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
