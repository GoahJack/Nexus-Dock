import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeepPartial, Settings, Size, WindowTarget } from '@shared/types'
import { applyAppearanceToDocument } from './appearance'

// 保持既有导入路径可用（原实现在本文件，已抽到无 React 依赖的 appearance.ts）
export { applyAppearanceToDocument }

/** 读取设置并订阅主进程广播；patch 会乐观更新本地状态 */
export function useSettings(): {
  settings: Settings | null
  /** 设置加载/保存失败的原因（UI 用来显示错误提示；成功后自动清空） */
  error: string | null
  /** 重新拉取设置（加载失败时的「重试」入口） */
  retry: () => void
  patch: (p: DeepPartial<Settings>) => Promise<void>
  reset: () => Promise<void>
} {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadToken, setLoadToken] = useState(0)

  /* 防抖落盘：滑块拖动时 onChange 会逐像素触发，旧实现每次都会发一次 IPC（拖一次几十次 invoke）。 */
  const pendingPatch = useRef<DeepPartial<Settings> | null>(null)
  const flushWaiters = useRef<Array<() => void>>([])
  const flushTimer = useRef<number | null>(null)
  const flushing = useRef(false)

  const flushNow = useCallback(async (): Promise<void> => {
    if (flushing.current) return
    const payload = pendingPatch.current
    if (!payload) return
    pendingPatch.current = null
    const waiters = flushWaiters.current
    flushWaiters.current = []
    flushing.current = true
    try {
      const next = await window.nexus.settings.update(payload)
      setSettings(next)
      setError(null)
    } catch (err) {
      // 保存失败必须可见：旧实现只 console.warn，控件会静默弹回原值
      const detail = err instanceof Error ? err.message : String(err)
      setError(`设置保存失败：${detail}`)
      // 回读真实配置，避免界面停留在乐观值上欺骗用户
      try {
        const actual = await window.nexus.settings.get()
        setSettings(actual)
      } catch {
        /* 回读也失败：保留乐观值，错误条已经提示 */
      }
    } finally {
      flushing.current = false
      for (const resolve of waiters) resolve()
      // 落盘期间又产生了新补丁：继续排空
      if (pendingPatch.current) void flushNow()
    }
  }, [])

  useEffect(() => {
    let alive = true
    if (!window.nexus?.settings) {
      setError('预加载脚本未初始化（window.nexus 缺失），请重启应用')
      return
    }
    // 旧实现没有 .catch：get() 一旦 reject，settings 永远是 null → Dock 变成永久空白的透明条
    window.nexus.settings
      .get()
      .then((s) => {
        if (!alive) return
        setSettings(s)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        const detail = err instanceof Error ? err.message : String(err)
        setError(`设置加载失败：${detail}`)
      })
    const off = window.nexus.settings.onChanged((s) => {
      if (!alive) return
      setSettings(s)
      setError(null)
    })
    return () => {
      alive = false
      off()
    }
  }, [loadToken])

  const retry = useCallback(() => {
    setError(null)
    setLoadToken((token) => token + 1)
  }, [])

  // 外观与动效设置：同步到 <html>，三窗口共用同一套令牌
  useEffect(() => {
    if (settings) applyAppearanceToDocument(settings)
  }, [settings])

  const patch = useCallback((p: DeepPartial<Settings>): Promise<void> => {
    // 1) 乐观生效：滑块/开关立即跟手，不等 IPC 往返
    setSettings((previous) => (previous ? applyLocalPatch(previous, p) : previous))
    // 2) 合并到待发送补丁，120ms 内的连续改动合并为一次 IPC
    pendingPatch.current = mergePatch(pendingPatch.current, p)
    return new Promise<void>((resolve) => {
      flushWaiters.current.push(resolve)
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null
        void flushNow()
      }, 120)
    })
  }, [flushNow])

  const reset = useCallback(async () => {
    try {
      const next = await window.nexus.settings.reset()
      pendingPatch.current = null
      setSettings(next)
      setError(null)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setError(`恢复默认设置失败：${detail}`)
    }
  }, [])

  // 卸载时把尚未落盘的补丁补发一次，避免最后一次拖动丢失
  useEffect(
    () => () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
      if (pendingPatch.current) void flushNow()
    },
    [flushNow]
  )

  return { settings, error, retry, patch, reset }
}

/** 本地乐观合并（与主进程 mergeSettings 的浅合并语义一致，不做 sanitize） */
function applyLocalPatch(base: Settings, patch: DeepPartial<Settings>): Settings {
  return {
    schemaVersion: base.schemaVersion,
    dock: { ...base.dock, ...(patch.dock ?? {}) },
    music: { ...base.music, ...(patch.music ?? {}) },
    clock: { ...base.clock, ...(patch.clock ?? {}) },
    lock: { ...base.lock, ...(patch.lock ?? {}) },
    system: { ...base.system, ...(patch.system ?? {}) },
    appearance: { ...base.appearance, ...(patch.appearance ?? {}) },
    apps: patch.apps ?? base.apps,
    extraWindows: patch.extraWindows ?? base.extraWindows
  }
}

/** 合并两个待发送补丁（后到者覆盖同名字段，apps 整体替换） */
function mergePatch(
  current: DeepPartial<Settings> | null,
  next: DeepPartial<Settings>
): DeepPartial<Settings> {
  if (!current) return next
  return {
    ...current,
    ...next,
    dock: { ...(current.dock ?? {}), ...(next.dock ?? {}) },
    music: { ...(current.music ?? {}), ...(next.music ?? {}) },
    clock: { ...(current.clock ?? {}), ...(next.clock ?? {}) },
    lock: { ...(current.lock ?? {}), ...(next.lock ?? {}) },
    system: { ...(current.system ?? {}), ...(next.system ?? {}) },
    appearance: { ...(current.appearance ?? {}), ...(next.appearance ?? {}) },
    apps: next.apps ?? current.apps,
    extraWindows: next.extraWindows ?? current.extraWindows
  }
}

/**
 * 量出内容尺寸并同步给主进程（Dock / 音乐卡片窗口按内容自适应大小）。
 * 透明窗口必须让窗口尺寸等于内容尺寸，否则会出现大片「看不见但能点击」的区域。
 */
export function useContentSize(target: WindowTarget, deps: unknown[] = []): {
  ref: React.RefObject<HTMLDivElement | null>
  size: Size | null
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const lastSent = useRef<string>('')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const push = (): void => {
      const rect = el.getBoundingClientRect()
      // 留 1px 余量吸收亚像素误差，避免窗口尺寸抖动
      const width = Math.ceil(rect.width) + 1
      const height = Math.ceil(rect.height) + 1
      const key = `${width}x${height}`
      if (key === lastSent.current || width < 2 || height < 2) return
      lastSent.current = key
      setSize({ width, height })
      window.nexus.window.setContentSize(target, { width, height })
    }
    push()
    const ro = new ResizeObserver(push)
    ro.observe(el)
    window.addEventListener('resize', push)
    // 隐藏窗口恢复默认节流后，隐藏期间的尺寸变化可能得不到 ResizeObserver 回调；
    // 重新可见时补量一次，保证透明窗口内容尺寸始终等于窗口尺寸（C7）
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') push()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', push)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps])

  return { ref, size }
}

/** 把元素内部的指针位置换算成屏幕坐标（右键菜单定位用） */
export function toScreenPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
  return { x: Math.round(e.clientX), y: Math.round(e.clientY) }
}

/** 通用 debounce */
export function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay = 120): T {
  const timer = useRef<number | null>(null)
  const latest = useRef(fn)
  latest.current = fn
  return useCallback(
    ((...args: never[]) => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => latest.current(...args), delay)
    }) as T,
    [delay]
  )
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
