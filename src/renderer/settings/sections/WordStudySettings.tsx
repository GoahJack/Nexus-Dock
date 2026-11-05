import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { NexusApi } from '@shared/types'
import {
  formatDueAt,
  resolveWordStudyOptions,
  wordBankReviewStats,
  wordBankStats,
  wordDueLabel
} from '@shared/wordBank'
import type {
  WordBank,
  WordBankOpResult,
  WordStudyOptions,
  WordProgress
} from '@shared/wordBank'
import { Button, Section, Switch } from '@renderer/shared/ui'
import type { ExtraWindowSettingsProps } from './ExtraWindowsSection'

/** 词库操作结果消息：ok = 成功 / info = 用户取消等中性结果 / err = 失败 */
type NoticeKind = 'ok' | 'info' | 'err'

interface Notice {
  kind: NoticeKind
  text: string
}

/** 单个按钮操作键：忙时整组禁用，只有触发中的按钮显示「处理中…」 */
type ActionKey = 'import' | 'export' | 'open' | 'reload' | 'resetWords' | 'resetProgress'

type WordBankApi = NexusApi['wordBank']

/** 词库 / 进度文件路径（只用于展示，不写回 settings） */
interface WordBankPaths {
  words: string
  progress: string
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 词库 API 缺失时给出可执行提示（旧 preload 未更新 / 需要重启应用） */
function wordBankApi(): WordBankApi {
  const api: WordBankApi | undefined = window.nexus?.wordBank
  if (!api || typeof api.get !== 'function') {
    throw new Error('词库接口未初始化（window.nexus.wordBank 缺失），请重启应用')
  }
  return api
}

/**
 * 词库里「最近到期」的那条进度：未学 / 尚未排期的词跳过。
 * 只遍历 bank.progress（键已归一化且只保留有效词条），不依赖词库顺序。
 */
function nextDueProgress(bank: WordBank): WordProgress | null {
  let next: WordProgress | null = null
  for (const progress of Object.values(bank.progress)) {
    if (progress.status === 'new' || progress.dueAt <= 0) continue
    if (next === null || progress.dueAt < next.dueAt) next = progress
  }
  return next
}

/**
 * v1.8 / v1.9 英语单词学习（附加窗口 kind=wordstudy）的独有设置：
 *
 * - 词库概览：挂载时 wordBank.get() 读统计（含 v1.9「待复习」口径），并订阅 onChanged
 *   跟随窗口 / 重置操作实时刷新；
 * - 学习选项：7 个开关写回 config.options（由 ExtraWindowsSection 的 patch 写回 extraWindows）；
 * - 记忆曲线：说明简化 SM-2 的间隔规则，实时显示待复习数量与最近到期时间；
 * - 词库管理：导入 / 导出 / 打开文件 / 重新读取 / 恢复默认 / 重置进度，结果消息显示在同区域。
 *
 * 词库 / 进度文件是用户可直接编辑的 JSON，所以这里也展示词库文件路径，
 * 方便手工修改后点「重新读取文件」生效。
 */
export function WordStudySettings({ config, patch }: ExtraWindowSettingsProps): JSX.Element {
  const [bank, setBank] = useState<WordBank | null>(null)
  const [paths, setPaths] = useState<WordBankPaths | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<'resetWords' | 'resetProgress' | null>(null)
  /** 待复习数会随时间自然变化：30 秒刷新一次 now，长时间开着设置页数字也不会陈旧 */
  const [now, setNow] = useState<number>(() => Date.now())

  const options = resolveWordStudyOptions(config.options)
  /** 概览统计 + v1.9 待复习口径（用 now 判定，跨过 dueAt 的单词会自动计入） */
  const reviewStats = bank ? wordBankReviewStats(bank, now) : null
  /** 「记忆曲线」区块的最近到期时间：没有已排期的词时为 null */
  const nextDue = bank ? nextDueProgress(bank) : null
  const nextDueLabel = nextDue ? wordDueLabel(nextDue, now) : '暂无排期'
  const nextDueTitle = nextDue
    ? `最近到期：${formatDueAt(nextDue.dueAt, now)}`
    : '还没有已排期的单词'

  /** 读词库统计 + 文件路径；两者互不阻塞（路径只用于展示，失败不影响统计） */
  const load = useCallback(async (): Promise<void> => {
    const api: WordBankApi | undefined = window.nexus?.wordBank
    if (!api || typeof api.get !== 'function') {
      setLoading(false)
      setLoadError('词库接口未初始化（window.nexus.wordBank 缺失），请重启应用')
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      setBank(await api.get())
    } catch (err) {
      setLoadError(`词库加载失败：${errorText(err)}`)
    }
    try {
      if (typeof api.paths === 'function') setPaths(await api.paths())
    } catch {
      /* 路径仅用于展示：读取失败不打断统计与词库操作 */
    }
    setLoading(false)
  }, [])

  /* 挂载读一次 + 订阅主进程广播（导入 / 重置 / 单词窗口记录进度后统计实时变） */
  useEffect(() => {
    let alive = true
    const api: WordBankApi | undefined = window.nexus?.wordBank
    const off =
      api && typeof api.onChanged === 'function'
        ? api.onChanged((next) => {
            if (!alive) return
            setBank(next)
            setLoadError(null)
          })
        : null
    void load()
    return () => {
      alive = false
      off?.()
    }
  }, [load])

  /* 待复习数 / 最近到期时间随真实时间推移：每 30 秒刷新 now（卸载时清掉定时器） */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  /** 操作后刷新统计（主进程 onChanged 也会广播，这里兜底避免广播延迟 / 丢失） */
  const refreshBank = async (): Promise<WordBank | null> => {
    try {
      const next = await wordBankApi().get()
      setBank(next)
      return next
    } catch {
      return null
    }
  }

  /** 统一的操作外壳：忙时锁按钮、清掉旧消息 / 旧确认条，异常转成可见错误 */
  const runAction = async (
    key: ActionKey,
    label: string,
    task: () => Promise<Notice>
  ): Promise<void> => {
    if (busy !== null) return
    setBusy(key)
    setNotice(null)
    setPendingConfirm(null)
    try {
      setNotice(await task())
    } catch (err) {
      setNotice({ kind: 'err', text: `${label}失败：${errorText(err)}` })
    } finally {
      setBusy(null)
    }
  }

  /** 两个破坏性操作先走行内二次确认（与「应用 / 关于」页的 .nx-confirm-bar 一致） */
  const beginConfirm = (key: 'resetWords' | 'resetProgress'): void => {
    if (busy !== null) return
    setNotice(null)
    setPendingConfirm((current) => (current === key ? null : key))
  }

  const importWords = (): Promise<void> =>
    runAction('import', '导入词库', async () => {
      const result = await wordBankApi().importFromFile()
      if (result.canceled) return { kind: 'info', text: '已取消导入词库' }
      if (!result.ok) return { kind: 'err', text: `导入失败：${result.error ?? '未知错误'}` }
      const next = await refreshBank()
      const count = result.count ?? next?.words.length ?? 0
      return { kind: 'ok', text: `已导入 ${count} 个单词${result.path ? `：${result.path}` : ''}` }
    })

  const exportWords = (): Promise<void> =>
    runAction('export', '导出词库', async () => {
      const result: WordBankOpResult = await wordBankApi().exportToFile()
      if (result.canceled) return { kind: 'info', text: '已取消导出词库' }
      if (!result.ok) return { kind: 'err', text: `导出失败：${result.error ?? '未知错误'}` }
      const count = result.count ?? bank?.words.length ?? 0
      return { kind: 'ok', text: `已导出 ${count} 个单词${result.path ? `：${result.path}` : ''}` }
    })

  const openBankFile = (): Promise<void> =>
    runAction('open', '打开词库文件', async () => {
      const result = await wordBankApi().openFile()
      if (!result.ok) {
        return {
          kind: 'err',
          text: `打开词库文件失败：${result.error ?? '未知错误'}${result.path ? `（${result.path}）` : ''}`
        }
      }
      return {
        kind: 'ok',
        text: `已用系统默认程序打开词库文件${result.path ? `：${result.path}` : ''}`
      }
    })

  const reloadFromDisk = (): Promise<void> =>
    runAction('reload', '重新读取文件', async () => {
      const next = await wordBankApi().reloadFromDisk()
      setBank(next)
      return { kind: 'ok', text: `已重新读取词库文件：共 ${wordBankStats(next).total} 个单词` }
    })

  const resetWords = (): Promise<void> =>
    runAction('resetWords', '恢复默认词库', async () => {
      const next = await wordBankApi().resetWords()
      setBank(next)
      return {
        kind: 'ok',
        text: `已恢复默认词库（共 ${wordBankStats(next).total} 个单词），学习进度已清空`
      }
    })

  const resetProgress = (): Promise<void> =>
    runAction('resetProgress', '重置学习进度', async () => {
      const next = await wordBankApi().resetProgress()
      setBank(next)
      return { kind: 'ok', text: '已重置学习进度' }
    })

  /** 开关只写当前窗口的 options（patch 由 ExtraWindowsSection 整体写回 extraWindows） */
  const updateOption = (key: keyof WordStudyOptions, value: boolean): void => {
    patch({ options: { ...config.options, [key]: value } })
  }

  const disabled = busy !== null
  const labelOf = (key: ActionKey, text: string): string => (busy === key ? '处理中…' : text)

  return (
    <div className="ws-settings">
      <Section title="词库概览" desc="当前词库规模与学习进度，随学习 / 导入 / 重置实时更新。">
        {/* 加载中 / 失败重试 / 统计数字 */}
        <div className="ws-settings-stats" role="status" aria-live="polite">
          {loading ? (
            <span className="ws-settings-stat">词库加载中…</span>
          ) : loadError ? (
            <>
              <span className="ws-settings-stat is-err">{loadError}</span>
              <Button size="sm" onClick={() => void load()}>
                重试
              </Button>
            </>
          ) : reviewStats ? (
            <>
              <span className="ws-settings-stat">
                共 <strong>{reviewStats.total}</strong> 词
              </span>
              <span className="ws-settings-stat">
                已掌握 <strong>{reviewStats.mastered}</strong>
              </span>
              <span className="ws-settings-stat">
                学习中 <strong>{reviewStats.learning}</strong>
              </span>
              <span className="ws-settings-stat">
                未学 <strong>{reviewStats.untouched}</strong>
              </span>
              <span className="ws-settings-stat is-due">
                待复习 <strong>{reviewStats.due}</strong>
              </span>
            </>
          ) : (
            <span className="ws-settings-stat">词库尚未加载</span>
          )}
        </div>

        {paths ? (
          <p className="ws-settings-path" title={`学习进度文件：${paths.progress}`}>
            <span className="ws-settings-path-label">词库文件：</span>
            <span className="ws-settings-path-value">{paths.words}</span>
          </p>
        ) : null}
      </Section>

      <Section title="学习选项" desc="只影响英语单词学习窗口，切换后立即生效。">
        {/* 7 个开关全部写回当前窗口的 options */}
        <div className="ws-settings-switches">
          <Switch
            label="显示音标"
            hint="在单词下方显示 /ˈæpl/ 这样的音标"
            checked={options.showPhonetic}
            onChange={(value) => updateOption('showPhonetic', value)}
          />
          <Switch
            label="显示例句"
            hint="在释义下方显示例句"
            checked={options.showExample}
            onChange={(value) => updateOption('showExample', value)}
          />
          <Switch
            label="先遮住释义"
            hint="先只显示单词，点击或按空格再显示释义；关闭后直接显示释义"
            checked={options.hideMeaning}
            onChange={(value) => updateOption('hideMeaning', value)}
          />
          <Switch
            label="随机顺序"
            hint="每轮按随机顺序学习单词"
            checked={options.shuffle}
            onChange={(value) => updateOption('shuffle', value)}
          />
          <Switch
            label="标记后自动下一词"
            hint="点「认识 / 不认识」后自动切到下一个单词"
            checked={options.autoNext}
            onChange={(value) => updateOption('autoNext', value)}
          />
          <Switch
            label="优先复习到期单词"
            hint="打开卡片先过一遍遗忘曲线排到的词"
            checked={options.reviewFirst}
            onChange={(value) => updateOption('reviewFirst', value)}
          />
          <Switch
            label="显示复习计划"
            hint="在卡片上显示下次复习时间与记忆强度"
            checked={options.showSchedule}
            onChange={(value) => updateOption('showSchedule', value)}
          />
        </div>
      </Section>

      <Section
        title="记忆曲线"
        desc="复习时间由简化 SM-2 间隔重复排定，只影响当前词库的学习进度。"
      >
        {/* 待复习数量 / 最近到期时间都基于 now 计算，30 秒自动刷新 */}
        <div className="ws-settings-review-stats">
          <span className="ws-settings-stat is-due">
            当前待复习 <strong>{reviewStats ? reviewStats.due : '—'}</strong> 词
          </span>
          <span className="ws-settings-stat" title={nextDueTitle}>
            最近到期 <strong>{nextDueLabel}</strong>
          </span>
        </div>
        <ul className="ws-settings-rules">
          <li>
            <strong>不认识</strong>：10 分钟后重新练，还没记住就继续按短间隔重复。
          </li>
          <li>
            <strong>模糊</strong>：从 1 天起排，比上次间隔略短一些再复习。
          </li>
          <li>
            <strong>认识</strong>：间隔按 1 → 3 → 7 天递增，之后按记忆强度继续拉长（约 15、30
            天……最长一年）。
          </li>
        </ul>
        <p className="ws-settings-hint">
          这是简化 SM-2：不做完整的难度矩阵，只按「认识 / 模糊 / 不认识」和连续答对次数推算下一次复习时间，因此个别单词的排期不会像专业背单词软件那样精确。
        </p>
      </Section>

      <Section
        title="词库管理"
        desc="词库与进度是可编辑的 JSON 文件，可导入 / 导出备份，或直接修改后重新读取。"
      >
        {/* 按钮组 + 二次确认条 + 操作结果消息都收在这块 */}
        <div className="ws-settings-actions">
          {pendingConfirm ? (
            <div
              className="nx-confirm-bar"
              role="alertdialog"
              aria-label={
                pendingConfirm === 'resetWords' ? '恢复默认词库确认' : '重置学习进度确认'
              }
            >
              <span>
                {pendingConfirm === 'resetWords'
                  ? '恢复默认词库会用内置词库替换当前词库，并清空学习进度，确定继续？'
                  : '重置学习进度会清空所有单词的掌握状态，词库本身不受影响，确定继续？'}
              </span>
              <div className="nx-confirm-actions">
                <Button size="sm" onClick={() => setPendingConfirm(null)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={disabled}
                  onClick={() =>
                    void (pendingConfirm === 'resetWords' ? resetWords() : resetProgress())
                  }
                >
                  {pendingConfirm === 'resetWords' ? '确认恢复' : '确认重置'}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="nx-inline-actions">
            <Button size="sm" disabled={disabled} onClick={() => void importWords()}>
              {labelOf('import', '导入词库')}
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => void exportWords()}>
              {labelOf('export', '导出词库')}
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => void openBankFile()}>
              {labelOf('open', '打开词库文件')}
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => void reloadFromDisk()}>
              {labelOf('reload', '重新读取文件')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={disabled}
              onClick={() => beginConfirm('resetWords')}
            >
              恢复默认词库
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={disabled}
              onClick={() => beginConfirm('resetProgress')}
            >
              重置学习进度
            </Button>
          </div>

          {notice ? (
            <p className={`ws-settings-msg is-${notice.kind}`} role="status" aria-live="polite">
              {notice.text}
            </p>
          ) : null}

          <p className="nx-hint-text">
            词库与学习进度保存在用户数据目录，可直接用文本编辑器修改；改完点「重新读取文件」生效。
          </p>
        </div>
      </Section>
    </div>
  )
}
