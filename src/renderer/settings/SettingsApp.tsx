import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import { useSettings } from '@renderer/shared/hooks'
import { spawnRipple } from '@renderer/shared/motion'
import { Button } from '@renderer/shared/ui'
import { DockSection } from './sections/DockSection'
import { MusicSection } from './sections/MusicSection'
import { ClockSection } from './sections/ClockSection'
import { AppsSection } from './sections/AppsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { SystemSection } from './sections/SystemSection'
import { AboutSection } from './sections/AboutSection'

type TabKey = 'dock' | 'music' | 'clock' | 'apps' | 'appearance' | 'system' | 'about'

const NAV_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'dock', label: 'Dock' },
  { key: 'music', label: '音乐' },
  { key: 'clock', label: '时钟' },
  { key: 'apps', label: '应用' },
  { key: 'appearance', label: '外观' },
  { key: 'system', label: '系统' },
  { key: 'about', label: '关于' }
]

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function NavIcon({ name }: { name: TabKey }): JSX.Element {
  switch (name) {
    case 'dock':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <rect x="1.6" y="5" width="12.8" height="6.2" rx="2.2" />
          <circle cx="5" cy="8.1" r="0.85" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8.1" r="0.85" fill="currentColor" stroke="none" />
          <circle cx="11" cy="8.1" r="0.85" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'music':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <path d="M6.1 11.6V4.4l5.8-1.1v7" />
          <circle cx="4.5" cy="12" r="1.6" />
          <circle cx="10.3" cy="10.5" r="1.6" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <circle cx="8" cy="8" r="6.1" />
          <path d="M8 4.4V8l2.5 1.5" />
        </svg>
      )
    case 'apps':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1.3" />
          <rect x="9" y="2" width="5" height="5" rx="1.3" />
          <rect x="2" y="9" width="5" height="5" rx="1.3" />
          <rect x="9" y="9" width="5" height="5" rx="1.3" />
        </svg>
      )
    case 'appearance':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <path d="M2.4 4.8h11.2M2.4 11.2h11.2" />
          <circle cx="6.1" cy="4.8" r="1.6" />
          <circle cx="9.9" cy="11.2" r="1.6" />
        </svg>
      )
    case 'system':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <circle cx="8" cy="8" r="2.3" />
          <path d="M8 2v2.1M8 11.9V14M2 8h2.1M11.9 8H14M3.8 3.8l1.5 1.5M10.7 10.7l1.5 1.5M12.2 3.8l-1.5 1.5M5.3 10.7l-1.5 1.5" />
        </svg>
      )
    case 'about':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <circle cx="8" cy="8" r="6.1" />
          <path d="M8 7.3v3.6" />
          <circle cx="8" cy="4.9" r="0.85" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="nx-loading" aria-busy="true" aria-label="设置加载中">
      <div className="nx-skeleton" style={{ width: '42%', height: 18 }} />
      <div className="nx-skeleton" style={{ width: '100%', height: 12, marginTop: 20 }} />
      <div className="nx-skeleton" style={{ width: '88%', height: 12 }} />
      <div className="nx-skeleton" style={{ width: '72%', height: 12 }} />
      <div className="nx-skeleton" style={{ width: '96%', height: 64, marginTop: 22 }} />
      <div className="nx-skeleton" style={{ width: '64%', height: 12, marginTop: 22 }} />
      <p className="settings-loading">加载中…</p>
    </div>
  )
}

export function SettingsApp(): JSX.Element {
  const { settings, error, retry, patch, reset } = useSettings()
  const [tab, setTab] = useState<TabKey>('dock')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetClosing, setResetClosing] = useState(false)
  const [resetting, setResetting] = useState(false)
  /** 弹层退场定时器：160ms 播完 nx-pop-out 再卸载 DOM */
  const resetCloseTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetCloseTimerRef.current !== null) window.clearTimeout(resetCloseTimerRef.current)
    },
    []
  )

  /** 弹层关闭：先播退场动画再卸载（AC-9.10 弹层进出动画） */
  const closeReset = useCallback(() => {
    if (resetting) return
    if (resetCloseTimerRef.current !== null) return
    setResetClosing(true)
    resetCloseTimerRef.current = window.setTimeout(() => {
      resetCloseTimerRef.current = null
      setResetOpen(false)
      setResetClosing(false)
    }, 160)
  }, [resetting])

  // IPC 失败不再静默：hooks 层已把失败原因放进 error，这里只负责呈现
  const safePatch = useCallback(
    async (p: DeepPartial<Settings>): Promise<void> => {
      try {
        await patch(p)
      } catch (err) {
        console.warn('[nexus] 保存设置失败', err)
      }
    },
    [patch]
  )

  const safeReset = useCallback(async (): Promise<void> => {
    try {
      await reset()
    } catch (err) {
      console.warn('[nexus] 恢复默认设置失败', err)
    }
  }, [reset])

  const confirmReset = async (): Promise<void> => {
    setResetting(true)
    await safeReset()
    setResetting(false)
    setResetClosing(true)
    window.setTimeout(() => {
      setResetOpen(false)
      setResetClosing(false)
    }, 160)
  }

  const renderContent = (): JSX.Element => {
    if (!settings) return <LoadingSkeleton />
    switch (tab) {
      case 'dock':
        return <DockSection settings={settings} patch={safePatch} />
      case 'music':
        return <MusicSection settings={settings} patch={safePatch} />
      case 'clock':
        return <ClockSection settings={settings} patch={safePatch} />
      case 'apps':
        return <AppsSection settings={settings} patch={safePatch} />
      case 'appearance':
        return <AppearanceSection settings={settings} patch={safePatch} />
      case 'system':
        return <SystemSection settings={settings} patch={safePatch} />
      case 'about':
        return <AboutSection reset={safeReset} />
    }
  }

  const env = window.nexus.env

  return (
    <div className="settings-shell">
      <header className="settings-titlebar">
        <div className="settings-title">
          <span className="settings-title-dot" aria-hidden="true" />
          <span>Nexus 设置</span>
        </div>
        <div className="settings-titlebar-actions nx-no-drag">
          <button
            type="button"
            className="settings-win-btn nx-no-drag nx-ripple-host"
            title="最小化"
            aria-label="最小化设置窗口"
            onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
            onClick={() => window.nexus.window.minimizeSettings()}
          >
            —
          </button>
          <button
            type="button"
            className="settings-win-btn is-close nx-no-drag nx-ripple-host"
            title="关闭"
            aria-label="关闭设置窗口"
            onPointerDown={(event) =>
              spawnRipple(event.currentTarget, event, { color: 'rgba(255, 124, 124, 0.5)' })
            }
            onClick={() => window.nexus.window.closeSettings()}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="settings-main">
        <nav className="settings-nav" aria-label="设置分组">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`settings-nav-item nx-ripple-host${tab === item.key ? ' is-active' : ''}`}
              aria-current={tab === item.key ? 'page' : undefined}
              disabled={!settings}
              onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
              onClick={() => setTab(item.key)}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                <NavIcon name={item.key} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <main className="settings-content">
          {/* v1.5：设置加载/保存失败必须可见（旧实现只 console.warn，用户只看到控件弹回） */}
          {error ? (
            <div className="settings-error-banner" role="alert">
              <span className="settings-error-text">{error}</span>
              <button
                type="button"
                className="settings-error-retry nx-ripple-host"
                onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                onClick={retry}
              >
                重试
              </button>
            </div>
          ) : null}
          {/* key=tab：切换分组时重挂载，触发 220ms 淡入位移转场 */}
          <div key={tab} className="settings-page">
            {renderContent()}
          </div>
        </main>
      </div>

      <footer className="settings-footer">
        <span className="settings-version">Nexus Dock v{env.appVersion}</span>
        <button
          type="button"
          className="settings-reset-link nx-no-drag nx-ripple-host"
          disabled={!settings}
          onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
          onClick={() => setResetOpen(true)}
        >
          恢复默认设置
        </button>
      </footer>

      {resetOpen ? (
        <>
          <div
            className={`nx-popover-backdrop${resetClosing ? ' is-leaving' : ''}`}
            aria-hidden="true"
            onClick={closeReset}
          />
          <div
            className={`nx-foot-confirm${resetClosing ? ' is-leaving' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="恢复默认设置确认"
          >
            <p>恢复全部默认设置？Dock 外观、音乐卡片、桌面时钟、位置锁定与应用列表都会回到初始状态。</p>
            <div className="nx-confirm-actions">
              <Button size="sm" onClick={closeReset}>
                取消
              </Button>
              <Button size="sm" variant="danger" disabled={resetting} onClick={() => void confirmReset()}>
                {resetting ? '恢复中…' : '确认恢复'}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
