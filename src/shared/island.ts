/** Geometry uses Electron screen DIP, including negative coordinates on secondary displays. */
export interface IslandBounds { x: number; y: number; width: number; height: number }
export interface IslandProximity { near: boolean; anchor: IslandBounds | null; bounds: IslandBounds | null }
export const ISLAND_ENTER_DIP = 24
export const ISLAND_EXIT_DIP = 40
export const ISLAND_LEAVE_MS = 900
export const ISLAND_MOTION_END = 'island:motionend'

function contains(point: { x: number; y: number }, bounds: IslandBounds, margin: number): boolean {
  return point.x >= bounds.x - margin && point.x <= bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin && point.y <= bounds.y + bounds.height + margin
}

/** Preserve the capsule footprint during expansion so a resize cannot strand the pointer. */
export function nextIslandProximity(
  previous: IslandProximity,
  point: { x: number; y: number },
  bounds: IslandBounds
): IslandProximity {
  const moved = previous.bounds && previous.bounds.width === bounds.width && previous.bounds.height === bounds.height &&
    (previous.bounds.x !== bounds.x || previous.bounds.y !== bounds.y)
  const resized = previous.bounds !== null && (previous.bounds.width !== bounds.width || previous.bounds.height !== bounds.height)
  const anchor = moved ? bounds : previous.anchor
  const margin = previous.near ? ISLAND_EXIT_DIP : ISLAND_ENTER_DIP
  // A shrinking window can move its edge away between two 100ms polls. Include
  // the latest swept footprint only while resizing, never after an idle/move.
  const swept = resized && previous.bounds !== null && contains(point, previous.bounds, margin)
  const near = contains(point, bounds, margin) || swept || (previous.near && anchor !== null && contains(point, anchor, margin))
  return { near, anchor: near ? anchor ?? (swept ? previous.bounds : bounds) : null, bounds }
}

/** Shared by React widgets and the native DOM clock; hover never writes settings. */
export class IslandExpansion {
  private enabled = false
  private pinned = false
  private near = false
  private interacting = false
  private collapsed = false
  private timer: ReturnType<typeof setTimeout> | null = null

  private readonly onChange: (collapsed: boolean) => void
  constructor(onChange: (collapsed: boolean) => void) { this.onChange = onChange }

  configure(enabled: boolean, pinned: boolean): void {
    const changed = enabled !== this.enabled || pinned !== this.pinned
    this.enabled = enabled
    this.pinned = pinned
    this.reconcile(changed)
  }

  setNear(near: boolean): void { this.near = near; this.reconcile(false) }
  setInteracting(active: boolean): void { this.interacting = active; this.reconcile(false) }

  private apply(collapsed: boolean): void {
    if (this.collapsed === collapsed) return
    this.collapsed = collapsed
    this.onChange(collapsed)
  }

  private reconcile(immediate: boolean): void {
    if (!this.enabled || this.pinned || this.near || this.interacting) {
      this.cancel()
      this.apply(false)
    } else if (immediate) {
      this.cancel()
      this.apply(true)
    } else if (!this.collapsed && this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; this.apply(true) }, ISLAND_LEAVE_MS)
    }
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  dispose(): void { this.cancel() }
}
