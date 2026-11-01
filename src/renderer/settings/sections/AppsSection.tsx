import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { DEFAULT_APPS, type DeepPartial, type DockItem, type Settings } from '@shared/types'
import { spawnRipple } from '@renderer/shared/motion'
import { Button, Section } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

type Notice = { kind: 'ok' | 'err'; text: string }

/** 36px 应用图标：有 icon 用 img，否则用名称首字占位（UWP 应用通常没有 icon） */
function AppIcon({ item }: { item: DockItem }): JSX.Element {
  if (item.icon) {
    return <img className="nx-app-icon" src={item.icon} alt="" draggable={false} />
  }
  const letter = item.name.trim().charAt(0) || '?'
  return (
    <span className="nx-app-icon nx-app-icon-fallback" aria-hidden="true">
      {letter}
    </span>
  )
}

/** UWP 应用小徽标（带 aumid 的打包应用，path 可能为空） */
function UwpBadge(): JSX.Element {
  return (
    <span className="nx-app-badge" title="UWP 应用（通过 AppUserModelID 启动）">
      UWP
    </span>
  )
}

/** 应用分组：排序 / 移除 / 添加 / 开始菜单选择 / 恢复默认图标 */
export function AppsSection({ settings, patch }: Props): JSX.Element {
  const [order, setOrder] = useState<string[] | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<DockItem[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)

  const apps = settings.apps

  /** 本地乐观顺序：id 只决定展示顺序，数据仍取自 settings.apps */
  const list = useMemo<DockItem[]>(() => {
    if (!order) return apps
    const byId = new Map(apps.map((item) => [item.id, item]))
    const ordered: DockItem[] = []
    for (const id of order) {
      const item = byId.get(id)
      if (item) {
        ordered.push(item)
        byId.delete(id)
      }
    }
    for (const item of apps) {
      if (byId.has(item.id)) ordered.push(item)
    }
    return ordered
  }, [apps, order])

  // 主进程广播最新设置后，丢弃本地乐观顺序
  useEffect(() => {
    setOrder(null)
  }, [settings])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  const fail = useCallback((err: unknown, prefix: string): void => {
    setNotice({ kind: 'err', text: `${prefix}：${err instanceof Error ? err.message : String(err)}` })
  }, [])

  const move = useCallback(
    async (index: number, dir: -1 | 1): Promise<void> => {
      const target = index + dir
      if (target < 0 || target >= list.length) return
      const next = list.slice()
      const moved = next[index]
      next[index] = next[target]
      next[target] = moved
      const ids = next.map((item) => item.id)
      setOrder(ids)
      try {
        const res = await window.nexus.apps.reorder(ids)
        if (Array.isArray(res) && res.length > 0) setOrder(res.map((item) => item.id))
      } catch (err) {
        setOrder(null)
        fail(err, '调整顺序失败')
      }
    },
    [list, fail]
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      setOrder(list.filter((item) => item.id !== id).map((item) => item.id))
      try {
        const res = await window.nexus.apps.remove(id)
        if (Array.isArray(res)) setOrder(res.map((item) => item.id))
      } catch (err) {
        setOrder(null)
        fail(err, '移除应用失败')
      }
    },
    [list, fail]
  )

  const addByDialog = useCallback(async (): Promise<void> => {
    if (dialogBusy) return
    setDialogBusy(true)
    try {
      const before = new Set(apps.map((item) => item.id))
      const res = await window.nexus.apps.addByDialog()
      if (Array.isArray(res)) {
        setOrder(res.map((item) => item.id))
        const added = res.filter((item) => !before.has(item.id))
        if (added.length > 0) {
          setNotice({ kind: 'ok', text: `已添加 ${added.map((item) => `「${item.name}」`).join('')} 到 Dock` })
        }
      }
    } catch (err) {
      fail(err, '添加应用失败')
    } finally {
      setDialogBusy(false)
    }
  }, [apps, dialogBusy, fail])

  const scan = useCallback(async (): Promise<void> => {
    setScanning(true)
    setScanError(null)
    try {
      const res = await window.nexus.apps.scanStartMenu()
      setCandidates(res)
    } catch (err) {
      setScanError(`扫描开始菜单失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setScanning(false)
    }
  }, [])

  const openStartMenu = useCallback((): void => {
    setPanelOpen(true)
    setQuery('')
    if (!candidates || candidates.length === 0) void scan()
  }, [candidates, scan])

  const addFromStartMenu = useCallback(
    async (item: DockItem): Promise<void> => {
      try {
        const res = await window.nexus.apps.addFromStartMenu(item)
        if (Array.isArray(res) && res.length > 0) setOrder(res.map((i) => i.id))
        setNotice({ kind: 'ok', text: `已添加「${item.name}」到 Dock` })
      } catch (err) {
        fail(err, '添加应用失败')
      }
    },
    [fail]
  )

  const restoreDefaults = useCallback(async (): Promise<void> => {
    setConfirmReset(false)
    setOrder(null)
    await patch({ apps: DEFAULT_APPS })
  }, [patch])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (candidates ?? []).filter((item) => q === '' || item.name.toLowerCase().includes(q)),
    [candidates, q]
  )
  const addedIds = useMemo(() => new Set(list.map((item) => item.id)), [list])

  return (
    <div className="nx-sections">
      <Section title="Dock 应用" desc="排序、移除或添加应用，改动会立即同步到 Dock 并写入配置。">
        {notice ? (
          <div className={`nx-notice ${notice.kind === 'ok' ? 'is-ok' : 'is-err'}`} role="status">
            {notice.text}
          </div>
        ) : null}

        {confirmReset ? (
          <div className="nx-confirm-bar">
            <span>恢复默认图标会替换当前应用列表（6 个内置应用），确定继续？</span>
            <div className="nx-confirm-actions">
              <Button size="sm" onClick={() => setConfirmReset(false)}>
                取消
              </Button>
              <Button size="sm" variant="danger" onClick={() => void restoreDefaults()}>
                确认恢复
              </Button>
            </div>
          </div>
        ) : null}

        <div className="nx-apps-toolbar">
          <Button size="sm" disabled={dialogBusy} onClick={() => void addByDialog()}>
            {dialogBusy ? '选择中…' : '添加应用'}
          </Button>
          <Button size="sm" onClick={openStartMenu}>
            从开始菜单选择
          </Button>
          <span className="nx-apps-toolbar-spacer" />
          <Button size="sm" variant="ghost" className="nx-text-danger" onClick={() => setConfirmReset(true)}>
            恢复默认图标
          </Button>
        </div>

        <p className="nx-apps-tip">点 Dock 图标即可启动；启动失败会在 Dock 上方显示原因。</p>

        <div className="nx-app-list">
          {list.length === 0 ? (
            <div className="nx-empty">列表为空，点击「添加应用」或「从开始菜单选择」加入应用。</div>
          ) : (
            list.map((app, index) => (
              <div className="nx-app-row" key={app.id}>
                <AppIcon item={app} />
                <div className="nx-app-text">
                  <div className="nx-app-name-line">
                    <span className="nx-app-name" title={app.name}>
                      {app.name}
                    </span>
                    {app.aumid ? <UwpBadge /> : null}
                  </div>
                  <span className="nx-app-path" title={app.path || app.aumid || app.name}>
                    {app.path || (app.aumid ? 'UWP 应用' : '—')}
                  </span>
                </div>
                <div className="nx-app-actions">
                  <button
                    type="button"
                    className="nx-app-action nx-no-drag nx-ripple-host"
                    title="上移"
                    aria-label={`上移 ${app.name}`}
                    disabled={index === 0}
                    onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                    onClick={() => void move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="nx-app-action nx-no-drag nx-ripple-host"
                    title="下移"
                    aria-label={`下移 ${app.name}`}
                    disabled={index === list.length - 1}
                    onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                    onClick={() => void move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="nx-app-action is-danger nx-no-drag nx-ripple-host"
                    title="从 Dock 移除"
                    aria-label={`从 Dock 移除 ${app.name}`}
                    onPointerDown={(event) =>
                      spawnRipple(event.currentTarget, event, { color: 'rgba(255, 124, 124, 0.5)' })
                    }
                    onClick={() => void remove(app.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      {panelOpen ? (
        <div className="nx-apps-overlay">
          <div className="nx-apps-panel" role="dialog" aria-modal="true" aria-label="从开始菜单选择应用">
            <header className="nx-apps-panel-head">
              <div>
                <h3>从开始菜单选择</h3>
                <p>
                  {scanning
                    ? '正在扫描开始菜单…'
                    : candidates
                      ? `共扫描到 ${candidates.length} 个应用`
                      : '尚未扫描'}
                </p>
              </div>
              <div className="nx-panel-head-actions">
                <Button size="sm" variant="ghost" disabled={scanning} onClick={() => void scan()}>
                  重新扫描
                </Button>
                <button
                  type="button"
                  className="nx-icon-btn nx-no-drag nx-ripple-host"
                  title="关闭"
                  aria-label="关闭开始菜单面板"
                  onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                  onClick={() => setPanelOpen(false)}
                >
                  ✕
                </button>
              </div>
            </header>

            <input
              className="nx-search nx-no-drag"
              type="search"
              placeholder="按名称搜索应用…"
              aria-label="搜索开始菜单应用"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="nx-apps-candidates">
              {scanError ? (
                <div className="nx-empty">{scanError}</div>
              ) : scanning && !candidates ? (
                <div className="nx-empty">正在扫描开始菜单，请稍候…</div>
              ) : filtered.length === 0 ? (
                <div className="nx-empty">
                  {candidates && candidates.length > 0 ? '没有匹配的应用' : '没有扫描到开始菜单应用'}
                </div>
              ) : (
                filtered.map((item) => {
                  const added = addedIds.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="nx-cand nx-no-drag nx-ripple-host"
                      disabled={added}
                      title={item.path || item.aumid || item.name}
                      onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                      onClick={() => void addFromStartMenu(item)}
                    >
                      <AppIcon item={item} />
                      <span className="nx-cand-text">
                        <span className="nx-cand-name-line">
                          <span className="nx-cand-name">{item.name}</span>
                          {item.aumid ? <UwpBadge /> : null}
                        </span>
                        <span className="nx-cand-path">{item.path || (item.aumid ? 'UWP 应用' : '')}</span>
                      </span>
                      <span className="nx-cand-action">{added ? '已添加' : '＋ 添加'}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
