import { screen, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import { nextIslandProximity, type IslandProximity } from '@shared/island'
import { subscribeSettings } from './settingsStore'

interface Entry {
  win: BrowserWindow
  config: () => { collapsed: boolean; pinned: boolean } | null
  proximity: IslandProximity
}

const entries = new Map<number, Entry>()
let timer: NodeJS.Timeout | null = null
let unsubscribe: (() => void) | null = null
const EMPTY: IslandProximity = { near: false, anchor: null, bounds: null }

function active(entry: Entry): boolean {
  const config = entry.config()
  return !!config?.collapsed && !config.pinned && !entry.win.isDestroyed() && entry.win.isVisible() && !entry.win.isMinimized()
}

function publish(entry: Entry, near: boolean): void {
  if (!entry.win.isDestroyed() && !entry.win.webContents.isDestroyed()) {
    entry.win.webContents.send(IPC.islandProximityChanged, near)
  }
}

function tick(): void {
  const cursor = screen.getCursorScreenPoint()
  for (const entry of entries.values()) {
    if (!active(entry)) continue
    updateEntry(entry, cursor)
  }
}

function updateEntry(entry: Entry, cursor: { x: number; y: number }): void {
  const next = nextIslandProximity(entry.proximity, cursor, entry.win.getBounds())
  const changed = next.near !== entry.proximity.near
  entry.proximity = next
  if (changed) publish(entry, next.near)
}

/** A single 100ms probe for all eligible widgets; no timer when hidden, pinned or disabled. */
function sync(): void {
  for (const entry of entries.values()) {
    if (!active(entry)) {
      const changed = entry.proximity.near
      entry.proximity = { ...EMPTY }
      if (changed) publish(entry, false)
    }
  }
  const needed = [...entries.values()].some(active)
  if (needed && timer === null) { tick(); timer = setInterval(tick, 100) }
  else if (!needed && timer !== null) { clearInterval(timer); timer = null }
  else if (needed) tick()
}

export function watchIslandWindow(win: BrowserWindow, config: Entry['config']): void {
  const id = win.webContents.id
  const entry: Entry = { win, config, proximity: { ...EMPTY } }
  entries.set(id, entry)
  unsubscribe ??= subscribeSettings(sync)
  win.on('show', sync)
  win.on('hide', sync)
  win.on('minimize', sync)
  win.on('restore', sync)
  win.webContents.on('did-finish-load', () => { sync(); publish(entry, entry.proximity.near) })
  win.once('closed', () => {
    entries.delete(id)
    sync()
    if (entries.size === 0) { unsubscribe?.(); unsubscribe = null }
  })
  sync()
}

/** The IPC caller can only read its own proximity; Dock/settings are never registered. */
export function getOwnIslandProximity(webContentsId: number): boolean {
  const entry = entries.get(webContentsId)
  if (!entry || !active(entry)) return false
  updateEntry(entry, screen.getCursorScreenPoint())
  return entry.proximity.near
}

export function disposeIslandProximity(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
  unsubscribe?.()
  unsubscribe = null
  entries.clear()
}
