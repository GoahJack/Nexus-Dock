import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import {
  WORD_FILTERS,
  WORD_FILTER_LABELS,
  WORD_SORTS,
  WORD_SORT_LABELS,
  WORD_STATUSES,
  WORD_STATUS_LABELS,
  applyWordStatus,
  filterWordBank,
  sortWordList,
  wordBankReviewStats,
  type WordBank,
  type WordFilter,
  type WordListItem,
  type WordSort,
  type WordStatus
} from '@shared/wordBank'

/**
 * v1.9「单词表」整理视图。
 *
 * 卡片内第三个视图（.ws-root[data-view='list']，宽 480）：
 * - 按学习状态筛选（全部 / 待复习 / 未学 / 学习中 / 已掌握，带每档计数）；
 * - 关键词搜索（单词 / 释义，大小写不敏感）；
 * - 排序（词库顺序 / 到期优先 / 字母 A→Z）；
 * - 每行直接改状态（未学 / 学习中 / 已掌握）或跳到该词开始学习；
 * - Esc 返回学习视图。
 *
 * 本组件只做视图与乐观更新：进度写入由父组件统一持久化（失败回滚 + 错误条）。
 */
export interface WordListViewProps {
  bank: WordBank
  /** 当前时间（父组件每 30s 刷新）：到期标签 / 待复习计数 */
  now: number
  onBack: () => void
  /** 跳到学习视图并定位到某个词（key = normalizeWordKey(word)） */
  onStudyWord: (key: string) => void
  /** 状态变更后的新词库快照（父组件负责 setProgress 持久化与失败回滚） */
  onBankChange: (next: WordBank) => void
  /** 报告可见错误（父组件错误条） */
  onError: (message: string) => void
  /** 卡片内 toast */
  notify: (text: string) => void
}

function IconChevronBack(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WordListView({
  bank,
  now,
  onBack,
  onStudyWord,
  onBankChange,
  onError,
  notify
}: WordListViewProps): JSX.Element {
  const [filter, setFilter] = useState<WordFilter>('all')
  const [sort, setSort] = useState<WordSort>('bank')
  const [query, setQuery] = useState('')

  /** 每档筛选的计数（不含搜索词，方便看出各状态有多少词） */
  const counts = useMemo(() => {
    const result: Record<WordFilter, number> = { all: 0, due: 0, new: 0, learning: 0, mastered: 0 }
    for (const item of WORD_FILTERS) result[item] = filterWordBank(bank, item, now).length
    return result
  }, [bank, now])

  const rows = useMemo(
    () => sortWordList(filterWordBank(bank, filter, now, query), sort),
    [bank, filter, now, query, sort]
  )

  const reviewStats = useMemo(() => wordBankReviewStats(bank, now), [bank, now])

  // Esc 返回学习视图（列表内输入框聚焦时也允许返回：搜索词会保留在本地 state）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack])

  const handleSortChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    const next = WORD_SORTS.find((item) => item === value)
    if (next) setSort(next)
  }, [])

  const handleStatusChange = useCallback(
    (item: WordListItem, event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value
      const nextStatus = WORD_STATUSES.find((status) => status === value)
      if (!nextStatus || nextStatus === item.status) return
      try {
        onBankChange(applyWordStatus(bank, item.key, nextStatus, Date.now()))
      } catch (err: unknown) {
        onError(`更新单词状态失败：${err instanceof Error ? err.message : String(err)}`)
        return
      }
      notify(`「${item.entry.word}」已标记为「${WORD_STATUS_LABELS[nextStatus]}」`)
    },
    [bank, notify, onBankChange, onError]
  )

  return (
    <div className="ws-list">
      <header className="ws-list-head">
        <button
          type="button"
          className="ws-icon-btn ws-list-back nx-no-drag"
          title="返回学习视图（Esc）"
          aria-label="返回学习视图"
          onClick={onBack}
        >
          <IconChevronBack />
        </button>
        <div className="ws-list-title">单词表</div>
        <div
          className="ws-list-count"
          title={`共 ${reviewStats.total} 个单词，其中 ${reviewStats.due} 个待复习`}
        >
          {rows.length} / {reviewStats.total} · 待复习 {reviewStats.due}
        </div>
      </header>

      <div className="ws-list-toolbar">
        <div className="ws-list-filters" role="group" aria-label="按学习状态筛选">
          {WORD_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className={`ws-list-filter${filter === item ? ' is-active' : ''}`}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {WORD_FILTER_LABELS[item]}
              <span className="ws-list-filter-count">{counts[item]}</span>
            </button>
          ))}
        </div>
        <div className="ws-list-tools">
          <input
            type="search"
            className="ws-list-search nx-no-drag"
            placeholder="搜索单词或释义"
            aria-label="搜索单词或释义"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="ws-list-sort nx-no-drag"
            aria-label="排序方式"
            title="排序方式"
            value={sort}
            onChange={handleSortChange}
          >
            {WORD_SORTS.map((item) => (
              <option key={item} value={item}>
                {WORD_SORT_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ws-list-body">
        {rows.length === 0 ? (
          <div className="ws-list-empty">没有符合条件的单词</div>
        ) : (
          rows.map((item) => (
            <div key={item.key} className="ws-list-row" data-status={item.status}>
              <div className="ws-list-row-main">
                <div className="ws-list-row-top">
                  <span className="ws-list-row-word" title={item.entry.word}>
                    {item.entry.word}
                  </span>
                  {item.entry.phonetic ? (
                    <span className="ws-list-row-phonetic" title={item.entry.phonetic}>
                      {item.entry.phonetic}
                    </span>
                  ) : null}
                  <span className={`ws-list-row-status is-${item.status}`}>
                    {WORD_STATUS_LABELS[item.status]}
                  </span>
                </div>
                <div className="ws-list-row-meaning" title={item.entry.meaning}>
                  {item.entry.meaning || '未填写释义'}
                </div>
              </div>

              <div className="ws-list-row-due" data-due={item.due ? 'true' : undefined}>
                {item.dueLabel}
              </div>

              <select
                className="ws-list-status-select nx-no-drag"
                aria-label={`设置「${item.entry.word}」的学习状态`}
                title="设置学习状态"
                value={item.status}
                onChange={(event) => handleStatusChange(item, event)}
              >
                {WORD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {WORD_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="ws-list-study-btn nx-no-drag"
                title={`学习「${item.entry.word}」`}
                aria-label={`学习「${item.entry.word}」`}
                onClick={() => onStudyWord(item.key)}
              >
                ▶
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
