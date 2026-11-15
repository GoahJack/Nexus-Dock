import { useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, MediaSource, MusicAnchor, ProgressStyle, Settings, ThemeMode } from '@shared/types'
import { Button, Section, Segmented, Slider, Switch } from '@renderer/shared/ui'
import { IslandStatus } from '@renderer/shared/IslandStatus'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

const ANCHOR_OPTIONS: { value: MusicAnchor; label: string }[] = [
  { value: 'dock', label: '跟随 Dock' },
  { value: 'free', label: '自由拖动' }
]

const SOURCE_OPTIONS: { value: MediaSource; label: string }[] = [
  { value: 'system', label: '系统播放器' },
  { value: 'local', label: '本地播放器' }
]

const PROGRESS_OPTIONS: { value: ProgressStyle; label: string }[] = [
  { value: 'bar', label: '条形' },
  { value: 'ring', label: '环形' }
]

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

/** 音乐分组：卡片显隐/布局/进度样式 + 本地音频选择 */
export function MusicSection({ settings, patch }: Props): JSX.Element {
  const m = settings.music
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  /** 分区内所有设置保存都走这里：失败时在同页提示，避免「点了没反应」 */
  const apply = (p: DeepPartial<Settings>): void => {
    void patch(p).catch((err) => {
      setNotice({ kind: 'err', text: `设置保存失败：${err instanceof Error ? err.message : String(err)}` })
    })
  }

  const pickLocal = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setNotice(null)
    try {
      // 先切来源再弹选择框：保证「来源」控件显示与真实配置始终一致，
      // 不会出现「弹完框后控件自己变了」的事后追认（主进程 pickFiles 成功后也会写 source）。
      if (m.source !== 'local') await patch({ music: { source: 'local' } })
      // pickFiles 由主进程负责把曲目广播给音乐卡片
      const tracks = await window.nexus.media.pickFiles()
      if (tracks.length > 0) {
        setNotice({ kind: 'ok', text: `已发送 ${tracks.length} 首到音乐卡片，来源已切到本地` })
      } else {
        setNotice({ kind: 'ok', text: '未选择文件，来源已切换到本地播放器' })
      }
    } catch (err) {
      setNotice({ kind: 'err', text: `选择本地音频失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="nx-sections">
      {/* 提示放在页首：主题 / 布局等分组保存失败也看得到（不只是本地音频选择） */}
      {notice ? (
        <div className={`nx-notice ${notice.kind === 'ok' ? 'is-ok' : 'is-err'}`} role="status">
          {notice.text}
        </div>
      ) : null}
      <Section title="音乐卡片" desc="桌面悬浮的音乐信息窗，可跟随 Dock 或自由摆放。">
        <Switch label="灵动岛：靠近时展开" hint="鼠标靠近胶囊自动展开，移开 900 毫秒后收起；关闭后始终展开。" checked={m.collapsed} onChange={(collapsed) => apply({ music: { collapsed } })} />
        <Switch label="保持展开" hint="与窗口上的图钉同步，再点一次恢复自动收起。" disabled={!m.collapsed} checked={m.pinned} onChange={(pinned) => apply({ music: { pinned } })} />
        <IslandStatus enabled={m.collapsed} pinned={m.pinned} />
        <Switch
          label="显示音乐卡片"
          hint="关闭后卡片隐藏，Dock 不受影响"
          checked={m.visible}
          onChange={(visible) => apply({ music: { visible } })}
        />
        <Segmented
          label="卡片位置"
          value={m.anchor}
          options={ANCHOR_OPTIONS}
          onChange={(anchor) => apply({ music: { anchor } })}
        />
        <Slider
          label="卡片宽度"
          min={240}
          max={520}
          step={1}
          value={m.width}
          format={(v) => `${Math.round(v)} px`}
          onChange={(width) => apply({ music: { width } })}
        />
        <Segmented
          label="进度样式"
          value={m.progressStyle}
          options={PROGRESS_OPTIONS}
          onChange={(progressStyle) => apply({ music: { progressStyle } })}
        />
        <Segmented
          label="主题"
          value={m.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => apply({ music: { theme } })}
        />
      </Section>

      <Section title="音乐来源" desc="系统播放器从 Windows 媒体会话读取，本地播放器播放所选音频。">
        <Segmented
          label="来源"
          value={m.source}
          options={SOURCE_OPTIONS}
          onChange={(source) => apply({ music: { source } })}
        />
        <div className="nx-inline-actions">
          <Button size="sm" variant="primary" disabled={picking} onClick={() => void pickLocal()}>
            {picking ? '选择中…' : '选择本地音频'}
          </Button>
          <span className="nx-hint-text">支持 mp3 / wav / flac / m4a / ogg</span>
        </div>
      </Section>

      <p className="nx-hint-text">窗口共性行为（吸附、置顶、仅在桌面、锁定、位置复位）在上方统一管理。</p>
    </div>
  )
}
