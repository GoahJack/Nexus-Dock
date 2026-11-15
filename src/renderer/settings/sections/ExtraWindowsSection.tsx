import { useState } from 'react'
import type { ComponentType, JSX } from 'react'
import type { DeepPartial, ExtraWindowConfig, Settings } from '@shared/types'
import { findWindowKind, patchExtraWindows } from '@shared/types'
import { WORD_STUDY_KIND } from '@shared/wordBank'
import { spawnRipple } from '@renderer/shared/motion'
import { Button, Section, Switch } from '@renderer/shared/ui'
import { WordStudySettings } from './WordStudySettings'
import { IslandStatus } from '@renderer/shared/IslandStatus'

interface Props {
  settings: Settings
  patch: (p: DeepPartial<Settings>) => Promise<void>
}

/**
 * 附加窗口独有设置组件接口：每个需要在设置页暴露专属选项的窗口实现一份。
 * patch 只写「当前窗口的配置」（含 options），ExtraWindowsSection 负责写回整个 extraWindows 数组。
 */
export interface ExtraWindowSettingsProps {
  settings: Settings
  /** 当前附加窗口的完整配置（含该窗口的 options） */
  config: ExtraWindowConfig
  /** 只更新当前窗口配置的局部补丁（自动写回 extraWindows） */
  patch: (patch: Partial<ExtraWindowConfig>) => void
}

/**
 * kind → 独有设置组件。
 * 以后新增附加窗口若要暴露专属选项，在这张表里注册一个组件即可；未注册时页面显示「该窗口暂无可调选项」。
 * v1.8 起第一个附加窗口「英语单词学习」（kind=wordstudy）注册了词库管理组件。
 */
const EXTRA_WINDOW_SETTINGS: Record<string, ComponentType<ExtraWindowSettingsProps>> = {
  [WORD_STUDY_KIND]: WordStudySettings
}

/** 折叠栏摘要：显示/隐藏 + 吸附/置顶/仅在桌面/锁定 */
function summaryOf(config: ExtraWindowConfig): string {
  return [
    config.visible ? '显示' : '隐藏',
    config.snapToEdge ? '吸附开' : '吸附关',
    config.alwaysOnTop ? '置顶开' : '置顶关',
    config.onlyOnDesktop ? '仅在桌面' : '始终显示',
    config.locked ? '已锁定' : '未锁定'
  ].join(' · ')
}

/**
 * v1.7 附加窗口页：从注册表 EXTRA_WINDOW_KINDS 驱动。
 * 每个已注册类型都会在这里出现一个折叠栏，共性行为 + 独有设置统一管理；
 * 以后注册新类型后配置会自动出现在这里（无需改本页）。
 */
export function ExtraWindowsSection({ settings, patch }: Props): JSX.Element {
  /** 折叠栏默认收起（与内置窗口页一致） */
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const toggleOpen = (kind: string): void => {
    setOpen((previous) => ({ ...previous, [kind]: !previous[kind] }))
  }

  /** 附加窗口所有共性字段都通过 patchExtraWindows 整体替换数组，主进程再按注册表收敛 */
  const patchWindow = (kind: string, next: Partial<ExtraWindowConfig>): void => {
    void patch({ extraWindows: patchExtraWindows(settings, kind, next) })
  }

  return (
    <div className="nx-sections">
      <Section
        title="附加窗口"
        desc="附加窗口是随应用提供的功能窗口，显示 / 吸附 / 置顶 / 锁定与各窗口的独有选项都在这里统一管理；当前已注册：英语单词学习。"
      >
        {settings.extraWindows.length === 0 ? (
          <div className="nx-empty nx-empty-card" role="status">
            <span className="nx-empty-icon" aria-hidden="true">
              <svg
                width={32}
                height={32}
                viewBox="0 0 32 32"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3.4" y="4.8" width="17.4" height="17.4" rx="3" />
                <path d="M4.8 9.4h14.6" />
                <path d="M25.6 19v6.4M22.4 22.2h6.4" />
              </svg>
            </span>
            <strong>暂无附加窗口</strong>
            <p>以后新增的功能窗口会自动出现在这里，不需要修改这个页面。</p>
          </div>
        ) : (
          <div className="nx-acc">
            {settings.extraWindows.map((config) => {
              const spec = findWindowKind(config.kind)
              const label = spec?.label ?? config.kind
              const Unique: ComponentType<ExtraWindowSettingsProps> | undefined =
                EXTRA_WINDOW_SETTINGS[config.kind]
              return (
                <div key={config.kind} className={`nx-acc-item${open[config.kind] ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="nx-acc-head nx-ripple-host"
                    aria-expanded={Boolean(open[config.kind])}
                    onPointerDown={(event) => spawnRipple(event.currentTarget, event)}
                    onClick={() => toggleOpen(config.kind)}
                  >
                    <span className="nx-acc-title">
                      <span className="nx-acc-chevron" aria-hidden="true">
                        ›
                      </span>
                      {label}
                    </span>
                    <span className="nx-acc-summary">{summaryOf(config)}</span>
                  </button>
                  {open[config.kind] ? (
                    <div className="nx-acc-body">
                      <Switch
                        label="显示窗口"
                        hint={spec?.description ?? '控制该附加窗口是否显示'}
                        checked={config.visible}
                        onChange={(visible) => patchWindow(config.kind, { visible })}
                      />
                      <Switch
                        label="自动吸附屏幕边缘"
                        hint="关闭后拖到哪停在哪；开启后松手吸附最近的屏幕边"
                        checked={config.snapToEdge}
                        onChange={(snapToEdge) => patchWindow(config.kind, { snapToEdge })}
                      />
                      <Switch
                        label="始终置顶"
                        hint="窗口悬浮在普通应用之上"
                        checked={config.alwaysOnTop}
                        onChange={(alwaysOnTop) => patchWindow(config.kind, { alwaysOnTop })}
                      />
                      <Switch
                        label="仅在桌面显示"
                        hint="前台窗口最大化/全屏时自动隐藏，回到桌面后恢复"
                        checked={config.onlyOnDesktop}
                        onChange={(onlyOnDesktop) => patchWindow(config.kind, { onlyOnDesktop })}
                      />
                      <Switch
                        label="锁定位置"
                        hint="锁定后该窗口不能拖动"
                        checked={config.locked}
                        onChange={(locked) => patchWindow(config.kind, { locked })}
                      />
                      <Switch label="灵动岛：靠近时展开" hint="靠近展开、移开后收起；保留学习与编辑内容，输入期间保持展开。" checked={config.collapsed} onChange={(collapsed) => patchWindow(config.kind, { collapsed })} />
                      <Switch label="保持展开" hint="与窗口上的图钉同步，再点一次恢复自动收起。" disabled={!config.collapsed} checked={config.pinned} onChange={(pinned) => patchWindow(config.kind, { pinned })} />
                      <IslandStatus enabled={config.collapsed} pinned={config.pinned} />
                      <div className="nx-inline-actions">
                        <Button
                          size="sm"
                          onClick={() =>
                            // 「移回默认位置」= 清空自由坐标 + 回落到注册表 placement（吸附模式仍按 edge/alongPercent 定位）
                            patchWindow(config.kind, {
                              freeX: -1,
                              freeY: -1,
                              ...(spec?.placement?.edge ? { edge: spec.placement.edge } : {}),
                              ...(typeof spec?.placement?.alongPercent === 'number'
                                ? { alongPercent: spec.placement.alongPercent }
                                : {})
                            })
                          }
                        >
                          移回默认位置
                        </Button>
                        <span className="nx-hint-text">清空自由坐标并回落到注册表默认停靠位置</span>
                      </div>
                      <div className="nx-window-unique">
                        <p className="nx-window-unique-title">该窗口独有设置</p>
                        {Unique ? (
                          <Unique
                            settings={settings}
                            config={config}
                            patch={(next) => patchWindow(config.kind, next)}
                          />
                        ) : (
                          <p className="nx-hint-text">该窗口暂无可调选项</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section
        title="接入说明"
        desc="给以后要新增功能窗口的开发者（当前版本只需了解，不用改设置页）。"
      >
        <ol className="nx-steps">
          <li>
            <strong>注册窗口类型</strong>：在 <code>src/shared/types.ts</code> 的{' '}
            <code>EXTRA_WINDOW_KINDS</code> 增加一条 <code>WindowKindSpec</code>，<code>page</code>{' '}
            写渲染页目录名。
          </li>
          <li>
            <strong>新建渲染页</strong>：创建 <code>src/renderer/&lt;page&gt;/</code>（
            <code>index.html</code> + <code>main.tsx</code> + 组件）。
          </li>
          <li>
            <strong>增加构建入口</strong>：在 <code>electron.vite.config.ts</code> 的{' '}
            <code>renderer.input</code> 增加同名入口。
          </li>
          <li>
            <strong>（可选）独有选项</strong>：需要专属设置时，在本页的{' '}
            <code>EXTRA_WINDOW_SETTINGS</code> 注册配置组件。
          </li>
        </ol>
        <p className="nx-hint-text">
          其余能力（窗口创建、显隐、吸附、锁定、仅在桌面、托盘入口）由注册表自动生效，不需要改设置页。
        </p>
      </Section>
    </div>
  )
}
