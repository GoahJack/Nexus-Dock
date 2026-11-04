# WINDOW CONVENTIONS — Nexus Dock 悬浮窗口行为准则 v1.0

> 状态：已定稿（2026-10-30，用户决策：**今后所有窗口都要有「自动吸附屏幕边缘」开关**，并沉淀为强制准则；v1.3 用户再次确认：**吸附/始终置顶/仅在桌面显示等共性项统一放「系统」页，用折叠栏按窗口单独设置；窗口缺少的共性选项必须补齐**；v1.7 用户确认：**设置导航按「窗口」分组，共性项入口迁移到「窗口 → 内置窗口」，并新增注册表驱动的「附加窗口」接入位**；v1.8：**接入位注册首个真实实例「英语单词学习」（kind=`wordstudy`）**，同步验证了「窗口内数据不进 settings」的扩展方式）。
> 适用范围：Dock、音乐卡片、桌面时钟、**英语单词学习（v1.8 附加窗口）**，以及**今后新增的任何桌面悬浮窗口**（内置或附加窗口）。
> 本文件是窗口能力的**唯一标准真源**。新增窗口先对照本准则，再写 spec/plan，不允许「先实现后补准则」。
> 关联文档：`docs/spec.md` §13/§14、`docs/plan.md` §18/§19、`docs/motion-spec.md`、`docs/verification.md` §v1.7/§v1.8。

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
| C1 | **显示/隐藏开关** | 设置页开关 + 至少一个快捷入口（Dock 按钮或右键菜单）；隐藏用 `hide()` 不销毁 | `visible` | 窗口自身页面的「显示」组 + 快捷入口；附加窗口为「窗口 → 附加窗口」折叠栏 |
| C2 | **位置可拖动 + 持久化** | 明确拖动区；松手后位置落盘；重启还原；分辨率变化收敛到可见区 | `freeX`/`freeY`（或 `edge`/`alongPercent`） | 独有位置模型留在「窗口 → 内置窗口」对应折叠栏（如 Dock 停靠边）；附加窗口为「窗口 → 附加窗口」 |
| C3 | **自动吸附屏幕边缘开关**（v1.2 起强制） | `snapToEdge: boolean`，**默认 true**；开=松手吸附最近屏幕边（间距 12px）；关=拖到哪停在哪并记录绝对坐标；运行中切换不跳变 | `snapToEdge` | **窗口 → 内置窗口 → 该窗口折叠栏**，文案「自动吸附屏幕边缘」 |
| C4 | **位置锁定** | 受全局总开关 + 单窗口开关控制；锁定后不可拖动、不写位置；解锁即时恢复；持久化 | `lock.<窗口>` | **窗口 → 内置窗口 → 该窗口折叠栏** + Dock 右键/托盘快捷入口 |
| C5 | **始终置顶开关** | 默认 true；切换即时生效；**三窗口均须提供**（v1.3 补齐音乐卡片） | `alwaysOnTop` | **窗口 → 内置窗口 → 该窗口折叠栏** |
| C6 | **统一动效** | 只用 `motion.css` 令牌（`--nx-*`），禁止硬编码毫秒；遵循「减少动效」降级 | – | – |
| C7 | **尺寸自适应** | 透明窗口内容尺寸必须等于窗口尺寸（内置窗口 `useContentSize(<target>)`、附加窗口 `setOwnContentSize`）；首次内容尺寸回报前不得显示，避免隐形点击区 | – | – |
| C8 | **配置迁移** | 新增字段必须 bump `schemaVersion`，在 `settingsStore.migrate` 写迁移，`sanitizeSettings` 补默认值与收敛；旧配置零丢失 | `schemaVersion` | – |
| C9 | **统一窗口接入** | 内置窗口必须纳入 `WindowTarget`、`createXWindow/applyXLayout`、`allWindows`、`broadcast`、`setContentSize`、`windowCapture`、`destroyWindows`、`onSettingsChanged`、屏幕 metrics 重排；附加窗口由 `extraWindows.ts` 注册表统一接入 | – | – |
| C10 | **验收契约** | 新增/修改窗口必须更新 spec/plan/tasks/verification，并提供 CDP 脚本检查；根节点稳定标记 `data-locked`/`data-theme`，关键文本节点使用稳定 class（如 `.clock-time`） | – | – |
| C11 | **「仅在桌面显示」开关**（v1.3 起强制） | 前台窗口最大化/全屏时自动隐藏，回到桌面恢复；**三窗口均须提供**（Dock 既有，v1.3 补齐音乐卡片/时钟）；默认值保留各窗口旧行为 | `onlyOnDesktop` | **窗口 → 内置窗口 → 该窗口折叠栏** |
| C12 | **移回默认位置** | 每个悬浮窗口提供位置复位动作（Dock→底部居中；音乐→跟随 Dock；时钟→主屏右上角；附加窗口→清空自由坐标、回落到注册表默认停靠位置） | 复位坐标字段 | **窗口 → 内置窗口 → 该窗口折叠栏** |

> 入口说明（v1.7）：**内置窗口**的 C3/C4/C5/C11/C12 统一在「窗口 → 内置窗口」的按窗口折叠栏管理；**附加窗口**的同类能力（含 C1 显示开关）由「窗口 → 附加窗口」按注册表渲染；「系统」页不再承载窗口共性项。
> 例外：**设置窗口**是管理面板不是桌面悬浮组件，豁免 C1/C3/C4/C5/C11/C12（不参与位置锁定、不需要吸附/置顶/仅在桌面/复位）；其余行为仍按通用工程规范执行。

### 2.1 设置信息架构规则（v1.3 用户确认，v1.7 调整入口）

| 规则 | 内容 |
|---|---|
| 导航分组（v1.7） | 设置左侧导航按「**窗口** / 应用 / 外观 / 系统 / 关于」分组；「窗口」组含**内置窗口**（Dock/音乐/时钟合并为一页）与**附加窗口**（注册表驱动，v1.8 起已含「英语单词学习」）。不再保留 Dock / 音乐 / 时钟三个独立导航项 |
| 共性归「内置窗口」页 | 吸附、始终置顶、仅在桌面显示、位置锁定、移回默认位置等**所有窗口共有的行为**，统一放在「窗口 → 内置窗口」中管理；「系统」页不再承载窗口共性设置，只保留启动项与跳转按钮 |
| 折叠栏单窗口管理 | 内置窗口页按窗口提供折叠栏（Dock / 音乐卡片 / 桌面时钟）；**默认全部收起**，标题行右侧展示状态摘要（如「吸附开 · 置顶开 · 始终显示 · 未锁定」），展开后单独调整共有开关 + 该窗口独有设置 |
| 独有归窗口 | 窗口独有特性放在同一折叠栏的「该窗口独有设置」区域：Dock=停靠边/沿边位置/图标/背景/主题；音乐卡片=显示/来源/卡片宽度/进度样式/卡片位置；时钟=显示内容/字号/透明度/主题 |
| 附加窗口注册表驱动 | 附加窗口在「窗口 → 附加窗口」按 `EXTRA_WINDOW_KINDS` 渲染；v1.8 注册了 `wordstudy`，页面自动出现「英语单词学习」折叠栏；**只有注册表为空时**才显示「暂无附加窗口」空状态 + 接入说明；新增窗口**不新增导航项**，页面自动出现 |
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

先判断窗口类型：**内置窗口**（随应用交付、写死在配置模型里）走 §4.0；**附加窗口**（以后接入的功能窗口、注册表驱动）走 §4.1 并对照 §5。

### 4.0 内置窗口接入

- [ ] spec 新增 US/AC（含默认值明示），plan 写方案与写作用域，tasks 建阶段
- [ ] `types.ts` 契约：Config 字段、`DEFAULT_SETTINGS`、`sanitizeSettings`、`mergeSettings`、`schemaVersion` +1
- [ ] `settingsStore.migrate` 写 `v(n-1) → v(n)` 迁移（旧字段保留）
- [ ] `windowManager`：创建/布局/`moved`（含吸附分支与锁定守卫）/显隐/置顶/metrics 重排
- [ ] 渲染入口：`electron.vite.config.ts` 增加页面、`index.html`/`main.tsx`/组件/CSS
- [ ] 设置页：**独有特性**放「窗口 → 内置窗口」对应折叠栏的「该窗口独有设置」；**共性项**放折叠栏共有区（自动吸附屏幕边缘 / 始终置顶 / 仅在桌面显示 / 锁定位置 / 移回默认位置），折叠栏**默认收起 + 标题状态摘要**
- [ ] 能力补齐：缺失的共性选项必须补齐，三窗口保持一致；新增开关默认值保留该窗口既有观感
- [ ] 锁定：`data-locked` + CSS + 主进程 `setMovable` + 快捷入口（如 Dock 右键）
- [ ] 动效：入场/状态切换用 `--nx-*` 令牌，无硬编码毫秒
- [ ] 验收：`typecheck` / `build` / CDP 脚本（schemaVersion、开关默认值、切换落盘、`data-locked`、截图）
- [ ] `docs/verification.md` 回填 AC 结果与人工项
- [ ] README / 操作指南更新版本与使用说明

### 4.1 附加窗口接入（完整机制见 §5）

- [ ] `src/shared/types.ts` 的 `EXTRA_WINDOW_KINDS` 增加一条 `WindowKindSpec`：`kind` / `page` 唯一且不与内置窗口重复，声明 `defaultSize`、`defaults`、`placement`、`defaultOptions`
- [ ] 新建 `src/renderer/<page>/`（`index.html` + `main.tsx` + 组件 + CSS）；透明窗口用 `window.nexus.window.setOwnContentSize(size)` 上报内容尺寸
- [ ] `electron.vite.config.ts` 的 `renderer.input` 增加 `<page>` 入口
- [ ] （可选）需要独有选项时，在 `ExtraWindowsSection` 的 `EXTRA_WINDOW_SETTINGS` 注册设置组件；不注册时显示「该窗口暂无可调选项」
- [ ] **不修改**设置页/托盘/`extraWindows.ts` 的通用代码：显隐、吸附、锁定、置顶、仅在桌面、托盘与 Dock 右键入口、n/N 锁定汇总、配置迁移应自动生效
- [ ] 契约测试覆盖：注册表 kind/page 唯一、未知/重复 kind 丢弃、`sanitizeWindowOptions` 标量白名单、`patchExtraWindows` 纯函数
- [ ] 验收：临时注册一个 kind → 设置页折叠栏与托盘项出现、开关落盘、`schemaVersion` 迁移零丢失；移除 kind 后配置收敛为空、不残留窗口

## 5. 附加窗口接入机制（v1.7）

> 定义区分：
> - **内置窗口** = 随 Nexus 交付、配置字段写死在 `Settings.dock / music / clock` 的窗口：**Dock、音乐卡片、桌面时钟**。
> - **附加窗口** = 以后新增、只登记在 `EXTRA_WINDOW_KINDS` 注册表的功能窗口（如天气卡片、便签）。它们复用 §2 的全部强制能力，但不新增配置组、不新增导航项。
> - v1.7 只预留接入位；v1.8 起注册表已有首个真实实例 **`wordstudy`（英语单词学习）**，「窗口 → 附加窗口」显示其折叠栏（实测见 `docs/verification.md` §v1.8）。清空注册表时才会回到「暂无附加窗口」空状态，这是预期状态，不是加载失败。

### 5.1 注册表模型（唯一登记处）

| 类型 | 位置 | 作用 |
|---|---|---|
| `WindowKindSpec` | `src/shared/types.ts` | 窗口类型元数据：`kind`（唯一键，同时是配置实例键）、`label`、`description`、`category`（`builtin`/`extra`）、`page`（渲染页目录名，与 `electron.vite.config.ts` 的 `renderer.input` 同名）、`defaultSize`、`defaults`（visible/snapToEdge/edge/alongPercent/alwaysOnTop/onlyOnDesktop/locked/theme）、`placement`（默认停靠边/沿边位置）、`defaultOptions`（独有选项默认值） |
| `BUILTIN_WINDOW_SPECS` | `src/shared/types.ts` | 内置窗口注册表（`dock` / `music` / `clock`），设置页分组、托盘入口、锁定汇总从这张表驱动 |
| `EXTRA_WINDOW_KINDS` | `src/shared/types.ts` | 附加窗口注册表；v1.8 起含 `wordstudy`（英语单词学习），新增功能窗口只在这里登记 |
| `ExtraWindowConfig` | `src/shared/types.ts` | 附加窗口**只存状态**：visible / snapToEdge / edge / alongPercent / freeX / freeY / alwaysOnTop / onlyOnDesktop / locked / theme / options；类型信息一律来自注册表 |
| `normalizeExtraWindows` / `sanitizeWindowOptions` | `src/shared/types.ts` | 收敛入口：按注册表逐 kind 生成配置、丢弃未知/重复 kind；`options` 只保留 JSON 安全标量（字符串 ≤2000、键 ≤64） |
| `src/main/extraWindows.ts` | 主进程 | 通用管理器：按注册表创建/销毁、加载 `src/renderer/<page>/`、内容尺寸、拖动落盘、吸附、锁定、置顶、仅在桌面、托盘/Dock 右键菜单项 |
| `BuiltinWindowsSection.tsx` / `ExtraWindowsSection.tsx` | 设置渲染层 | 内置窗口合并页 / 附加窗口注册表驱动页（含空状态与 4 步接入说明） |

### 5.2 接入 4 步（以后新增功能窗口只做这些）

1. **注册类型**：在 `src/shared/types.ts` 的 `EXTRA_WINDOW_KINDS` 增加一条 `WindowKindSpec`（`kind`/`page` 必须唯一，且 `page` 与内置窗口不重名；声明默认尺寸、默认行为、默认选项）。
2. **新建渲染页**：创建 `src/renderer/<page>/`（`index.html` + `main.tsx` + 组件 + CSS）；透明窗口需要在渲染层用 `window.nexus.window.setOwnContentSize(size)` 上报内容尺寸（主进程按 IPC sender 定位窗口，渲染层不需要知道自己的 kind）。
3. **增加构建入口**：在 `electron.vite.config.ts` 的 `renderer.input` 增加同名 `<page>` 入口。
4. **（可选）独有设置**：需要专属选项时，在设置页 `ExtraWindowsSection` 的 `EXTRA_WINDOW_SETTINGS` 注册 kind → 设置组件；不注册时折叠栏显示「该窗口暂无可调选项」。

### 5.3 自动获得的能力（无需改通用代码）

- 窗口创建/销毁、渲染页加载、内容尺寸自适应（未收到首次尺寸前不显示，避免隐形点击区，C7）
- 显示/隐藏开关（`visible`）+ 托盘与 Dock 右键菜单入口
- 拖动 + 自动吸附开关 + 位置持久化（吸附边/沿边百分比/自由坐标，12px 边距与「最近边」规则）
- 位置锁定（`locked` → `setMovable(false)` + `moved` 守卫）、始终置顶（`alwaysOnTop`）
- 仅在桌面显示（`onlyOnDesktop` → 并入桌面状态桥与附加窗口显隐决策）。附加窗口与内置窗口**共用同一桌面状态桥**；桌面状态桥协议 v1.7 起含 `minimized` / `visible` 字段（旧协议缺字段时按 `visible=true` / `minimized=false` 兼容）。「是否占用桌面」由共享纯函数 `isDesktopBusy(state, selfActive)` 统一判定（空状态 / 自身窗口 / 最小化 / 不可见 → 不占用），主进程与契约测试共用。
- 设置页「窗口 → 附加窗口」折叠栏（注册表驱动，默认收起 + 状态摘要）
- 锁定汇总 n/N（`windowLockSummary` 计入附加窗口）与「锁定全部窗口位置」联动（`withAllWindowsLocked`）
- 配置迁移：新增字段提升 `schemaVersion`，`normalizeExtraWindows` 按注册表补默认、旧配置零丢失

### 5.4 约束

- **一个 kind 一个实例**：配置数组按 kind 唯一化，重复/未知 kind 一律丢弃；注册表 `kind` 与 `page` 必须唯一且不得与内置窗口重复（契约测试强制）。
- **未知 kind 丢弃**：用户配置里残留的未注册 kind 不会恢复，也不会创建窗口。
- **schema 迁移**：新增配置字段必须 bump `schemaVersion` 并写 `settingsStore.migrate`；附加窗口字段统一由 `sanitizeSettings` 收敛。
- **options 只存 JSON 标量**：数组/函数/超长键丢弃，字符串截断 2000 字符；默认值只来自注册表 `defaultOptions`。
- **能力完整**：附加窗口同样受 §2 强制能力约束，缺项不得合入；新增 IPC 通道必须登记 `IPC` 常量 + preload 白名单。
- **默认值稳定**：注册表 `defaults`/`placement` 必须声明清楚，避免升级后窗口位置/显隐突变。
- **窗口内业务数据不进 `options`**（v1.8 接入经验）：`options` 只允许 JSON 安全标量，适合放少量偏好（如 5 个布尔学习选项）；像「词库 + 学习进度」这种可能上千条、用户还要手工编辑的数据，**不能塞进 settings.json**。正确做法是单独文件存储（`userData/wordbank.json`、`userData/wordbank-progress.json`），由专属主进程模块负责原子写 / 损坏备份 / sanitize，通过独立 IPC 通道读写并广播变更；设置页只展示统计与文件路径，不搬运数据本体。这样 `settings.json` 体积稳定、可读，词库也能被任意编辑器/脚本整体替换。

### 5.5 验收要求

- **契约测试**（`npm test`，不需要 Electron）：注册表 kind/page 唯一、`normalizeExtraWindows` 对未知/重复 kind 丢弃、`sanitizeWindowOptions` 标量白名单、`hasOnlyOnDesktopWindow` 覆盖附加窗口、`windowLockSummary` n/N 汇总、`withAllWindowsLocked` 同时锁内置+附加、`patchExtraWindows` 纯函数、桌面占用判定 `isDesktopBusy`（最小化/不可见不算占用，是「显示桌面」bug 的回归点）。
- **运行时验收**：临时注册一个 kind → 设置页自动出现折叠栏、托盘/Dock 右键出现显隐项、开关落盘、吸附/锁定/置顶/仅在桌面生效；移除该 kind → 配置收敛为空、不残留窗口。v1.8 已用 `wordstudy` 实例完整走通该链路（CDP 运行时 42/43，见 §v1.8）。
- **迁移验收**：旧 `settings.json`（schemaVersion 9）升级到 10 后 `extraWindows` 补 `[]`，其余设置零丢失；schemaVersion 10 升级到 11 时按注册表补出 `wordstudy`，旧配置同样零丢失（v1.8 实测见 `docs/verification.md` §v1.8）。
- **接线门禁**（v1.8 新增）：`tests/wiring.test.mjs` 用静态断言钉住「IPC 声明 ↔ 主进程 handler ↔ preload」「注册表 ↔ 渲染页 ↔ vite 入口 ↔ `loadRenderer(spec.page)`」「设置页 `EXTRA_WINDOW_SETTINGS` 注册」与「DOM class 契约」，防止单测全绿但窗口按钮没反应。
- 具体结果写入 `docs/verification.md` §v1.7 / §v1.8（由验收脚本生成），本节只定义要求。

## 6. 当前窗口符合性矩阵（v1.7 / v1.8）

| 能力 | Dock | 音乐卡片 | 桌面时钟 | 设置窗口（豁免） |
|---|---|---|---|---|
| C1 显示/隐藏开关 | ✅ 仅桌面显示 + 关闭即退出 | ✅ 设置开关 / Dock 音符 / 卡片 ✕ | ✅ 设置开关 / Dock 时钟按钮 | 豁免 |
| C2 位置拖动 + 持久化 | ✅ 手柄 + `freeX/freeY`（含吸附边模式） | ✅ 整卡拖动 + `anchor/freeX/freeY` | ✅ 整卡拖动 + `freeX/freeY` | ✅ 标题栏拖动（OS 默认） |
| C3 自动吸附开关 | ✅ `dock.snapToEdge`（窗口 → 内置窗口） | ✅ `music.snapToEdge`（窗口 → 内置窗口） | ✅ `clock.snapToEdge`（窗口 → 内置窗口） | 豁免 |
| C4 位置锁定 | ✅ `lock.dock`（窗口 → 内置窗口） | ✅ `lock.music`（窗口 → 内置窗口） | ✅ `lock.clock`（窗口 → 内置窗口） | 豁免 |
| C5 始终置顶开关 | ✅ `dock.alwaysOnTop`（窗口 → 内置窗口） | ✅ `music.alwaysOnTop`（v1.3 补齐） | ✅ `clock.alwaysOnTop` | 普通窗口 |
| C6 统一动效 | ✅ | ✅ | ✅ | ✅ |
| C7 尺寸自适应 | ✅ | ✅ | ✅ | 固定尺寸 |
| C8 配置迁移 | ✅ schemaVersion 10（v1.7） | ✅ | ✅ | – |
| C9/C10 窗口接入与验收 | ✅ | ✅ | ✅ | ✅ |
| C11 仅在桌面显示 | ✅ `dock.onlyOnDesktop`（默认开，v0.2） | ✅ `music.onlyOnDesktop`（v1.3 补齐，默认关） | ✅ `clock.onlyOnDesktop`（v1.3 补齐，默认关） | 豁免 |
| C12 移回默认位置 | ✅ → 底部居中 | ✅ → 跟随 Dock | ✅ → 主屏右上角 | 豁免 |

**附加窗口（注册表驱动，v1.7 机制 / v1.8 首个实例）**：

| 能力 | 附加窗口通用机制（接入后自动具备） | `wordstudy`（英语单词学习，v1.8） | 说明 |
|---|---|---|---|
| C1 显示/隐藏 | ✅ `visible` + 托盘/Dock 右键菜单项 | ✅ 卡片右上 ✕ / 托盘 / Dock 右键 / 设置折叠栏 | 注册表驱动生成，无需改设置页 |
| C2/C3 位置 + 吸附 | ✅ `snapToEdge` / `edge` / `alongPercent` / `freeX` / `freeY` | ✅ 默认吸附右侧 32%，可在「窗口 → 附加窗口」切换 | 12px 边距、最近边规则与内置窗口一致 |
| C4 位置锁定 | ✅ `locked`（n/N 汇总计入） | ✅ 设置折叠栏 / 「锁定全部窗口位置」 | 与内置窗口共用总开关补丁 |
| C5 始终置顶 | ✅ `alwaysOnTop` | ✅ 默认开，设置变更即时生效 | 创建与设置变更时生效 |
| C6 统一动效 | 新页面自行遵循 `motion.css` 令牌 | ✅ 复用 `theme.css` / `ui.css` / `motion.css` | 无硬编码毫秒 |
| C7 尺寸自适应 | ✅ `setOwnContentSize`（按 IPC sender 定位） | ✅ 学习视图 inner 362×252 / 根 360×250.3；词库管理 inner 482×548（CDP 实测） | 首次尺寸回报前不显示 |
| C8 配置迁移 | ✅ schemaVersion 逐版本补默认，未知 kind 丢弃 | ✅ v10 → v11 自动补 `wordstudy`，旧配置零丢失 | 注册表逐 kind 补默认 |
| C9/C10 接入与验收 | 按 §4.1/§5 接入，补 spec/plan/tasks/verification + CDP | ✅ spec §14 / plan §19 / tasks 阶段 29 / verification §v1.8 + `scripts/v18-verify.mjs` | `npm test` 41 项（含 8 项接线门禁） |
| C11 仅在桌面显示 | ✅ `onlyOnDesktop`（并入桌面状态桥） | ✅ 默认关，可在折叠栏开启 | v1.7 修复「显示桌面」后不恢复 |
| C12 移回默认位置 | ✅ 清空自由坐标、回落到注册表默认停靠位置 | ✅ 折叠栏内「移回默认位置」 | 折叠栏内按钮 |

> v1.7 起，C3/C4/C5/C11/C12 五类共性项的入口统一为「窗口 → 内置窗口」的按窗口折叠栏；附加窗口为「窗口 → 附加窗口」按注册表渲染（v1.8 起含 `wordstudy` 真实实例）；「系统」页不再承载窗口共性项，只保留启动项与跳转按钮。
> v1.8 运行时验收（`docs/verification.md` §v1.8）：C1/C2/C3/C4/C5/C7/C8/C11/C12 由 CDP 脚本与设置页开关写回验证（42/43 通过、0 失败、1 项原生对话框列手动），C6 由代码审查 + 截图核对，C9/C10 由 spec/plan/tasks/verification 与 `tests/wiring.test.mjs` 覆盖。

## 7. 变更与评审流程

1. 需求确认后，先改 `docs/spec.md`（新增 US/AC），再改本准则（若涉及窗口能力变化）。
2. `docs/plan.md` 写实现方案与写作用域，`docs/tasks.md` 建任务阶段；**新增附加窗口按 §5 的 4 步执行，内置窗口按 §4.0 清单执行**。
3. 实现后跑 `npm run typecheck`、`npm run build`、`npm test`、CDP 验收脚本（安装版）。
4. 结果回填 `docs/verification.md`，截图存 `docs/verification/v<version>/`。
5. 未满足 §2 强制能力的窗口**不得合入/发布**；确有豁免需求（如设置窗口）必须在本文件 §6 中显式登记理由。
