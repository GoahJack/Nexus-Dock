import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_APPS, DEFAULT_SETTINGS, sanitizeSettings, type DeepPartial, type Settings } from '@shared/types'

let current: Settings = DEFAULT_SETTINGS
let filePath = ''
const listeners = new Set<(settings: Settings) => void>()
let saveTimer: NodeJS.Timeout | null = null

/**
 * v1 → v2 迁移：
 * - 内置应用改为带 AUMID 的新集合（旧的 taskmgr 等直接启动会失败），保留用户自定义/开始菜单项；
 * - Dock 背景默认改为完全透明（opacity 0）。
 */
function migrate(settings: Settings, fromVersion: number): Settings {
  if (fromVersion >= DEFAULT_SETTINGS.schemaVersion) return settings
  let next = settings

  // v1 → v2：内置应用换成带 AppID 的新集合；Dock 背景默认透明
  if (fromVersion < 2) {
    const defaultsById = new Map(DEFAULT_APPS.map((item) => [item.id, item]))
    const keptBuiltin = next.apps
      .filter((item) => item.source === 'builtin' && defaultsById.has(item.id))
      .map((item) => ({ ...(defaultsById.get(item.id) as Settings['apps'][number]), icon: item.icon || '' }))
    const missingDefaults = DEFAULT_APPS.filter((item) => !keptBuiltin.some((kept) => kept.id === item.id))
    const others = next.apps.filter((item) => item.source !== 'builtin')
    next = {
      ...next,
      dock: { ...next.dock, opacity: 0 },
      apps: [...keptBuiltin, ...missingDefaults, ...others]
    }
  }

  // v2 → v3：自由定位坐标系修正（旧数据默认写成了 0,0 → 跑到左上角）
  if (fromVersion < 3) {
    next = {
      ...next,
      dock: { ...next.dock, freeX: -1, freeY: -1 }
    }
  }

  // v3 → v4：新增 appearance（外观与动效）分组。旧配置由 sanitizeSettings 补默认值，
  // 无需改写历史字段；这里只做显式记录，方便后续版本继续追加迁移。
  if (fromVersion < 4) {
    next = { ...next, appearance: next.appearance ?? DEFAULT_SETTINGS.appearance }
  }

  // v4 → v5：新增 clock / lock / system 三组（由 sanitizeSettings 补默认值，旧字段原样保留）；
  // 音乐窗口默认开启「拖动松手吸附屏幕边缘」，同时把旧配置里的自由坐标占位值重置为「未定位」(-1)，
  // 避免用户关闭吸附后位置跳到旧默认坐标 (60,60)。
  if (fromVersion < 5) {
    next = {
      ...next,
      music: { ...next.music, snapToEdge: true, freeX: -1, freeY: -1 }
    }
  }

  // v5 → v6：时钟窗口新增「拖动松手吸附屏幕边缘」开关（默认开启，保持 v1.1 的始终吸附行为）；
  // 旧配置的 clock 其他字段原样保留，吸附关闭后使用的自由坐标沿用既有 freeX/freeY。
  // v1.2 起该开关是《窗口行为准则》对所有悬浮窗口的强制要求（docs/window-conventions.md）。
  if (fromVersion < 6) {
    next = {
      ...next,
      clock: { ...next.clock, snapToEdge: true }
    }
  }

  // v6 → v7：设置信息架构重构，补齐窗口共性选项（默认值保持各窗口既有行为）：
  // - 音乐卡片新增 alwaysOnTop（默认 true）与 onlyOnDesktop（默认 false）；
  // - 时钟新增 onlyOnDesktop（默认 false）；
  // - Dock 既有 alwaysOnTop / onlyOnDesktop 不变。
  // 「系统」页统一管理所有窗口的 吸附/置顶/仅在桌面/位置锁定/移回默认位置（见 docs/window-conventions.md）。
  if (fromVersion < 7) {
    next = {
      ...next,
      music: { ...next.music, alwaysOnTop: true, onlyOnDesktop: false },
      clock: { ...next.clock, onlyOnDesktop: false }
    }
  }

  // v7 → v8（v1.5）：音乐卡片新增「主题」（默认深色，保持旧观感）。
  // 其余新字段（如托盘相关）不落配置；由 sanitizeSettings 统一补默认值，旧配置零丢失。
  if (fromVersion < 8) {
    next = {
      ...next,
      music: { ...next.music, theme: next.music.theme ?? 'dark' }
    }
  }

  return sanitizeSettings({ ...next, schemaVersion: DEFAULT_SETTINGS.schemaVersion })
}

export function initSettings(): Settings {
  filePath = join(app.getPath('userData'), 'settings.json')
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion?: number }
      const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
      current = migrate(sanitizeSettings(raw), fromVersion)
      if (fromVersion < DEFAULT_SETTINGS.schemaVersion) {
        console.log(`[settings] 已从 v${fromVersion} 迁移到 v${DEFAULT_SETTINGS.schemaVersion}`)
        scheduleSave()
      }
    }
  } catch (error) {
    console.error('[settings] 读取失败，使用默认值：', error)
    current = sanitizeSettings(DEFAULT_SETTINGS)
  }
  return current
}

export function getSettings(): Settings {
  return current
}

export function getSettingsPath(): string {
  return filePath
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener(current)
    } catch (error) {
      console.error('[settings] 监听器异常：', error)
    }
  }
}

/** 原子写盘：先写 .tmp 再 rename，避免写一半崩溃导致配置损坏 */
function persist(): void {
  if (!filePath) return
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8')
    renameSync(tmp, filePath)
  } catch (error) {
    console.error('[settings] 写入失败：', error)
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, 250)
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const next = sanitizeSettings({
    ...current,
    ...patch,
    dock: { ...current.dock, ...(patch.dock ?? {}) },
    music: { ...current.music, ...(patch.music ?? {}) },
    clock: { ...current.clock, ...(patch.clock ?? {}) },
    lock: { ...current.lock, ...(patch.lock ?? {}) },
    system: { ...current.system, ...(patch.system ?? {}) },
    appearance: { ...current.appearance, ...(patch.appearance ?? {}) },
    apps: patch.apps ?? current.apps
  })
  // 合并结果与当前值完全一致时不写盘、不广播：拖动吸附、位置回写、自启状态回滚等场景
  // 会上报相同值，跳过 emit 可避免 subscribeSettings 监听链路被无谓地反复触发。
  if (JSON.stringify(next) === JSON.stringify(current)) return current
  current = next
  scheduleSave()
  emit()
  return current
}

export function resetSettings(): Settings {
  current = sanitizeSettings(DEFAULT_SETTINGS)
  scheduleSave()
  emit()
  return current
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 退出前调用，确保防抖中的变更落盘 */
export function flushSettings(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persist()
}
