import { ISLAND_MOTION_END } from '@shared/island'
import { prefersReducedMotion } from './motion'

const OWNED = ['width', 'height', 'min-width', 'min-height', 'overflow', 'border-radius'] as const
type InlineStyles = Record<typeof OWNED[number], string>
const CONTENT = '.music-main,.music-bottom,.music-ring,.music-card > .music-art,.ws-study,.ws-editor,.ws-list,.ws-mini,.clock-main,.clock-date'

function radiusOf(root: HTMLElement, width: number, height: number): number {
  return Math.min(parseFloat(getComputedStyle(root).borderTopLeftRadius) || 0, width / 2, height / 2)
}

/** Real layout dimensions, not a scaled bitmap: text retains its natural size. */
export class IslandMorph {
  private generation = 0
  private initialized = false
  private disposed = false
  private animation: Animation | null = null
  private contentAnimations = new Set<Animation>()
  private original: InlineStyles | null = null
  private frozenWidth = ''

  constructor(private root: HTMLElement, private apply: (collapsed: boolean) => void) {}

  request(collapsed: boolean, afterApply: () => void): void {
    const id = ++this.generation
    const from = this.root.getBoundingClientRect()
    const radius = radiusOf(this.root, from.width, from.height)
    const animate = this.initialized && !prefersReducedMotion() && document.visibilityState === 'visible'
    this.initialized = true
    this.rememberExternalWidth()
    this.original ??= Object.fromEntries(OWNED.map(key => [key, this.root.style.getPropertyValue(key)])) as InlineStyles
    // Freeze the visible intermediate geometry before cancelling an interrupted morph.
    this.freeze(from.width, from.height, radius)
    this.animation?.cancel()
    this.animation = null
    this.cancelContent()
    queueMicrotask(() => {
      if (this.disposed || id !== this.generation) return
      this.apply(collapsed)
      this.rememberExternalWidth()
      // Measure natural target layout synchronously, then restore the starting box
      // before paint. ResizeObserver never sees a one-frame jump to the target.
      this.restore()
      const to = this.root.getBoundingClientRect()
      const toRadius = radiusOf(this.root, to.width, to.height)
      if (!animate || prefersReducedMotion() || document.visibilityState === 'hidden' || (Math.abs(to.width - from.width) < .5 && Math.abs(to.height - from.height) < .5)) {
        this.original = null
        delete this.root.dataset.islandAnimating
        this.root.dispatchEvent(new Event(ISLAND_MOTION_END))
        afterApply()
        return
      }
      this.freeze(from.width, from.height, radius)
      this.root.dataset.islandAnimating = 'true'
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nx-motion-scale')) || 1
      const duration = 320 * scale
      const animation = this.root.animate([
        { width: `${from.width}px`, height: `${from.height}px`, borderRadius: `${radius}px` },
        { width: `${to.width}px`, height: `${to.height}px`, borderRadius: `${toRadius}px` }
      ], { duration, easing: 'cubic-bezier(.22,.85,.25,1)', fill: 'both' })
      this.animation = animation
      void animation.finished.catch(() => { /* Reentry/disposal intentionally cancels. */ })
      for (const content of this.root.querySelectorAll<HTMLElement>(CONTENT)) {
        if (content.getClientRects().length === 0) continue
        const fade = content.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 180 * scale, delay: collapsed ? 30 * scale : 60 * scale, fill: 'backwards', easing: 'ease-out'
        })
        this.contentAnimations.add(fade)
        fade.onfinish = () => this.contentAnimations.delete(fade)
      }
      animation.onfinish = () => { if (id === this.generation) this.finish() }
      afterApply()
    })
  }

  /** Visibility/reduced-motion changes settle the current target immediately. */
  finish(): void {
    this.rememberExternalWidth()
    this.restore()
    this.animation?.cancel()
    this.animation = null
    this.cancelContent()
    this.original = null
    delete this.root.dataset.islandAnimating
    if (!this.disposed) this.root.dispatchEvent(new Event(ISLAND_MOTION_END))
  }

  private rememberExternalWidth(): void {
    // A settings slider may update the React inline width while a morph is active.
    if (this.original && this.root.style.width !== this.frozenWidth) this.original.width = this.root.style.width
  }

  private freeze(width: number, height: number, radius: number): void {
    this.root.style.width = `${width}px`
    this.frozenWidth = this.root.style.width
    this.root.style.height = `${height}px`
    this.root.style.minWidth = '0px'
    this.root.style.minHeight = '0px'
    this.root.style.overflow = 'clip'
    this.root.style.borderRadius = `${radius}px`
  }

  private restore(): void {
    if (!this.original) return
    for (const key of OWNED) {
      const value = this.original[key]
      if (value) this.root.style.setProperty(key, value)
      else this.root.style.removeProperty(key)
    }
  }

  private cancelContent(): void {
    for (const animation of this.contentAnimations) animation.cancel()
    this.contentAnimations.clear()
  }

  dispose(): void { this.disposed = true; this.generation++; this.finish() }
}
