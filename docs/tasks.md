# TASKS — 按序执行清单（SDD 阶段 3）

> 状态：`[x]` 完成 · `[~]` 部分完成/待人工 · `[ ]` 待做
> 验收依据见 `docs/verification.md`；写作用域见 `docs/plan.md` §10。

## 阶段 0 — 环境与脚手架

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T0.1 | 环境自检（Node/npm/写权限/SMTC） | [x] | 修复了工作区 Windows 权限（`WRITE_OWNER` 缺失） |
| T0.2 | 工程骨架（package.json/.npmrc/tsconfig/electron.vite.config.ts） | [x] | TS7 移除 `baseUrl`，改用相对 `paths` |
| T0.3 | IPC 契约与配置模型 `src/shared/types.ts` | [x] | 含默认值、深合并、sanitize |
| T0.4 | 最小可启动骨架（主进程 + preload + 三入口） | [x] | 需处理宿主 `ELECTRON_RUN_AS_NODE` 与沙箱 |

## 阶段 1 — 主进程核心

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T1.1 | `settingsStore.ts`（加载/校验/原子写盘/防抖/广播） | [x] | 250ms 防抖；`settings:changed` 广播 |
| T1.2 | `windowManager.ts`（三类窗口、位置计算、拖动吸附） | [x] | 吸附公式实现；OS 拖动需人工验证 |
| T1.3 | `ipc.ts`（全部通道 + 参数校验） | [x] | 含应用菜单、捕获、媒体 |
| T1.4 | `protocol.ts`（`icon://` 图标、`media://` 音频 Range 流） | [x] | 修了双重解码 bug（含 `%` 文件名） |

## 阶段 2 — Dock 界面与交互

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T2.1 | Dock 容器（玻璃条、四边布局、尺寸回报） | [x] | 悬停公式按 AC 校准为 1.18/1.06 |
| T2.2 | 图标项（图标/放大/上浮/运行指示点） | [x] | 图标 `icon://` 修复后正常加载 |
| T2.3 | 单击启动、右键菜单、拖拽排序持久化 | [x] | 点击/排序已实测；右键菜单待人工 |
| T2.4 | 拖动手柄与主进程吸附联动 | [x] | 原生 tooltip 在 drag 区不显示（已知） |

## 阶段 3 — 音乐子系统

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T3.1 | `resources/smtc-bridge.ps1`（WinRT 轮询/JSON Lines/命令/封面） | [x] | 实测中文标题/进度/控制/非法命令容错 |
| T3.2 | `smtcBridge.ts`（子进程管理/退避重启/日志） | [x] | 1s/2s/3s 退避；`userData/logs/media.log` |
| T3.3 | `mediaHub.ts`（去重广播/控制路由） | [x] | 首帧广播 stopped |
| T3.4 | 音乐卡片 UI（封面/标题/进度插值/按钮/空状态） | [x] | `music-playing.png` / `music-empty.png` |
| T3.5 | 卡片窗口位置（跟随 Dock / 自由吸附持久化） | [x] | 跟随已实测；自由拖动待人工 |
| T3.6 | 本地播放器（选文件/播放列表/进度拖动） | [~] | 代码完成，文件对话框交互待人工 |

## 阶段 4 — 设置面板与应用管理

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T4.1 | 设置窗口壳（标题栏/导航/版本） | [x] | 580×760 |
| T4.2 | Dock 组参数 | [x] | 四页截图见 verification |
| T4.3 | 音乐组参数 | [x] | 含来源切换、选本地文件 |
| T4.4 | 应用组（列表/添加/开始菜单/排序/恢复默认） | [x] | 开始菜单面板含搜索 |
| T4.5 | `apps.ts`（扫描/lnk 解析/图标/启动/运行态） | [~] | 启动与图标正常；运行态受宿主进程可见性限制 |

## 阶段 5 — 集成与验收

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T5.1 | `npm run typecheck` 零错误 | [x] | |
| T5.2 | `npm run build` 成功 | [x] | `out/` 三份产物 |
| T5.3 | 应用启动、Dock/音乐卡片可见 | [x] | 截图见 `docs/verification/` |
| T5.4 | 停靠边切换与参数落盘 | [x] | CDP 触发 bottom/left/top 均正确 |
| T5.5 | 音乐卡片显示真实系统媒体并可控制 | [x] | 真实 Edge 会话双向验证 |
| T5.6 | 回填 `docs/verification.md` | [x] | 含已知限制 |
| T5.7 | 更新 README / 操作指南 | [x] | 含本机兼容性说明 |

## 阶段 6 — 交付（用户验收通过后）

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| T6.1 | 用户验收 | [ ] | 待用户确认 |
| T6.2 | electron-builder 打包（NSIS + `extraResources` 带 ps1） | [ ] | 验收后执行 |
| T6.3 | 开机自启 / 托盘常驻（可选） | [ ] | |

## v0.2 迭代（2026-10-29 用户反馈）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T7.1 | 音乐窗口开关（Dock 音符按钮 + 卡片 ✕ + 设置开关） | [x] | 三者共享 `music.visible`，CDP 实测切换 |
| T7.2 | 音乐时间准确性（LastUpdatedTime 推算 / 时长未知 `--:--`） | [x] | 酷狗与 Edge 双源实测 |
| T7.3 | Dock 自由定位（默认不吸附，可开关） | [x] | 主进程自由坐标 + 设置开关 |
| T7.4 | Dock 背景完全透明（默认 0，可调 0–100%） | [x] | 修复 `setBackgroundMaterial('none')` 黑底问题 |
| T7.5 | 仅在桌面显示（最大化/全屏隐藏） | [x] | UIA 桌面状态桥 + 主进程显隐 |
| T7.6 | 应用可靠启动（shell:AppsFolder/AUMID + 回退与错误提示） | [x] | 计算器实测启动；失败会提示 |
| T7.7 | 应用目录修复（Get-StartApps，186 项） | [x] | 中文名/图标正常，可添加 |
| T7.8 | 配置迁移 v1→v2→v3、PowerShell 编码/环境变量修复 | [x] | 保留用户自定义应用 |
| T7.9 | 人工确认拖动/插入应用/本地播放 | [ ] | 待用户验收 |

## v0.9 迭代（2026-10-30 用户反馈：点击应用无响应/报错/置前无效）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T8.1 | 定位根因：工作区 Low 完整性标签导致应用永远 Low 权限 | [x] | `icacls` 实测；同一 exe 复制到 LOCALAPPDATA 即恢复 Medium |
| T8.2 | `install-local.ps1`：安装到 `%LOCALAPPDATA%\NexusDock` + 桌面快捷方式 + 启动 | [x] | `npm run install:local` / 根目录 `启动 Nexus Dock.cmd` 调用 |
| T8.3 | 启动链路去掉 16~30s 超时误报；已在运行应用不再报错 | [x] | 新增 `LAUNCHED_NO_WINDOW` 状态，正常 1~2.4s 返回 |
| T8.4 | 资源管理器置前排除 `Program Manager`，改按文件夹窗口标题匹配 | [x] | 实测前台 = `OS (C:) - 文件资源管理器` |
| T8.5 | 运行指示点修复（tasklist `.exe` 后缀、UWP 进程名映射、去掉去重计数误判） | [x] | 10/10 点亮 |
| T8.6 | 启动日志 `lowIntegrity` 自检 + 低权限提示 | [x] | `launch.log` 可见 `lowIntegrity=false` |
| T8.7 | 正常权限安装版全量验收（10 应用 + 真实点击/双击 + 指示点） | [x] | 见 `docs/verification.md` v0.9 与 `scripts/out/final-verify2.log` |

## v1.0 迭代（2026-10-30 用户确认：精细化交互设计 / SDD）

> 规格：`docs/spec.md` §7；设计细则：`docs/motion-spec.md`；方案：`docs/plan.md` §12。

### 阶段 9 — 动效基础设施

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T9.1 | `AppearanceConfig` 契约 + 默认值 + sanitize + schemaVersion 4 迁移 | [x] | `shared/types.ts`、`settingsStore.ts`；实测 v3→v4 迁移保留全部旧配置 |
| T9.2 | `motion.css` 动效令牌（时长/曲线/幅度/降级） | [x] | 三档 ×0.72/1/1.28；系统与用户双降级 |
| T9.3 | `shared/motion.ts`：`spawnRipple()` + `playClickSound()` | [x] | 零依赖、DOM 自动清理、尊重降级；音效默认关闭 |
| T9.4 | `useSettings()` 注入 `data-motion/data-reduced-motion/data-click-sound` | [x] | 三窗口自动联动，实测切换即时生效 |
| T9.5 | 通用控件四态精细化（按钮/开关/滑块/分段） | [x] | `ui.css`、`ui.tsx` 涟漪 + 按压 + 焦点环 + 禁用态 |

### 阶段 10 — 三窗口动效

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T10.1 | Dock 按压变形 + 涟漪光晕 + 启动弹跳 | [x] | CDP 实测：data-pressed / nx-ripple 0.42s / nx-launch-bounce 0.42s |
| T10.2 | Dock 悬停光效 + 指示点呼吸 | [x] | 1.31× + 上浮 8px + 强调色柔光；nx-breath 2.6s |
| T10.3 | Dock FLIP 排序过渡 + 入场错峰 + Toast 进出 | [x] | 排序中 6 项非单位位移；toast in 0.18s/out 0.16s |
| T10.4 | 音乐卡片控件：按压/涟漪/播放 morph/切歌微动 | [x] | 真实鼠标 :active + 涟漪；双击 SVG morph；nudge 关键帧 |
| T10.5 | 音乐卡片：进度条跟手 + 封面交叉淡入 + 入场 | [x] | 绝对定位轨道增高不抖高度；双层封面；根节点仅 opacity |
| T10.6 | 设置面板：导航/按钮/列表行四态 + 页面转场 | [x] | `.settings-page` 转场；导航指示条 spring；列表操作涟漪 |
| T10.7 | 设置面板：新增「外观与动效」页 + 效果预览 | [x] | 三档强度/减少动效/点击音效/预览 tile；弹层进出动画 |

### 阶段 11 — 集成验收

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T11.1 | `npm run typecheck` 零错误 | [x] | tsc --noEmit 通过 |
| T11.2 | `npm run build` 成功 | [x] | `out/` 三份产物齐全，v1.0.0 |
| T11.3 | CDP 启动三窗口并截图（按压/涟漪/新设置页） | [x] | `docs/verification/v1/` 11 张截图 + 2 张真实桌面 |
| T11.4 | 计算样式与 data 属性验证（强度切换/减少动效/音效开关） | [x] | `motion-report.json` 17 项检查全通过 |
| T11.5 | 回填 `docs/verification.md` §v1.0 + README 更新 | [x] | 验收记录、任务状态、操作指南均已更新 |

## v1.1 迭代（2026-10-30 用户确认：吸附开关 / 开机自启 / 桌面时钟 / 位置锁定 / SDD）

> 规格：`docs/spec.md` §8（US-11 ~ US-15）；方案：`docs/plan.md` §13。
> 状态标记：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成并验收。
> 验收：`docs/verification.md` §v1.1（`v11-report.json` 31/31 通过，0 运行时异常）。

### 阶段 12 — 契约与文档（Lead）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T12.1 | `Settings` schemaVersion 5：`ClockConfig` / `LockConfig` / `SystemConfig` + `MusicConfig.snapToEdge` | [x] | `src/shared/types.ts`：默认值、sanitize、merge 全部同步；typecheck 0 错误 |
| T12.2 | IPC 契约增量：`system:setAutoStart`、`WindowTarget` 加 clock、`env.isPackaged` | [x] | `types.ts` + `preload/index.ts`；`NEXUS_PACKAGED` 由主进程建窗前注入 |
| T12.3 | 渲染入口：`electron.vite.config.ts` 增加 clock 输入 | [x] | build 产物含 `out/renderer/clock/index.html` + clock 资源 |
| T12.4 | SDD 文档：spec §8 / plan §13 / tasks v1.1 / motion-spec §3.4 | [x] | 规格 26 条 AC；方案含契约/决策/写作用域/验收方法 |
| T12.5 | 配置迁移 v4→v5（旧配置零丢失、音乐自由坐标重置） | [x] | 真实旧配置实测：日志 v4→v5，10 个应用与旧字段保留（verification §v1.1 门禁表） |

### 阶段 13 — 主进程能力（main-core）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T13.1 | `settingsStore.ts`：schemaVersion 5 迁移 + 新分组默认/sanitize + `updateSettings` 深合并扩展 | [x] | 深合并补 clock/lock/system；相同值短路防订阅空转；esbuild 冒烟 36 项断言 |
| T13.2 | `windowManager.ts`：时钟窗口创建/显隐/布局/拖动吸附/位置持久化；`allWindows`/`broadcast`/`destroyWindows` 纳入 clock | [x] | 首次内容尺寸回报后才显示（clockContentSized 门控）；CDP 实测 clock target + 格式/样式 |
| T13.3 | `windowManager.ts`：音乐 `snapToEdge` 拖动分支（吸附 / 自由坐标）+ 开关切换不跳变 | [x] | 自由坐标分支 + 翻转换算；CDP 实测 snapToEdge 往返落盘（E1–E3） |
| T13.4 | 位置锁定：`lock.{dock,music,clock}` → `win.setMovable(!locked)` + `moved` 事件守卫 | [x] | `applyLockState` + 三处 moved 守卫；CDP 实测 data-locked 开/关（D1/D2） |
| T13.5 | `autostart.ts`（新增）：`applyAutoStart` / 启动态同步 / 设置变更同步（仅 `app.isPackaged` 生效） | [x] | 真实 HKCU Run 写入→回读→清理 0 差异（F2–F5）；防递归三层防护 |
| T13.6 | `ipc.ts`：`system:setAutoStart` handler、`window:capture` 支持 clock、Dock 右键菜单加「显示桌面时钟」「锁定全部窗口位置」 | [x] | handler 实测（F2/F3）；菜单项代码审查（原生菜单无法 CDP 触发） |
| T13.7 | `index.ts`：注入 `NEXUS_PACKAGED`、启动时同步自启状态、注册自启订阅、销毁时清理 | [x] | 安装版 env.isPackaged=true（A2），启动同步 + before-quit 清理 |

### 阶段 14 — 渲染层 UI（clock-ui / settings-ui / dock-music-ui）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T14.1 | 时钟窗口：`renderer/clock/{index.html,main.ts,clock.css}` 新增（v1.4 轻量化后入口改为原生 TS DOM `main.ts`，原 `main.tsx` + `ClockWindow.tsx` 已删除） | [x] | 24h/秒/日期/12h/字号/透明度/主题/置顶全部实测（B1–B6）；v1.4 回归见 `docs/verification.md` §v1.4 |
| T14.2 | 时钟窗口：`data-locked` 锁定态（禁用拖动区 + 光标提示）+ 入场淡入 + reduced-motion 降级 | [x] | 锁定时 no-drag + 小锁图标 + title；动效走 motion.css 令牌（D1） |
| T14.3 | 设置导航扩为 7 项（Dock / 音乐 / 时钟 / 应用 / 外观 / 系统 / 关于）+ 图标 | [x] | CDP 实测 7 项文本与顺序（C1）；580×760 不溢出 |
| T14.4 | 设置「时钟」页：显示开关、24h/秒/日期、字号、透明度、主题、置顶、移回默认位置 | [x] | 页面文本/控件实测（C2）；SSR 冒烟 12/12 |
| T14.5 | 设置「系统」页：开机自启（开发模式禁用+提示）、锁定总开关 + 三窗口独立开关 | [x] | 页面文本 + 安装版开关 enabled（C3/F1）；冒烟覆盖全锁/部分锁定推导 |
| T14.6 | 设置「音乐」页新增「自动吸附屏幕边缘」开关与说明 | [x] | 页面开关默认 checked=true、切换同步（C4/E1–E3） |
| T14.7 | Dock：末端新增时钟开关按钮（可见时高亮）+ 手柄锁定态样式 + 右键菜单入口（主进程） | [x] | 按钮/锁定态代码审查 + 锁定截图 dock-locked.png；主进程菜单项已实现 |
| T14.8 | 音乐卡片：`data-locked` 锁定态（关闭整卡拖动区、光标提示） | [x] | music data-locked + app-region no-drag（D1/D2），截图 music-locked.png |

### 阶段 15 — 集成与验收（Lead + verifier）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T15.1 | 集成审查、跨文件一致性、`npm run typecheck` 零错误 | [x] | Lead 审查 settingsStore/autostart/windowManager/ipc/index + 四窗口渲染层；typecheck 0 |
| T15.2 | `npm run build` 成功，产物含 clock 入口 | [x] | 构建成功，四份 renderer 产物齐全 |
| T15.3 | v4→v5 迁移实测（旧配置启动不丢字段） | [x] | 真实用户配置迁移成功（10 应用保留，新组默认值正确） |
| T15.4 | CDP 四窗口运行时验收：时钟显示/样式/锁定 data 属性/设置页 7 项 | [x] | `scripts/v11-verify.mjs` → 31/31 通过，0 异常，注册表清理干净 |
| T15.5 | 截图证据存入 `docs/verification/v1.1/` | [x] | 9 张 PNG + `v11-report.json` |
| T15.6 | 回填 `docs/verification.md` §v1.1 + README + 操作指南 | [x] | 逐条 AC + 人工项 + 已知限制；README v1.1 段；操作指南 v1.1 段 |

## v1.2 迭代（2026-10-30 用户确认：时钟吸附开关 + 窗口行为准则）

> 规格：`docs/spec.md` §9（US-16 / US-17）；准则真源：`docs/window-conventions.md`；方案：`docs/plan.md` §14。

### 阶段 16 — 时钟吸附开关

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T16.1 | 契约：`ClockConfig.snapToEdge` + 默认值/sanitize + schemaVersion 6 | [x] | `src/shared/types.ts`；typecheck 0 错误 |
| T16.2 | 迁移 v5→v6：旧时钟配置（含已记忆位置）保留，`snapToEdge` 补默认 true | [x] | `settingsStore.ts` `migrate`；真实 v5 配置启动日志验证 |
| T16.3 | 主进程：时钟 `moved` 吸附/自由分支 + 开关翻转不跳变 | [x] | `windowManager.ts`；`snapToEdge` 开=吸附最近边，关=写回原始坐标 |
| T16.4 | 设置 UI：「时钟」→「位置」组新增「自动吸附屏幕边缘」开关 + 文案 | [x] | `ClockSection.tsx`；与音乐页开关文案/语义一致 |
| T16.5 | CDP 验收：schemaVersion 6、开关默认值/切换落盘、迁移位置保留、截图 | [x] | `scripts/v12-verify.mjs` → `docs/verification/v1.2/` |

### 阶段 17 — 窗口行为准则与交付

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T17.1 | 新建 `docs/window-conventions.md`：强制能力 C1–C10（含吸附开关默认 true）、DOM/IPC 契约、接入清单、符合性矩阵、豁免流程 | [x] | 准则唯一真源；明确「今后所有悬浮窗口必须提供吸附开关，否则不得合入/发布」 |
| T17.2 | 准则纳入 SDD 引用：spec §4/§9、plan §14、README 文档表、操作指南 | [x] | AC-17.3 |
| T17.3 | 版本与文档：`package.json` 1.2.0、README v1.2 段、操作指南 v1.2 段 | [x] | 安装版 About 显示 v1.2.0 |
| T17.4 | 构建门禁 + 安装版更新 + 运行时验收 + 回填 `docs/verification.md` §v1.2 | [x] | typecheck/build 0 错误；CDP 报告 0 失败 |

## v1.3 迭代（2026-10-30 用户确认：设置信息架构重构）

> 规格：`docs/spec.md` §10（US-18 / US-19）；准则：`docs/window-conventions.md` §2/§2.1；方案：`docs/plan.md` §15。

### 阶段 18 — 契约、行为与设置 UI 重构

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T18.1 | 契约：`music.alwaysOnTop/onlyOnDesktop`、`clock.onlyOnDesktop` + schemaVersion 7 + sanitize | [x] | `src/shared/types.ts`；默认值保留旧观感 |
| T18.2 | 迁移 v6→v7：旧配置零丢失，新字段补默认值 | [x] | `settingsStore.migrate`；真实旧配置启动验证 |
| T18.3 | 主进程：音乐始终置顶（创建/变更联动）+ `applyFloatingVisibility()` 三窗口「仅在桌面显示」 | [x] | `windowManager.ts`；用户主动隐藏的窗口不受影响 |
| T18.4 | 系统页重构：「窗口共性设置」+ 三个默认折叠窗口栏（摘要/五项设置/移回默认位置） | [x] | `SystemSection.tsx` + `settings.css` |
| T18.5 | 窗口页瘦身：Dock/音乐/时钟移除共性项，仅留独有特性 + 提示 | [x] | `DockSection/MusicSection/ClockSection` |
| T18.6 | 准则更新：C11 仅在桌面、C12 移回默认位置、§2.1 信息架构规则、v1.3 矩阵 | [x] | `docs/window-conventions.md` |

### 阶段 19 — 文档、构建与验收

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T19.1 | SDD 文档：spec §10 / plan §15 / tasks v1.3 / README / 操作指南 / 版本 1.3.0 | [x] | 交叉引用准则 |
| T19.2 | 构建门禁：`npm run typecheck` 0 错误、`npm run build` 成功 | [x] | 安装版更新到 v1.3.0 |
| T19.3 | CDP 验收 `scripts/v13-verify.mjs`：折叠栏默认收起/摘要/展开、五项设置、页面归属、字段迁移、复位、回归 | [x] | `docs/verification/v1.3/v13-report.json` + 截图 |
| T19.4 | 回填 `docs/verification.md` §v1.3 + 任务状态 + 重启正常实例 | [x] | 用户配置全程快照还原 |

## v1.3.1 修复（2026-11-01 用户反馈：Dock 唤起要保留窗口状态）

> 规格：`docs/spec.md` §11（US-20）；方案：`docs/plan.md` §16。

### 阶段 20 — 唤起保持窗口显示状态

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T20.1 | 定位根因：`Activate-Win` 无条件调用 `ShowWindow(9)`（SW_RESTORE）把最大化窗口还原 | [x] | `src/main/apps.ts`；现象为「先最大化出现、随后变普通」 |
| T20.2 | 修复：仅窗口最小化时 `SW_RESTORE`；最大化/普通窗口只 `BringWindowToTop`+`SetForegroundWindow`，保持状态 | [x] | C# 辅助类补 `IsIconic`/`IsZoomed`；置前兜底链保留 |
| T20.3 | 验收脚本 `scripts/v131-verify.mjs`：独立 WinForms fixture 覆盖最大化保持/最小化恢复/普通保持/首启置前/apps 恢复 | [x] | `docs/verification/v1.3.1/v131-report.json`；10/10 通过、0 运行时异常 |
| T20.4 | 文档与版本：spec §11、plan §16、tasks v1.3.1、verification §v1.3.1、README、操作指南、`package.json` 1.3.1 | [x] | 安装版 About/footer 显示 v1.3.1 |

## v1.4 迭代（2026-11-01 用户确认：内存占用轻量化 / SDD）

> 目标：消除「常驻 PowerShell 桥」的约 199MB 与时钟渲染进程的 React 运行时开销；量化验收 `docs/verification.md` §v1.4，工具 `scripts/mem-probe.ps1` / `scripts/v14-verify.mjs`。

### 阶段 21 — 桥与主进程轻量化（bridge-optimizer）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T21.1 | SMTC 桥按需启停（`mediaHub.ts` + `index.ts`）：仅 `music.visible && source='system'` 时拉起，关闭即 kill 并广播空状态，500ms 去抖 | [x] | v14 实测：音乐开启 powershell 3→4、关闭 4→3 |
| T21.2 | 桌面状态桥原生化：`resources/desktop-state.cs` → `desktop-state.exe`（C# P/Invoke，协议不变，exe 缺失回退 ps1；采样 400→800ms；仅 `onlyOnDesktop` 任一开启时运行） | [x] | 原生桥工作集 14.2MB（原 ps1 ≈104.4MB） |
| T21.3 | 运行态检测 `tasklist` 轮询 4s → 10s | [x] | 每天少 spawn 约 1.3 万次 |
| T21.4 | Chromium 轻量化开关（`app ready` 前）+ `NEXUS_LOW_END=1` 关闭硬件加速 | [x] | 低配采样 GPU 123.7 → 59.0MB |
| T21.5 | 内存自测：`diagnostics.ts`（`NEXUS_MEM_REPORT` / `mem-report.on` 标记 → 5s 采样 `app.getAppMetrics()` 写 `logs\memory.jsonl`，默认零成本） | [x] | 采样数据支撑 §v1.4 量化表 |
| T21.6 | 探针 `scripts/mem-probe.ps1`（启动前后 PID 差集归因桥进程） | [x] | 产出 `scripts/out/mem-probe.jsonl` |

### 阶段 22 — 渲染层轻量化（renderer-slimmer）

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T22.1 | 时钟去 React：`renderer/clock/main.ts` 原生 TS DOM（删除 `main.tsx` / `ClockWindow.tsx`），保留 DOM 契约与 C6/C7/C10 | [x] | clock 入口 9,994B，不再加载 569,942B `jsx-runtime`；验收 `usesReact=false` |
| T22.2 | music/clock `backgroundThrottling: true`（Dock 保持 false）；时钟隐藏停走时、可见即补 | [x] | 隐藏窗口降频，重新可见立即刷新 |
| T22.3 | 渲染层常驻定时器/监听清理：音乐进度 rAF 可见性门控、删除死代码 `useSmoothProgress`、`useContentSize` 可见补量 | [x] | renderer 仅剩 clock 一个 interval；typecheck 0 错误 |

### 阶段 23 — 验收、文档与版本

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T23.1 | `scripts/v14-verify.mjs` CDP 验收：时钟 DOM/时间/走时、Dock 11 项、SMTC 桥启停、音乐/设置窗口 | [x] | `docs/verification/v1.4/v14-report.json` 17/17 PASS |
| T23.2 | 人工/端到端 C11 + 内存三组采样 + 截图 | [x] | 656.0 → 473.4（-27.8%）；低配 421.1（-35.8%）；7 张截图 + 报告 |
| T23.3 | 构建门禁：`npm run typecheck` 0 错误、`npm run build` 成功 | [x] | 安装版更新至 v1.4.0 |
| T23.4 | 文档与版本：README v1.4、操作指南「内存占用与轻量化」、`docs/verification.md` §v1.4、tasks v1.4、`package.json` 1.4.0 | [x] | 验收报告与证据目录交叉引用 |

## v1.4.1 修复（2026-11-01 用户反馈：点击 Dock 里的 DockApp 图标要打开设置）

> 规格：`docs/spec.md` §12（US-21）；方案：`docs/plan.md` §17；验收：`docs/verification.md` §v1.4.1（`scripts/v141-verify.mjs`）。

### 阶段 24 — 自身图标打开设置

| ID | 任务 | 状态 | 说明 |
|---|---|---|---|
| T24.1 | 定位根因：自身图标指向本程序 exe，`launchAndFocus` 的「已有窗口优先」按进程名命中同一程序的「Nexus 时钟」窗口，不启动第二实例 → `second-instance` 不触发 | [x] | `src/main/apps.ts`：`$selfTitles` 漏 `Nexus 时钟`；现象为「点 DockApp 图标设置不出现」 |
| T24.2 | 契约级识别：`isSelfApp(item)` 用 `app.getPath('exe')` / `process.execPath` 规范化比对 `path` / `aumid`，`.lnk` 经 `shell.readShortcutLink` 解析目标 | [x] | 命中后 `launchApp` 直接 `openSettingsWindow()` 并返回 `{ ok: true }`，不再启动进程 |
| T24.3 | 置前脚本兜底：`$selfTitles` 增加 `Nexus 时钟`，四个自身窗口标题齐全，自窗口一律不当目标窗口 | [x] | 即使入口判断失效也不会把时钟窗口当成「应用已打开」 |
| T24.4 | 验收脚本 `scripts/v141-verify.mjs`：真实鼠标左键点击打开设置并聚焦 / 已存在则前置不重复创建 / 右键「打开」/ `.lnk` 与 aumid 指向自身 / 非自身不误判 / 二次启动单实例 | [x] | 见 `docs/verification.md` §v1.4.1 |
| T24.5 | 构建门禁：`npm run typecheck` 0 错误、`npm run build` 成功；安装版更新至 v1.4.1 | [x] | 见 `docs/verification.md` §v1.4.1「构建与安装门禁」 |
| T24.6 | 文档与版本：spec §12、plan §17、tasks v1.4.1、README、`docs/verification.md` §v1.4.1、`package.json` 1.4.1 | [x] | README「v1.4.1 修复」段与文档表交叉引用 |


---

## v1.5 迭代（2026-11-01 用户确认：稳定性 / 交互打磨 / 工程化 + 托盘图标）

> 用户决策：四个方向全选（稳定性优先、交互与视觉打磨、工程化与可维护性、补齐核心功能），功能只做「托盘图标 + 右键菜单」；交付方式 = 重建 + 重装 + 重启真机验证。
> 验收：`docs/verification.md` §v1.5（自动化 9/9 + 溢出压力 5/5）。

### 阶段 25 — v1.5 交付

| # | 任务 | 归属 | 文件 | 状态 |
|---|---|---|---|---|
| 25.1 | 基线纳入版本控制（此前无 git，改坏无法回滚） | lead | `.gitignore` / 基线提交 | ✅ |
| 25.2 | 托盘图标资源（16/24/32/64，含 HiDPI 表示） | lead | `resources/tray-*.png` | ✅ |
| 25.3 | 托盘 + 右键菜单（单击显隐 Dock / 双击设置 / 完整菜单 / 失败降级） | lead | `src/main/tray.ts`、`src/main/index.ts` | ✅ |
| 25.4 | Dock 显隐 API + 宽度夹紧 + 渲染进程崩溃自愈 + 设置窗崩溃重建 | lead | `src/main/windowManager.ts` | ✅ |
| 25.5 | 窗口加固（拦截导航 / window.open / webview） | lead | `src/main/windowManager.ts` | ✅ |
| 25.6 | `dock:snap` 死通道补 handler + Dock 右键菜单「隐藏 Dock」 | lead | `src/main/ipc.ts` | ✅ |
| 25.7 | 开机自启改用 `PORTABLE_EXECUTABLE_FILE` | lead | `src/main/autostart.ts` | ✅ |
| 25.8 | 渲染层兜底：设置加载失败卡片 + 重试 + ErrorBoundary + 乐观补丁/120ms 合并落盘 | lead | `src/renderer/shared/hooks.ts`、`ErrorBoundary.tsx`、三个 `main.tsx`、`SettingsApp.tsx` | ✅ |
| 25.9 | 设置保存/加载失败提示条样式 | lead | `src/renderer/settings/settings.css` | ✅ |
| 25.10 | 桥稳定性：统一日志（1MB 轮转）+ 桌面状态桥崩溃循环冷却 + SMTC 桥 ready 清零/看门狗 | main-hardening | `src/main/logger.ts`、`desktopState.ts`、`media/smtcBridge.ts`、`apps.ts` | ✅ |
| 25.11 | Dock 渲染层：溢出滚动 + 空状态 + 键盘菜单/roving + 命中区 + 对比度 + 加载失败卡片 | dock-ui | `Dock.tsx`、`DockItemView.tsx`、`dock.css`、`theme.css` | ✅ |
| 25.12 | 音乐卡片：浅色主题（schemaVersion 7→8）+ 空闲不扫光 + aria/键盘 + ring seek + 失败提示 + 空列表修复 + 选文件来源顺序 | music-ui | `MusicCard.tsx`、`music.css`、`LocalPlayer.ts`、`types.ts`、`MusicSection.tsx` | ✅ |
| 25.13 | 设置面板：Dock 复位空操作、锁定三态 x/3、恢复默认应用列表改名、排序/移除反馈与二次确认、亚克力文案 | settings-ux | `SystemSection.tsx`、`AppsSection.tsx`、`DockSection.tsx` | ✅ |
| 25.14 | 工程化：`npm test`（12 项契约单测）、`npm run check`、版本号 1.5.0、dist 脚本与 portable 对齐 | lead | `tests/`、`package.json` | ✅ |
| 25.15 | 安装脚本修正：同步 `resources/`（托盘图标）与 app manifest，manifest 无 BOM | lead | `scripts/install-local.ps1` | ✅ |
| 25.16 | 自动化验收脚本（CDP 9 项 + 溢出压力 5 项） | lead | `scripts/v15-verify.mjs`、`scripts/v15-overflow-check.mjs` | ✅ |
| 25.17 | 文档：README v1.5、操作指南（托盘/FAQ/参数表校正）、verification §v1.5、本任务表 | lead | `README.md`、`操作指南.md`、`docs/verification.md`、`docs/tasks.md` | ✅ |

### 验收结论与遗留

- 自动化：9/9（版本/迁移/托盘/渲染层/键盘/命中区/dock:snap/音乐卡片/设置面板/日志轮转）+ 5/5（溢出夹紧/滚动/末端可达/还原）。
- 真机：安装版已重装并重启，用户配置零丢失（11 应用 / 三窗口锁定 / Dock 自由坐标全保留，仅 `music.theme` 补默认值、schema 7→8）。
- 需人工确认：托盘图标视觉与单击/双击手感、拖动吸附手感、锁定不可拖、开机自启真实登录行为、动效主观手感。
- 明确不做（登记在 verification.md §v1.5.6）：Dock 自动隐藏、应用搜索/全局热键、拖拽添加应用、UWP 图标与运行点、启动链路去 UIA、多显示器选屏。
