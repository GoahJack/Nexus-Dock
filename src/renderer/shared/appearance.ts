import type { Settings } from '@shared/types'

/**
 * 把外观设置同步到 <html data-*>，驱动 motion.css 的令牌切换：
 * - data-motion：light / standard / expressive
 * - data-reduced-motion：true / false
 * - data-click-sound：true / false
 *
 * 单独放在无 React 依赖的模块里：时钟窗口已改为原生 DOM（不再引入 react），
 * 但仍必须与 Dock / 音乐卡片共用同一套动效令牌与「减少动效」降级。
 */
export function applyAppearanceToDocument(settings: Settings): void {
  const root = document.documentElement
  root.dataset.motion = settings.appearance.motionIntensity
  root.dataset.reducedMotion = settings.appearance.reducedMotion ? 'true' : 'false'
  root.dataset.clickSound = settings.appearance.clickSound ? 'true' : 'false'
}
