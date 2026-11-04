import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AppCustomPatch,
  type AutoStartResult,
  type DeepPartial,
  type DockItem,
  type LaunchResult,
  type LocalTrack,
  type MediaAction,
  type MediaState,
  type NexusApi,
  type PickIconResult,
  type Point,
  type Settings,
  type Size,
  type WindowTarget
} from '@shared/types'

/** 统一的「订阅 → 返回取消订阅函数」工具，保证渲染层不会泄漏监听器 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: NexusApi = {
  env: {
    platform: process.platform,
    isDev: !!process.env['ELECTRON_RENDERER_URL'],
    // 主进程在创建窗口前注入（沙箱 preload 无法直接访问 app.isPackaged）
    isPackaged: process.env['NEXUS_PACKAGED'] === '1',
    appVersion: process.env['NEXUS_VERSION'] ?? '0.1.0',
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? ''
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
    update: (patch: DeepPartial<Settings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch) as Promise<Settings>,
    reset: () => ipcRenderer.invoke(IPC.settingsReset) as Promise<Settings>,
    onChanged: (cb) => subscribe<Settings>(IPC.settingsChanged, cb)
  },
  apps: {
    list: () => ipcRenderer.invoke(IPC.appsList) as Promise<DockItem[]>,
    launch: (id: string) => ipcRenderer.invoke(IPC.appsLaunch, id) as Promise<LaunchResult>,
    remove: (id: string) => ipcRenderer.invoke(IPC.appsRemove, id) as Promise<DockItem[]>,
    addByDialog: () => ipcRenderer.invoke(IPC.appsAddByDialog) as Promise<DockItem[]>,
    reorder: (ids: string[]) => ipcRenderer.invoke(IPC.appsReorder, ids) as Promise<DockItem[]>,
    menu: (id: string, point: Point) => ipcRenderer.invoke(IPC.appsMenu, id, point) as Promise<void>,
    dockMenu: (point: Point) => ipcRenderer.invoke(IPC.appsContextMenuDock, point) as Promise<void>,
    scanStartMenu: () => ipcRenderer.invoke(IPC.appsScanStartMenu) as Promise<DockItem[]>,
    addFromStartMenu: (item: DockItem) => ipcRenderer.invoke(IPC.appsAddFromStartMenu, item) as Promise<DockItem[]>,
    updateItem: (id: string, patch: AppCustomPatch) =>
      ipcRenderer.invoke(IPC.appsUpdateItem, id, patch) as Promise<DockItem[]>,
    pickIcon: () => ipcRenderer.invoke(IPC.appsPickIcon) as Promise<PickIconResult>,
    requestEdit: (id: string) => ipcRenderer.invoke(IPC.appsRequestEdit, id) as Promise<void>,
    consumeEditRequest: () => ipcRenderer.invoke(IPC.appsConsumeEditRequest) as Promise<string | null>,
    onEditRequest: (cb) => subscribe<string>(IPC.appsEditRequest, cb),
    onRunning: (cb) => subscribe<Record<string, boolean>>(IPC.appsRunning, cb)
  },
  window: {
    setContentSize: (target: WindowTarget, size: Size) => ipcRenderer.send(IPC.windowSetContentSize, target, size),
    // v1.7：附加窗口上报自己的内容尺寸（主进程按发送者定位窗口）
    setOwnContentSize: (size: Size) => ipcRenderer.send(IPC.windowSetOwnContentSize, size),
    openSettings: () => ipcRenderer.send(IPC.windowOpenSettings),
    closeSettings: () => ipcRenderer.send(IPC.windowCloseSettings),
    minimizeSettings: () => ipcRenderer.send(IPC.windowMinimizeSettings),
    quit: () => ipcRenderer.send(IPC.windowQuit),
    capture: (target: WindowTarget) => ipcRenderer.invoke(IPC.windowCapture, target) as Promise<string>,
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IPC.windowSetIgnoreMouse, ignore)
  },
  dock: {
    snap: () => ipcRenderer.invoke(IPC.dockSnap) as Promise<void>
  },
  system: {
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke(IPC.systemSetAutoStart, enabled) as Promise<AutoStartResult>
  },
  media: {
    getState: () => ipcRenderer.invoke(IPC.mediaGetState) as Promise<MediaState>,
    control: (action: MediaAction, positionMs?: number) =>
      ipcRenderer.invoke(IPC.mediaControl, action, positionMs) as Promise<{ ok: boolean }>,
    pickFiles: () => ipcRenderer.invoke(IPC.mediaPickFiles) as Promise<LocalTrack[]>,
    setLocalState: (state: MediaState) => ipcRenderer.send(IPC.mediaSetLocalState, state),
    onUpdate: (cb) => subscribe<MediaState>(IPC.mediaUpdate, cb),
    onTracks: (cb) => subscribe<LocalTrack[]>(IPC.mediaTracks, cb)
  }
}

contextBridge.exposeInMainWorld('nexus', api)
