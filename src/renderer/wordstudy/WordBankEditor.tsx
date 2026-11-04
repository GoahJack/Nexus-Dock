import { useMemo, useState } from 'react'
import type { ChangeEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  WORD_LIMITS,
  WORD_STATUS_LABELS,
  normalizeWordKey,
  type WordBank,
  type WordEntry,
  type WordStatus
} from '@shared/wordBank'

/**
 * Nexus Dock — v1.8 单词学习附加窗口的「词库管理」视图。
 *
 * 学习视图与词库管理视图在同一个透明窗口内切换（宽度 360 → 480，由根节点量测上报）。
 * 本视图是本迭代的核心验收点：窗口内必须能完成词库的全部 CRUD 与文件操作，
 * 而且每次改动都立即落盘（IPC 返回最新词库后用返回值刷新本地状态，失败必须可见）。
 *
 * 所有写操作都走 `window.nexus.wordBank`：
 *   setWords / importFromFile / exportToFile / openFile / reloadFromDisk /
 *   resetWords / resetProgress / paths / get
 * 危险操作（删除 / 覆盖词库 / 清空进度）先用 window.confirm 二次确认。
 */

type NoticeKind = 'ok' | 'err'

interface WordBankEditorProps {
  bank: WordBank
  /** 词库 / 进度文件绝对路径（挂载时由父组件读取） */
  paths: { words: string; progress: string } | null
  /** 返回学习视图 */
  onBack: () => void
  /** 用 IPC 返回的最新词库刷新父组件状态 */
  onBankChange: (bank: WordBank) => void
  /** 显示可见错误条 */
  onError: (message: string) => void
  /** 操作成功后清除旧错误条 */
  onClearError: () => void
  /** 卡片内 toast（成功结果 / 取消） */
  notify: (kind: NoticeKind, text: string) => void
}

/** 行内编辑 / 新增表单的草稿 */
interface Draft {
  mode: 'add' | 'edit'
  /** 编辑时原词条在 bank.words 中的索引；新增为 -1 */
  index: number
  word: string
  phonetic: string
  meaning: string
  example: string
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toEntry(draft: Draft): WordEntry {
  return {
    word: draft.word.trim().slice(0, WORD_LIMITS.word),
    phonetic: draft.phonetic.trim().slice(0, WORD_LIMITS.phonetic),
    meaning: draft.meaning.trim().slice(0, WORD_LIMITS.meaning),
    example: draft.example.trim().slice(0, WORD_LIMITS.example)
  }
}

function IconChevronLeft(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPencil(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        d="M4.5 19.5h3.2l9.6-9.6a2 2 0 0 0 0-2.8l-1-1a2 2 0 0 0-2.8 0L3.9 15.7l-.4 3.4a.5.5 0 0 0 .5.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        d="M5 7h14M10 4.8h4M7 7l.7 11.3c.05.9.8 1.6 1.7 1.6h5.2c.9 0 1.65-.7 1.7-1.6L17 7M10 10.5v5.5M14 10.5v5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WordBankEditor(props: WordBankEditorProps): JSX.Element {
  const { bank, paths } = props
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const statusOf = (word: string): WordStatus => bank.progress[normalizeWordKey(word)]?.status ?? 'new'

  // 搜索：按单词或释义过滤（保留原索引，保存时用它定位词条）
  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return bank.words
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          keyword.length === 0 ||
          entry.word.toLowerCase().includes(keyword) ||
          entry.meaning.toLowerCase().includes(keyword)
      )
  }, [bank, query])

  /* ------------------------------ 表单动作 ------------------------------ */

  const openAdd = (): void => {
    props.onClearError()
    setQuery('')
    setDraft({ mode: 'add', index: -1, word: '', phonetic: '', meaning: '', example: '' })
  }

  const openEdit = (index: number): void => {
    const entry = bank.words[index]
    if (!entry) return
    props.onClearError()
    // 清空搜索，确保被编辑的行一定在列表里可见
    setQuery('')
    setDraft({
      mode: 'edit',
      index,
      word: entry.word,
      phonetic: entry.phonetic,
      meaning: entry.meaning,
      example: entry.example
    })
  }

  const cancelDraft = (): void => setDraft(null)
  const setField = (field: 'word' | 'phonetic' | 'meaning' | 'example', value: string): void => {
    setDraft((previous) => (previous ? { ...previous, [field]: value } : previous))
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft || saving) return
    const entry = toEntry(draft)
    if (entry.word.length === 0) {
      props.onError('保存失败：单词不能为空')
      return
    }
    const key = normalizeWordKey(entry.word)
    const others =
      draft.mode === 'edit' ? bank.words.filter((_, index) => index !== draft.index) : bank.words
    if (others.some((word) => normalizeWordKey(word.word) === key)) {
      props.onError(`保存失败：单词「${entry.word}」已存在`)
      return
    }

    const nextWords =
      draft.mode === 'edit'
        ? bank.words.map((word, index) => (index === draft.index ? entry : word))
        : [...bank.words, entry]

    setSaving(true)
    try {
      const next = await window.nexus.wordBank.setWords(nextWords)
      props.onBankChange(next)
      props.onClearError()
      setDraft(null)
      if (draft.mode === 'add') setQuery('')
      props.notify('ok', draft.mode === 'edit' ? `已保存「${entry.word}」` : `已添加「${entry.word}」`)
    } catch (error) {
      props.onError(`保存词条失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async (index: number): Promise<void> => {
    const entry = bank.words[index]
    if (!entry || saving) return
    if (!window.confirm(`确定删除单词「${entry.word}」吗？\n删除后会立即写入词库文件。`)) return
    setSaving(true)
    try {
      const next = await window.nexus.wordBank.setWords(bank.words.filter((_, at) => at !== index))
      props.onBankChange(next)
      props.onClearError()
      setDraft(null)
      props.notify('ok', `已删除「${entry.word}」`)
    } catch (error) {
      props.onError(`删除词条失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  /* ------------------------------ 文件 / 批量操作 ------------------------------ */

  const importWords = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.nexus.wordBank.importFromFile()
      if (result.canceled) {
        props.notify('ok', '已取消导入')
        return
      }
      if (!result.ok) {
        props.onError(`导入失败：${result.error ?? '未知错误'}`)
        return
      }
      // 导入只返回操作结果，需要回读最新词库刷新界面
      const next = await window.nexus.wordBank.get()
      props.onBankChange(next)
      props.onClearError()
      setDraft(null)
      props.notify(
        'ok',
        `已导入 ${result.count ?? next.words.length} 个单词${result.path ? `：${result.path}` : ''}`
      )
    } catch (error) {
      props.onError(`导入失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const exportWords = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.nexus.wordBank.exportToFile()
      if (result.canceled) {
        props.notify('ok', '已取消导出')
        return
      }
      if (!result.ok) {
        props.onError(`导出失败：${result.error ?? '未知错误'}`)
        return
      }
      props.onClearError()
      props.notify(
        'ok',
        `已导出 ${result.count ?? bank.words.length} 个单词${result.path ? `：${result.path}` : ''}`
      )
    } catch (error) {
      props.onError(`导出失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const openFile = async (): Promise<void> => {
    try {
      const result = await window.nexus.wordBank.openFile()
      if (!result.ok) {
        props.onError(`打开词库文件失败：${result.error ?? '未知错误'}`)
        return
      }
      props.onClearError()
      props.notify('ok', `已用默认程序打开词库文件${result.path ? `：${result.path}` : ''}`)
    } catch (error) {
      props.onError(`打开词库文件失败：${describeError(error)}`)
    }
  }

  const reloadFromDisk = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const next = await window.nexus.wordBank.reloadFromDisk()
      props.onBankChange(next)
      props.onClearError()
      setDraft(null)
      props.notify('ok', `已重新读取磁盘文件：${next.words.length} 个单词`)
    } catch (error) {
      props.onError(`重新读取词库失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const resetWords = async (): Promise<void> => {
    if (saving) return
    if (!window.confirm('恢复默认词库会覆盖当前全部词条，并清空学习进度。\n确定继续吗？')) return
    setSaving(true)
    try {
      const next = await window.nexus.wordBank.resetWords()
      props.onBankChange(next)
      props.onClearError()
      setDraft(null)
      setQuery('')
      props.notify('ok', `已恢复默认词库：${next.words.length} 个单词（进度已清空）`)
    } catch (error) {
      props.onError(`恢复默认词库失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const resetProgress = async (): Promise<void> => {
    if (saving) return
    if (!window.confirm('确定重置全部学习进度吗？词条不会被删除，但「已掌握 / 学习中」记录会清空。')) return
    setSaving(true)
    try {
      const next = await window.nexus.wordBank.resetProgress()
      props.onBankChange(next)
      props.onClearError()
      props.notify('ok', '已重置全部学习进度')
    } catch (error) {
      props.onError(`重置学习进度失败：${describeError(error)}`)
    } finally {
      setSaving(false)
    }
  }

  /* -------------------------------- 渲染 -------------------------------- */

  return (
    <div className="ws-editor">
      <header className="ws-editor-head">
        <button
          type="button"
          className="ws-icon-btn ws-editor-back nx-no-drag"
          title="返回学习视图"
          aria-label="返回学习视图"
          onClick={props.onBack}
        >
          <IconChevronLeft />
        </button>
        <div className="ws-editor-title">词库管理</div>
        <div className="ws-bank-count">共 {bank.words.length} 词</div>
      </header>

      <div className="ws-bank-toolbar">
        <input
          type="search"
          className="ws-bank-search nx-no-drag"
          value={query}
          placeholder="搜索单词或释义"
          aria-label="搜索单词或释义"
          onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
        />
        <div className="ws-bank-actions">
          <button
            type="button"
            className="ws-tool ws-bank-add nx-no-drag"
            title="新增词条"
            aria-label="新增词条"
            onClick={openAdd}
            disabled={saving}
          >
            添加
          </button>
          <button
            type="button"
            className="ws-tool ws-import nx-no-drag"
            title="从 JSON 文件导入词库（替换现有词条）"
            aria-label="导入词库"
            onClick={() => void importWords()}
            disabled={saving}
          >
            导入
          </button>
          <button
            type="button"
            className="ws-tool ws-export nx-no-drag"
            title="把当前词库导出为 JSON 文件"
            aria-label="导出词库"
            onClick={() => void exportWords()}
            disabled={saving}
          >
            导出
          </button>
          <button
            type="button"
            className="ws-tool ws-open-file nx-no-drag"
            title="用系统默认程序打开 wordbank.json（手工编辑）"
            aria-label="打开词库文件"
            onClick={() => void openFile()}
          >
            打开文件
          </button>
          <button
            type="button"
            className="ws-tool ws-reload nx-no-drag"
            title="重新读取磁盘上的词库与进度文件"
            aria-label="重新读取磁盘文件"
            onClick={() => void reloadFromDisk()}
            disabled={saving}
          >
            重新读取
          </button>
          <button
            type="button"
            className="ws-tool is-danger ws-reset-words nx-no-drag"
            title="恢复内置默认词库（会清空学习进度）"
            aria-label="恢复默认词库"
            onClick={() => void resetWords()}
            disabled={saving}
          >
            恢复默认词库
          </button>
          <button
            type="button"
            className="ws-tool is-danger ws-reset-progress nx-no-drag"
            title="清空学习进度（词条保留）"
            aria-label="重置学习进度"
            onClick={() => void resetProgress()}
            disabled={saving}
          >
            重置进度
          </button>
        </div>
      </div>

      <div className="ws-bank-list" aria-label="词库列表">
        {draft?.mode === 'add' ? (
          <BankForm
            draft={draft}
            saving={saving}
            onField={setField}
            onSave={() => void saveDraft()}
            onCancel={cancelDraft}
          />
        ) : null}

        {rows.length === 0 ? (
          <div className="ws-bank-empty">
            {query.trim().length > 0 ? `没有匹配「${query.trim()}」的单词` : '词库还是空的，点「添加」录入第一个单词'}
          </div>
        ) : null}

        {rows.map(({ entry, index }) =>
          draft?.mode === 'edit' && draft.index === index ? (
            <BankForm
              key={`form-${index}`}
              draft={draft}
              saving={saving}
              onField={setField}
              onSave={() => void saveDraft()}
              onCancel={cancelDraft}
            />
          ) : (
            <div className="ws-bank-row" key={`${index}-${entry.word}`}>
              <div className="ws-bank-row-main">
                <div className="ws-bank-row-top">
                  <span className="ws-bank-row-word">{entry.word}</span>
                  {entry.phonetic ? <span className="ws-bank-row-phonetic">{entry.phonetic}</span> : null}
                  <span
                    className={`ws-bank-row-status is-${statusOf(entry.word)}`}
                    data-status={statusOf(entry.word)}
                  >
                    {WORD_STATUS_LABELS[statusOf(entry.word)]}
                  </span>
                </div>
                <div className="ws-bank-row-meaning">{entry.meaning || '未填写释义'}</div>
              </div>
              <div className="ws-bank-row-actions">
                <button
                  type="button"
                  className="ws-icon-btn ws-bank-edit-btn nx-no-drag"
                  title={`编辑「${entry.word}」`}
                  aria-label={`编辑 ${entry.word}`}
                  onClick={() => openEdit(index)}
                  disabled={saving}
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  className="ws-icon-btn is-danger ws-bank-delete-btn nx-no-drag"
                  title={`删除「${entry.word}」`}
                  aria-label={`删除 ${entry.word}`}
                  onClick={() => void removeEntry(index)}
                  disabled={saving}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          )
        )}
      </div>

      <div className="ws-bank-foot">
        <div
          className="ws-bank-path"
          title={
            paths ? `词库文件：${paths.words}\n进度文件：${paths.progress}` : '词库文件：读取中…'
          }
        >
          <span className="ws-bank-path-label">词库文件：</span>
          <span className="ws-bank-path-value">{paths?.words ?? '读取中…'}</span>
        </div>
        <div className="ws-bank-hint">改动会立即写入词库文件；手工改完文件可点「重新读取」。</div>
      </div>
    </div>
  )
}

/* ------------------------------ 行内表单 ------------------------------ */

interface BankFormProps {
  draft: Draft
  saving: boolean
  onField: (field: 'word' | 'phonetic' | 'meaning' | 'example', value: string) => void
  onSave: () => void
  onCancel: () => void
}

/** 新增 / 编辑共用的行内表单（四个输入 + 保存 / 取消） */
function BankForm(props: BankFormProps): JSX.Element {
  const { draft, saving } = props

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      props.onSave()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
    }
  }

  return (
    <div
      className="ws-bank-form"
      role="group"
      aria-label={draft.mode === 'add' ? '新增词条' : '编辑词条'}
      onKeyDown={onKeyDown}
    >
      <label className="ws-bank-field">
        <span>单词 *</span>
        <input
          className="ws-bank-input ws-bank-input-word"
          name="word"
          value={draft.word}
          maxLength={WORD_LIMITS.word}
          placeholder="apple"
          autoFocus
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onField('word', event.target.value)}
        />
      </label>
      <label className="ws-bank-field">
        <span>音标</span>
        <input
          className="ws-bank-input ws-bank-input-phonetic"
          name="phonetic"
          value={draft.phonetic}
          maxLength={WORD_LIMITS.phonetic}
          placeholder="/ˈæpl/"
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onField('phonetic', event.target.value)}
        />
      </label>
      <label className="ws-bank-field ws-bank-field-wide">
        <span>释义</span>
        <input
          className="ws-bank-input ws-bank-input-meaning"
          name="meaning"
          value={draft.meaning}
          maxLength={WORD_LIMITS.meaning}
          placeholder="n. 苹果"
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onField('meaning', event.target.value)}
        />
      </label>
      <label className="ws-bank-field ws-bank-field-wide">
        <span>例句</span>
        <input
          className="ws-bank-input ws-bank-input-example"
          name="example"
          value={draft.example}
          maxLength={WORD_LIMITS.example}
          placeholder="An apple a day keeps the doctor away."
          onChange={(event: ChangeEvent<HTMLInputElement>) => props.onField('example', event.target.value)}
        />
      </label>
      <div className="ws-bank-form-actions">
        <button
          type="button"
          className="ws-tool ws-bank-cancel nx-no-drag"
          onClick={props.onCancel}
          disabled={saving}
        >
          取消
        </button>
        <button
          type="button"
          className="ws-tool is-primary ws-bank-save nx-no-drag"
          onClick={props.onSave}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
