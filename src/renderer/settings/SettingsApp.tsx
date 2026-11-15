import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import { useSettings } from '@renderer/shared/hooks'
import { spawnRipple } from '@renderer/shared/motion'
import { Button } from '@renderer/shared/ui'
import { BuiltinWindowsSection } from './sections/BuiltinWindowsSection'
import { ExtraWindowsSection } from './sections/ExtraWindowsSection'
import { AppsSection } from './sections/AppsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { SystemSection } from './sections/SystemSection'
import { AboutSection } from './sections/AboutSection'

type TabKey = 'windows' | 'extra' | 'apps' | 'appearance' | 'system' | 'about'

interface NavItem {
  key: TabKey
  label: string
}

/** 「窗口」分组：内置窗口（Dock/音乐/时钟合并）+ 附加窗口（注册表驱动，v1.8 起含英语单词学习） */
const WINDOW_NAV_ITEMS: NavItem[] = [
  { key: 'windows', label: '内置窗口' },
  { key: 'extra', label: '附加窗口' }
]

/** 其余页面保持原顺序与图标风格 */
const NAV_ITEMS: NavItem[] = [
  { key: 'apps', label: '应用' },
  { key: 'appearance', label: '外观' },
  { key: 'system', label: '系统' },
  { key: 'about', label: '关于' }
]

const PAGE_COPY: Record<TabKey, [string, string]> = {
  windows: ['你的桌面，恰到好处', '调整 Dock、音乐与时钟，让常用功能停在顺手的位置。'],
  extra: ['多一点专注', '管理桌面小工具，把学习放进日常。'],
  apps: ['常用应用，触手可及', '添加、排序，或换上你喜欢的图标。'],
  appearance: ['找到舒适的节奏', '调整动效与反馈，让每一次操作都自然。'],
  system: ['安静地陪伴', '管理启动方式与后台资源占用。'],
  about: ['Nexus Dock', '为你的 Windows 桌面留一点空间。']
}

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
    // 「内置窗口」：层叠窗口（后窗 + 前窗），与「应用」网格图标区分
    case 'windows':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <rect x="5.4" y="5.4" width="9.2" height="9.2" rx="1.5" />
          <path d="M2.7 10.6a1.5 1.5 0 0 1-1.5-1.5V2.8a1.5 1.5 0 0 1 1.5-1.5h6.3a1.5 1.5 0 0 1 1.5 1.5" />
        </svg>
      )
    // 「附加窗口」：窗口 + 加号（以后新增的功能窗口接入位）
    case 'extra':
      return (
        <svg {...ICON_PROPS} aria-hidden="true">
          <rect x="1.7" y="2.3" width="8.4" height="8.4" rx="1.6" />
          <path d="M13 9.9v4.6M10.7 12.2h4.6" />
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
  /** v1.7：默认进入「窗口 → 内置窗口」（Dock / 音乐 / 时钟 合并页） */
  const [tab, setTab] = useState<TabKey>('windows')
  /** v1.6：Dock 右键菜单「编辑名称与图标…」→ 切到「应用」页并打开对应条目弹层 */
  const [editAppId, setEditAppId] = useState<string | null>(null)
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

  // v1.6：接收主进程转发的「编辑某个应用显示」请求。
  // 新开设置窗口时事件可能早于订阅 → 挂载时主动消费一次；窗口已挂载但请求迟到（仍在加载）→ 聚焦时再消费一次。
  useEffect(() => {
    let alive = true
    const open = (id: string): void => {
      if (!alive || !id) return
      setTab('apps')
      setEditAppId(id)
    }
    const consume = (): void => {
      void window.nexus.apps
        .consumeEditRequest()
        .then((id) => {
          if (id) open(id)
        })
        .catch(() => undefined)
    }
    const off = window.nexus.apps.onEditRequest(open)
    consume()
    window.addEventListener('focus', consume)
    return () => {
      alive = false
      off()
      window.removeEventListener('focus', consume)
    }
  }, [])

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
      case 'windows':
        return <BuiltinWindowsSection settings={settings} patch={safePatch} />
      case 'extra':
        return <ExtraWindowsSection settings={settings} patch={safePatch} />
      case 'apps':
        return (
          <AppsSection
            settings={settings}
            patch={safePatch}
            editRequestId={editAppId}
            onEditRequestHandled={() => setEditAppId(null)}
          />
        )
      case 'appearance':
        return <AppearanceSection settings={settings} patch={safePatch} />
      case 'system':
        return <SystemSection settings={settings} patch={safePatch} onNavigate={(next) => setTab(next)} />
      case 'about':
        return <AboutSection reset={safeReset} settings={settings} patch={safePatch} />
    }
  }

  /** 左侧导航项：保持 v1.0 的 ripple / aria-current / 加载中 disabled 行为 */
  const renderNavItem = (item: NavItem): JSX.Element => (
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
  )

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
          {/* v1.7：分组标题不可点击（纯视觉分组），组内两项才是导航 */}
          <div className="settings-nav-group">窗口</div>
          {WINDOW_NAV_ITEMS.map((item) => renderNavItem(item))}
          <div className="settings-nav-sep" aria-hidden="true" />
          {NAV_ITEMS.map((item) => renderNavItem(item))}
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
            <div className="settings-page-heading"><h1>{PAGE_COPY[tab][0]}</h1><p>{PAGE_COPY[tab][1]}</p></div>
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
            <p>恢复全部默认设置？Dock 外观、音乐卡片、桌面时钟、附加窗口、位置锁定与应用列表都会回到初始状态。</p>
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
