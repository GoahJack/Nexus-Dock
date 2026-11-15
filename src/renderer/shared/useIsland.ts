import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { bindIsland } from './island'

export function useIsland(root: RefObject<HTMLElement | null>, enabled: boolean, pinned: boolean): boolean {
  // Match the controller's initial state; configure runs before the first paint.
  const [collapsed, setCollapsed] = useState(false)
  const behavior = useRef<ReturnType<typeof bindIsland> | null>(null)
  useLayoutEffect(() => {
    if (!root.current) return
    // bindIsland applies in a microtask, outside React's render/effect stack.
    const binding = bindIsland(root.current, value => flushSync(() => setCollapsed(value)))
    behavior.current = binding
    return () => { binding.dispose(); behavior.current = null }
  }, [root])
  useLayoutEffect(() => { behavior.current?.configure(enabled, pinned) }, [enabled, pinned])
  return collapsed
}
