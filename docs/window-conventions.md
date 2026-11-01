# WINDOW CONVENTIONS — Nexus Dock 悬浮窗口行为准则 v1.0

> 状态：已定稿（2026-10-30，用户决策：**今后所有窗口都要有「自动吸附屏幕边缘」开关**，并沉淀为强制准则；v1.3 用户再次确认：**吸附/始终置顶/仅在桌面显示等共性项统一放「系统」页，用折叠栏按窗口单独设置；窗口缺少的共性选项必须补齐**）。
> 适用范围：Dock、音乐卡片、桌面时钟，以及**今后新增的任何桌面悬浮窗口**。
> 本文件是窗口能力的**唯一标准真源**。新增窗口先对照本准则，再写 spec/plan，不允许「先实现后补准则」。
> 关联文档：`docs/spec.md` §4/§9、`docs/plan.md` §14、`docs/motion-spec.md`、`docs/verification.md` §v1.2。

## 1. 设计原则

| 原则 | 含义 | 落地要求 |
|---|---|---|
| 行为可配置 | 桌面常驻工具必须允许用户控制「怎么摆、是否自动对齐」 | 每个悬浮窗口都提供 **吸附开关**、**位置锁定**、**显示开关** |
| 默认不打扰 | 默认值保持既有手感，不因新增选项改变老用户体验 | `snapToEdge` 默认 **true**（吸附，等价旧行为）；新窗口默认值需在 spec 中明示 |
| 不跳变 | 运行中切换开关时窗口不得瞬移 | 关→开：以当前位置反算最近边；开→关：把当前位置固化为绝对坐标 |
| 双层防护 | 锁定/拖动不能只靠 CSS | 渲染层 `data-locked` + `-webkit-app-region`，主进程 `setMovable` + `moved` 守卫 |
| 可验证 | 每个能力都要有稳定的 DOM/IPC 契约供 CDP 验收 | 统一 `data-*` 标记与 class 命名，见 §3 |

## 2. 强制能力清单（每个桌面悬浮窗口必须全部实现）

| # | 能力 | 强制要求 | 配置字段（示例） | 设置入口 |
|---|---|---|---|---|
| C1 | **显示/隐藏开关** | 设置页开关 + 至少一个快捷入口（Dock 按钮或右键菜单）；隐藏用 `hide()` 不销毁 | `visible` | 窗口自身页面的「显示」组 + 快捷入口 |
| C2 | **位置可拖动 + 持久化** | 明确拖动区；松手后位置落盘；重启还原；分辨率变化收敛到可见区 | `freeX`/`freeY`（或 `edge`/`alongPercent`） | 独有位置模型留在窗口页（如 Dock 停靠边）；共性操作见 C3/C4/C11 |
| C3 | **自动吸附屏幕边缘开关**（v1.2 起强制） | `snapToEdge: boolean`，**默认 true**；开=松手吸附最近屏幕边（间距 12px）；关=拖到哪停在哪并记录绝对坐标；运行中切换不跳变 | `snapToEdge` | **系统 →「窗口共性设置」→ 该窗口折叠栏**，文案「自动吸附屏幕边缘」 |
| C4 | **位置锁定** | 受全局总开关 + 单窗口开关控制；锁定后不可拖动、不写位置；解锁即时恢复；持久化 | `lock.<窗口>` | **系统 → 窗口共性设置折叠栏** + Dock 右键快捷入口 |
| C5 | **始终置顶开关** | 默认 true；切换即时生效；**三窗口均须提供**（v1.3 补齐音乐卡片） | `alwaysOnTop` | **系统 → 窗口共性设置折叠栏** |
| C6 | **统一动效** | 只用 `motion.css` 令牌（`--nx-*`），禁止硬编码毫秒；遵循「减少动效」降级 | – | – |
| C7 | **尺寸自适应** | 透明窗口内容尺寸必须等于窗口尺寸（`useContentSize(<target>)`）；首次内容尺寸回报前不得显示，避免隐形点击区 | – | – |
| C8 | **配置迁移** | 新增字段必须 bump `schemaVersion`，在 `settingsStore.migrate` 写迁移，`sanitizeSettings` 补默认值与收敛；旧配置零丢失 | `schemaVersion` | – |
| C9 | **统一窗口接入** | 新窗口必须纳入 `WindowTarget`、`createXWindow/applyXLayout`、`allWindows`、`broadcast`、`setContentSize`、`windowCapture`、`destroyWindows`、`onSettingsChanged`、屏幕 metrics 重排 | – | – |
| C10 | **验收契约** | 新增/修改窗口必须更新 spec/plan/tasks/verification，并提供 CDP 脚本检查；根节点稳定标记 `data-locked`/`data-theme`，关键文本节点使用稳定 class（如 `.clock-time`） | – | – |
| C11 | **「仅在桌面显示」开关**（v1.3 起强制） | 前台窗口最大化/全屏时自动隐藏，回到桌面恢复；**三窗口均须提供**（Dock 既有，v1.3 补齐音乐卡片/时钟）；默认值保留各窗口旧行为 | `onlyOnDesktop` | **系统 → 窗口共性设置折叠栏** |
| C12 | **移回默认位置** | 每个悬浮窗口提供位置复位动作（Dock→底部居中；音乐→跟随 Dock；时钟→主屏右上角） | 复位坐标字段 | **系统 → 窗口共性设置折叠栏** |

> 例外：**设置窗口**是管理面板不是桌面悬浮组件，豁免 C1/C3/C4/C5/C11/C12（不参与位置锁定、不需要吸附/置顶/仅在桌面/复位）；其余行为仍按通用工程规范执行。

### 2.1 设置信息架构规则（v1.3 用户确认）

| 规则 | 内容 |
|---|---|
| 共性归系统 | 吸附、始终置顶、仅在桌面显示、位置锁定、移回默认位置等**所有窗口共有的行为**，统一放在设置「系统」页的「窗口共性设置」中管理 |
| 折叠栏单窗口管理 | 系统页按窗口提供折叠栏（Dock / 音乐卡片 / 桌面时钟）；**默认全部折叠**，标题行右侧展示状态摘要（如「吸附开 · 置顶开 · 始终显示 · 未锁定」），展开后单独调整 |
| 独有归窗口页 | 窗口独有特性留在各自页面：Dock=停靠边/沿边位置/图标/背景/主题；音乐卡片=显示/来源/卡片宽度/进度样式/卡片位置；时钟=显示内容/字号/透明度/主题 |
| 能力一致 | 若某窗口缺少某项共性能力（尤其吸附/置顶/仅在桌面/锁定），**必须补齐**，不允许只在部分窗口提供；新增字段同时补 `schemaVersion` 迁移 |
| 默认值稳定 | 新增共性开关的默认值必须保留该窗口既有观感（例如 Dock `onlyOnDesktop=true`，音乐/时钟 `onlyOnDesktop=false`），避免升级后行为突变 |

## 3. DOM 与 IPC 契约约定

- 悬浮窗口根节点必须带：
  - `data-locked="true"`（仅锁定时存在，未锁定缺失，不输出 `"false"`）
  - 锁定提示：根节点 `title`/`aria-label` 包含「位置已锁定」与解锁路径
  - 主题类窗口带 `data-theme="dark|light"`
- 拖动区：未锁定时 `-webkit-app-region: drag`；锁定时必须改为 `no-drag` 且光标不再是抓取样式。
- 有文字的窗口给关键文本节点稳定 class，供验收脚本读取（如 `.clock-time`、`.clock-date`）。
- 主进程每个窗口的 `moved` 处理器顺序：`applying 守卫 → 锁定守卫 → snapToEdge 分支（吸附/自由写回）`，防抖回调内再判一次锁定。
- 开关翻转处理统一放在 `onSettingsChanged`：`false→true` 反算最近边，`true→false` 固化当前坐标，其余情况走 `applyXLayout()`。

## 4. 新窗口接入检查清单（PR / SDD Checklist）

- [ ] spec 新增 US/AC（含默认值明示），plan 写方案与写作用域，tasks 建阶段
- [ ] `types.ts` 契约：Config 字段、`DEFAULT_SETTINGS`、`sanitizeSettings`、`mergeSettings`、`schemaVersion` +1
- [ ] `settingsStore.migrate` 写 `v(n-1) → v(n)` 迁移（旧字段保留）
- [ ] `windowManager`：创建/布局/`moved`（含吸附分支与锁定守卫）/显隐/置顶/metrics 重排
- [ ] 渲染入口：`electron.vite.config.ts` 增加页面、`index.html`/`main.tsx`/组件/CSS
- [ ] 设置页：**独有特性**放窗口自身页面（显示/外观/专属模型）；**共性项**放「系统」页「窗口共性设置」折叠栏（吸附 / 始终置顶 / 仅在桌面显示 / 位置锁定 / 移回默认位置），折叠栏**默认收起 + 标题状态摘要**
- [ ] 能力补齐：缺失的共性选项必须补齐，三窗口保持一致；新增开关默认值保留该窗口既有观感
- [ ] 锁定：`data-locked` + CSS + 主进程 `setMovable` + 快捷入口（如 Dock 右键）
- [ ] 动效：入场/状态切换用 `--nx-*` 令牌，无硬编码毫秒
- [ ] 验收：`typecheck` / `build` / CDP 脚本（schemaVersion、开关默认值、切换落盘、`data-locked`、截图）
- [ ] `docs/verification.md` 回填 AC 结果与人工项
- [ ] README / 操作指南更新版本与使用说明

## 5. 当前窗口符合性矩阵（v1.3）

| 能力 | Dock | 音乐卡片 | 桌面时钟 | 设置窗口（豁免） |
|---|---|---|---|---|
| C1 显示/隐藏开关 | ✅ 仅桌面显示 + 关闭即退出 | ✅ 设置开关 / Dock 音符 / 卡片 ✕ | ✅ 设置开关 / Dock 时钟按钮 | 豁免 |
| C2 位置拖动 + 持久化 | ✅ 手柄 + `freeX/freeY`（含吸附边模式） | ✅ 整卡拖动 + `anchor/freeX/freeY` | ✅ 整卡拖动 + `freeX/freeY` | ✅ 标题栏拖动（OS 默认） |
| C3 自动吸附开关 | ✅ `dock.snapToEdge`（系统页折叠栏） | ✅ `music.snapToEdge`（系统页折叠栏） | ✅ `clock.snapToEdge`（系统页折叠栏） | 豁免 |
| C4 位置锁定 | ✅ `lock.dock`（系统页） | ✅ `lock.music`（系统页） | ✅ `lock.clock`（系统页） | 豁免 |
| C5 始终置顶开关 | ✅ `dock.alwaysOnTop` | ✅ `music.alwaysOnTop`（v1.3 补齐） | ✅ `clock.alwaysOnTop` | 普通窗口 |
| C6 统一动效 | ✅ | ✅ | ✅ | ✅ |
| C7 尺寸自适应 | ✅ | ✅ | ✅ | 固定尺寸 |
| C8 配置迁移 | ✅ schemaVersion 7 | ✅ | ✅ | – |
| C9/C10 窗口接入与验收 | ✅ | ✅ | ✅ | ✅ |
| C11 仅在桌面显示 | ✅ `dock.onlyOnDesktop`（默认开，v0.2） | ✅ `music.onlyOnDesktop`（v1.3 补齐，默认关） | ✅ `clock.onlyOnDesktop`（v1.3 补齐，默认关） | 豁免 |
| C12 移回默认位置 | ✅ → 底部居中 | ✅ → 跟随 Dock | ✅ → 主屏右上角 | 豁免 |

> v1.3 起，C3/C4/C5/C11/C12 这五类共性项全部由「系统 → 窗口共性设置」的按窗口折叠栏统一管理；窗口页面只保留 C1/C2 的独有形态与各自外观/内容选项。

## 6. 变更与评审流程

1. 需求确认后，先改 `docs/spec.md`（新增 US/AC），再改本准则（若涉及窗口能力变化）。
2. `docs/plan.md` 写实现方案与写作用域，`docs/tasks.md` 建任务阶段。
3. 实现后跑 `npm run typecheck`、`npm run build`、CDP 验收脚本（安装版）。
4. 结果回填 `docs/verification.md`，截图存 `docs/verification/v<version>/`。
5. 未满足 §2 强制能力的窗口**不得合入/发布**；确有豁免需求（如设置窗口）必须在本文件 §5 中显式登记理由。
