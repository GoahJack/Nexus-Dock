import { useState } from 'react'
import type { JSX } from 'react'
import type { DeepPartial, Settings } from '@shared/types'
import { findWindowKind, windowLockSummary, withAllWindowsLocked } from '@shared/types'
import { spawnRipple } from '@renderer/shared/motion'
import { Button, Section, Switch } from '@renderer/shared/ui'
import { ClockSection } from './ClockSection'
import { DockSection } from './DockSection'
import { MusicSection } from './MusicSection'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

/** 内置窗口（注册表 BUILTIN_WINDOW_SPECS 的 kind；独有设置组件与之一一对应） */
type BuiltinWindowKey = 'dock' | 'music' | 'clock'

const BUILTIN_LABELS: Record<BuiltinWindowKey, string> = {
  dock: 'Dock',
  music: '音乐卡片',
  clock: '桌面时钟'
}

type CommonField = 'snapToEdge' | 'alwaysOnTop' | 'onlyOnDesktop'

/** 共性字段 → 对应窗口设置组的 patch（Dock/音乐/时钟字段同名） */
function commonPatch(key: BuiltinWindowKey, field: CommonField, value: boolean): DeepPartial<Settings> {
  if (key === 'dock') return { dock: { [field]: value } as DeepPartial<Settings['dock']> }
  if (key === 'music') return { music: { [field]: value } as DeepPartial<Settings['music']> }
  return { clock: { [field]: value } as DeepPartial<Settings['clock']> }
}

/** 折叠栏状态摘要：吸附 / 置顶 / 仅在桌面 / 位置锁定（音乐/时钟补一个显示状态前缀） */
function commonSummary(state: {
  snap: boolean
  alwaysOnTop: boolean
  onlyOnDesktop: boolean
  locked: boolean
  visible?: boolean | null
}): string {
  const prefix = typeof state.visible === 'boolean' ? [state.visible ? '显示' : '隐藏'] : []
  return [
    ...prefix,
    state.snap ? '吸附开' : '吸附关',
    state.alwaysOnTop ? '置顶开' : '置顶关',
    state.onlyOnDesktop ? '仅在桌面' : '始终显示',
    state.locked ? '已锁定' : '未锁定'
  ].join(' · ')
}

/**
 * v1.7 内置窗口页：Dock / 音乐卡片 / 桌面时钟合并为一页。
 * 每个折叠栏 = 共性开关（吸附 / 置顶 / 仅在桌面 / 锁定 / 复位）+ 该窗口独有设置组件。
 * 锁定全部按 windowLockSummary 推导（内置 + 附加窗口一起计数），默认为全部收起。
 */
export function BuiltinWindowsSection({ settings, patch }: Props): JSX.Element {
  /** 折叠栏默认收起（v1.3 用户确认的交互） */
  const [open, setOpen] = useState<Record<BuiltinWindowKey, boolean>>({
    dock: false,
    music: false,
    clock: false
  })

  const summary = windowLockSummary(settings)
  const lockedNames = [
    settings.lock.dock ? 'Dock' : null,
    settings.lock.music ? '音乐卡片' : null,
    settings.lock.clock ? '桌面时钟' : null,
    ...settings.extraWindows
      .filter((item) => item.locked)
      .map((item) => findWindowKind(item.kind)?.label ?? item.kind)
  ].filter((name): name is string => name !== null)

  /** 总开关是「全部窗口全锁」的推导值，三态提示显式带出 x/N，避免部分锁定时显示为「关」 */
  const lockHint =
    summary.locked === summary.total
      ? `当前 ${summary.total}/${summary.total} 全部锁定；点一下 = 全部解锁，展开下方窗口可再单独调整`
      : summary.locked === 0
        ? `当前 0/${summary.total} 未锁定；点一下 = 全部锁定，展开下方窗口可再单独调整`
        : `当前 ${summary.locked}/${summary.total} 已锁定（部分锁定）；点一下 = 全部锁定，已全锁后再点 = 全部解锁`

  const toggleOpen = (key: BuiltinWindowKey): void => {
    setOpen((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  /**
   * 按顺序应用复位步骤。Dock 必须两步：主进程在「吸附 true→false」时会把当前窗口坐标
   * 固化为 freeX/freeY（onSettingsChanged），单次 patch 里写的 freeX/freeY=-1 会被这次
   * 固化覆盖、且不触发重新布局 —— 所以先关吸附，再单独写底部居中坐标让 applyDockLayout 生效。
   */
  const applyReset = async (steps: DeepPartial<Settings>[]): Promise<void> => {
    for (const step of steps) {
      await patch(step)
    }
  }

  const windows: Array<{
    key: BuiltinWindowKey
    snap: boolean
    alwaysOnTop: boolean
    onlyOnDesktop: boolean
    locked: boolean
    /** null = 该窗口没有独立显示开关（Dock 常驻，由 Dock 自身管理） */
    visible: boolean | null
    /** 复位步骤按顺序 patch（Dock 需要先关吸附再写坐标，见 applyReset 注释） */
    reset: DeepPartial<Settings>[]
    resetHint: string
    /** 该窗口独有设置组件（保留 {settings, patch} 接口） */
    unique: JSX.Element
  }> = [
    {
      key: 'dock',
      snap: settings.dock.snapToEdge,
      alwaysOnTop: settings.dock.alwaysOnTop,
      onlyOnDesktop: settings.dock.onlyOnDesktop,
      locked: settings.lock.dock,
      visible: null,
      // 吸附开启时 computeDockBounds 完全忽略 freeX/freeY，复位必须同时关闭吸附并重置停靠边/沿边位置
      reset: [
        { dock: { snapToEdge: false } },
        { dock: { edge: 'bottom', alongPercent: 50, freeX: -1, freeY: -1 } }
      ],
      resetHint: '关闭吸附并恢复为底部居中',
      unique: <DockSection settings={settings} patch={patch} />
    },
    {
      key: 'music',
      snap: settings.music.snapToEdge,
      alwaysOnTop: settings.music.alwaysOnTop,
      onlyOnDesktop: settings.music.onlyOnDesktop,
      locked: settings.lock.music,
      visible: settings.music.visible,
      reset: [{ music: { anchor: 'dock', freeX: -1, freeY: -1 } }],
      resetHint: '恢复为跟随 Dock',
      unique: <MusicSection settings={settings} patch={patch} />
    },
    {
      key: 'clock',
      snap: settings.clock.snapToEdge,
      alwaysOnTop: settings.clock.alwaysOnTop,
      onlyOnDesktop: settings.clock.onlyOnDesktop,
      locked: settings.lock.clock,
      visible: settings.clock.visible,
      reset: [{ clock: { freeX: -1, freeY: -1 } }],
      resetHint: '恢复为主屏右上角',
      unique: <ClockSection settings={settings} patch={patch} />
    }
  ]

  return (
    <div className="nx-sections">
      <Section
        title="内置窗口"
        desc="Dock、音乐卡片、桌面时钟随 Nexus 一起提供，这里统一管理它们的显示行为；点击窗口名展开共性开关与独有设置。"
      >
        <Switch
          label={`锁定全部窗口位置（${summary.locked}/${summary.total}）`}
          hint={lockHint}
          checked={summary.allLocked}
          onChange={(next) => void patch(withAllWindowsLocked(settings, next))}
        />
        <div className={`nx-lock-state${summary.locked > 0 ? ' is-locked' : ''}`} role="status">
          <span className="nx-lock-state-label">当前锁定</span>
          <span className="nx-lock-state-value">
            {summary.locked === 0
              ? `0/${summary.total} · 无窗口锁定`
              : `${lockedNames.join('、')}（${summary.locked}/${summary.total}）`}
          </span>
        </div>

        <div className="nx-acc">
          {windows.map((w) => {
            return (
              <div key={w.key} className={`nx-acc-item${open[w.key] ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="nx-acc-head nx-ripple-host"
                  aria-expanded={open[w.key]}
                  onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                  onClick={() => toggleOpen(w.key)}
                >
                  <span className="nx-acc-title">
                    <span className="nx-acc-chevron" aria-hidden="true">
                      ›
                    </span>
                    {BUILTIN_LABELS[w.key]}
                  </span>
                  <span className="nx-acc-summary">{commonSummary(w)}</span>
                </button>
                {open[w.key] ? (
                  <div className="nx-acc-body">
                    <Switch
                      label="自动吸附屏幕边缘"
                      hint="关闭后拖到哪停在哪；开启后松手吸附最近的屏幕边"
                      checked={w.snap}
                      onChange={(next) => void patch(commonPatch(w.key, 'snapToEdge', next))}
                    />
                    <Switch
                      label="始终置顶"
                      hint="窗口悬浮在普通应用之上"
                      checked={w.alwaysOnTop}
                      onChange={(next) => void patch(commonPatch(w.key, 'alwaysOnTop', next))}
                    />
                    <Switch
                      label="仅在桌面显示"
                      hint="前台窗口最大化/全屏时自动隐藏，回到桌面后恢复"
                      checked={w.onlyOnDesktop}
                      onChange={(next) => void patch(commonPatch(w.key, 'onlyOnDesktop', next))}
                    />
                    <Switch
                      label="锁定位置"
                      hint="锁定后该窗口不能拖动"
                      checked={w.locked}
                      onChange={(next) =>
                        void patch({ lock: { [w.key]: next } as DeepPartial<Settings['lock']> })
                      }
                    />
                    <div className="nx-inline-actions">
                      <Button size="sm" onClick={() => void applyReset(w.reset)}>
                        移回默认位置
                      </Button>
                      <span className="nx-hint-text">{w.resetHint}</span>
                    </div>
                    <div className="nx-window-unique">
                      <p className="nx-window-unique-title">该窗口独有设置</p>
                      {w.unique}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <p className="nx-hint-text">
          锁定期间拖动不写入位置；右键 Dock 勾选「锁定全部窗口位置」可快捷解锁；设置窗口本身不受位置锁定影响。
        </p>
      </Section>
    </div>
  )
}
