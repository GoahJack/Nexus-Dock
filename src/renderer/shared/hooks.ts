import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeepPartial, Settings, Size, WindowTarget } from '@shared/types'
import { applyAppearanceToDocument } from './appearance'

// 保持既有导入路径可用（原实现在本文件，已抽到无 React 依赖的 appearance.ts）
export { applyAppearanceToDocument }

/** 读取设置并订阅主进程广播；patch 会乐观更新本地状态 */
export function useSettings(): {
  settings: Settings | null
  patch: (p: DeepPartial<Settings>) => Promise<void>
  reset: () => Promise<void>
} {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let alive = true
    window.nexus.settings.get().then((s) => {
      if (alive) setSettings(s)
    })
    const off = window.nexus.settings.onChanged((s) => setSettings(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  // 外观与动效设置：同步到 <html>，三窗口共用同一套令牌
  useEffect(() => {
    if (settings) applyAppearanceToDocument(settings)
  }, [settings])

  const patch = useCallback(async (p: DeepPartial<Settings>) => {
    const next = await window.nexus.settings.update(p)
    setSettings(next)
  }, [])

  const reset = useCallback(async () => {
    const next = await window.nexus.settings.reset()
    setSettings(next)
  }, [])

  return { settings, patch, reset }
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
