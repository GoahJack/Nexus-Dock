import type { JSX } from 'react'
import type { DeepPartial, Settings, ThemeMode } from '@shared/types'
import { Section, Segmented, Slider, Switch } from '@renderer/shared/ui'
import { IslandStatus } from '@renderer/shared/IslandStatus'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

const HOUR_OPTIONS: { value: '24' | '12'; label: string }[] = [
  { value: '24', label: '24 小时制' },
  { value: '12', label: '12 小时制' }
]

/**
 * 时钟分组（v1.3 起只保留独有特性：显示内容 / 外观）。
 * 吸附、始终置顶、仅在桌面显示、位置锁定、移回默认位置等共性项统一在「窗口 → 内置窗口」页折叠栏管理。
 */
export function ClockSection({ settings, patch }: Props): JSX.Element {
  const c = settings.clock
  /** 配置里 opacity 是 0.2–1，滑块按 20–100% 展示与写入 */
  const opacityPercent = Math.round(c.opacity * 100)

  return (
    <div className="nx-sections">
      <Section title="显示" desc="桌面悬浮数字时钟默认隐藏，打开后立即显示在桌面右上角。">
        <Switch label="灵动岛：靠近时展开" hint="靠近恢复完整时钟，移开后收起；保留原来的秒与日期选项。" checked={c.collapsed} onChange={(collapsed) => void patch({ clock: { collapsed } })} />
        <Switch label="保持展开" hint="与窗口上的图钉同步，再点一次恢复自动收起。" disabled={!c.collapsed} checked={c.pinned} onChange={(pinned) => void patch({ clock: { pinned } })} />
        <IslandStatus enabled={c.collapsed} pinned={c.pinned} />
        <Switch
          label="显示桌面时钟"
          hint="也可以点击 Dock 末端的时钟按钮快速开关，两处共享同一开关"
          checked={c.visible}
          onChange={(visible) => void patch({ clock: { visible } })}
        />
        <Switch
          label="显示秒"
          hint="每秒刷新一次；关闭后只在分钟变化时刷新，更省电"
          checked={c.showSeconds}
          onChange={(showSeconds) => void patch({ clock: { showSeconds } })}
        />
        <Switch
          label="显示日期"
          hint="在时间下方显示今天的日期"
          checked={c.showDate}
          onChange={(showDate) => void patch({ clock: { showDate } })}
        />
        <Segmented
          label="时间制式"
          value={c.hour12 ? '12' : '24'}
          options={HOUR_OPTIONS}
          onChange={(value) => void patch({ clock: { hour12: value === '12' } })}
        />
      </Section>

      <Section title="外观" desc="字号即时钟尺寸；主题与透明度立即作用于时钟窗口。">
        <Slider
          label="字号"
          hint="时钟窗口会随字号自动调整大小"
          min={28}
          max={96}
          step={1}
          value={c.fontSize}
          format={(v) => `${Math.round(v)} px`}
          onChange={(fontSize) => void patch({ clock: { fontSize } })}
        />
        <Slider
          label="透明度"
          min={20}
          max={100}
          step={1}
          value={opacityPercent}
          format={(v) => `${Math.round(v)}%`}
          onChange={(pct) => void patch({ clock: { opacity: Math.round(pct) / 100 } })}
        />
        <Segmented
          label="主题"
          value={c.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => void patch({ clock: { theme } })}
        />
      </Section>

      <p className="nx-hint-text">窗口共性行为（吸附、置顶、仅在桌面、锁定、位置复位）在上方统一管理。</p>
    </div>
  )
}
