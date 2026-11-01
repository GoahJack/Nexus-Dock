import { useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import { spawnRipple } from '@renderer/shared/motion'
import { Button, Section, Switch } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

/** v1.3 窗口共性设置：吸附 / 置顶 / 仅在桌面 / 位置锁定 / 移回默认位置统一在系统页管理 */
type WindowKey = 'dock' | 'music' | 'clock'
type CommonField = 'snapToEdge' | 'alwaysOnTop' | 'onlyOnDesktop'

const WINDOW_LABELS: Record<WindowKey, string> = {
  dock: 'Dock',
  music: '音乐卡片',
  clock: '桌面时钟'
}

/** AutoStartResult.reason → 可读中文；reason 可能是 'dev' / 'os' / 任意异常文本 */
function autoStartErrorText(reason?: string): string {
  if (!reason) return '写入系统登录项失败，请稍后重试'
  if (reason === 'dev') return '开发模式不可用，请使用安装版'
  if (reason === 'os') return '系统登录项写入后校验不一致，可能被安全软件拦截'
  return `写入系统登录项失败：${reason}`
}

/** 系统分组：开机自启 + 窗口共性设置（折叠栏按窗口单独管理，默认全部折叠） */
export function SystemSection({ settings, patch }: Props): JSX.Element {
  const packaged = window.nexus.env.isPackaged
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 折叠栏默认收起，标题行摘要展示每个窗口的现状（用户确认的交互）
  const [open, setOpen] = useState<Record<WindowKey, boolean>>({ dock: false, music: false, clock: false })

  const allLocked = settings.lock.dock && settings.lock.music && settings.lock.clock
  const lockedNames = [
    settings.lock.dock ? 'Dock' : null,
    settings.lock.music ? '音乐卡片' : null,
    settings.lock.clock ? '桌面时钟' : null
  ].filter((name): name is string => name !== null)

  /** 写系统登录项并回读校验；失败时展示原因，开关回到返回的实际状态 */
  const changeAutoStart = async (next: boolean): Promise<void> => {
    if (pending || !packaged) return
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.nexus.system.setAutoStart(next)
      if (result.ok) {
        setNotice(
          result.autoStart
            ? '已写入当前用户的 Windows 登录启动项，下次登录自动启动'
            : '已移除 Windows 登录启动项，下次登录不再自动启动'
        )
      } else {
        setError(autoStartErrorText(result.reason))
      }
      // 主进程会广播 settings 校正；这里再用返回值兜底，避免广播延迟时开关短暂显示错误状态
      if (result.autoStart !== next) {
        await patch({ system: { autoStart: result.autoStart } })
      }
    } catch (err) {
      setError(`调用系统接口失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPending(false)
    }
  }

  const toggleOpen = (key: WindowKey): void => {
    setOpen((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  /** 共性字段 → 对应窗口设置组的 patch（Dock/音乐/时钟字段同名） */
  const commonPatch = (key: WindowKey, field: CommonField, value: boolean): DeepPartial<Settings> => {
    if (key === 'dock') return { dock: { [field]: value } as DeepPartial<Settings['dock']> }
    if (key === 'music') return { music: { [field]: value } as DeepPartial<Settings['music']> }
    return { clock: { [field]: value } as DeepPartial<Settings['clock']> }
  }

  /** 折叠栏用状态摘要：吸附 / 置顶 / 仅在桌面 / 位置锁定 */
  const summaryOf = (w: {
    snap: boolean
    alwaysOnTop: boolean
    onlyOnDesktop: boolean
    locked: boolean
  }): string =>
    [
      w.snap ? '吸附开' : '吸附关',
      w.alwaysOnTop ? '置顶开' : '置顶关',
      w.onlyOnDesktop ? '仅在桌面' : '始终显示',
      w.locked ? '已锁定' : '未锁定'
    ].join(' · ')

  const windows: Array<{
    key: WindowKey
    snap: boolean
    alwaysOnTop: boolean
    onlyOnDesktop: boolean
    locked: boolean
    reset: DeepPartial<Settings>
    resetHint: string
  }> = [
    {
      key: 'dock',
      snap: settings.dock.snapToEdge,
      alwaysOnTop: settings.dock.alwaysOnTop,
      onlyOnDesktop: settings.dock.onlyOnDesktop,
      locked: settings.lock.dock,
      reset: { dock: { freeX: -1, freeY: -1 } },
      resetHint: '恢复为底部居中'
    },
    {
      key: 'music',
      snap: settings.music.snapToEdge,
      alwaysOnTop: settings.music.alwaysOnTop,
      onlyOnDesktop: settings.music.onlyOnDesktop,
      locked: settings.lock.music,
      reset: { music: { anchor: 'dock', freeX: -1, freeY: -1 } },
      resetHint: '恢复为跟随 Dock'
    },
    {
      key: 'clock',
      snap: settings.clock.snapToEdge,
      alwaysOnTop: settings.clock.alwaysOnTop,
      onlyOnDesktop: settings.clock.onlyOnDesktop,
      locked: settings.lock.clock,
      reset: { clock: { freeX: -1, freeY: -1 } },
      resetHint: '恢复为主屏右上角'
    }
  ]

  return (
    <div className="nx-sections">
      <Section title="启动" desc="控制 Nexus Dock 是否随 Windows 登录自动启动。">
        <Switch
          label="开机自启"
          hint="登录 Windows 后自动启动 Nexus Dock（仅安装版生效）"
          checked={settings.system.autoStart}
          disabled={!packaged || pending}
          onChange={(next) => void changeAutoStart(next)}
        />
        {!packaged ? (
          <p className="nx-notice is-warn" role="status">
            仅安装版生效（当前为开发模式）
          </p>
        ) : null}
        {pending ? <p className="nx-hint-text">正在写入系统登录项…</p> : null}
        {error ? (
          <p className="nx-notice is-err" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="nx-notice is-ok" role="status">
            {notice}
          </p>
        ) : null}
      </Section>

      <Section
        title="窗口共性设置"
        desc="吸附、始终置顶、仅在桌面显示、位置锁定是所有窗口共有的行为，统一在这里管理；点击窗口名展开单独设置，各窗口独有的选项仍留在对应页面。"
      >
        <Switch
          label="锁定全部窗口位置"
          hint="勾选 = 三个窗口全部锁定；取消 = 全部解锁，展开下方窗口可再单独调整"
          checked={allLocked}
          onChange={(next) => void patch({ lock: { dock: next, music: next, clock: next } })}
        />
        <div className={`nx-lock-state${lockedNames.length > 0 ? ' is-locked' : ''}`} role="status">
          <span className="nx-lock-state-label">当前锁定</span>
          <span className="nx-lock-state-value">
            {lockedNames.length === 0 ? '无窗口锁定' : `${lockedNames.join('、')}（${lockedNames.length}/3）`}
          </span>
        </div>

        <div className="nx-acc">
          {windows.map((w) => (
            <div key={w.key} className={`nx-acc-item${open[w.key] ? ' is-open' : ''}`}>
              <button
                type="button"
                className="nx-acc-head nx-ripple-host"
                aria-expanded={open[w.key]}
                onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                onClick={() => toggleOpen(w.key)}
              >
                <span className="nx-acc-title">
                  <span className="nx-acc-chevron" aria-hidden="true">
                    ›
                  </span>
                  {WINDOW_LABELS[w.key]}
                </span>
                <span className="nx-acc-summary">{summaryOf(w)}</span>
              </button>
              {open[w.key] ? (
                <div className="nx-acc-body">
                  <Switch
                    label="自动吸附屏幕边缘"
                    hint="关闭后拖到哪停在哪；开启后松手吸附最近的屏幕边"
                    checked={w.snap}
                    onChange={(next) => void patch(commonPatch(w.key, 'snapToEdge', next))}
                  />
                  <Switch
                    label="始终置顶"
                    hint="窗口悬浮在普通应用之上"
                    checked={w.alwaysOnTop}
                    onChange={(next) => void patch(commonPatch(w.key, 'alwaysOnTop', next))}
                  />
                  <Switch
                    label="仅在桌面显示"
                    hint="前台窗口最大化/全屏时自动隐藏，回到桌面后恢复"
                    checked={w.onlyOnDesktop}
                    onChange={(next) => void patch(commonPatch(w.key, 'onlyOnDesktop', next))}
                  />
                  <Switch
                    label="锁定位置"
                    hint="锁定后该窗口不能拖动"
                    checked={w.locked}
                    onChange={(next) =>
                      void patch({ lock: { [w.key]: next } as DeepPartial<Settings['lock']> })
                    }
                  />
                  <div className="nx-inline-actions">
                    <Button size="sm" onClick={() => void patch(w.reset)}>
                      移回默认位置
                    </Button>
                    <span className="nx-hint-text">{w.resetHint}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <p className="nx-hint-text">
          锁定期间拖动不写入位置；右键 Dock 勾选「锁定全部窗口位置」可快捷解锁；设置窗口本身不受位置锁定影响。
        </p>
      </Section>
    </div>
  )
}
