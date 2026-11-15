import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import type { UpdateState } from '@shared/updates'
import { Button, Section, Switch } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (patch: DeepPartial<Settings>) => Promise<void>
}

function statusText(state: UpdateState): string {
  switch (state.phase) {
    case 'unsupported':
      return state.mode === 'portable' ? '便携版支持手动更新。安装一次安装版，以后即可自动更新。'
        : state.mode === 'development' ? '开发模式不检查更新。请使用安装版验证自动更新。'
        : '当前运行方式不支持自动更新，请从发布页下载安装版。'
    case 'checking': return '正在检查新版本…'
    case 'available': return `发现新版本 ${state.latestVersion}`
    case 'downloading': return `正在下载 ${state.latestVersion}…`
    case 'downloaded': return `${state.latestVersion} 已准备就绪，重启即可更新。`
    case 'installing': return '正在重启并安装更新…'
    case 'error': return state.message ?? '更新失败，请稍后重试。'
    default: return state.checkedAt ? '当前已是最新版本。' : '随时检查，轻松保持最新。'
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function UpdateSection({ settings, patch }: Props): JSX.Element {
  const [state, setState] = useState<UpdateState | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const accept = (next: UpdateState): void => {
      if (active) setState(current => !current || next.revision >= current.revision ? next : current)
    }
    // 先订阅再读取，revision 防止较慢的 IPC 响应覆盖新状态。
    const unsubscribe = window.nexus.updates.onChanged(accept)
    void window.nexus.updates.getState().then(accept).catch(() => {
      if (active) setError('无法读取更新状态，请重新打开设置。')
    })
    return () => { active = false; unsubscribe() }
  }, [])

  const action = async (request: () => Promise<UpdateState | void>): Promise<void> => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const next = await request()
      if (next) setState(current => !current || next.revision >= current.revision ? next : current)
    } catch {
      setError('操作未完成，请重试。')
    } finally {
      setPending(false)
    }
  }

  const supported = state?.mode === 'installer'
  const busy = pending || state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'installing'
  const ready = state?.phase === 'downloaded'
  const canDownload = state?.phase === 'available' || (state?.phase === 'error' && state.errorStage === 'download')
  const progress = state?.progress

  return (
    <Section title="软件更新" desc="更新来自 Nexus Dock 的 GitHub 正式发布。设置、窗口位置和词库会保留。">
      <div className="nx-update-card" data-update-phase={state?.phase ?? 'loading'}>
        <div className="nx-update-heading">
          <span className="nx-update-mark" aria-hidden="true">↗</span>
          <div>
            <strong>Nexus Dock <span className="nx-mono">v{state?.currentVersion ?? window.nexus.env.appVersion}</span></strong>
            <p role="status" aria-live="polite">{state ? statusText(state) : '正在读取更新状态…'}</p>
          </div>
        </div>
        {state?.phase === 'downloading' ? (
          <div className="nx-update-download">
            <progress aria-label="更新下载进度" max={100} {...(progress ? { value: progress.percent } : {})} />
            <span>{progress ? `${progress.percent.toFixed(0)}% · ${megabytes(progress.transferred)} / ${megabytes(progress.total)} MB · ${megabytes(progress.bytesPerSecond)} MB/s` : '正在连接下载…'}</span>
          </div>
        ) : null}
        <div className="nx-update-actions">
          {supported ? ready ? (
            <Button variant="primary" disabled={busy} onClick={() => void action(window.nexus.updates.install)}>重启更新</Button>
          ) : canDownload ? (
            <Button variant="primary" disabled={busy} onClick={() => void action(window.nexus.updates.download)}>
              {state?.phase === 'error' ? '重试下载' : '下载更新'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void action(window.nexus.updates.check)}>
              {state?.phase === 'checking' ? '检查中…' : state?.phase === 'error' ? '重新检查' : '检查更新'}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={pending || state?.phase === 'installing'} onClick={() => void action(window.nexus.updates.openReleases)}>
            {state?.mode === 'portable' ? '下载安装版' : '查看发布页'}
          </Button>
        </div>
        {state?.checkedAt ? <p className="nx-update-time">上次检查：{new Date(state.checkedAt).toLocaleString()}</p> : null}
        {error ? <p className="nx-update-error" role="alert">{error}</p> : null}
      </div>
      <Switch
        label="自动检查并下载更新"
        hint={supported ? '启动 12 秒后检查，之后每 6 小时检查。关闭后停止后续自动任务，当前下载继续。' : '安装版支持，便携版仍可正常使用。'}
        checked={settings.system.autoUpdate}
        disabled={!supported}
        onChange={enabled => void patch({ system: { autoUpdate: enabled } })}
      />
      <p className="nx-about-note">下载完成后点击「重启更新」才会安装。平时退出不会安装更新。</p>
    </Section>
  )
}
