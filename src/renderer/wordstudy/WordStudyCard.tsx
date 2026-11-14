import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  WORD_STATUS_LABELS,
  WORD_STUDY_KIND,
  applyWordReview,
  formatReviewInterval,
  normalizeWordKey,
  resolveWordStudyOptions,
  studyQueueKeys,
  wordBankReviewStats,
  wordBankStats,
  wordDueLabel,
  type WordBank,
  type WordEntry,
  type WordReviewGrade,
  type WordStatus
} from '@shared/wordBank'
import { patchExtraWindows, type Settings } from '@shared/types'
import { useSettings } from '../shared/hooks'
import { WordBankEditor } from './WordBankEditor'
import { WordListView } from './WordListView'
import { useOwnContentSize } from './useOwnContentSize'

/**
 * Nexus Dock — v1.9「英语单词学习」附加窗口（透明浮窗卡片）。
 *
 * 同一窗口三个视图：
 * - study：大号单词 + 音标 + 状态 +（可遮住的）释义 + 例句 + 记忆计划 + 认识度标记；
 * - editor：词库管理（搜索 / 新增 / 编辑 / 删除 / 导入导出 / 打开文件 / 重新读取 / 恢复默认 / 重置进度）；
 * - list：单词表（按状态筛选 / 搜索 / 排序 / 直接改状态 / 跳到某个词学习）。
 *
 * 关键约束（见 docs/window-conventions.md）：
 * - C7 内容尺寸：根节点 `.ws-root` 是量测对象，通过 useOwnContentSize 上报主进程；
 * - 三个视图宽度不同（360 / 480 / 480），切换后 ResizeObserver 会重新量测；
 * - 未锁定时仅标题栏可拖动（-webkit-app-region: drag），所有交互元素 no-drag；
 * - 所有 IPC 失败都必须有可见错误提示（错误条 / toast），不能静默；
 * - 动效只用 motion.css 的 --nx-* 令牌。
 */

/** 当前视图 */
type ViewMode = 'study' | 'editor' | 'list'
/** 认识度标记 */
type MarkKind = 'unknown' | 'vague' | 'known'
/** 卡片内提示（操作结果 / 失败） */
type NoticeKind = 'ok' | 'err'

interface Notice {
  kind: NoticeKind
  text: string
  /** 连续触发时递增，用于重放入场动画 */
  seq: number
}

/** 认识度标记 → v1.9 遗忘曲线评级（unknown=重来 / vague=困难 / known=认识） */
const MARK_GRADES: Record<MarkKind, WordReviewGrade> = {
  unknown: 'again',
  vague: 'hard',
  known: 'good'
}

/** 提示停留时长：足够读完一行带路径的结果，又不至于长期遮挡控件 */
const NOTICE_MS = 4200

/** 「待复习」按钮的显示刷新间隔：跨过到期时刻后无需用户操作也能更新 */
const CLOCK_TICK_MS = 30_000

/** 记忆计划条满格对应的间隔天数（间隔越大条越满，仅作直观参考） */
const SCHEDULE_FULL_DAYS = 30

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 键盘事件是否来自输入控件：输入框聚焦时全局快捷键不拦截 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function IconClose(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconChevron(props: { dir: 'prev' | 'next' }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d={props.dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WordStudyCard(): JSX.Element {
  const { settings, patch, error: settingsError } = useSettings()

  /** 词库快照（null = 尚未加载） */
  const [bank, setBank] = useState<WordBank | null>(null)
  /** 卡片内错误条（IPC 失败 / 数据异常，必须可见） */
  const [error, setError] = useState<string | null>(null)
  /** 卡片内 toast（成功结果 / 取消） */
  const [notice, setNotice] = useState<Notice | null>(null)
  const [view, setView] = useState<ViewMode>('study')
  /** 学习队列（归一化 key），只在词条内容 / 选项 / 复习模式变化时重排 */
  const [queue, setQueue] = useState<string[]>([])
  /** 当前词在队列中的下标 */
  const [index, setIndex] = useState(0)
  /** 只学「到期待复习」的词（头部待复习按钮切换） */
  const [dueOnly, setDueOnly] = useState(false)
  /** 从单词表「学习该词」跳转时递增，强制重建队列并定位 */
  const [queueNonce, setQueueNonce] = useState(0)
  /** 释义是否已显示（切词后重新遮住） */
  const [revealed, setRevealed] = useState(false)
  /** 词库 / 进度文件路径（词库管理页底部展示） */
  const [paths, setPaths] = useState<{ words: string; progress: string } | null>(null)
  /** 当前时间（30s 刷新）：待复习数量 / 复习计划标签随到期时间自动变化 */
  const [now, setNow] = useState<number>(() => Date.now())

  const rootRef = useRef<HTMLDivElement | null>(null)
  const noticeTimer = useRef<number | null>(null)
  /** 进度写入序号：只有最后一次写入的失败才回滚，避免旧请求覆盖新状态 */
  const markSeq = useRef(0)
  /** 队列 / 下标的即时镜像：effect 与事件回调里读取最新值，避免闭包过期 */
  const queueRef = useRef<string[]>([])
  const indexRef = useRef(0)
  /** 队列重建后要定位到的词（单词表「学习该词」） */
  const pendingKeyRef = useRef<string | null>(null)

  const config = settings?.extraWindows.find((item) => item.kind === WORD_STUDY_KIND) ?? null
  const options = resolveWordStudyOptions(config?.options)
  const theme = config?.theme ?? 'dark'
  const locked = config?.locked === true
  const collapsed = config?.collapsed === true
  const toggleCollapsed = (): void => {
    if (!settings) return
    void patch({ extraWindows: patchExtraWindows(settings, WORD_STUDY_KIND, { collapsed: !collapsed }) })
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLButtonElement>(collapsed ? '.ws-fold-full' : '.ws-mini .ws-fold')?.focus()
    })
  }

  // C7：透明窗口内容尺寸 = 根节点尺寸；视图切换（360 → 480）后重测
  useOwnContentSize(rootRef, [view, collapsed])

  /* ------------------------------ 通用反馈 ------------------------------ */

  const notify = useCallback((kind: NoticeKind, text: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setNotice((previous) => ({ kind, text, seq: (previous?.seq ?? 0) + 1 }))
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, NOTICE_MS)
  }, [])

  const showError = useCallback((text: string) => setError(text), [])
  const clearError = useCallback(() => setError(null), [])
  /** 单词表只报成功文本：统一按 ok 类型走 toast */
  const notifyOk = useCallback((text: string) => notify('ok', text), [notify])

  // 卸载时清理 toast 定时器
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  /* ------------------------------ 词库加载 ------------------------------ */

  useEffect(() => {
    const api = window.nexus?.wordBank
    if (!api) {
      setError('词库接口未就绪（预加载脚本未初始化），请重启应用')
      return
    }
    let alive = true
    api
      .get()
      .then((next) => {
        if (alive) setBank(next)
      })
      .catch((err: unknown) => {
        if (alive) setError(`词库加载失败：${describeError(err)}`)
      })
    const off = api.onChanged((next) => {
      if (alive) setBank(next)
    })
    api
      .paths()
      .then((next) => {
        if (alive) setPaths(next)
      })
      .catch((err: unknown) => {
        if (alive) setError(`读取词库文件路径失败：${describeError(err)}`)
      })
    return () => {
      alive = false
      off()
    }
  }, [])

  /* ---------------------------- 学习队列与当前词 ---------------------------- */

  // 词条「内容签名」：词库增删改（含改释义/例句）才重排学习顺序；
  // 只改学习进度（同一批词条）不重排，否则每标记一次顺序就乱跳。
  const contentSignature = useMemo(() => {
    if (!bank) return ''
    return bank.words
      .map((entry) => [normalizeWordKey(entry.word), entry.phonetic, entry.meaning, entry.example].join('\u0001'))
      .join('\u0000')
  }, [bank])

  const bankRef = useRef<WordBank | null>(bank)
  bankRef.current = bank
  queueRef.current = queue
  indexRef.current = index

  // 队列重建：只在词条内容 / 随机与复习优先选项 / 待复习模式变化时重排（标记单词不重排）。
  useEffect(() => {
    const current = bankRef.current
    if (!current) {
      setQueue([])
      setIndex(0)
      return
    }
    const nextQueue = studyQueueKeys(current, options, Date.now(), dueOnly)
    const jump = pendingKeyRef.current
    pendingKeyRef.current = null
    if (jump) {
      const target = nextQueue.indexOf(jump)
      setQueue(nextQueue)
      setIndex(target >= 0 ? target : 0)
      return
    }
    // 尽量保持在原来的词上；词被删掉 / 不在复习范围时才回到队首
    const previousKey = queueRef.current[indexRef.current] ?? null
    const keep = previousKey ? nextQueue.indexOf(previousKey) : -1
    setQueue(nextQueue)
    setIndex(keep >= 0 ? keep : 0)
    // 只依赖内容签名与学习选项：progress 更新不应重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSignature, options.shuffle, options.reviewFirst, dueOnly, queueNonce])

  // 每 30s 刷新一次「现在」：待复习计数 / 复习计划标签跟随到期时间
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const wordsByKey = useMemo(() => {
    const map = new Map<string, WordEntry>()
    for (const entry of bank?.words ?? []) map.set(normalizeWordKey(entry.word), entry)
    return map
  }, [bank])

  const currentKey = queue[index] ?? null
  const currentWord = currentKey ? (wordsByKey.get(currentKey) ?? null) : null
  const currentPosition = queue.length === 0 ? 0 : Math.min(index + 1, queue.length)

  // 切词后重新遮住释义
  useEffect(() => {
    setRevealed(false)
  }, [currentKey])

  // 打开「先遮住释义」选项时立刻回到自测状态
  useEffect(() => {
    if (options.hideMeaning) setRevealed(false)
  }, [options.hideMeaning])

  const stats = useMemo(
    () => (bank ? wordBankStats(bank) : { total: 0, mastered: 0, learning: 0, untouched: 0 }),
    [bank]
  )

  const reviewStats = useMemo(
    () =>
      bank
        ? wordBankReviewStats(bank, now)
        : { total: 0, mastered: 0, learning: 0, untouched: 0, due: 0 },
    [bank, now]
  )

  const progress = currentKey && bank ? bank.progress[currentKey] : undefined
  const status: WordStatus = progress?.status ?? 'new'
  const meaningHidden = options.hideMeaning && !revealed
  const schedulePercent = progress
    ? Math.max(0, Math.min(100, Math.round((progress.intervalDays / SCHEDULE_FULL_DAYS) * 100)))
    : 0

  /* ------------------------------ 交互逻辑 ------------------------------ */

  const stepTo = useCallback((delta: number) => {
    setIndex((previous) => {
      const length = queueRef.current.length
      if (length === 0) return 0
      return (previous + delta + length) % length
    })
  }, [])

  /**
   * 进度持久化助手（学习标记 / 单词表改状态共用）：
   * 乐观更新 → setProgress(整表) → 成功用服务端快照回填；失败回滚并显示错误条 + toast。
   * markSeq 防止旧请求晚到把新状态覆盖掉。
   */
  const commitProgress = useCallback(
    (nextBank: WordBank, previousBank: WordBank, toastText?: string) => {
      const seq = markSeq.current + 1
      markSeq.current = seq
      setBank(nextBank)

      const api = window.nexus?.wordBank
      if (!api) {
        setBank(previousBank)
        const text = '词库接口未就绪，无法保存学习进度'
        setError(text)
        notify('err', text)
        return
      }
      api
        .setProgress(nextBank.progress)
        .then((saved) => {
          if (markSeq.current !== seq) return
          setBank(saved)
          setError(null)
          if (toastText) notify('ok', toastText)
        })
        .catch((err: unknown) => {
          if (markSeq.current !== seq) return
          // 失败回滚到写入前，并显示可见错误（不静默）
          setBank(previousBank)
          const text = `保存学习进度失败：${describeError(err)}`
          setError(text)
          notify('err', text)
        })
    },
    [notify]
  )

  const markWord = useCallback(
    (kind: MarkKind) => {
      const previousBank = bankRef.current
      if (!previousBank || !currentKey) return
      const nextBank = applyWordReview(previousBank, currentKey, MARK_GRADES[kind], Date.now())
      const nextProgress = nextBank.progress[currentKey]
      const toastText = `已记录 · ${formatReviewInterval(nextProgress.intervalDays)}复习`
      commitProgress(nextBank, previousBank, toastText)
      // 自动切下一个词（autoNext 默认开启）；队列本身不重排
      if (options.autoNext) stepTo(1)
    },
    [commitProgress, currentKey, options.autoNext, stepTo]
  )

  /** 单词表里手动改状态：同一个持久化助手，失败会回滚 */
  const handleListBankChange = useCallback(
    (next: WordBank) => {
      const previousBank = bankRef.current
      if (!previousBank) return
      commitProgress(next, previousBank)
    },
    [commitProgress]
  )

  /** 单词表「▶ 学习该词」：重建全量队列并把光标定位到该词 */
  const startStudyWord = useCallback(
    (key: string) => {
      pendingKeyRef.current = key
      setDueOnly(false)
      setQueueNonce((nonce) => nonce + 1)
      setView('study')
      clearError()
    },
    [clearError]
  )

  const toggleDueOnly = useCallback(() => {
    setDueOnly((previous) => !previous)
    clearError()
  }, [clearError])

  // 隐藏自己：settings.extraWindows 里对应实例 visible=false（不销毁窗口，可从设置/托盘重新显示）
  const hideSelf = useCallback(() => {
    try {
      const apply = (source: Settings): Promise<Settings> =>
        window.nexus.settings.update({
          extraWindows: patchExtraWindows(source, WORD_STUDY_KIND, { visible: false })
        })
      const pending = settings ? apply(settings) : window.nexus.settings.get().then(apply)
      pending.catch((err: unknown) => setError(`隐藏窗口失败：${describeError(err)}`))
    } catch (err) {
      setError(`隐藏窗口失败：${describeError(err)}`)
    }
  }, [settings])

  // 词库管理自身已负责持久化，服务端返回的快照就是权威状态
  const handleEditorBankChange = useCallback((next: WordBank) => setBank(next), [])

  /* ------------------------------ 键盘快捷键 ------------------------------ */
  // 空格 / Enter = 显示释义；←/→ 切词；1/2/3 = 不认识/模糊/认识；输入框聚焦时不拦截。
  useEffect(() => {
    if (view !== 'study' || collapsed) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableTarget(event.target) || (event.target instanceof HTMLElement && event.target.closest('button'))) return
      switch (event.key) {
        case ' ':
        case 'Enter':
          event.preventDefault()
          setRevealed(true)
          break
        case 'ArrowLeft':
          event.preventDefault()
          stepTo(-1)
          break
        case 'ArrowRight':
          event.preventDefault()
          stepTo(1)
          break
        case '1':
          markWord('unknown')
          break
        case '2':
          markWord('vague')
          break
        case '3':
          markWord('known')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view, collapsed, markWord, stepTo])

  /* -------------------------------- 渲染 -------------------------------- */

  const displayError = error ?? settingsError
  const revealLabel = !options.hideMeaning ? '释义常显' : revealed ? '遮住释义' : '显示释义'
  const meaningText = currentWord?.meaning?.trim() ?? ''
  const dueOnlyEmpty = dueOnly && queue.length === 0 && (bank?.words.length ?? 0) > 0

  return (
    <div
      ref={rootRef}
      className="ws-root nx-glass"
      data-view={view}
      data-collapsed={collapsed ? 'true' : undefined}
      data-theme={theme}
      data-locked={locked ? 'true' : undefined}
      aria-label="英语单词学习卡片"
      title={locked ? '位置已锁定：设置 → 窗口 → 附加窗口 解锁' : undefined}
    >
      <div className="ws-mini" hidden={!collapsed}>
        <span className="ws-mini-dot" aria-hidden="true" />
        <span className="ws-mini-word" title={currentWord?.word}>{currentWord?.word ?? '英语单词'}</span>
        <span className="ws-mini-due">待复习 {reviewStats.due}</span>
        <button type="button" className="ws-icon-btn ws-fold nx-no-drag" aria-label="展开单词卡片" aria-expanded={false} onClick={toggleCollapsed}><IconChevron dir="next" /></button>
      </div>
      <div className="ws-content" hidden={collapsed}>
      <button type="button" className="ws-icon-btn ws-fold ws-fold-full nx-no-drag" aria-label="收起单词卡片" aria-expanded={true} onClick={toggleCollapsed}>⌄</button>
      {view === 'study' ? (
        <div className="ws-study">
          <header className="ws-header">
            <div className="ws-title">英语单词学习</div>
            <div className="ws-stats" title={`已掌握 ${stats.mastered} / 共 ${stats.total}`}>
              <span>
                已掌握 <b>{stats.mastered}</b>
              </span>
              <span className="ws-stats-sep">/</span>
              <span>
                共 <b>{stats.total}</b>
              </span>
            </div>
            <div className="ws-header-actions">
              <button
                type="button"
                className={`ws-pill ws-review-pill${dueOnly ? ' is-active' : ''}`}
                title={dueOnly ? '正在只看待复习单词（点击回到全部）' : '只看已到期待复习的单词'}
                aria-label={`只看待复习单词，当前 ${reviewStats.due} 个`}
                aria-pressed={dueOnly}
                disabled={reviewStats.due === 0 && !dueOnly}
                onClick={toggleDueOnly}
              >
                待复习 {reviewStats.due}
              </button>
              <button
                type="button"
                className="ws-pill ws-list-toggle nx-no-drag"
                title="单词表：按学习状态筛选 / 搜索 / 排序"
                aria-label="打开单词表"
                onClick={() => {
                  clearError()
                  setView('list')
                }}
              >
                单词表
              </button>
              <button
                type="button"
                className="ws-pill ws-bank-toggle nx-no-drag"
                title="词库管理：增删改词条 / 导入导出 / 重新读取"
                aria-label="打开词库管理"
                onClick={() => {
                  clearError()
                  setView('editor')
                }}
              >
                词库
              </button>
              <button
                type="button"
                className="ws-icon-btn ws-hide nx-no-drag"
                title="隐藏单词卡片（可从设置 / 托盘重新显示）"
                aria-label="隐藏单词卡片"
                onClick={hideSelf}
              >
                <IconClose />
              </button>
            </div>
          </header>

          {currentWord ? (
            <div className="ws-main">
              <div className="ws-word-line">
                <span className="ws-word" title={currentWord.word}>
                  {currentWord.word}
                </span>
                <span className={`ws-status is-${status}`} data-status={status}>
                  {WORD_STATUS_LABELS[status]}
                </span>
              </div>

              {options.showPhonetic && currentWord.phonetic ? (
                <div className="ws-phonetic">{currentWord.phonetic}</div>
              ) : null}

              <div
                className={`ws-meaning${meaningHidden ? ' is-hidden' : ' is-revealed'}`}
                data-revealed={meaningHidden ? 'false' : 'true'}
                role={meaningHidden ? 'button' : undefined}
                tabIndex={meaningHidden ? 0 : undefined}
                aria-label={meaningHidden ? '点击显示释义' : undefined}
                title={meaningHidden ? '点击显示释义（空格 / Enter）' : undefined}
                onClick={meaningHidden ? () => setRevealed(true) : undefined}
                onKeyDown={
                  meaningHidden
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setRevealed(true)
                        }
                      }
                    : undefined
                }
              >
                <span className="ws-meaning-text">{meaningText || '未填写释义'}</span>
                {meaningHidden ? (
                  <span className="ws-meaning-cover" aria-hidden="true">
                    点击显示释义
                  </span>
                ) : null}
              </div>

              {options.showExample && currentWord.example ? (
                <div className="ws-example">{currentWord.example}</div>
              ) : null}
            </div>
          ) : dueOnlyEmpty ? (
            <div className="ws-empty">
              <div className="ws-empty-title">待复习已清空</div>
              <div className="ws-empty-hint">到期的单词都复习过了。可以回到全部单词继续学，或去单词表整理。</div>
              <button
                type="button"
                className="ws-pill is-primary ws-empty-open nx-no-drag"
                onClick={() => setDueOnly(false)}
              >
                回到全部
              </button>
            </div>
          ) : (
            <div className="ws-empty">
              <div className="ws-empty-title">词库为空，先添加几个单词吧</div>
              <div className="ws-empty-hint">在词库管理里新增词条，或导入一份 JSON 词库文件。</div>
              <button
                type="button"
                className="ws-pill is-primary ws-empty-open nx-no-drag"
                onClick={() => setView('editor')}
              >
                打开词库管理
              </button>
            </div>
          )}

          {options.showSchedule && progress && progress.status !== 'new' ? (
            <div className="ws-schedule" title="按遗忘曲线排期的下次复习时间">
              <span className="ws-schedule-text">
                下次复习 {wordDueLabel(progress, now)} · 连续 {progress.streak}
              </span>
              <span className="ws-schedule-bar">
                <span className="ws-schedule-fill" style={{ width: `${schedulePercent}%` }} />
              </span>
            </div>
          ) : null}

          <div className="ws-study-foot">
            <div className="ws-nav">
              <button
                type="button"
                className="ws-icon-btn ws-prev nx-no-drag"
                title="上一个单词（←）"
                aria-label="上一个单词"
                onClick={() => stepTo(-1)}
                disabled={queue.length === 0}
              >
                <IconChevron dir="prev" />
              </button>
              <span
                className="ws-progress"
                aria-label={`第 ${currentPosition} 个，共 ${queue.length} 个`}
              >
                {queue.length === 0 ? '0 / 0' : `${currentPosition} / ${queue.length}`}
              </span>
              <button
                type="button"
                className="ws-icon-btn ws-next nx-no-drag"
                title="下一个单词（→）"
                aria-label="下一个单词"
                onClick={() => stepTo(1)}
                disabled={queue.length === 0}
              >
                <IconChevron dir="next" />
              </button>
              <button
                type="button"
                className="ws-reveal nx-no-drag"
                title={options.hideMeaning ? '显示 / 遮住释义（空格 / Enter）' : '「先遮住释义」选项未开启'}
                aria-label={revealLabel}
                disabled={!options.hideMeaning}
                onClick={() => setRevealed((previous) => !previous)}
              >
                {revealLabel}
              </button>
            </div>

            <div className="ws-marks">
              <button
                type="button"
                className="ws-mark ws-mark-unknown nx-no-drag"
                title="不认识（快捷键 1）"
                onClick={() => markWord('unknown')}
                disabled={!currentWord}
              >
                不认识
                <kbd>1</kbd>
              </button>
              <button
                type="button"
                className="ws-mark ws-mark-vague nx-no-drag"
                title="模糊（快捷键 2）"
                onClick={() => markWord('vague')}
                disabled={!currentWord}
              >
                模糊
                <kbd>2</kbd>
              </button>
              <button
                type="button"
                className="ws-mark ws-mark-known nx-no-drag"
                title="认识（快捷键 3）"
                onClick={() => markWord('known')}
                disabled={!currentWord}
              >
                认识
                <kbd>3</kbd>
              </button>
            </div>
          </div>
        </div>
      ) : bank ? (
        view === 'list' ? (
          <WordListView
            bank={bank}
            now={now}
            onBack={() => setView('study')}
            onStudyWord={startStudyWord}
            onBankChange={handleListBankChange}
            onError={showError}
            notify={notifyOk}
          />
        ) : (
          <WordBankEditor
            bank={bank}
            paths={paths}
            onBack={() => setView('study')}
            onBankChange={handleEditorBankChange}
            onError={showError}
            onClearError={clearError}
            notify={notify}
          />
        )
      ) : (
        <div className="ws-editor">
          <div className="ws-editor-head">
            <button
              type="button"
              className="ws-icon-btn ws-editor-back nx-no-drag"
              title="返回学习视图"
              aria-label="返回学习视图"
              onClick={() => setView('study')}
            >
              <IconChevron dir="prev" />
            </button>
            <div className="ws-editor-title">{view === 'list' ? '单词表' : '词库管理'}</div>
          </div>
          <div className="ws-editor-loading">词库加载中…</div>
        </div>
      )}

      </div>
      {displayError ? (
        <div className="ws-error" role="alert">
          <span className="ws-error-text">{displayError}</span>
          <button
            type="button"
            className="ws-error-close nx-no-drag"
            title="关闭错误提示"
            aria-label="关闭错误提示"
            onClick={() => setError(null)}
          >
            <IconClose />
          </button>
        </div>
      ) : null}

      <div
        key={notice?.seq ?? 0}
        className={`ws-toast${notice ? ` is-${notice.kind}` : ' is-empty'}`}
        role="status"
        aria-live="polite"
        title={notice?.text}
      >
        {notice?.text ?? ''}
      </div>
    </div>
  )
}
