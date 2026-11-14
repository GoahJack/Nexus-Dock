# MOTION SPEC — Nexus 动效设计规范 v1.1

> 2026-11-14 最新增补：Dock 不折叠，保留图标交互；音乐、单词、时钟手动切换为胶囊。根节点不做尺寸过渡，内部文字使用淡入并遵循减少动效；运行指示点保持静态。详见 [浮窗折叠规范](island-design.md)。

> 状态：已定稿（v1.0 2026-10-30 用户确认 Apple Dock 物理回弹风格 / 标准 180–260ms；v1.1 2026-10-30 增补桌面时钟 §3.4）
> 适用：Dock、音乐卡片、设置面板、桌面时钟四个渲染窗口
> 本文件是动效实现的**唯一视觉真源**。改效果先改本文件，再改代码。

## 1. 设计原则

| 原则 | 含义 | 落地要求 |
|---|---|---|
| 跟手 | 反馈发生在 `pointerdown`，不等 `click` | 按压/涟漪必须在按下瞬间出现 |
| 物理感 | 回弹曲线带轻微过冲，不做线性位移 | 释放用 `--nx-spring`，不做 ease-in-out 长动画 |
| 分层 | 按压、涟漪、形变各占独立图层 | 涟漪是 `position:absolute` 的独立 span，不参与布局 |
| 克制 | 常驻桌面工具，动效不抢注意力 | 标准档单次 ≤ 260ms，启动弹跳 ≤ 520ms 且只播一次 |
| 可降级 | 尊重系统与用户偏好 | `prefers-reduced-motion` 与「减少动效」均收敛为 0.01ms |
| 性能 | 只动 `transform` / `opacity` | 不在动效过程中改宽高、不用 `layout` 属性做动画 |

## 2. 设计令牌（`src/renderer/shared/motion.css`）

### 2.1 时长（随强度档位缩放）

| 令牌 | 标准档 | 用途 |
|---|---|---|
| `--nx-dur-fast` | `calc(120ms * var(--nx-motion-scale))` | hover 颜色、图标态切换 |
| `--nx-dur-base` | `calc(180ms * var(--nx-motion-scale))` | 按钮按压回弹、页面内元素 |
| `--nx-dur-slow` | `calc(260ms * var(--nx-motion-scale))` | 页面转场、卡片入场 |
| `--nx-dur-spring` | `calc(420ms * var(--nx-motion-scale))` | 弹跳、FLIP 排序 |
| `--nx-ripple-dur` | `calc(420ms * var(--nx-motion-scale))` | 涟漪扩散 |

强度映射（`:root[data-motion=...]`）：

| 档位 | `--nx-motion-scale` | `--nx-press-scale` | 过冲 |
|---|---|---|---|
| `light` 轻快 | 0.72 | 0.96 | 无（`--nx-spring: cubic-bezier(.25,.9,.3,1)`） |
| `standard` 标准 | 1 | 0.95 | 轻微（`--nx-spring: cubic-bezier(.34,1.56,.64,1)`） |
| `expressive` 弹性 | 1.28 | 0.93 | 明显（`--nx-spring: cubic-bezier(.3,1.75,.5,1)`） |

### 2.2 曲线

| 令牌 | 值 | 用途 |
|---|---|---|
| `--nx-ease-press` | `cubic-bezier(.3,0,.2,1)` | 按下收缩（快出慢收） |
| `--nx-spring` | 见上表 | 松手/展开/回弹 |
| `--nx-spring-soft` | `cubic-bezier(.22,1.16,.36,1)` | 轻量回弹（hover 放大） |
| `--nx-ease-out` | `cubic-bezier(.25,.8,.3,1)` | 淡入/颜色过渡 |

### 2.3 幅度

| 令牌 | 值 | 用途 |
|---|---|---|
| `--nx-press-scale` | 0.93–0.96（按档位） | 普通按钮按压 |
| `--dock-press-scale` | 0.94 | Dock 图标按压 |
| `--nx-hop` | 8px | 启动弹跳距离（方向随停靠边） |
| `--nx-glow` | `0 0 22px rgba(110,168,254,.35)` | 悬停强调光 |

### 2.4 可访问性

```css
/* 用户开关：data-reduced-motion=true */
:root[data-reduced-motion='true'] *,
:root[data-reduced-motion='true'] *::before,
:root[data-reduced-motion='true'] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}
/* 系统偏好：媒体查询同规则 */
```

`spawnRipple()` 在 reduced 状态下直接不创建图层；`playClickSound()` 仍可用（声音不属于动效）。

## 3. 组件动效矩阵

### 3.1 Dock

| 交互 | 效果 | 参数 |
|---|---|---|
| hover 图标 | 放大 + 朝内上浮 + 强调色柔光投影 | 放大沿用现有公式；光效 `drop-shadow(0 8px 22px rgba(110,168,254,.28))`；`--nx-dur-base` |
| pointerdown 图标 | 按压缩小 + 亮度提升 + 光晕从点击点扩散 | `scale 0.94`（乘进放大公式）、`brightness(1.12)`；涟漪 `nx-ripple-glow`，直径 = iconSize×1.8 |
| click 图标 | 朝屏幕内侧弹跳一次 + 光晕；失败追加 toast | 弹跳 520ms，hop 8px，方向由 `data-edge` 决定；不做失败抖动 |
| 悬停移开 | 180ms 内平滑复位 | 复用 `--nx-dur-base` |
| 运行指示点 | 2.6s 呼吸（scale .85→1、opacity .75→1）；hover 时增亮 | 仅 `is-running` |
| 拖拽排序 | FLIP：槽位交换 260ms spring；被拖图标抬升 1.06 + 投影 + 半透明 | 位移作用在 `.dock-item`，缩放作用在 `.dock-item-inner` |
| 新图标入场 | 错峰：opacity 0→1、translateY 6px→0、scale .86→1；每项延迟 24ms | 仅挂载时播放；`--nx-dur-slow` |
| Dock 入场 | 首次显示：opacity 0→1、位移 6px→0 | 320ms，只播一次 |
| Toast | 进：opacity/translate/scale pop；出：160ms 淡出后卸载 | 需要在 React 里维护 leaving 状态 |

### 3.2 音乐卡片

| 交互 | 效果 | 参数 |
|---|---|---|
| 控制按钮按压 | scale 0.90 + 阴影收缩，松手 spring 回弹 | `--nx-spring` |
| 控制按钮点击 | 圆形涟漪（裁剪在按钮内） | `nx-ripple-surface`，直径 2×按钮宽 |
| 播放/暂停切换 | 两个图标交叉过渡：旋转 -18°→0、scale 0.6→1、opacity 0→1 | 200ms，spring-soft；音频状态变化即触发 |
| 上一首/下一首 | 点击后图标朝操作方向微移 3px 再回弹 | 260ms，只播一次 |
| 进度条 hover | 轨道高度 4→6px、滑块 scale 1.35、填充加柔光 | `--nx-dur-fast` |
| 进度条拖动 | 滑块 scale 1.55 + 发光、填充渐变发光、时间数字保持 tabular | 拖动中禁用宽度过渡 |
| 封面切换 | 新封面淡入 + scale 1.04→1 | 220ms `--nx-ease-out` |
| 卡片入场 | opacity 0→1、translateY 8px→0、scale .98→1 | 260ms |
| 关闭按钮 | 默认隐藏、卡片 hover 浮现；按下 scale .9 + 涟漪 | 150ms |

### 3.3 设置面板

| 交互 | 效果 | 参数 |
|---|---|---|
| 普通按钮 | hover 提亮 + 轻微上浮 1px；按下 scale .97 + 阴影收缩；涟漪 | ripple 裁切在圆角内 |
| 主按钮 | 强调色底 + 悬停柔光，按下同普通按钮 | 不发光过强 |
| 开关 | 滑块 spring 位移（轻微过冲）、轨道按下 scale .96、开启时轨道柔光 | 180ms |
| 滑块 | thumb hover 1.15 / active 1.3 + 柔光；轨道填充发光 | 130ms |
| 分段选择 | hover 提亮；按下 scale .97；选中态 spring 背景 + 内描边 | 180ms |
| 导航项 | hover 背景 + 文字提亮；选中左侧指示条高度 spring 展开；按下 scale .98 | 200ms |
| 应用列表行 | hover 边框/背景提亮；行内操作按钮 opacity 0.6→1、按下 + 涟漪 | 140ms |
| 页面切换 | 内容 opacity 0→1、translateY 6px→0 | 220ms |
| 弹层（恢复默认/开始菜单） | 背景淡入 + 面板 scale .96→1 / translateY 8px→0 | 200ms |
| 标题栏按钮 | hover 提亮；关闭按钮 hover 红色；按下 scale .94 | 120ms |

### 3.4 桌面时钟（v1.1 新增）

| 交互 | 效果 | 参数 |
|---|---|---|
| 窗口首次显示 | 整体淡入（opacity 0→1，不位移，保持内容测量稳定） | `--nx-dur-slow` / `--nx-ease-out` |
| 秒/分变化 | 仅文本内容替换，**不做**位移、缩放、翻牌动画 | 保证读时稳定；变更瞬间不触发尺寸变化（等宽数字 `tabular-nums`） |
| 锁定态切换 | 拖动区光标与锁定图标 120ms 内切换（透明度/颜色过渡） | `--nx-dur-fast`；不改变布局 |
| 拖动手柄/整卡 | 无额外动效（系统级窗口拖动本身有跟手感，禁止叠加 transform） | 与 Dock/音乐卡片一致：窗口位移不进 CSS 动画 |
| 减少动效 | 入场淡入收敛为瞬时显示；锁定态过渡取消 | 遵循 §2.4 全局降级规则 |

> 时钟以**可读性优先**：不做秒针动画、不做背景脉冲；所有颜色/字号来自设置（`clock.*`），动效令牌只用于入场与状态切换。

## 4. 强度档位语义

| 档位 | 用户预期 | 实现差异 |
|---|---|---|
| 轻快 | 干净利落，低性能设备 | 时长 ×0.72、无过冲、按压幅度稍小（0.96）、启动弹跳 6px |
| 标准 | 默认，轻微 Q 弹 | 时长 ×1、轻微过冲、按压 0.95、弹跳 8px |
| 弹性 | 手感优先，明显物理感 | 时长 ×1.28、明显过冲、按压 0.93、弹跳 10px |

## 5. 状态与可访问性

- 所有可交互元素必须有 `:focus-visible` 焦点环：`0 0 0 2px` 强调色（偏移 2px）。
- 禁用态：`opacity .45` + `cursor: default` + 不响应按压与涟漪。
- 动效不得改变元素命中区域（涟漪/光晕 `pointer-events: none`）。
- 文本可读性优先：动效透明度最低不低于 0.35（除非是消散中的涟漪）。

## 6. 文件与职责

| 文件 | 职责 |
|---|---|
| `src/renderer/shared/motion.css` | 令牌、关键帧、`.nx-ripple*`、`.nx-pressable`、降级规则 |
| `src/renderer/shared/motion.ts` | `spawnRipple()`、`playClickSound()`、`prefersReducedMotion()` |
| `src/renderer/shared/theme.css` | 颜色/圆角/阴影/字体层级 + `@import './motion.css'` |
| `src/renderer/shared/ui.css` / `ui.tsx` | 通用控件四态 + Button 涟漪接入 |
| `src/renderer/dock/*` | Dock 专属动效（见 §3.1） |
| `src/renderer/music/*` | 音乐卡片专属动效（见 §3.2） |
| `src/renderer/settings/*` | 设置面板专属动效 + 外观与动效页（见 §3.3） |
| `src/renderer/clock/*` | 桌面时钟专属动效（见 §3.4，v1.1 新增） |

## 7. 验收口径

- 计算样式证据：`transition-duration` 随 `data-motion` 变化（0.72×/1×/1.28×），`reducedMotion=true` 时为 `0.00001s`。
- 截图证据：按压瞬间（pointerdown 后 ~60ms）与松手后、涟漪存在与消失、设置页三档切换。
- 人工体验项：拖拽排序手感、启动弹跳、点击音效、音乐切歌反馈。
