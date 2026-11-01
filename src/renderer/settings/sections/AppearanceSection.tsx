import { useState } from 'react'
import type { AnimationEvent as ReactAnimationEvent, JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { DeepPartial, MotionIntensity, Settings } from '@shared/types'
import { Button, Section, Segmented, Switch } from '@renderer/shared/ui'
import { spawnRipple } from '@renderer/shared/motion'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

const INTENSITY_OPTIONS: { value: MotionIntensity; label: string }[] = [
  { value: 'light', label: '轻快' },
  { value: 'standard', label: '标准' },
  { value: 'expressive', label: '弹性' }
]

/** 三档语义与 motion.css 的令牌一一对应（docs/motion-spec.md §2.1 / §4），此处用于界面说明 */
const INTENSITY_INFO: Record<
  MotionIntensity,
  { name: string; scale: string; overshoot: string; press: string; desc: string }
> = {
  light: { name: '轻快', scale: '×0.72', overshoot: '无', press: '0.96', desc: '干净利落，适合低性能设备' },
  standard: { name: '标准', scale: '×1', overshoot: '轻微', press: '0.95', desc: '默认手感，轻微 Q 弹' },
  expressive: { name: '弹性', scale: '×1.28', overshoot: '明显', press: '0.93', desc: '物理感最强，适合手感优先' }
}

/** 效果预览：按压/涟漪用 shared 控件与 spawnRipple，图标 tile 额外重播一次启动弹跳 */
function MotionPreview({
  intensity,
  reducedMotion,
  clickSound
}: {
  intensity: MotionIntensity
  reducedMotion: boolean
  clickSound: boolean
}): JSX.Element {
  const info = INTENSITY_INFO[intensity]
  const [bouncing, setBouncing] = useState(false)

  // 涟漪必须在 pointerdown 出现，不等 click（docs/motion-spec.md §1「跟手」）
  const rippleTile = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    spawnRipple(event.currentTarget, event, { kind: 'glow', scale: 1.9 })
  }

  // 重复点击时类名已在，先复位再置位即可重播同一段关键帧
  const playBounce = (): void => {
    setBouncing(false)
    window.requestAnimationFrame(() => setBouncing(true))
  }

  const handleAnimationEnd = (event: ReactAnimationEvent<HTMLButtonElement>): void => {
    // 涟漪图层的 animationend 会冒泡上来，只处理弹跳自身
    if (event.animationName === 'nx-launch-bounce') setBouncing(false)
  }

  const note = reducedMotion
    ? '已开启「减少动效」，预览中的动画会收敛为零时长。'
    : clickSound
      ? '点击上方控件可试听内置合成点击音。'
      : '点击图标可重播启动弹跳；开启点击音效后这里同样可试听。'

  return (
    <div className="nx-motion-preview">
      <div className="nx-motion-preview-stage">
        <button
          type="button"
          className={`nx-motion-tile nx-ripple-glow-host nx-no-drag${bouncing ? ' is-bouncing' : ''}`}
          title="点击预览：按压 + 涟漪 + 启动弹跳"
          aria-label="预览 Dock 图标的按压、涟漪与启动弹跳"
          onPointerDown={rippleTile}
          onClick={playBounce}
          onAnimationEnd={handleAnimationEnd}
        >
          <span className="nx-motion-tile-glyph" aria-hidden="true">
            N
          </span>
        </button>
        <Button size="sm" onClick={playBounce}>
          普通按钮
        </Button>
      </div>

      <div className="nx-motion-preview-meta">
        <span className="nx-motion-preview-tier">当前档位 · {info.name}</span>
        <span className="nx-motion-preview-desc">{info.desc}</span>
        <span className="nx-motion-preview-facts">
          时长 {info.scale} · 过冲 {info.overshoot} · 按压 {info.press}
        </span>
        <span className="nx-motion-preview-note">{note}</span>
      </div>
    </div>
  )
}

/** 外观与动效分组（v1.0）：动效强度 / 可访问性 / 效果预览，改动即时 patch 到主进程 */
export function AppearanceSection({ settings, patch }: Props): JSX.Element {
  const a = settings.appearance
  const info = INTENSITY_INFO[a.motionIntensity]

  return (
    <div className="nx-sections">
      <Section title="动效强度" desc="三档影响全部窗口的时长、按压幅度与回弹过冲，切换后立即生效。">
        <Segmented
          label="强度"
          value={a.motionIntensity}
          options={INTENSITY_OPTIONS}
          onChange={(motionIntensity) => void patch({ appearance: { motionIntensity } })}
        />
        <p className="nx-motion-hint">
          当前：<strong>{info.name}</strong> · 时长 {info.scale} · 过冲 {info.overshoot} · 按压 {info.press}
          <span className="nx-motion-hint-desc">{info.desc}</span>
        </p>
      </Section>

      <Section title="可访问性" desc="降低动效或开启音效；设置立即保存并作用于 Dock、音乐卡片与设置面板。">
        <Switch
          label="减少动效"
          hint="关闭全部动画，适合低性能设备或对动效敏感的人"
          checked={a.reducedMotion}
          onChange={(reducedMotion) => void patch({ appearance: { reducedMotion } })}
        />
        <Switch
          label="点击音效"
          hint="使用内置合成短音，默认关闭"
          checked={a.clickSound}
          onChange={(clickSound) => void patch({ appearance: { clickSound } })}
        />
      </Section>

      <Section title="效果预览" desc="在这里直接试按当前动效强度，无需来回切换窗口。">
        <MotionPreview intensity={a.motionIntensity} reducedMotion={a.reducedMotion} clickSound={a.clickSound} />
      </Section>
    </div>
  )
}
