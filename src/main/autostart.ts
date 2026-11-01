import { app } from 'electron'
import type { AutoStartResult, Settings } from '@shared/types'
import { getSettings, subscribeSettings, updateSettings } from './settingsStore'

/**
 * 开机自启（v1.1，US-12）：
 * - 唯一真源是操作系统当前用户登录项（Windows：HKCU Run），不是 settings.json；
 * - 仅安装版（app.isPackaged）可写；开发模式下安全降级，绝不写入系统登录项；
 * - 写后立即回读校验；失败时把系统实际状态回写设置，避免设置页显示假状态。
 */

/** 登录项路径与参数：写入与回读必须使用同一组，否则 openAtLogin 判断会失真 */
const loginItemOptions = { path: process.execPath, args: [] as string[] }

/** 上一次已知的操作系统登录项状态；null = 尚未同步过 */
let lastKnownAutoStart: boolean | null = null
/** 同步中标记：防止「回写设置 → 设置变更回调 → 再次同步」形成递归 */
let syncing = false

/** 读取操作系统登录项真实状态（开发模式视为不可用 → false） */
export function readAutoStartState(): boolean {
  if (!app.isPackaged) return false
  try {
    return app.getLoginItemSettings(loginItemOptions).openAtLogin
  } catch (error) {
    console.error('[autostart] 读取系统登录项失败：', error)
    return false
  }
}

/**
 * 写入/移除开机启动项并回读校验。
 * 返回 AutoStartResult：autoStart 始终是操作系统实际状态，供调用方回写设置/回滚开关。
 */
export function applyAutoStart(enabled: boolean): AutoStartResult {
  if (!app.isPackaged) {
    // 开发态 process.execPath 指向 electron.exe，写入会产生错误的登录项
    lastKnownAutoStart = false
    console.log('[autostart] 开发模式：跳过开机自启写入（仅安装版生效）')
    return { ok: false, autoStart: false, reason: 'dev' }
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions })
    const actual = app.getLoginItemSettings(loginItemOptions).openAtLogin
    lastKnownAutoStart = actual
    if (actual !== enabled) {
      console.warn(`[autostart] 回读校验不一致：期望 ${enabled}，实际 ${actual}`)
      return { ok: false, autoStart: actual, reason: 'os' }
    }
    console.log(`[autostart] 开机自启已${enabled ? '开启' : '关闭'}`)
    return { ok: true, autoStart: actual }
  } catch (error) {
    const actual = readAutoStartState()
    lastKnownAutoStart = actual
    console.error('[autostart] 写入系统登录项失败：', error)
    return {
      ok: false,
      autoStart: actual,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 启动时以操作系统登录项为真源，回写 settings.system.autoStart。
 * 必须在注册设置订阅之前调用，避免启动回写又触发一次系统写入。
 */
export function syncAutoStartOnStartup(): void {
  const actual = readAutoStartState()
  lastKnownAutoStart = actual
  if (!app.isPackaged) console.log('[autostart] 开发模式：登录项状态按关闭处理，不读取/不写入系统')
  const desired = getSettings().system.autoStart
  if (desired !== actual) {
    console.log(`[autostart] 启动同步：设置值 ${desired} → 系统实际 ${actual}`)
    updateSettings({ system: { autoStart: actual } })
  }
}

/** 设置变更 → 同步操作系统登录项；失败时把真实状态回写到设置（内部防递归） */
function syncAutoStartFromSettings(settings: Settings): void {
  if (syncing) return
  const desired = settings.system.autoStart
  // 与上一次已知的系统状态一致说明无需再写系统（含 IPC 已写过、启动已同步等场景）
  if (lastKnownAutoStart === desired) return
  syncing = true
  try {
    const result = applyAutoStart(desired)
    if (result.autoStart !== desired && getSettings().system.autoStart !== result.autoStart) {
      // applyAutoStart 内已更新 lastKnownAutoStart，且 syncing 为 true，
      // 这里回写设置触发的嵌套 emit 会被上面两重守卫拦截，不会再次写系统。
      console.warn(
        `[autostart] 同步失败，设置回写为系统实际状态 ${result.autoStart}（原因：${result.reason ?? '未知'}）`
      )
      updateSettings({ system: { autoStart: result.autoStart } })
    }
  } finally {
    syncing = false
  }
}

/** 注册设置变更订阅（返回取消订阅函数，供 before-quit 清理） */
export function subscribeAutoStartSettings(): () => void {
  return subscribeSettings(syncAutoStartFromSettings)
}
