import { useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, MediaSource, MusicAnchor, ProgressStyle, Settings } from '@shared/types'
import { Button, Section, Segmented, Slider, Switch } from '@renderer/shared/ui'

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

/** 音乐分组：卡片显隐/布局/进度样式 + 本地音频选择 */
export function MusicSection({ settings, patch }: Props): JSX.Element {
  const m = settings.music
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const pickLocal = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setNotice(null)
    try {
      // pickFiles 由主进程负责把曲目广播给音乐卡片
      const tracks = await window.nexus.media.pickFiles()
      if (tracks.length > 0) {
        await patch({ music: { source: 'local' } })
        setNotice({ kind: 'ok', text: `已发送 ${tracks.length} 首到音乐卡片，来源已切到本地` })
      }
    } catch (err) {
      setNotice({ kind: 'err', text: `选择本地音频失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="nx-sections">
      <Section title="音乐卡片" desc="桌面悬浮的音乐信息窗，可跟随 Dock 或自由摆放。">
        <Switch
          label="显示音乐卡片"
          hint="关闭后卡片隐藏，Dock 不受影响"
          checked={m.visible}
          onChange={(visible) => void patch({ music: { visible } })}
        />
        <Segmented
          label="卡片位置"
          value={m.anchor}
          options={ANCHOR_OPTIONS}
          onChange={(anchor) => void patch({ music: { anchor } })}
        />
        <Slider
          label="卡片宽度"
          min={240}
          max={520}
          step={1}
          value={m.width}
          format={(v) => `${Math.round(v)} px`}
          onChange={(width) => void patch({ music: { width } })}
        />
        <Segmented
          label="进度样式"
          value={m.progressStyle}
          options={PROGRESS_OPTIONS}
          onChange={(progressStyle) => void patch({ music: { progressStyle } })}
        />
      </Section>

      <Section title="音乐来源" desc="系统播放器从 Windows 媒体会话读取，本地播放器播放所选音频。">
        <Segmented
          label="来源"
          value={m.source}
          options={SOURCE_OPTIONS}
          onChange={(source) => void patch({ music: { source } })}
        />
        <div className="nx-inline-actions">
          <Button size="sm" variant="primary" disabled={picking} onClick={() => void pickLocal()}>
            {picking ? '选择中…' : '选择本地音频'}
          </Button>
          <span className="nx-hint-text">支持 mp3 / wav / flac / m4a / ogg</span>
        </div>
        {notice ? (
          <div className={`nx-notice ${notice.kind === 'ok' ? 'is-ok' : 'is-err'}`} role="status">
            {notice.text}
          </div>
        ) : null}
      </Section>

      <p className="nx-hint-text">窗口共性行为（吸附、置顶、仅在桌面、锁定、位置复位）已统一到「系统」页管理。</p>
    </div>
  )
}
