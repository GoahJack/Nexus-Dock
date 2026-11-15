import { useEffect } from 'react'
import { ISLAND_MOTION_END } from '@shared/island'

/** 根节点引用（结构类型，避免 RefObject 泛型协变问题） */
interface ElementRef {
  current: HTMLElement | null
}

/**
 * 附加窗口（v1.8「英语单词学习」）内容尺寸上报——窗口能力准则 C7。
 *
 * 透明窗口的内容尺寸必须等于窗口尺寸，否则会出现「看不见但能点到」的隐形区域。
 * 与内置窗口的 `useContentSize(target)` 不同，附加窗口不能把自己写进 `WindowTarget`：
 * 主进程通过 `window:setOwnContentSize` 的 IPC sender 定位窗口，渲染层不需要知道 kind。
 *
 * 量测时机（缺一不可）：
 * - 挂载后立即量一次（首帧）；
 * - 根节点 ResizeObserver（视图切换 / 内容变化导致宽高变化）；
 * - window resize（窗口被主进程调整后字体/布局回流）；
 * - window load（样式表/字体全部就绪的兜底补测）；
 * - visibilitychange → visible（隐藏期间节流导致 ResizeObserver 回调丢失时补测）。
 *
 * 首次量测前检查样式是否生效（theme.css 的 --nx-* 令牌取不到值 = CSSOM 未就绪）：
 * 若在 CSS 生效前量到错误尺寸，主进程会按错误大小显示窗口，出现尺寸跳变。
 *
 * @param ref 被测量的根节点（透明卡片本身，不是 body）
 * @param deps 影响布局的视图依赖（如当前视图），变化时重新量测
 */
export function useOwnContentSize(ref: ElementRef, deps: readonly unknown[] = []): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    /** 上一次上报的尺寸键：尺寸不变时不重复 IPC */
    let lastSent = ''
    /** 下一帧量测的句柄（合并同一帧内的多次触发） */
    let frame = 0
    /** 样式未就绪时的重试计数（最多 120 帧 ≈ 2 秒） */
    let probing = 0
    let disposed = false

    const stylesReady = (): boolean => {
      if (document.readyState === 'complete') return true
      return getComputedStyle(document.documentElement).getPropertyValue('--nx-radius-lg').trim().length > 0
    }

    const push = (): void => {
      if (disposed) return
      if (!stylesReady()) {
        if (probing < 120) {
          probing += 1
          frame = window.requestAnimationFrame(push)
        }
        return
      }
      probing = 0
      const rect = element.getBoundingClientRect()
      // 留 1px 余量吸收亚像素误差，避免窗口尺寸抖动（与 clock/main.ts 一致）
      const width = Math.ceil(rect.width) + 1
      const height = Math.ceil(rect.height) + 1
      if (width < 2 || height < 2) return
      const key = `${width}x${height}`
      if (key === lastSent) return
      lastSent = key
      window.nexus?.window?.setOwnContentSize?.({ width, height })
    }

    const schedule = (): void => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(push)
    }

    push()

    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener('resize', schedule)
    window.addEventListener('load', schedule)
    element.addEventListener(ISLAND_MOTION_END, schedule)

    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return
      probing = 0
      schedule()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('load', schedule)
      element.removeEventListener(ISLAND_MOTION_END, schedule)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // deps 由调用方声明（视图切换后宽高不同，必须重新量测）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
}
