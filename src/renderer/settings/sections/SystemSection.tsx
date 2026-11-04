import { useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import { Button, Section, Switch } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
  /**
   * v1.7：窗口共性行为（吸附 / 置顶 / 仅在桌面 / 锁定 / 复位）已迁移到
   * 「窗口 → 内置窗口 / 附加窗口」，系统页只保留跳转入口。
   */
  onNavigate?: (tab: 'windows' | 'extra') => void
}

/** AutoStartResult.reason → 可读中文；reason 可能是 'dev' / 'os' / 任意异常文本 */
function autoStartErrorText(reason?: string): string {
  if (!reason) return '写入系统登录项失败，请稍后重试'
  if (reason === 'dev') return '开发模式不可用，请使用安装版'
  if (reason === 'os') return '系统登录项写入后校验不一致，可能被安全软件拦截'
  return `写入系统登录项失败：${reason}`
}

/** 系统分组：开机自启 + 「窗口」页跳转（v1.7 起窗口共性设置不在此页） */
export function SystemSection({ settings, patch, onNavigate }: Props): JSX.Element {
  const packaged = window.nexus.env.isPackaged
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
        title="窗口"
        desc="吸附 / 始终置顶 / 仅在桌面 / 位置锁定 / 移回默认位置已统一在「窗口 → 内置窗口」管理；附加窗口在「窗口 → 附加窗口」。"
      >
        <div className="nx-inline-actions">
          <Button size="sm" disabled={!onNavigate} onClick={() => onNavigate?.('windows')}>
            前往内置窗口
          </Button>
          <Button size="sm" disabled={!onNavigate} onClick={() => onNavigate?.('extra')}>
            前往附加窗口
          </Button>
        </div>
        <p className="nx-hint-text">
          右键 Dock 勾选「锁定全部窗口位置」可快捷锁定 / 解锁所有窗口；设置窗口本身不受位置锁定影响。
        </p>
      </Section>
    </div>
  )
}
