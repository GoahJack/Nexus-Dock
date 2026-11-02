import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  CUSTOM_NAME_MAX_LENGTH,
  DEFAULT_APPS,
  displayIconOf,
  displayNameOf,
  type DeepPartial,
  type DockItem,
  type Settings
} from '@shared/types'
import { spawnRipple } from '@renderer/shared/motion'
import { Button, Section } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
  /** v1.6：由 Dock 右键菜单发起的编辑请求（目标应用 id） */
  editRequestId?: string | null
  /** 编辑请求已处理：通知父组件清空，避免重复打开 */
  onEditRequestHandled?: () => void
}

type Notice = { kind: 'ok' | 'err'; text: string }

/** v1.6 编辑弹层的草稿：name / icon 为空字符串表示「使用默认」（保存时转成 null 清空自定义） */
interface EditDraft {
  app: DockItem
  name: string
  icon: string
  picking: boolean
  saving: boolean
}

/** 36px 应用图标：有（自定义）图标用 img，否则用名称首字占位 */
function AppIcon({ item }: { item: DockItem }): JSX.Element {
  const icon = displayIconOf(item)
  if (icon) {
    return <img className="nx-app-icon" src={icon} alt="" draggable={false} />
  }
  const letter = displayNameOf(item).trim().charAt(0) || '?'
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

/** v1.6：已自定义显示名称/图标的条目徽标（悬停可看原名） */
function CustomBadge({ item }: { item: DockItem }): JSX.Element | null {
  if (!item.customName && !item.customIcon) return null
  return (
    <span className="nx-app-badge is-custom" title={`原名：${item.name}`}>
      自定义
    </span>
  )
}

/** 应用分组：排序 / 移除 / 添加 / 开始菜单选择 / 自定义显示名称与图标 / 恢复默认应用列表 */
export function AppsSection({ settings, patch, editRequestId, onEditRequestHandled }: Props): JSX.Element {
  const [order, setOrder] = useState<string[] | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<DockItem | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<DockItem[] | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  /** v1.6：正在编辑显示名称/图标的条目；null = 弹层关闭 */
  const [editing, setEditing] = useState<EditDraft | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

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

  /* ------------------- v1.6 自定义显示名称 / 图标 ------------------- */

  const openEditor = useCallback((app: DockItem): void => {
    setConfirmReset(false)
    setConfirmRemove(null)
    setPanelOpen(false)
    setEditing({
      app,
      name: app.customName ?? '',
      icon: app.customIcon ?? '',
      picking: false,
      saving: false
    })
  }, [])

  const updateDraft = useCallback((patchDraft: Partial<Pick<EditDraft, 'name' | 'icon'>>): void => {
    setEditing((current) => (current ? { ...current, ...patchDraft } : current))
  }, [])

  const closeEditor = useCallback((): void => {
    // 保存中不允许关闭，避免用户以为没生效
    setEditing((current) => (current && current.saving ? current : null))
  }, [])

  const editorOpen = editing !== null

  // 外部（Dock 右键菜单）请求：定位到对应条目并打开弹层；处理完通知父组件清空
  useEffect(() => {
    if (!editRequestId) return
    const target = apps.find((item) => item.id === editRequestId)
    if (target) openEditor(target)
    else setNotice({ kind: 'err', text: '该应用已不在 Dock 列表中（可能刚被移除）' })
    onEditRequestHandled?.()
  }, [apps, editRequestId, onEditRequestHandled, openEditor])

  // 打开弹层时聚焦名称输入框，便于直接改字
  useEffect(() => {
    if (!editing) return
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.app.id])

  // Esc 关闭编辑弹层（与开始菜单面板互不干扰：弹层层级更高）
  useEffect(() => {
    if (!editorOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editorOpen, closeEditor])

  const chooseIcon = useCallback(async (): Promise<void> => {
    setEditing((current) => (current ? { ...current, picking: true } : current))
    try {
      const result = await window.nexus.apps.pickIcon()
      if (result.ok && result.icon) {
        const icon = result.icon
        setEditing((current) => (current ? { ...current, icon } : current))
      } else if (result.error && result.error !== 'canceled') {
        setNotice({ kind: 'err', text: `选择图标失败：${result.error}` })
      }
    } catch (err) {
      fail(err, '选择图标失败')
    } finally {
      setEditing((current) => (current ? { ...current, picking: false } : current))
    }
  }, [fail])

  const saveEditor = useCallback(async (): Promise<void> => {
    const draft = editing
    if (!draft || draft.saving) return
    setEditing((current) => (current ? { ...current, saving: true } : current))
    try {
      const trimmed = draft.name.trim()
      // 与原名相同视为「恢复默认名称」，避免配置里留下无意义的重复字段
      const customName = trimmed && trimmed !== draft.app.name ? trimmed : null
      const customIcon = draft.icon ? draft.icon : null
      const res = await window.nexus.apps.updateItem(draft.app.id, { customName, customIcon })
      if (Array.isArray(res)) setOrder(res.map((item) => item.id))
      setEditing(null)
      setNotice({ kind: 'ok', text: `已更新「${customName ?? draft.app.name}」的显示` })
    } catch (err) {
      setEditing((current) => (current ? { ...current, saving: false } : current))
      fail(err, '保存显示设置失败')
    }
  }, [editing, fail])

  const resetEditor = useCallback(async (): Promise<void> => {
    const draft = editing
    if (!draft || draft.saving) return
    setEditing((current) => (current ? { ...current, saving: true } : current))
    try {
      const res = await window.nexus.apps.updateItem(draft.app.id, { customName: null, customIcon: null })
      if (Array.isArray(res)) setOrder(res.map((item) => item.id))
      setEditing(null)
      setNotice({ kind: 'ok', text: `已恢复「${draft.app.name}」的默认名称与图标` })
    } catch (err) {
      setEditing((current) => (current ? { ...current, saving: false } : current))
      fail(err, '恢复默认显示失败')
    }
  }, [editing, fail])

  /* ------------------------------ 排序 / 移除 / 添加 ------------------------------ */

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
        setNotice({ kind: 'ok', text: '顺序已保存' })
      } catch (err) {
        setOrder(null)
        fail(err, '调整顺序失败')
      }
    },
    [list, fail]
  )

  const remove = useCallback(
    async (app: DockItem): Promise<void> => {
      setConfirmRemove(null)
      setOrder(list.filter((item) => item.id !== app.id).map((item) => item.id))
      try {
        const res = await window.nexus.apps.remove(app.id)
        if (Array.isArray(res)) setOrder(res.map((item) => item.id))
        setNotice({ kind: 'ok', text: `已移除「${displayNameOf(app)}」` })
      } catch (err) {
        setOrder(null)
        fail(err, '移除应用失败')
      }
    },
    [list, fail]
  )

  /** 移除是破坏性操作：先弹本页统一的确认条，确认后才真正调用 IPC */
  const requestRemove = (app: DockItem): void => {
    setConfirmReset(false)
    setConfirmRemove(app)
  }

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
          setNotice({ kind: 'ok', text: `已添加 ${added.map((item) => `「${displayNameOf(item)}」`).join('')} 到 Dock` })
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
    setConfirmRemove(null)
    setOrder(null)
    await patch({ apps: DEFAULT_APPS })
  }, [patch])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (candidates ?? []).filter((item) => q === '' || item.name.toLowerCase().includes(q)),
    [candidates, q]
  )
  const addedIds = useMemo(() => new Set(list.map((item) => item.id)), [list])

  /* -------------------------------- 编辑弹层数据 -------------------------------- */

  const previewName = editing ? editing.name.trim() || editing.app.name : ''
  const previewItem: DockItem | null = editing
    ? {
        ...editing.app,
        name: previewName,
        customIcon: editing.icon || undefined
      }
    : null
  const draftHasDefault = editing ? !editing.app.customName && !editing.app.customIcon : false

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
            <span>恢复默认应用列表将删除你添加的全部应用，只保留 6 个内置应用，确定继续？</span>
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

        {confirmRemove ? (
          <div className="nx-confirm-bar">
            <span>
              从 Dock 移除「{displayNameOf(confirmRemove)}」？只会从 Dock 列表移除，不会卸载该应用。
            </span>
            <div className="nx-confirm-actions">
              <Button size="sm" onClick={() => setConfirmRemove(null)}>
                取消
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove(confirmRemove)}>
                确认移除
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
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmRemove(null)
              setConfirmReset(true)
            }}
          >
            恢复默认应用列表
          </Button>
        </div>

        <p className="nx-apps-tip">
          点 Dock 图标即可启动；启动失败会在 Dock 上方显示原因。点 ✎ 可修改图标与显示名称（v1.6）。
        </p>

        <div className="nx-app-list">
          {list.length === 0 ? (
            <div className="nx-empty">列表为空，点击「添加应用」或「从开始菜单选择」加入应用。</div>
          ) : (
            list.map((app, index) => {
              const label = displayNameOf(app)
              return (
                <div className="nx-app-row" key={app.id}>
                  <AppIcon item={app} />
                  <div className="nx-app-text">
                    <div className="nx-app-name-line">
                      <span
                        className="nx-app-name"
                        title={app.customName ? `${label}（原名：${app.name}）` : app.name}
                      >
                        {label}
                      </span>
                      {app.aumid ? <UwpBadge /> : null}
                      <CustomBadge item={app} />
                    </div>
                    <span className="nx-app-path" title={app.path || app.aumid || app.name}>
                      {app.path || (app.aumid ? 'UWP 应用' : '—')}
                    </span>
                  </div>
                  <div className="nx-app-actions">
                    <button
                      type="button"
                      className="nx-app-action nx-no-drag nx-ripple-host"
                      title="编辑显示名称与图标"
                      aria-label={`编辑 ${label} 的显示名称与图标`}
                      onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                      onClick={() => openEditor(app)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="nx-app-action nx-no-drag nx-ripple-host"
                      title="上移"
                      aria-label={`上移 ${label}`}
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
                      aria-label={`下移 ${label}`}
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
                      aria-label={`从 Dock 移除 ${label}`}
                      onPointerDown={(event) =>
                        spawnRipple(event.currentTarget, event, { color: 'rgba(255, 124, 124, 0.5)' })
                      }
                      onClick={() => requestRemove(app)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Section>

      {editing && previewItem ? (
        <div className="nx-apps-overlay" onClick={closeEditor}>
          <div
            className="nx-app-edit"
            role="dialog"
            aria-modal="true"
            aria-label={`编辑「${previewName}」的显示名称与图标`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="nx-app-edit-head">
              <div>
                <h3>编辑名称与图标</h3>
                <p>只改变 Dock 里的显示，不会修改应用本身。</p>
              </div>
              <button
                type="button"
                className="nx-icon-btn nx-no-drag nx-ripple-host"
                title="关闭"
                aria-label="关闭编辑弹层"
                onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                onClick={closeEditor}
              >
                ✕
              </button>
            </header>

            <div className="nx-app-edit-body">
              <div className="nx-app-edit-preview">
                <AppIcon item={previewItem} />
                <div className="nx-app-edit-preview-text">
                  <span className="nx-app-edit-preview-name">{previewName}</span>
                  <span className="nx-app-edit-preview-sub">
                    {editing.app.path || (editing.app.aumid ? 'UWP 应用' : '—')}
                  </span>
                </div>
              </div>

              <label className="nx-app-edit-field">
                <span className="nx-app-edit-label">显示名称</span>
                <input
                  ref={nameInputRef}
                  className="nx-app-edit-input nx-no-drag"
                  type="text"
                  value={editing.name}
                  maxLength={CUSTOM_NAME_MAX_LENGTH}
                  placeholder={editing.app.name}
                  aria-label="显示名称"
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveEditor()
                    }
                  }}
                />
                <span className="nx-app-edit-hint">
                  留空则使用原名称「{editing.app.name}」，最多 {CUSTOM_NAME_MAX_LENGTH} 个字符。
                </span>
              </label>

              <div className="nx-app-edit-field">
                <span className="nx-app-edit-label">显示图标</span>
                <div className="nx-app-edit-icon-row">
                  <Button size="sm" disabled={editing.picking || editing.saving} onClick={() => void chooseIcon()}>
                    {editing.picking ? '选择中…' : '选择图片…'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!editing.icon || editing.picking || editing.saving}
                    onClick={() => updateDraft({ icon: '' })}
                  >
                    恢复默认图标
                  </Button>
                </div>
                <span className="nx-app-edit-hint">
                  支持 PNG / JPG / WebP / ICO / SVG，最大 8MB；图片会复制到图标缓存，原文件移动后仍可用。
                </span>
              </div>
            </div>

            <footer className="nx-app-edit-foot">
              <Button
                size="sm"
                variant="ghost"
                disabled={draftHasDefault || editing.saving}
                onClick={() => void resetEditor()}
              >
                恢复默认
              </Button>
              <span className="nx-app-edit-foot-spacer" />
              <Button size="sm" disabled={editing.saving} onClick={closeEditor}>
                取消
              </Button>
              <Button size="sm" variant="primary" disabled={editing.saving} onClick={() => void saveEditor()}>
                {editing.saving ? '保存中…' : '保存'}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}

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
