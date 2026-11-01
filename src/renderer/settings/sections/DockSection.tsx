import type { JSX } from 'react'
import type { DeepPartial, DockEdge, Settings, ThemeMode } from '@shared/types'
import { Section, Segmented, Slider, Switch } from '@renderer/shared/ui'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

const EDGE_OPTIONS: { value: DockEdge; label: string; icon: string }[] = [
  { value: 'bottom', label: '底部', icon: '↓' },
  { value: 'top', label: '顶部', icon: '↑' },
  { value: 'left', label: '左侧', icon: '←' },
  { value: 'right', label: '右侧', icon: '→' }
]

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' }
]

/** Dock 分组：停靠位置 / 拖动行为 / 图标手感 / 外观与行为，所有改动即时 patch */
export function DockSection({ settings, patch }: Props): JSX.Element {
  const d = settings.dock
  /** 配置里 opacity 是 0–1，滑块按 0–100% 展示与写入 */
  const opacityPercent = Math.round(d.opacity * 100)

  return (
    <div className="nx-sections">
      <Section title="停靠位置" desc="切换停靠边或微调沿边位置，Dock 会立即重新排列。">
        <Segmented
          label="停靠边"
          value={d.edge}
          options={EDGE_OPTIONS}
          onChange={(edge) => void patch({ dock: { edge } })}
        />
        <Slider
          label="沿边位置"
          hint="0% 靠左/上端，100% 靠右/下端"
          min={0}
          max={100}
          step={1}
          value={d.alongPercent}
          format={(v) => `${Math.round(v)}%`}
          onChange={(alongPercent) => void patch({ dock: { alongPercent } })}
        />
      </Section>

      <Section title="图标" desc="图标尺寸与悬停手感，直接决定 Dock 的视觉体量。">
        <Slider
          label="图标尺寸"
          min={28}
          max={80}
          step={1}
          value={d.iconSize}
          format={(v) => `${Math.round(v)} px`}
          onChange={(iconSize) => void patch({ dock: { iconSize } })}
        />
        <Slider
          label="悬停放大"
          hint="鼠标经过时的最大放大倍率"
          min={1}
          max={1.8}
          step={0.05}
          value={d.magnification}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(magnification) => void patch({ dock: { magnification } })}
        />
        <Slider
          label="图标间距"
          min={0}
          max={32}
          step={1}
          value={d.gap}
          format={(v) => `${Math.round(v)} px`}
          onChange={(gap) => void patch({ dock: { gap } })}
        />
        <Slider
          label="内边距"
          min={6}
          max={32}
          step={1}
          value={d.padding}
          format={(v) => `${Math.round(v)} px`}
          onChange={(padding) => void patch({ dock: { padding } })}
        />
      </Section>

      <Section title="外观与行为" desc="背景不透明度、运行指示点与主题；窗口共性行为（吸附/置顶/仅在桌面/锁定）已统一到「系统」页。">
        <Slider
          label="背景不透明度"
          hint={opacityPercent === 0 ? '完全透明，只显示图标' : '底条背景透明度，数值越低越透明'}
          min={0}
          max={100}
          step={1}
          value={opacityPercent}
          format={(v) => `${Math.round(v)}%`}
          onChange={(pct) => void patch({ dock: { opacity: Math.round(pct) / 100 } })}
        />
        <Switch
          label="显示运行指示点"
          hint="进程运行时图标下方显示高亮点"
          checked={d.showIndicators}
          onChange={(showIndicators) => void patch({ dock: { showIndicators } })}
        />
        <Switch
          label="系统亚克力"
          hint="仅 Win11 22H2+ 生效；Win10 或被系统策略禁用时开关仍可打开，但没有视觉效果。开启后为矩形玻璃，可能盖住圆角"
          checked={d.acrylic}
          onChange={(acrylic) => void patch({ dock: { acrylic } })}
        />
        <Segmented
          label="主题"
          value={d.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => void patch({ dock: { theme } })}
        />
      </Section>

      <p className="nx-hint-text">窗口共性行为（吸附、置顶、仅在桌面、锁定、位置复位）已统一到「系统」页管理。</p>
    </div>
  )
}
