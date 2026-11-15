import { IslandExpansion } from '@shared/island'
import { prefersReducedMotion } from './motion'
import { IslandMorph } from './islandMorph'

/** Native DOM adapter shared by React widgets and the lightweight clock. */
export function bindIsland(root: HTMLElement, onChange: (collapsed: boolean) => void): {
  configure: (enabled: boolean, pinned: boolean) => void
  dispose: () => void
} {
  let keyboard = false
  let pointerDown = false
  let hovered = false
  let alive = true
  let proximityRevision = 0
  let focusFrame = 0
  let verifyTimer = 0
  let pointerId = -1
  let pointerTarget: Element | null = null
  const morph = new IslandMorph(root, onChange)
  const expansion = new IslandExpansion((collapsed) => {
    const hadFocus = root.contains(document.activeElement)
    morph.request(collapsed, () => {
      if (!hadFocus) return
      cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => {
        const pin = [...root.querySelectorAll<HTMLButtonElement>('[data-island-pin]')].find(el => el.getClientRects().length > 0)
        pin?.focus({ preventScroll: true })
      })
    })
  })
  const captured = (): boolean => {
    for (let node = pointerTarget; node && root.contains(node); node = node.parentElement) {
      if (node.hasPointerCapture(pointerId)) return true
    }
    return false
  }
  const reconcile = (): void => {
    const element = document.activeElement
    const focused = document.hasFocus() && element instanceof HTMLElement && root.contains(element)
    const editing = focused && !!element.closest('input,textarea,select,[contenteditable="true"]')
    expansion.setInteracting(hovered || pointerDown || editing || (focused && keyboard))
  }
  const nativeProximity = (near: boolean): void => {
    if (!near) {
      // Windows caption/drag hit testing may omit DOM leave/up. The native cursor
      // is authoritative; only a genuine pointer capture can retain a press hold.
      hovered = false
      if (!captured()) pointerDown = false
    }
    expansion.setNear(near)
    reconcile()
  }
  const readNative = (): void => {
    const revision = proximityRevision
    void window.nexus.window.getIslandProximity().then(near => {
      if (alive && revision === proximityRevision) nativeProximity(near)
    }).catch(() => { /* DOM leave/focus still works if the initial read fails. */ })
  }
  const verifyPointer = (): void => {
    window.clearTimeout(verifyTimer)
    // One verification per interaction, not another polling loop. This also covers
    // a very fast enter/leave between two native monitor ticks.
    verifyTimer = window.setTimeout(readNative, 200)
  }
  const enter = (): void => { hovered = true; reconcile(); verifyPointer() }
  const leave = (): void => { hovered = false; reconcile() }
  const key = (): void => { keyboard = true; reconcile() }
  const down = (event: PointerEvent): void => {
    keyboard = false
    pointerDown = true
    pointerId = event.pointerId
    pointerTarget = event.target instanceof Element ? event.target : null
    reconcile()
    verifyPointer()
  }
  const up = (): void => { pointerDown = false; pointerTarget = null; reconcile() }
  const blur = (): void => { pointerDown = false; hovered = false; pointerTarget = null; reconcile() }
  const focus = (): void => { queueMicrotask(() => { if (alive) reconcile() }) }
  const settle = (): void => {
    if (document.visibilityState === 'hidden' || prefersReducedMotion()) morph.finish()
  }
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const appearance = new MutationObserver(settle)
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] })
  media.addEventListener('change', settle)
  document.addEventListener('visibilitychange', settle)
  root.addEventListener('pointerenter', enter)
  root.addEventListener('pointerleave', leave)
  root.addEventListener('pointerdown', down, true)
  root.addEventListener('lostpointercapture', up, true)
  root.addEventListener('focusin', focus)
  root.addEventListener('focusout', focus)
  window.addEventListener('keydown', key, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', blur)
  const off = window.nexus.window.onIslandProximity(near => { proximityRevision++; nativeProximity(near) })
  readNative()
  return {
    configure: (enabled, pinned) => { reconcile(); expansion.configure(enabled, pinned) },
    dispose: () => {
      alive = false
      expansion.dispose()
      morph.dispose()
      off()
      window.clearTimeout(verifyTimer)
      cancelAnimationFrame(focusFrame)
      appearance.disconnect()
      media.removeEventListener('change', settle)
      document.removeEventListener('visibilitychange', settle)
      root.removeEventListener('pointerenter', enter)
      root.removeEventListener('pointerleave', leave)
      root.removeEventListener('pointerdown', down, true)
      root.removeEventListener('lostpointercapture', up, true)
      root.removeEventListener('focusin', focus)
      root.removeEventListener('focusout', focus)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', blur)
    }
  }
}
