import { useState } from 'react'
import type { JSX } from 'react'
import { Button, Row, Section } from '@renderer/shared/ui'

interface Props {
  reset: () => Promise<void>
}

const PLATFORM_LABEL: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

/** 关于分组：版本 / 运行环境 / 恢复全部默认 / 退出 */
export function AboutSection({ reset }: Props): JSX.Element {
  const env = window.nexus.env
  const [confirm, setConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  const doReset = async (): Promise<void> => {
    setResetting(true)
    try {
      await reset()
    } finally {
      setResetting(false)
      setConfirm(false)
    }
  }

  const platform = PLATFORM_LABEL[env.platform] ?? env.platform

  return (
    <div className="nx-sections">
      <Section title="关于 Nexus Dock" desc="版本与运行环境用于反馈问题和定位差异。">
        <Row label="应用">
          <span className="nx-about-value">Nexus Dock</span>
        </Row>
        <Row label="版本">
          <span className="nx-mono">{env.appVersion}</span>
        </Row>
        <Row label="平台">
          <span className="nx-about-value">
            {platform}
            {env.isDev ? '（开发模式）' : ''}
          </span>
        </Row>
      </Section>

      <Section title="运行环境" desc="Electron / Chromium / Node 版本。">
        <Row label="Electron">
          <span className="nx-mono">{env.versions.electron || '—'}</span>
        </Row>
        <Row label="Chromium">
          <span className="nx-mono">{env.versions.chrome || '—'}</span>
        </Row>
        <Row label="Node">
          <span className="nx-mono">{env.versions.node || '—'}</span>
        </Row>
      </Section>

      <Section title="维护" desc="恢复默认会立即覆盖当前所有参数；退出后 Dock 与音乐卡片一并关闭。">
        {confirm ? (
          <div className="nx-confirm-bar">
            <span>恢复全部默认设置？当前 Dock、音乐卡片、桌面时钟、位置锁定与应用列表的调整都会丢失。</span>
            <div className="nx-confirm-actions">
              <Button size="sm" onClick={() => setConfirm(false)}>
                取消
              </Button>
              <Button size="sm" variant="danger" disabled={resetting} onClick={() => void doReset()}>
                {resetting ? '恢复中…' : '确认恢复'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="nx-about-actions">
          <Button variant="danger" onClick={() => setConfirm(true)}>
            恢复全部默认设置
          </Button>
          <Button variant="ghost" onClick={() => window.nexus.window.quit()}>
            退出 Nexus Dock
          </Button>
        </div>
        <p className="nx-about-note">退出后设置窗口关闭，主进程随之退出；下次启动会沿用当前配置。</p>
      </Section>
    </div>
  )
}
