/** 自动更新 IPC 契约：安装与下载路径只留在主进程。 */
export type UpdateMode = 'installer' | 'portable' | 'development' | 'unsupported'
export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type UpdateErrorStage = 'check' | 'download' | 'install'

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  revision: number
  mode: UpdateMode
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  checkedAt?: number
  progress?: UpdateProgress
  message?: string
  errorStage?: UpdateErrorStage
}

export interface UpdateApi {
  getState: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => Promise<UpdateState>
  openReleases: () => Promise<void>
  onChanged: (cb: (state: UpdateState) => void) => () => void
}

export const RELEASES_URL = 'https://github.com/GoahJack/Nexus-Dock/releases/latest'
