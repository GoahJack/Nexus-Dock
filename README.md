# Nexus Dock

Nexus 风格的 Windows 桌面美化工具：**位置可调的悬浮 Dock** + **音乐显示卡片**。

- 技术栈：Electron 44.7 + React 19 + TypeScript 7 + Vite 8（electron-vite 构建）
- 平台：Windows 10 1809+ / Windows 11
- 音乐数据：Windows 系统媒体会话（SMTC，任意播放器）+ 内置本地播放器

## 快速开始

```powershell
npm install
npm run dev
```

启动后：屏幕底部出现 Dock，右上出现音乐卡片。桌面时钟默认隐藏，点击 Dock 末端时钟按钮（或设置 →「时钟」）即可显示。右键 Dock →「Dock 设置」可打开设置面板。**系统托盘**有常驻图标（单击显示/隐藏 Dock、双击打开设置、右键完整菜单）。

> 验收 / 日常使用请用安装版（自动安装到 `%LOCALAPPDATA%\NexusDock`，以正常权限运行）：
>
> ```powershell
> npm run build
> npm run install:local   # 或直接双击根目录「启动 Nexus Dock.cmd」
> ```

## v1.5 更新（2026-11-01）

> 当前版本：**v1.5.0**（`package.json`）；口径：规格 §13、任务阶段 25、验收 `docs/verification.md` §v1.5。
> 主题：**托盘找回入口 + 稳定性（日志/崩溃自愈/桥治理）+ 交互可访问性 + 工程化门禁**。共 21 个文件改动（+1,885/−271），9 个自动化验收项 + 5 个溢出压力项全部通过。

### 新增：系统托盘（解决「关掉 Dock 就找不回」）

- Dock 是主窗口（关掉即退出），且应用 `skipTaskbar` 不进任务栏；旧版本一旦窗口异常（设置窗跑到屏幕外、Dock 被「仅在桌面显示」隐掉），用户没有任何找回入口（FAQ Q6 只能建议删 `settings.json`）。
- 托盘图标（`resources/tray-16/24/32/64.png`，含 1.5x/2x/4x 表示）：**单击 = 显示/隐藏 Dock**，**双击 = 打开设置**，右键菜单 = 打开设置 / 显示·隐藏 Dock / 吸附到最近屏幕边 / 重载 Dock / 音乐卡片 / 桌面时钟 / 锁定全部窗口 / 开机自启 / 版本 / 退出。
- Dock 右键菜单同步新增「隐藏 Dock（托盘可恢复）」；隐藏走 `hide()` 而非关窗，不触发退出。
- 图标缺失或托盘创建失败只记日志，不影响 Dock/音乐卡片（`src/main/tray.ts`）。

### 修复：真实 bug（均有日志或复现证据）

| 问题 | 根因 | 修复 |
|---|---|---|
| 删掉最后一个 Dock 图标，6 个内置应用全回来 | `sanitizeSettings` 把「合法空数组」当「数据缺失」回退默认值 | 区分 `undefined` 与 `[]`；空列表现在是合法状态 |
| 音乐卡片累计 5 次崩溃后永久空白 | SMTC 桥重启计数只在「ready 且存活 >30s」时清零，实际永远活不到 30s | ready 即清零退避；新增 15s 看门狗兜底重拉 |
| 桌面状态桥崩溃后无限 1s 级重启刷屏 | 无崩溃循环治理 | 60s 内 ≥5 次失败 → 60s 降级冷却，日志收敛 |
| 渲染进程崩溃后 Dock/音乐卡片永久白屏、设置窗「点不开」 | `render-process-gone` 只打日志；设置窗只判 `isDestroyed()` | 四个窗口统一自愈重载（60s 内最多 3 次，之后 10s 慢重载）；设置窗崩溃即销毁重建 |
| Dock 的「移回默认位置」在开启吸附时是空操作 | 复位只写 `freeX/freeY`，但吸附模式完全忽略它们 | 复位改为「先关吸附、再置 edge=bottom/along=50/freeX/freeY=-1」两步 |
| `window.nexus.dock.snap()` 必定 reject | 契约与 preload 都声明了 `dock:snap`，主进程从没注册 handler | 补上 handler（托盘菜单「吸附到最近屏幕边」也用它） |
| 开机自启指向 portable 临时解包目录，重启后失效 | 用 `process.execPath`，portable stub 解包目录退出即删 | 优先使用 `PORTABLE_EXECUTABLE_FILE` |
| 选「本地音频」会偷偷改掉来源 | 弹框后被动写入 `source:'local'` | 先切来源再弹框，取消也有提示，控件与真实配置始终一致 |
| 设置加载失败 → 永久空白透明 Dock | `settings.get()` 无 `.catch`，`settings` 永远是 null | 加载失败显示可读错误卡片 + 重试；三个渲染入口加 ErrorBoundary |
| 滑块每拖一像素发一次 IPC | `onChange` 直接 `await patch()` | 乐观更新 + 120ms 合并落盘；保存失败在设置页顶部提示并可重试 |

### 交互与可访问性

- **Dock 溢出可用**：图标多/尺寸大时主进程把窗口夹紧到工作区，渲染层 `.dock-items` 改内部滚动（隐藏滚动条 + 滚轮驱动 + 两端渐隐），末端音乐/时钟开关始终可见；拖拽落点已计入 `scrollLeft`，支持拖到边缘自动滚动（25 图标 × iconSize 80 压力验证：窗口 1684px ≤ 工作区，maxScroll 1293px）。
- **键盘可用**：方向键在图标间移动焦点（roving tabindex）、`ContextMenu` / `Shift+F10` 打开应用菜单（旧版只能右键鼠标）；空列表显示「添加应用」空状态。
- **命中区**：Dock 末端开关最小 24px（原 18px），圆角/指示点按 `--dock-icon-size` 比例派生；音乐卡片选文件按钮 20→24px。
- **对比度**：`--nx-text-faint` 0.38 → 0.55（11px 提示文字 ~3.3:1 → ~4.6:1）。
- **音乐卡片**：新增浅色主题（`data-theme`，与 Dock/时钟同套令牌，schemaVersion 7→8 迁移零丢失）；空闲态不再无限扫光（只有「播放中且时长未知」才扫）；环形进度样式不再丢失 seek 能力；进度条给读屏完整 `aria-valuetext`（原来是裸毫秒数）且不再被移出 Tab 序；媒体控制/选文件/切来源失败在卡片内提示。
- **设置面板**：锁定总开关显示 `/3` 三态、「恢复默认图标」正名为**「恢复默认应用列表」**并明确破坏性、排序/移除有成功反馈且移除有二次确认、亚克力开关文案说明 Win11 22H2+ 限制、Dock 主题浅色下的次要文字一并提亮。

### 工程化

- **最小自动化门禁**：`npm test` = 12 个 `node --test` 纯函数契约测试（设置夹紧/枚举回退/空列表/深合并/schema 幂等/IPC 通道唯一性/托盘图标资源合法性），不需要 Electron；`npm run check` = typecheck + test。
- **`scripts/v15-verify.mjs`**：安装版 + CDP 的 9 项验收（版本/迁移/托盘/渲染层/键盘/命中区/`dock:snap`/音乐卡片/设置面板/日志轮转），产物 `docs/verification/v1.5/v15-report.json` + 截图。
- **`scripts/v15-overflow-check.mjs`**：25 图标溢出压力测试（夹紧/滚动/末端可达/还原），产物 `overflow-report.json`。
- **`scripts/install-local.ps1` 修正**：旧版只同步 `out/`，新增的 `resources/`（托盘图标、桥脚本）和 `package.json` 版本号永远不会装进去 → 现在一并同步；manifest 改为**无 BOM** UTF-8 写入（带 BOM 会让 Electron 解析 package.json 失败并静默退出）。
- **窗口加固**：四个窗口统一拦截导航 / `window.open` / `<webview>`，本地页面之外一律拒绝（纵深防御）。
- **日志轮转**：`logs/*.log` 单文件 1MB 上限，超限轮转为 `.log.1`（只留 1 个备份）。
- **启动错峰**：`hydrateIcons` / `probeEnvironment` / `cleanupErrorDialogs`（各会拉起 1–2 个 PowerShell）推迟到界面首帧之后执行，减少启动抢 CPU。
- **版本控制**：仓库此前没有 git（改坏无法回滚），现已初始化并提交 v1.4.1 基线 + v1.5.0。

**已知未做（本轮范围外，按证据登记）**：Dock 自动隐藏、应用搜索/全局热键、拖拽 `.exe/.lnk` 入 Dock、UWP 应用图标与运行指示、启动链路去 UIA 提效、多显示器选屏。详见 `docs/verification.md` §v1.5.4。


## v1.4.1 修复（2026-11-01）

> 当前版本：**v1.4.1**（`package.json`）；补丁文档：规格 §12、方案 §17、验收 `docs/verification.md` §v1.4.1。

- **Dock 自身图标点开即设置**：修复「点 Dock 栏里的 DockApp 软件图标不会打开设置栏」。根因是该图标指向 Nexus Dock 自己的 exe（`%LOCALAPPDATA%\NexusDock\NexusDockApp.exe`），点击先走「已有窗口优先」置前逻辑；它按进程名匹配窗口，把同一程序（exe 同名）的「Nexus 时钟」窗口误当成目标应用，于是只把时钟置前、不启动第二个实例，也就不会触发 `second-instance` → 打开设置。
- **修复**：`launchApp` 新增「自身图标」识别——用当前进程 exe 路径（`app.getPath('exe')` / `process.execPath`）规范化比对条目 `path` / `aumid`，`.lnk` 快捷方式经 `shell.readShortcutLink` 解析目标；命中直接打开设置面板并返回成功，不再启动新进程。置前脚本的自身窗口名单补上 `Nexus 时钟`，自窗口一律不当成目标窗口（双保险）。
- **不变**：非自身应用的启动 / 置前 / 失败提示链路不变；Windows「设置」等系统应用不会因名称被误判为自身；单实例锁与 `second-instance` → 打开设置的行为保留（桌面快捷方式二次启动仍打开设置）。
- 验收：`node scripts/v141-verify.mjs`（安装版 + CDP 9224）；逐条 AC 与证据见 `docs/verification.md` §v1.4.1。

## v1.4 轻量化（2026-11-01）

> 当前版本：**v1.4.0**（`package.json`）；文档：验收 `docs/verification.md` §v1.4、任务 `docs/tasks.md` v1.4。

**内存（工作集 MB，`scripts/mem-probe.ps1` 实测，进程归因来自 `app.getAppMetrics()`）**：v1.3.1 基线 **656.0** → v1.4 默认 **473.4（-182.6，-27.8%）**；低配模式（`NEXUS_LOW_END=1`）**421.1（-234.9，-35.8%）**。收益主要来自常驻 PowerShell 桥：基线两个桥合计 198.6MB → 现在 1 个原生 `desktop-state.exe` 14.2MB。

- **SMTC 桥按需启停**：只有「音乐卡片显示 + 来源=系统媒体」时才拉起 `smtc-bridge.ps1`；关闭卡片立即结束子进程并广播空状态（约 100MB），设置变更有 500ms 去抖防反复启停。
- **桌面状态桥原生化**：新增 C# 原生助手 `resources/desktop-state.exe`（9.7KB，P/Invoke 读前台窗口/最大化/全屏/工作区），替代 PowerShell + UI Automation 版（约 100MB）；JSON Lines 协议与旧 `.ps1` 一致，找不到 exe 或启动失败自动回退 `.ps1`；采样 400ms → 800ms，且仅当任一窗口开启「仅在桌面显示」时运行。
- **时钟渲染层去 React**：改为原生 TS DOM（`renderer/clock/main.ts`，替代 `main.tsx` + `ClockWindow.tsx`）。clock 页面入口 JS 约 10KB（另有 0.8KB 共享模块），不再加载约 570KB 的 react-dom 共享 chunk；`data-locked` / `data-theme` / `.clock-time` / `.clock-date` / `.clock-period` / title+aria 等 DOM 契约全部保留。
- **隐藏窗口降频**：音乐卡片 / 时钟恢复默认 `backgroundThrottling: true`（隐藏时降低渲染频率，重新可见立即补帧/补时）；Dock 保持不节流，保证悬停放大手感。
- **轮询降频**：运行状态检测 `tasklist` 轮询 4s → 10s（每天少 spawn 约 1.3 万次）。
- **Chromium 轻量化开关**：`app ready` 前追加 `--disable-background-networking`、`--disable-component-update`、`--disable-domain-reliability`、`--disable-sync`、`--disable-breakpad`；不影响透明窗口与动效。
- **内存自测工具**：`src/main/diagnostics.ts` 按需采样 `app.getAppMetrics()` 写入 `logs\memory.jsonl`（默认零成本）+ `scripts/mem-probe.ps1` 一键对比探针。

**自查内存**（安装版）：

```powershell
# 方式一：应用内采样。在 %APPDATA%\nexus-dock 新建空文件 mem-report.on，
#         采样每 5s 写入 %APPDATA%\nexus-dock\logs\memory.jsonl（NEXUS_MEM_INTERVAL 可调）
# 方式二（推荐）：探针自动创建标记文件、启动前后按 PID 差集归因桥进程
powershell -File scripts/mem-probe.ps1 -Label baseline
powershell -File scripts/mem-probe.ps1 -Label low-end -EnvPairs 'NEXUS_LOW_END=1'
```

**低配模式**：设置环境变量 `NEXUS_LOW_END=1` 后启动（开发态 `$env:NEXUS_LOW_END='1'; npm run dev`；安装版用 `set NEXUS_LOW_END=1` 的 cmd 包装启动，或直接用上面探针脚本试跑）。该模式关闭硬件加速，GPU 内存约 124MB → 59MB；透明窗口与动效仍可用，动画改由 CPU 合成，低端机可能略掉帧，默认不开启。

**验收**：`node scripts/v14-verify.mjs`（安装版 + CDP 9224）→ 17/17 通过；报告与截图见 `docs/verification/v1.4/`。

## v1.3.1 修复（2026-11-01）

> 当前版本：**v1.3.1**（`package.json`）；补丁文档：规格 §11、方案 §16、验收 `docs/verification.md` §v1.3.1。

- **Dock 唤起应用保持窗口状态**：修复「已最大化的应用从 Dock 点开时先最大化出现、随后被还原为普通窗口」的问题。根因是置前逻辑无条件调用 `ShowWindow(SW_RESTORE)`；现在只有窗口最小化时才恢复，最大化/普通窗口只置前、不改变显示状态。最小化窗口恢复后也会回到最小化前的最大化状态。
- 验收：`node scripts/v131-verify.mjs` 用独立测试窗口覆盖最大化/最小化/普通三种路径，10/10 通过，证据见 `docs/verification/v1.3.1/`。

## v1.3 更新（2026-10-30）

> 当前版本：**v1.3.0**（`package.json`）；本轮 SDD 文档：规格 §10、方案 §15、任务 v1.3、验收 `docs/verification.md` §v1.3。

- **设置信息架构重构**：把「自动吸附屏幕边缘」「始终置顶」「仅在桌面显示」「位置锁定」「移回默认位置」等**共性项统一收进「系统」页**的「窗口共性设置」；按 Dock / 音乐卡片 / 桌面时钟三个**默认收起的折叠栏**单独管理，标题行显示状态摘要（吸附/置顶/仅在桌面/锁定）。各窗口页面只保留独有特性（Dock=停靠边/图标/背景/主题；音乐=来源/宽度/进度/位置模式；时钟=显示内容/字号/透明度/主题）。
- **共性能力补齐**：音乐卡片新增「始终置顶」「仅在桌面显示」，桌面时钟新增「仅在桌面显示」，三窗口能力一致；默认值保留现有观感（Dock 仅在桌面默认开，音乐/时钟默认关，音乐默认置顶）。
- **行为实现**：音乐卡片置顶开关即时生效；Dock/音乐/时钟的「仅在桌面显示」在前台窗口最大化/全屏时自动隐藏、回到桌面恢复（不覆盖用户主动隐藏的窗口）。
- **配置迁移**：`schemaVersion 6 → 7`，旧配置零丢失。
- 准则同步更新：[window-conventions.md](docs/window-conventions.md) 新增 C11「仅在桌面显示」、C12「移回默认位置」与 §2.1 设置信息架构规则。

## v1.2 更新（2026-10-30）

> 当前版本：**v1.2.0**（`package.json`）；本轮 SDD 文档：规格 §9、方案 §14、任务 v1.2、验收 `docs/verification.md` §v1.2。

- **桌面时钟吸附开关**：设置「时钟」→「位置」组新增「自动吸附屏幕边缘」。默认开启（保持旧行为）；关闭后时钟拖到哪停在哪并记忆坐标，重新开启立即吸附最近屏幕边、切换不跳变。
- **窗口行为准则**：新增 [docs/window-conventions.md](docs/window-conventions.md) —— 把「自动吸附屏幕边缘开关（默认开）」「位置记忆」「位置锁定」「显示开关」「统一动效」「配置迁移」「窗口接入与验收」列为**今后所有悬浮窗口的强制能力**，并给出 C1–C10 清单、DOM/IPC 契约、新窗口接入检查清单、当前窗口符合性矩阵与豁免流程。新窗口未满足准则不得合入/发布。
- **配置迁移**：`schemaVersion 5 → 6`，旧时钟配置（含已记忆位置）完整保留，`clock.snapToEdge` 补默认 `true`。
- 准则已纳入 SDD 流程：`docs/spec.md` §4/§9 引用，今后新增窗口按准则逐项验收。

## v1.1 新功能（2026-10-30）

> 当前版本：**v1.1.0**（`package.json`）；本轮 SDD 文档：规格 §8、方案 §13、任务阶段 12–15、验收 `docs/verification.md` §v1.1。

- **音乐窗口吸附开关**：设置 →「音乐」新增「自动吸附屏幕边缘」。关闭后拖动卡片停在哪里就是哪里并记住坐标；重新开启立即恢复吸附最近边（默认开启，保持 v1.0 行为，切换过程不跳变）。
- **开机自启**：设置 →「系统」一键写入 / 移除 Windows 当前用户登录启动项。以操作系统登录项为唯一真源：启动时回读校正设置，写入失败自动回滚并显示原因；仅安装版生效，开发模式开关禁用并提示。
- **桌面时钟**：新增可独立开关的数字时钟悬浮窗（默认隐藏，隐藏时零渲染开销）。入口：Dock 末端时钟按钮 + 设置「时钟」页。支持 24/12 小时制、显示秒、显示日期、字号 28–96、整体透明度、深浅主题、始终置顶；可拖动、松手吸附屏幕边缘、位置持久化，「移回默认位置」一键复位。
- **窗口位置锁定**：Dock / 音乐卡片 / 时钟三窗口可锁定位置。设置 →「系统」提供「锁定全部窗口位置」总开关（按三者是否全锁推导）与三个独立开关（可单独覆盖）；锁定生效为双层防护——渲染层拖动区 `no-drag` + 主进程 `setMovable(false)`，并显示锁定图标/光标提示；Dock 右键菜单可快捷锁定/解锁；设置窗口不受影响。
- **配置迁移**：`schemaVersion 4 → 5` 平滑升级，新增 `clock` / `lock` / `system` 三组，旧配置零丢失（音乐自由坐标重置为「未定位」标记，避免关闭吸附后位置跳变）。
- 验收记录见 [docs/verification.md](docs/verification.md) §v1.1；四窗口动效仍统一由 [docs/motion-spec.md](docs/motion-spec.md) 约束（时钟见 §3.4）。

## v1.0 精细化交互（2026-10-30）

> 当前版本：**v1.0.0**（`package.json`）；本轮 SDD 文档：规格 §7、方案 §12、任务阶段 9–11、动效规范 `docs/motion-spec.md`、验收 `docs/verification.md` §v1.0。

- **统一动效体系**：以 Apple Dock 物理回弹风格为基准，三窗口共用一套 CSS 令牌（时长 / 曲线 / 幅度），定义见 [docs/motion-spec.md](docs/motion-spec.md)。
- **按压与光晕**：Dock 图标、音乐卡片按钮、设置面板按钮/列表操作按下即缩小回弹，并以点击位置为圆心扩散强调色光晕（独立图层，不改变布局）。
- **启动反馈**：点击 Dock 图标立即弹跳一次（乐观反馈），启动失败仍走原有 toast；新增 Toast 进出动画。
- **Dock 手感**：悬停强调色柔光、运行指示点呼吸、拖拽排序 FLIP 平滑过渡、图标错峰入场。
- **音乐卡片**：播放/暂停图标形变、上一首/下一首方向微动、进度条 hover/拖拽跟手发光、封面双层交叉淡入。
- **设置面板**：导航/按钮/开关/滑块/分段/应用列表四态精细化，页面切换淡入转场，弹层与确认条进出动画。
- **外观与动效设置**：设置面板新增「外观」页——动效强度（轻快 / 标准 / 弹性）、减少动效、点击音效（默认关）、效果预览；配置持久化并兼容旧配置（schemaVersion 3 → 4）。
- **可访问性**：遵循系统 `prefers-reduced-motion`，用户也可强制「减少动效」（全部动画收敛至 0.01ms）。
- 验收记录见 [docs/verification.md](docs/verification.md) §v1.0；证据在 `docs/verification/v1/`。

## 本次修复（v0.9，2026-10-30）

- **根因**：DSH 工作区沙箱给工作区内文件打了 Low 完整性标签，Windows 会把从这些文件启动的进程降为 Low 权限；Low 权限下无法启动 UWP（记事本/计算器/画图/设置）、无法把窗口置前、`ms-settings:` 报拒绝访问，旧链路因此每次点击都等 16~30 秒后弹错误提示。
- **修复**：`npm run install:local` 把打包产物安装到 `%LOCALAPPDATA%\NexusDock`（无 Low 标签，正常权限，Electron 沙盒可正常工作，不再需要 `--no-sandbox`）；启动链路不再把“窗口暂时未出现/应用已在运行”误报为失败；资源管理器改为匹配文件夹窗口并置前；运行指示点修正 tasklist `.exe` 后缀与 UWP 进程名映射；启动日志新增 `lowIntegrity=true/false` 自检。
- 详见 [操作指南.md](操作指南.md) 末节与 [docs/verification.md](docs/verification.md) v0.9 验收记录。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式（入口 `scripts/dev.ps1`：清宿主环境变量 + `--noSandbox` + 远程调试 9222） |
| `npm run build` | 构建到 `out/` |
| `npm run typecheck` | 全量类型检查 |
| `npm test` | 共享契约单元测试（Node 内置 test runner，12 项，不需要 Electron） |
| `npm run check` | `typecheck` + `test`（提交前门禁） |
| `npm run dist` | 打包 Windows 便携版到 `dist/`（electron-builder 配置为 **portable** 单文件 exe；如需 NSIS 安装包请先在 `package.json` 的 `build.win.target` 增加 `nsis`） |
| `powershell -File scripts/start.ps1` | 启动已构建产物（试用/验收），可加 `-DebugPort 9222` |

## 当前状态（v1.5.0，开发态）

- ✅ Dock：玻璃质感、四边停靠、沿边位置、悬停放大（1.30×，邻项递减）、拖拽排序、右键菜单、图标提取
- ✅ Dock 自身图标：点击打开设置面板并前置；`.lnk` / `aumid` 指向自身同样识别（v1.4.1）
- ✅ Dock 手感：按压回弹、涟漪光晕、启动弹跳、悬停柔光、指示点呼吸、FLIP 排序过渡、入场动画
- ✅ Dock 溢出：图标多时窗口夹紧 + 内部滚动 + 两端渐隐；末端开关始终可达（v1.5）
- ✅ Dock 键盘：方向键移动焦点、`ContextMenu`/`Shift+F10` 打开应用菜单、空列表引导（v1.5）
- ✅ 系统托盘：单击显隐 Dock / 双击设置 / 右键完整菜单（v1.5）
- ✅ 音乐卡片：Windows SMTC 实时显示任意播放器的曲目/进度，卡片按钮可真实控制播放器；空状态；本地播放器；控件按压/图标形变/进度跟手；深浅主题（v1.5）
- ✅ 桌面时钟：可开关、24/12 小时制、显示秒/日期、字号/透明度/主题、拖动吸附开关与位置记忆
- ✅ 设置面板：Dock / 音乐 / 时钟 / 应用 / 外观 / 系统 / 关于 七页；**共性项统一在「系统」页折叠栏管理**，窗口页只留独有特性；保存失败/加载失败均有可见提示（v1.5）
- ✅ 窗口共性能力：吸附 / 始终置顶 / 仅在桌面显示 / 位置锁定 / 移回默认位置，三窗口一致且统一入口
- ✅ 外观与动效：强度三档、减少动效、点击音效、效果预览
- ✅ 开机自启：安装版写入 HKCU 登录项，状态以系统为准、失败回滚；portable 版使用 `PORTABLE_EXECUTABLE_FILE` 写入真实路径（v1.5）
- ✅ 稳定性：桥崩溃循环治理 + 桥看门狗 + 渲染进程崩溃自愈 + 日志轮转 + 窗口导航加固（v1.5）
- ✅ 窗口行为准则：`docs/window-conventions.md`（新窗口强制能力清单与验收契约）
- ✅ 内存轻量化（v1.4）：常驻桥按需启停 + 原生 `desktop-state.exe`、时钟去 React、隐藏窗口降频；工作集 656.0 → 473.4MB（低配模式 421.1MB）
- ✅ 自动化门禁：`npm run check`（typecheck + 12 个契约测试）+ `scripts/v15-verify.mjs` + `scripts/v15-overflow-check.mjs`（v1.5）
- ⏳ 待人工验证（只能靠真人，脚本无法替代）：托盘图标在你自己任务栏的**视觉与单击/双击手感**、Dock/音乐/时钟真实拖动吸附手感、锁定后鼠标不可拖、开机自启在真实登录后的行为、动效主观手感
- ⏳ 待验收后打包：便携版单文件 exe（`npm run dist`）

验收证据见 [docs/verification.md](docs/verification.md) §v1.5（9/9 + 5/5 通过，报告与截图在 `docs/verification/v1.5/`）；本机宿主环境限制见 [操作指南.md](操作指南.md) 末节。

## 文档

| 文档 | 内容 |
|---|---|
| [操作指南.md](操作指南.md) | 环境自检、执行顺序、日常使用说明、FAQ |
| [docs/spec.md](docs/spec.md) | 需求规格与验收标准（SDD 阶段 1，§7 为 v1.0 精细化交互规格，§8 为 v1.1，§9 为 v1.2，§11 为 v1.3.1、§12 为 v1.4.1 补丁） |
| [docs/window-conventions.md](docs/window-conventions.md) | 窗口行为准则：所有悬浮窗口的强制能力（吸附开关/位置记忆/位置锁定等）、接入清单与验收契约（**新窗口必读**） |
| [docs/motion-spec.md](docs/motion-spec.md) | 动效设计规范（令牌/曲线/组件矩阵/降级，v1.0 唯一视觉真源） |
| [docs/plan.md](docs/plan.md) | 技术方案与架构、IPC 契约（SDD 阶段 2，§12 为 v1.0 方案，§16、§17 为补丁方案） |
| [docs/tasks.md](docs/tasks.md) | 任务分解与状态（SDD 阶段 3，阶段 9–11 为 v1.0 任务，阶段 24 为 v1.4.1，阶段 25 为 v1.5） |
| [docs/verification.md](docs/verification.md) | 逐条 AC 验收记录与截图（§v1.5 = 9/9 + 5/5 通过） |

## 目录结构

```
src/
  shared/types.ts      # IPC 契约 + 配置模型（唯一真源）
  main/                # 主进程：窗口/位置引擎、设置、应用、媒体桥
    tray.ts            # 系统托盘（v1.5 新增）
    logger.ts          # 统一文件日志 + 1MB 轮转（v1.5 新增）
  preload/index.ts     # contextBridge 白名单 API
  renderer/dock/       # Dock 界面
  renderer/music/      # 音乐卡片
  renderer/clock/      # 桌面时钟（v1.1 新增）
  renderer/settings/   # 设置面板
  renderer/shared/     # 设计系统、通用 hooks、ErrorBoundary（v1.5）
resources/             # 桥脚本与原生助手（smtc-bridge.ps1 / desktop-state.ps1 / desktop-state.cs + .exe）+ 托盘图标 tray-*.png
tests/                 # 共享契约单元测试（node --test，v1.5 新增）
scripts/               # 验收辅助脚本（截屏、CDP 验收、溢出压力测试等）
```

## 配置与日志

- 设置：`%APPDATA%\nexus-dock\settings.json`（删除即恢复默认；`schemaVersion` 当前 **8**）
- 图标缓存：`%APPDATA%\nexus-dock\icons\`
- 日志：`%APPDATA%\nexus-dock\logs\`
