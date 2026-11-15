# VERIFICATION — 验收记录

## v1.10.0 正式发布与线上更新源（2026-11-15）

[正式 Release](https://github.com/GoahJack/Nexus-Dock/releases/tag/v1.10.0) 已于北京时间 **2026-11-15 12:12** 公开为最新版，`draft=false`、`prerelease=false`，目标提交 `976fe271447ceff22d25cdf1c59ab4cd49775c25`。[GitHub Actions 发布任务](https://github.com/GoahJack/Nexus-Dock/actions/runs/43675395445) 全部步骤成功：82/82 测试、双分发构建、SHA-512 清单校验、四个上传资产的大小/SHA-256 校验与正式发布。

线上验证：`node scripts/release-live-verify.mjs` 已通过。四个附件公开下载均返回 200；真实隔离 v1.10.0 客户端从生产配置的 GitHub 源检查到当前为最新版。仅模拟更新引擎的比较版本为 1.9.0 后，检测并实际下载 **120,939,729 字节**的正式安装包，SHA-512 与公开 `latest.yml` 一致，SHA-256 与 GitHub 资产摘要一致。下载完成状态为 `downloaded`，未执行安装器、未修改用户现有安装或配置；实际两个版本的安装替换仍留待后续版本验收。

证据：[published-release.json](verification/auto-update/published-release.json)、[live-release-report.json](verification/auto-update/live-release-report.json)。发布包来自 Windows CI，同版本的先前本地验证构建属于历史证据，大小/摘要可能不同；更新清单始终和其对应构建一起发布，不混用两份构建的文件。

发布机制增补：`main` 的 `.github/release-request.json` 明确指定版本和 `publish: true` 才自动公开，普通代码提交不触发正式发布；标签构建及默认手动运行仍生成草稿。浏览器发布尝试因窗口状态失败，已按规则提交一次收尾摘要并重置本聊天 Computer Use 内核；正式发布最终由 GitHub Actions 完成。

## v1.10 自动更新（2026-11-15）

当前版本 **1.10.0**，设置 schemaVersion **12**。以下旧版本章节与计数均为历史证据。功能、迁移及发布约束见 [auto-update.md](auto-update.md)。

| 验证项 | 实跑结果 | 证据 / 边界 |
| --- | --- | --- |
| 类型检查 + 单元/契约回归 | 75/75 通过，0 失败 | `npm run check`；含 11 项更新流程测试 |
| 安装版 + 便携版打包 | 成功 | `npm run dist`；electron-builder 26.18.0，Electron 44.7.0，updater 6.8.12 |
| 更新资产一致性 | 通过 | `npm run verify:release`；安装包 120,939,792 字节，SHA-512 与 latest.yml 一致；blockmap 存在；latest.yml 只指向 setup |
| 打包 Electron：网络失败 → 错误校验值 → 正确校验值 | 通过 | 真实 HTTP 下载共 **241,879,584 字节**；503 可重试；错误 SHA-512 阻止安装；正确文件自动下载并显示可用「重启更新」 |
| 显式安装与数据保留 | 通过限定范围 | 按钮只调用一次 `quitAndInstall(true,true)`；调用被测试拦截，不执行安装器；schema v11→v12、窗口自定义坐标/自动更新开关保留，两份词库文件字节未变 |
| 便携版 / 开发态 | 均通过 | 显示正确说明，不执行更新；测试源收到的请求数不增长 |
| 更新设置页视觉复核 | 通过 | 真实 Electron 截图 `verification/auto-update/ready.png`，按钮、状态、开关与说明完整可见 |
| 线上发布与两个真实版本的安装替换 | 正式发布与线上更新源已通过；实际版本替换尚未执行 | 当前发布结果见上方记录；此表其余数值为初次本地验证构建，未替换用户当前安装 |

运行脚本：`node scripts/update-verify.mjs`；结构化结果：[auto-update/report.json](verification/auto-update/report.json)，**3 个场景全部通过**。隔离目录和缓存位于 `.userdata/update-verify`。本地测试元数据 1.10.1 使用当前 1.10.0 安装文件，只验证传输/完整性/UI/安装请求；不宣称已验证真实版本替换。截图和下载缓存不纳入 Git。未操作用户真实配置，测试进程已退出；本轮未建立 Computer Use 采集连接。

构建最初因沙箱网络无法访问 GitHub 失败；获准联网后完整打包成功。当前未配置 Windows 代码签名证书，未绕过更新组件默认签名校验。首次公开 Release 后，需在干净测试环境做基线安装→下一版本升级与快捷方式/配置保留验证。

> 当前修正：64 项单元/契约测试、类型检查和构建通过；18 项运行验证见 [motion-island/report.json](verification/motion-island/report.json)。[baseline/report.json](verification/motion-island/baseline/report.json) 有意保留旧构建两个失败，供确认音乐/单词卡住修复。所有更早目录均为历史证据。

> 环境：Windows 11 build 26200 · Node v24.21.0 · Electron 44.10.0（Chromium 152 / Node 24.22）· 2026-10-29
> 本文件记录的是「实跑」结果，不是计划。证据截图在 `docs/verification/`。

## 0. 环境自检

| 检查 | 结果 | 说明 |
|---|---|---|
| Node ≥ 20 | ✅ v24.21.0 | |
| npm + 镜像 | ✅ PONG（registry.npmmirror.com，`.npmrc` 固定 + 工作区内缓存） | 沙箱下用户目录 npm 缓存不可写，已改为工作区缓存 |
| Electron 二进制 | ✅ 44.10.0 可用 | 45.1.0 在本机启动即崩溃（`0xc0000005`），已锁定 44.10.0 |
| SMTC 可用 | ✅ 读到 Edge 会话（标题/歌手/进度/状态） | 用 PowerShell WinRT 接口验证 |

### 本机已知环境限制（重要）

1. **宿主注入了 `ELECTRON_RUN_AS_NODE=1`**：直接 `npx electron` 会以 Node 模式运行、拿不到 `app/protocol`。`scripts/dev.ps1` 会先清除该变量。
2. **Chromium 沙箱在本宿主不可用**：不加 `--no-sandbox` 时 Electron 在主进程 JS 执行前静默退出（事件日志无崩溃记录）。`scripts/dev.ps1` / `scripts/start.ps1` 已加 `--no-sandbox`；**普通桌面环境不需要**。
3. **进程可见性受限**：应用子进程的 `Get-Process` 只能看到约 9 个进程（看不到 `explorer`），因此「运行状态指示点」在本机无法验证（代码已加保护：可见进程 < 20 时不上报，避免全部误判为未运行）。
4. **Edge 不把 MediaSession 封面暴露给 SMTC**：音乐卡片封面走占位图；真实播放器（Spotify 等）会提供缩略图，取图分支已用模拟流单测通过。

## 1. 构建门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误 |
| 生产构建 | `npm run build` | ✅ `out/main`、`out/preload`、`out/renderer/{dock,music,settings}` 齐全 |
| 开发启动 | `npm run dev` | ✅ Vite 5173 + Electron 5 个进程，控制台无红错 |

## 2. AC 逐条验收

### US-1 位置可调的 Dock

| AC | 结果 | 证据 / 方式 |
|---|---|---|
| AC-1.1 默认底部居中、玻璃质感、置顶、不进任务栏 | ✅ | `final-desktop.png`；窗口 `skipTaskbar:true`、`alwaysOnTop:true` |
| AC-1.2 拖动手柄移动、松手吸附最近边 + 12px | ⚠️ 待人工 | 吸附算法（最近边 + 沿边百分比 + `SCREEN_MARGIN`）已实现且窗口可移动；`-webkit-app-region: drag` 属 OS 级拖动，CDP 无法模拟，需人工拖一次确认 |
| AC-1.3 吸附后保留沿边位置 | ✅（等价验证） | CDP 设置 `edge/alongPercent` 后窗口按公式移动（bottom→left→top 均正确），并写入 settings.json |
| AC-1.4 设置切四边立即转向 | ✅ | `dock-left.png`（93×417 竖条）、`dock-top.png`、`dock-default.png`（417×93 横条），`data-edge` 同步 |
| AC-1.5 沿边位置滑块实时移动 | ✅ | 设置面板滑块 → `settings:update` → 窗口重排（CDP 验证位置变化） |
| AC-1.6 位置参数持久化、重启还原 | ✅ | `%APPDATA%\nexus-dock\settings.json` 写入正确；dev 多次重启后位置保持 |
| AC-1.7 可识别拖拽手柄 | ✅（提示气泡受限） | 手柄 ⋮ 圆点 + `cursor:grab` 可见；Electron drag 区域不向渲染层转发鼠标事件，原生 tooltip 可能不弹（已知限制） |

### US-2 图标交互与 Nexus 观感

| AC | 结果 | 证据 |
|---|---|---|
| AC-2.1 6 个内置应用图标 | ✅ | 6 个图标 `naturalWidth=48` 全部加载（`icon://` 协议；曾因 URL host 位解析错误显示字母占位，已修） |
| AC-2.2 悬停放大 + 邻项递减 + 上浮 + 平滑复位 | ✅ | 实测缩放 `[1.06, 1.18, 1.30, 1.18, 1.06, 1.0]`，移开后 `matrix(1,0,0,1,0,0)`；`dock-hover.png` |
| AC-2.3 单击启动应用 | ✅ | CDP 真实鼠标点击 → `notepad.exe` 进程启动（`shell.openPath` 返回空错误） |
| AC-2.4 右键菜单四项 | ⚠️ 待人工 | 原生 `Menu.popup` 已接（打开 / 在资源管理器中显示 / 从 Dock 移除 / Dock 设置），需人工右键确认观感 |
| AC-2.5 拖动排序并持久化 | ✅ | 拖拽后顺序 `explorer→notepad/calc/explorer…`，settings.json 落盘；已还原 |
| AC-2.6 运行指示点 | ⚠️ 环境不可验 | 逻辑完整（4px 圆点 + `is-running`），但本机进程可见性受限，见 §0.3 |

### US-3 音乐显示

| AC | 结果 | 证据 |
|---|---|---|
| AC-3.1 封面/标题/歌手/进度/时间 | ✅ | `music-playing.png`：`Nexus 主题曲 · 玻璃海岸 / Nexus Audio Lab / 0:11 / 0:36`；无封面时显示音符占位 |
| AC-3.2 自动显示系统播放器曲目、切歌刷新 | ✅ | SMTC 抓到 Edge 会话（MSEdge），卡片实时同步（暂停/播放/进度均变化） |
| AC-3.3 卡片按钮真实控制系统播放器 | ✅ | 点「暂停」→ Edge `player.paused=true`、按钮变「播放」；再点 → `false`、按钮回「暂停」 |
| AC-3.4 无播放器时空状态、不残留封面 | ✅ | `music-empty.png`：「未在播放 / 打开任意播放器即可同步 / 0:00」，无封面残留 |
| AC-3.5 卡片显示/隐藏、位置跟随或自由吸附、持久化 | ✅（跟随部分） | 卡片位置随 Dock 停靠边变化（bottom→left 坐标同步变化）；自由拖动吸附需人工验证 |
| AC-3.6 本地播放器选文件播放、拖动进度 | ⚠️ 待人工 | 代码完成（`media://local?p=` + Range 流 + 播放列表 + 进度拖动），需在真实文件对话框里点一次 |
| AC-3.7 宽度、进度样式实时生效 | ✅（环形待截图） | 宽度 240–520、条形/环形切换均接线；环形截图待补 |

### US-4 设置面板

| AC | 结果 | 证据 |
|---|---|---|
| AC-4.1 打开/拖动/关闭、不进任务栏 | ✅ | `settings-dock.png`（自定义标题栏、最小化/关闭）；打开方式：Dock 右键 / `window.nexus.window.openSettings()` |
| AC-4.2 三组参数齐全 | ✅ | Dock/音乐/应用/关于 四页截图齐全 |
| AC-4.3 修改即时生效并落盘 | ✅ | 滑动/切换 → 立即广播 → 各窗口同步；settings.json 250ms 防抖落盘 |
| AC-4.4 恢复默认（二次确认） | ✅（代码）/ 待人工点击 | 行内确认条 + `settings:reset` 链路完整 |
| AC-4.5 版本与进程信息 | ✅ | 关于页显示 Electron 44.10.0 / Chromium 152.0.7977.169 / Node 24.22.1 |

### US-5 工程质量

| AC | 结果 | 证据 |
|---|---|---|
| AC-5.1 一条命令启动 | ✅（本机用 `npm run dev`，内部走 `scripts/dev.ps1`） | 启动日志无红错 |
| AC-5.2 build / typecheck 零错误 | ✅ | 命令输出 |
| AC-5.3 安全基线 | ✅ | `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`，仅 preload 白名单 |
| AC-5.4 只写 userData；SMTC 挂掉自动重启 | ✅（桥启动/就绪日志已证，异常重启待补测） | `userData/logs/media.log`：桥启动 + 就绪 |
| AC-5.5 本文档 | ✅ | 本文件 |

## 3. 验收截图清单

| 文件 | 内容 |
|---|---|
| `dock-default.png` | 底部 Dock（玻璃条 + 6 真实图标 + 运行指示点） |
| `dock-left.png` / `dock-top.png` | 左侧/顶部停靠（竖排/横排切换正确） |
| `dock-hover.png` | 悬停放大（1.30 倍，邻项递减） |
| `dock-running.png` | 运行指示点样式 |
| `music-empty.png` | 音乐卡片空状态 |
| `music-playing.png` | 音乐卡片显示真实系统媒体（标题/歌手/进度） |
| `settings-{dock,music,apps,about}.png` | 设置四页 |
| `final-desktop.png` | 桌面实况：Dock + 音乐卡片叠加在桌面上 |
| `interact-report.json` / `final-report.json` / `cdp-report.json` | 自动化验收原始数据 |

## 4. 已知问题与后续

1. **Electron 版本**：45.1.0 本机启动崩溃（0xc0000005）→ 已锁 44.10.0；打包前建议在干净机器再评估 45。
2. **Dock/卡片窗口拖动吸附**：需人工拖一次验证（自动化无法模拟 `-webkit-app-region: drag`）。
3. **运行指示点**：宿主进程隔离导致本机不可验证；普通桌面应正常（逻辑已单测通过代码审查）。
4. **封面**：SMTC 缩略图依赖播放器；Edge 不提供。
5. **打包**：待用户验收后执行 `npm run dist`（electron-builder 需补 `extraResources` 把 `resources/smtc-bridge.ps1` 打进安装包）。

---

# v0.2 验收（2026-10-29 用户反馈 6 项）

> 环境同上；应用通过 `npm run dev` 运行，CDP 端口 9224。

## 逐项结果

| # | 用户需求 | 实现 | 实测结果 |
|---|---|---|---|
| 1 | 音乐窗口加开关 | 卡片右上角 ✕（hover 显示）＋ Dock 末端常驻音符按钮＋设置面板开关，三者共享 `music.visible` | ✅ CDP 点击 Dock 音符按钮：`music.visible true→false→true`；卡片 ✕ 点击同样生效 |
| 2 | 时间显示不准确 | SMTC 用 `Position + (now - LastUpdatedTime)` 推算；`EndTime=0` 视为时长未知；卡片显示 `已播 / --:--`，进度条 `is-unknown` 且不参与比例计算 | ✅ 酷狗会话（POS=0/END=0/LAST=1601 无效值）安全输出 `0:00/--:--`；Edge 会话实测 pos 19828→21276→21984→22686→23407（+700ms/次，被 30000 正确钳制） |
| 3 | Dock 可停在中间（不吸附） | `snapToEdge` 默认 false，`freeX/freeY` 自由坐标；旧配置 v2→v3 迁移修正坐标 | ✅ 设置项存在；`settings.json` `snapToEdge=false`、`freeX/freeY` 生效；Dock 现在停在底部居中而非左上角；拖动手柄后写回坐标（拖动本身需人工确认） |
| 4 | Dock 背景透明 | `opacity` 允许 0（默认 0）；渲染层全透明时不渲染背景/描边/阴影/backdrop-filter | ✅ DOM 各层计算样式均为 `rgba(0,0,0,0)`、无 shadow、`::before display:none`；桌面截图只有图标浮在壁纸上（修复了 `setBackgroundMaterial('none')` 导致透明窗口变黑底的问题） |
| 5 | 应用能点开 / 能插入新应用 | 统一 `shell:AppsFolder\<AppID>` 启动（UWP/Store/桌面通用）；`scanStartMenu` 改用 `Get-StartApps`；失败按序回退并把原因显示在 Dock 上方 | ✅ 目录返回 **186 个应用**（中文名正常、exe 路径类应用有图标）；点计算器图标 → `CalculatorApp` 进程启动；启动失败会返回 `ok:false` 并弹提示 |
| 6 | 只在桌面显示（最大化隐藏） | 新增 `desktop-state.ps1`（UIA 遍历顶层窗口 + 矩形比对）＋ `desktopState.ts` 桥＋`applyDesktopState()` | ✅ 最大化计算器后 Dock 消失、音乐卡片保留；恢复普通窗口后 Dock 自动回来（截图 `v02-dock-hidden-maximized.png` / `v02-dock-visible-normal.png`） |

## v0.2 关键截图

| 文件 | 内容 |
|---|---|
| `v02-final-desktop.png` | 最终桌面：底部透明 Dock（只留图标 + 音符按钮）、右上音乐卡片（酷狗真实曲目、`0:00/--:--`、✕） |
| `v02-dock-transparent.png` | Dock 窗口截图（透明态） |
| `v02-dock-hidden-maximized.png` | 最大化计算器时 Dock 自动隐藏 |
| `v02-dock-visible-normal.png` | 恢复窗口后 Dock 出现 |
| `music-card-time-unknown.png` | 时长未知时的 `--:--` 与 `is-unknown` 进度条 |
| `v02-report.json` / `v02-click.json` | 自动化验收原始数据（位置/样式/开关/目录/启动） |

## v0.2 附加修复

1. **内置应用集合更新**：任务管理器（本机直接启动被拦）替换为「设置」；其余应用改用 AUMID 启动。
2. **配置迁移 v1→v2→v3**：重建内置应用、opacity 归零、自由坐标修正；保留用户自定义/开始菜单应用（实测保留了 DeepSeek Harness、微信）。
3. **PowerShell 中文乱码**：`Get-StartApps` 输出改 Base64(UTF-8)，应用目录中文名正常。
4. **子进程环境变量**：所有 PowerShell 子进程显式注入 TEMP/TMP/APPDATA/LOCALAPPDATA/ProgramData。
5. **透明窗口黑底**：仅在开启亚克力时才调用 `setBackgroundMaterial`。

## 仍需人工确认

- 按住 Dock 手柄自由拖动是否停在原地（不吸附）；打开「吸附到屏幕边缘」后是否恢复吸附行为。
- 从设置 → 应用 →「从开始菜单选择」添加一个新应用，然后点击图标启动。
- 音乐卡片位置当前在右上角（不遮挡 Dock）；如需改为「固定跟随 Dock 上方」，需要再调整 `music.anchor` 的默认策略。

---

# v0.3 修复验收（2026-10-29 晚 · 用户反馈第二轮）

## 三个反馈的处理结果

| 反馈 | 根因 | 修复 | 实测 |
|---|---|---|---|
| Dock 点击没反应 | ① 指针捕获设在列表容器上，导致 click 的 target 变成容器，图标的 onClick 永远不触发；② 启动 UWP 应用在受限令牌下被拒 | pointerdown 不再抢捕获，只有拖拽超阈值才捕获；单击走图标 onClick。启动链路改为「进程内 ShellExecute → 外部 ShellExecute → explorer shell:AppsFolder → spawn」，失败时返回明确错误 | 点击日志确认 `launch id=calc` 被调用（`%APPDATA%\nexus-dock\logs\launch.log`）；外部 ShellExecute 返回「拒绝访问」，属环境限制，现在会在 Dock 上方显示原因 |
| 音频时长不显示、进度条像摆设 | 酷狗等播放器 SMTC `EndTime=0`（不上报总时长） | 时长未知时显示 `已播 / --:--`、进度条改为低频扫光（不再像坏掉的空条），并加 hover 解释文案；有总时长的播放器（Edge 等）正常显示 `0:15/0:36` | Edge 会话实测 `0:15/0:36` 且进度条随播放推进 |
| 暂停再播放时间归零 | SMTC 会话选择逻辑：暂停瞬间「Playing」会话消失，会切到另一个播放器会话（位置/时长全变） | ① SMTC 桥按 appId **粘滞当前播放器**；② 进度插值保留连续性，同曲目内位置回退到 0 时不跳变（暂停冻结、续播继续） | 实测 `0:36 → 暂停 0:36 → 恢复 0:36 → 3.8s 后 0:39`，不再归零 |

## 环境限制（重要，已二次实测）

- 从 DSH/沙盒终端启动 Nexus Dock 时，进程继承受限令牌：
  - 无法激活 UWP 应用（`Start-Process` 返回「拒绝访问」，Shell.Application COM 超时）；
  - 从**普通终端**执行同样的 ShellExecute 可以正常启动计算器（已实测 CalculatorApp 进程出现）。
- 因此：**双击项目根目录的 `启动 Nexus Dock.cmd`（资源管理器里以正常权限启动）后，Dock 点击启动应用即可正常工作**；打包成 exe 后双击安装启动同理。
- 该限制不影响：Dock 显示/拖动/透明/音乐卡片/SMTC 时间/设置面板。

## 本次新增文件

- `启动 Nexus Dock.cmd`：以正常权限启动已构建应用（双击即可）。
- `scripts/debug-dock-click.mjs`、`scripts/test-click-launch.mjs`、`scripts/test-music-continuity.mjs`、`scripts/invoke-launch.mjs`：点击/播放/启动链路的自动化验收脚本。

## v0.4 启动问题修复（2026-10-29 深夜）

| 现象 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 双击 .cmd 无效 | ① .cmd 里中文注释被 cmd 按 GBK 解析成命令；② `%~dp0` 以反斜杠结尾导致引号被转义；③ 环境带 `ELECTRON_RUN_AS_NODE=1` | 启动脚本改为纯 ASCII、路径用 `%~dp0.`、启动前清空该环境变量；启动失败会暂停显示错误 | 脚本输出 `[OK] Nexus Dock is running.`，5 个进程正常 |
| 部分应用点了没反应 | 从开始菜单添加的桌面程序其 AppID 就是 exe 路径，旧逻辑错误包成 `shell:AppsFolder\D:\...\app.exe` | AppID 若为 exe 路径 → 直接 `shell.openPath/spawn` | 实测 7-Zip：`openPath(.exe) ok`，`7zFM` 进程出现 |
| UWP 应用显示沙盒无法启动 / 静默无反应 | 受限令牌下 UWP 激活被拒；且 `shell.openPath(calc.exe)` 对 UWP 存根返回“成功”造成假成功 | AppID 启动改为 COM/explorer 两种方式 + **窗口数量前后对比验证**；失败返回明确错误（不再假成功） | 沙盒内点计算器返回 `AppID 启动失败` 并弹提示；正常权限环境会验证到新窗口 |

## v0.5 修复（2026-10-29 深夜第二轮）

| 问题 | 根因 | 修复 | 验证 |
|---|---|---|---|
| 酷狗在放歌，音乐卡片完全没反应 | 我上轮为「会话粘滞」改 smtc-bridge.ps1 时引入了 PowerShell 语法错误（ParserError），桥进程启动即失败，重试 5 次后放弃 | 用解析器定位错误并整段重写 Get-Session（纯 ASCII 风格、括号配对）；已 `PARSE_OK` | 独立运行输出酷狗会话：`全部君のせいだ / Kotoha / kugou` + 封面已落盘；应用内 `SMTC 桥就绪`，卡片显示曲目与封面 |
| 除 7-Zip 外应用打不开 | ① 桌面应用（微信/Edge）走 exe 路径：实测 `Weixin.exe` 启动成功（进程出现）、`msedge.exe` openPath 成功；② UWP 应用（资源管理器/记事本/计算器/设置）在受限令牌下激活被拒 | exe 路径应用直接 openPath/spawn（已修）；UWP 走 COM/explorer + 窗口验证，失败明确报错 | 微信：启动后进程数 0→1；7-Zip：进程出现；UWP：沙盒内返回 `AppID 启动失败`（正常权限环境应可用） |

### 重要说明
- 音乐问题的直接原因是**脚本语法错误**，与酷狗无关；修复后酷狗曲目/封面/进度（暂停态）均能显示。
- 酷狗仍不上报总时长，显示 `--:--` 属播放器限制。
- 从本工具的受限终端启动的实例无法激活 UWP 应用；请通过资源管理器双击 `启动 Nexus Dock.cmd` 启动后再测试。

## v0.6 修复（0xc0000142 与音乐归零）

| 问题 | 根因 | 修复 |
|---|---|---|
| 点「文件资源管理器」弹出 `explorer.exe - 0xc0000142 应用程序无法正常启动` | AppID 启动失败后，代码又 spawn 了一个 explorer.exe 作为兜底；同会话第二个 explorer 实例初始化失败（STATUS_DLL_INIT_FAILED） | **删除 explorer.exe spawn 兜底**；资源管理器改用 `shell.openPath('C:\\Windows\\explorer.exe')` 专用路径；设置改用 `shell.openExternal('ms-settings:')`；UWP 只保留 Shell.Application COM |
| 音乐暂停再播放仍归零 | `useMediaProgress` 在渲染阶段就把 `statusRef.current` 更新为当前状态，effect 里读到的「上一次状态」永远等于当前状态，导致「暂停→播放」的复位保护逻辑从未生效 | 拆出独立的 `prevStatusRef`，只在 effect 内更新；并增加「同曲目播放中位置突然回退到 0 也保持连续」的保护 |

### 本轮实测
- 资源管理器：`openPath result=""` 成功，已存在 CabinetWClass 窗口；修复后不再产生新的 0xc0000142 弹窗（截图里的弹窗为修复前残留）。
- 设置：`ms-settings:` 在本沙盒实例返回 `拒绝访问 (0x5)`，属权限限制；正常权限启动应可用。
- 微信：启动后 `Weixin` 进程 0→1，启动通道正常；若微信已在托盘运行，它会拒绝第二实例（微信自身行为）。

## v0.7 启动校验与前台激活（2026-10-30 凌晨）

### 修复
1. **0xc0000142 根因彻底移除**：不再 `spawn/ShellExecute explorer.exe`；「文件资源管理器」改为 `shell.openPath('C:\\')`（在已有 Explorer 中打开）并验证窗口；启动时还会清理旧版本遗留的错误弹窗。
2. **启动结果不再假成功**：所有启动路径统一走 `launchAndFocus()`——
   - 记录启动前顶层窗口列表；
   - 尝试启动（Electron openPath / COM ShellExecute / AppID）；
   - 轮询 ≤5.6s 寻找「标题匹配 hint 的窗口」或「新出现的窗口」（排除 `Application Error` 弹窗）；
   - 找到后置前：Win32 `ShowWindow(9)+BringWindowToTop+AllowSetForegroundWindow+SetForegroundWindow`，失败再退 `AppletActivate`；
   - 找不到 → 返回 `ok:false` 并给出明确原因（不再“点了没反应”）。
3. 启动时写入环境自检：`env: visibleProcesses=xx restricted=true/false`（launch.log）。

### 本机测试环境的限制（重要）
- 从本 agent 终端启动的实例会继承受限作业对象：实测 `spawn(exe)` 返回成功但进程立刻消失、无窗口；UWP 激活同样被拒。
- 因此 GUI 启动行为的最终验收必须由用户**从资源管理器双击 `启动 Nexus Dock.cmd`** 的实例完成。
- 修复后日志粒度足够：每一步都有 `openPath/COM/AppID/窗口校验 found=… activated=…`，可直接定位卡点。

### 前台激活实现
- `release/` 无需额外依赖：PowerShell 内联 Win32 P/Invoke（`user32.dll`）+ `Microsoft.VisualBasic.Interaction.AppActivate` 双保险。

---

# v0.9 启动 / 置前 / 误报修复验收（2026-10-30）

## 根因（本次实测确认）

| 现象 | 根因 |
|---|---|
| 点击 Dock 应用长时间无反应后弹错误 | DSH 工作区沙箱给工作区内文件打了 **Low 完整性标签**（`icacls` 可见 `Mandatory Label\Low...`）；Windows 把从这些文件启动的进程降为 Low 权限。Low 权限下 Windows 拒绝启动 UWP、拒绝窗口置前、`ms-settings:` 返回 0x5；旧链路每次点击要等 16~30 秒窗口扫描超时后才失败。 |
| 应用即使从桌面快捷方式启动仍是 Low | 快捷方式指向工作区内的 exe（Low 标签）；`--no-sandbox` 启动参数也会让 Electron 以 Low 运行。 |
| 部分应用“已在运行但无法激活” | 启动链路把“窗口扫描未命中”直接判为失败并弹提示；微信/Edge 等常驻应用必现。 |
| 运行指示点永远不亮 | `tasklist` 进程名带 `.exe` 后缀比对不上；且旧逻辑按“去重进程名数量 < 20”误判受限而跳过上报。 |

## 修复

1. 新增 `scripts/install-local.ps1` / `npm run install:local`：同步 `out/` → 打包产物 → 安装到 `%LOCALAPPDATA%\NexusDock`（无 Low 标签）并刷新桌面快捷方式后启动；`启动 Nexus Dock.cmd` 已改为调用该安装器。
2. 启动链路：`launchAndFocus` 新增 `LAUNCHED_NO_WINDOW` 状态，启动命令已发出但窗口未在时限内出现时按成功处理；已在运行的 exe 应用请求前置后返回成功，不再报错。
3. 资源管理器：置前匹配排除 `Program Manager`（桌面窗口也属于 explorer 进程），改用文件夹窗口标题匹配（此电脑/文件资源管理器/主文件夹等）。
4. 运行指示点：`tasklist` 一次性取进程名并去掉 `.exe` 后缀；补充 UWP/常用应用进程名映射（calculatorapp/notepad/mspaint/systemsettings/msweixin/msedge 等）；低可见性时跳过而非误清空。
5. 环境自检：启动日志记录 `env: lowIntegrity=true/false`，低权限时在启动失败原因后追加提示。

## 实测（安装版、正常权限、无 `--no-sandbox`，CDP 驱动）

| # | 应用 | 结果 | 耗时 | 前台窗口 |
|---|---|---|---|---|
| 1 | 文件资源管理器 | ok:true | 2387ms | OS (C:) - 文件资源管理器 |
| 2 | 记事本 | ok:true | 981ms | launch.log - Notepad |
| 3 | 计算器 | ok:true | 1083ms | 计算器 |
| 4 | 画图 | ok:true | 986ms | 无标题 - 画图 |
| 5 | 命令提示符 | ok:true | 1049ms | C:\Windows\System32\cmd.exe |
| 6 | 设置 | ok:true | 1303ms | 设置 |
| 7 | DeepSeek Harness | ok:true | 1237ms | 修复软件无响应与报错 — DeepSeek Harness |
| 8 | 7zFM | ok:true | 1282ms | E:\My_AI\ |
| 9 | Weixin | ok:true | 1233ms | 微信 |
| 10 | msedge | ok:true | 1263ms | 新标签页 - 个人 - Microsoft Edge |

- 全部 10 个应用：`ok:true`、无错误 toast、正确置前。
- 真实鼠标点击 + 连续双击（计算器 / 文件资源管理器 / DeepSeek Harness）：无错误提示、正确置前（验证了“双击不再报错、资源管理器不再命中桌面窗口”）。
- 运行指示点：10/10 全部 `data-running=true`（此前永远为空）。
- 环境自检：`env: lowIntegrity=false`。
- 证据：`scripts/out/final-verify2.log`、`scripts/out/final-verify.json`、`scripts/out/final-verify-desktop.png`。

---

# v1.0 精细化交互设计验收（2026-10-30）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限，无 `--no-sandbox`）· Electron 44.7.0 · **Nexus Dock v1.0.0**
> 验收方式：`scripts/v1-motion-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动三个真实窗口，采集计算样式 / DOM 状态 / 截图
> 机器证据：[`docs/verification/v1/motion-report.json`](verification/v1/motion-report.json)；截图目录：[`docs/verification/v1/`](verification/v1/)

## 1. 构建与安装门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误（tsc --noEmit） |
| 生产构建 | `npm run build` | ✅ `out/main`、`out/preload`、`out/renderer/{dock,music,settings}` 齐全 |
| 安装版更新 | `npm run install:local` | ✅ 同步 out → 打包产物 → `%LOCALAPPDATA%\NexusDock`，桌面快捷方式刷新 |
| 启动 | `NexusDockApp.exe --remote-debugging-port=9224` | ✅ Dock / 音乐卡片双窗口，设置窗口按需打开 |

## 2. AC 逐条验收

### US-9 统一动效体系

| AC | 结果 | 证据（motion-report.json 字段） |
|---|---|---|
| AC-9.1 动效令牌统一 | ✅ | 三档 `--nx-motion-scale` = 0.72 / 1 / 1.28；`.dock-item-inner` 实际过渡时长 0.1296s / 0.18s / 0.2304s，曲线随档位切换 |
| AC-9.2 按压变形 | ✅ | pointerdown 后 70ms：`data-pressed=true`；涟漪 1 层；按下态 `inner` transform 从 1.30 向 0.94 收缩中（`matrix(1.1198…)`，另有 0.949 无悬停样本）；松手回 `--nx-spring` |
| AC-9.3 涟漪/光晕 | ✅ | `.nx-ripple` 存在 1 层，`animationName=nx-ripple-expand`、`0.42s`；宿主 `dock-item nx-ripple-glow-host`；动画结束自动移除 |
| AC-9.4 启动反馈 | ✅ | 点击后 `.dock-item-icon.is-launching`，`nx-launch-bounce 0.42s`；为乐观反馈（不等启动结果）；失败仅追加 Toast |
| AC-9.5 悬停光效 | ✅ | 悬停中心项 `matrix(1.3114, …, -8.30)`（约 1.31× + 上浮 8.3px，含 spring 过冲）；图标 filter 出现强调色 `rgba(110,168,254,0.28)` 柔光；邻项 1.05/1.17/1.19 递减 |
| AC-9.6 运行指示点 | ✅ | 临时挂 `.is-running`：`animationName=nx-breath`、`2.6s`、`infinite`、强调色 shadow（本机进程可见性限制无法点亮真实运行态，见 §0.3） |
| AC-9.7 拖拽排序 FLIP | ✅ | 合成拖拽后第 2 次读取：6 个图标均有非单位 transform（约 31–36px 位移），顺序变为 `msedge→notepad→calc→paint→cmd→explorer`，松手 500ms 后落盘 |
| AC-9.8 容器过渡 | ✅ | Dock bar 入场 `nx-rise-in`；图标错峰 `nx-item-in` 24ms/项；Toast 入场 `dock-toast-in 0.18s`，退场 `nx-toast-out 0.16s`（读取瞬间 opacity≈0.08–0.19） |
| AC-9.9 音乐卡片控件 | ✅ | 6 个涟漪宿主；播放图标双层（2 层 / 2 SVG）；CDP 真实鼠标按下：`:active=true`、transform `matrix(0.9037…)`、涟漪 `nx-ripple-expand`；进度条 hover/drag 发光、封面双层交叉淡入为代码级实现 |
| AC-9.10 设置面板控件 | ✅ | 导航 5 项含「外观」；`.settings-page` 转场挂载；恢复默认弹层入场 `nx-pop-in` + 遮罩 `nx-fade-in`，取消后 `is-leaving` + `nx-pop-out`，220ms 后 DOM 移除（`gone=true`） |
| AC-9.11 可访问性降级 | ✅ | `data-reduced-motion=true` 时 `.dock-item-inner` 过渡 `1e-05s`、指示点动画 `1e-05s`；系统 `prefers-reduced-motion` 同规则 |
| AC-9.12 性能约束 | ✅（实现约束） | 动效只用 transform/opacity/filter/box-shadow；Dock `.dock-root`（ResizeObserver 测量对象）与 `.music-card`（useContentSize 测量对象）不做 transform 动画；进度条视觉增高用绝对定位图层，不改变卡片高度（代码审查 + 截图无布局抖动） |

### US-10 外观与动效设置

| AC | 结果 | 证据 |
|---|---|---|
| AC-10.1 新增「外观」页 | ✅ | 导航 `["Dock","音乐","应用","外观","关于"]`；`pageVisible=true`、`hasPreviewTile=true`、三档分段齐全 |
| AC-10.2 强度实时生效 | ✅ | 点「轻快」→ `data-motion=light`、setting=light、scale=0.72；点「弹性」→ expressive、1.28；广播同步至 Dock/音乐窗口 |
| AC-10.3 减少动效开关 | ✅ | 开启后 `data-reduced-motion=true`、setting=true、过渡 1e-05s；关闭恢复 |
| AC-10.4 点击音效 | ✅（听感待人工） | 开关写入 setting 与 `data-click-sound=true`；实现为 WebAudio 合成 50ms 短音（无外部资源），默认关闭 |
| AC-10.5 持久化与迁移 | ✅ | `settings.json` schemaVersion 3 → 4；`appearance={standard,false,false}` 落盘；用户原有 dock/music/apps 配置保留 |
| AC-10.6 效果预览 | ✅ | 预览区含 Dock 风格 tile（按压+涟漪+弹跳重播）与普通按钮，实时显示当前档位/时长/过冲/按压参数 |

## 3. 截图证据（`docs/verification/v1/`）

| 文件 | 内容 |
|---|---|
| `desktop-dock-v1.0.png` | 真实桌面：Dock 悬停放大 1.30× + 上浮 8px，音乐卡片同步酷狗正在播放的《Sprout》 |
| `desktop-v1.0.png` | 真实桌面：设置「外观」页 + 音乐卡片 + 用户壁纸 |
| `dock-hover.png` | Dock 悬停：邻项衰减 1.05 / 1.17 / 1.31 / 1.19 / 1.07 |
| `dock-press.png` | Dock 按压态（涟漪扩散中） |
| `dock-launch-bounce.png` | 点击后启动弹跳帧 |
| `dock-toast-in.png` / `dock-toast-out.png` | 启动失败 Toast 入场 / 退场 |
| `music-press.png` | 音乐卡片按钮真实鼠标按压（缩放 + 涟漪） |
| `settings-appearance.png` | 设置「外观」页（v1.0.0）：强度三档 / 减少动效 / 点击音效 / 效果预览 |
| `settings-motion-expressive.png` | 弹性档选中态 |
| `settings-accessibility.png` | 可访问性开关操作后 |
| `settings-backup-before-verify.json` | 验收前用户配置快照（验收后已恢复） |

## 4. 验收夹具与现场恢复

- 用户 Dock 原本只有 2 个图标（文件资源管理器、msedge）。为观察悬停衰减 / FLIP / 弹跳，验收脚本**临时**补入 4 个默认应用（记事本/计算器/画图/命令提示符），验收结束后通过 `settings:update({apps})` 原样恢复。
- `restored` 字段确认：`apps=[explorer, custom-f075a8241e05]`、`appearance={standard,false,false}`、`music.source=system`、`schemaVersion=4`。
- 音乐卡片验证期间「系统/本地」徽标被真实点击，已在 finally 恢复 `source=system`。

## 5. 已知限制与待人工体验

1. **运行指示点真实态**：本机进程可见性受限（§0.3），只能验证 CSS 呼吸动画参数；真实运行点亮需在正常桌面环境确认。
2. **主观手感**：拖拽排序跟手度、启动弹跳节奏、点击音效音量、封面交叉淡入（本机酷狗会话有封面，切换歌曲时）建议人工体验一次。
3. **失败反馈时延**：不存在的路径启动会依次尝试 COM → openPath → ShellExecute，约 **43s** 才返回失败并弹 Toast（沿用 v0.9 启动回退链，非本轮引入）。若希望失败反馈更快，可列入 v1.1：在回退链前先做 `existsSync` 快速失败。
4. **弹层退场范围**：本轮只给「恢复默认设置」确认框补了退场动画；开始菜单候选面板仍为仅入场（不涉及本轮 AC-9.10 点名范围）。
5. **测试脚本副作用**：验收会临时点击计算器/记事本等应用（安装版正常权限会真实打开窗口），脚本运行后已清理测试打开的记事本窗口；音乐卡片来源与 Dock 配置已恢复。

---

# v1.1 吸附开关 / 开机自启 / 桌面时钟 / 位置锁定 验收（2026-10-30）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限，无 `--no-sandbox`）· Electron 44.10.0 · **Nexus Dock v1.1.0**（`package.json`）
> 验收方式：`node scripts/v11-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动**四个真实窗口**（Dock / 音乐卡片 / 设置 / 桌面时钟），采集 DOM 状态 / 计算样式 / 设置落盘 / HKCU Run 注册表前后 diff / 截图
> 机器证据：[`docs/verification/v1.1/v11-report.json`](verification/v1.1/v11-report.json)（31 checks / 31 passed / 0 failed / 0 exceptions）；截图目录：[`docs/verification/v1.1/`](verification/v1.1/)
> 对应规格：`docs/spec.md` §8（US-11 ~ US-15）；方案：`docs/plan.md` §13；任务：`docs/tasks.md` v1.1（阶段 12–15，已全部完成）。

## 1. 构建与安装门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误（tsc --noEmit） |
| 生产构建 | `npm run build` | ✅ `out/main`、`out/preload`、`out/renderer/{dock,music,settings,clock}` 齐全（`out/renderer/clock/index.html` + `clock-*.js/css`） |
| 配置迁移 | 旧 v4 `settings.json` 启动 | ✅ 日志 `[settings] 已从 v4 迁移到 v5`；`schemaVersion=5`，`music.snapToEdge=true`、`music.freeX/freeY=-1`，dock/appearance/apps 原样保留（10 个应用） |
| 安装版更新 | `npm run install:local` | ✅ 同步 out → `%LOCALAPPDATA%\NexusDock`，桌面快捷方式刷新，About 显示 v1.1.0 |
| 运行时启动 | `NexusDockApp.exe --remote-debugging-port=9224` | ✅ Dock / 音乐卡片 / 桌面时钟（按需）/ 设置（按需）四窗口 |

## 2. AC 逐条验收（v11-report.json 字段）

### US-11 音乐窗口自动吸附开关

| AC | 结果 | 证据 |
|---|---|---|
| AC-11.1 开关默认开启 | ✅ | 设置「音乐」页含「自动吸附屏幕边缘」，`checked=true`；`settings.music.snapToEdge=true`（`C4` / `E1`） |
| AC-11.2 开启吸附最近边 | ✅（实现 + 代码审查） | `computeMusicBounds`/`snapMusicToNearestEdge` 保持 v1.0 吸附逻辑，12px `SCREEN_MARGIN`；真实拖动吸附列入人工项（`E1`） |
| AC-11.3 关闭后自由摆放并持久化 | ✅ | API 切 `snapToEdge=false` → `settings.music.snapToEdge=false`、页面开关同步；自由坐标写入 `music.freeX/freeY`（`E2`，主进程 `moved` 分支代码审查） |
| AC-11.4 运行中切换不跳变 | ✅ | `onSettingsChanged` 检测翻转：false→true 以当前位置反算最近边；true→false 固化当前位置；仅 `anchor='free'` 时换算（避免打断跟随 Dock）；`E3` 切回 true 成功 |
| AC-11.5 拖动即脱离 Dock / 锁定不可拖 | ✅ | `moved` 时 `anchor:'free'`；`lock.music` 时 `moved` 直接 return（`D1` music `appRegion=no-drag`） |
| AC-11.6 反复切换不跳默认位置 | ✅ | 翻转逻辑不重置 `freeX/freeY`；`E2→E3` 往返实测通过 |

### US-12 开机自启

| AC | 结果 | 证据 |
|---|---|---|
| AC-12.1 系统页开关 + 默认关闭 | ✅ | 系统页「开机自启」存在且未 disabled（安装版），初始 `checked=false`；`settings.system.autoStart=false`（`F1`） |
| AC-12.2 写 HKCU Run / 移除无重复 | ✅ | `setAutoStart(true)` → `{ok:true,autoStart:true}`，`reg query` 实测新增 `com.nexus.dock = "C:\Users\huih\AppData\Local\NexusDock\NexusDockApp.exe"`；`setAutoStart(false)` → `{ok:true,autoStart:false}`，独立 `reg query` 与运行前快照 **0 差异**（`F2`/`F3`/`F4`/`F5`） |
| AC-12.3 失败回滚 + 启动同步 | ✅（代码 + 冒烟断言） | `applyAutoStart` 写后回读校验；启动 `syncAutoStartOnStartup()` 以 OS 为真源回写设置；失败回写真实状态且 `syncing + lastKnown` 双重防递归（main-core esbuild 冒烟 36 项断言） |
| AC-12.4 开发模式禁用 | ✅（代码 + 安装版对照） | `!app.isPackaged` 时 `system.setAutoStart` 返回 `{ok:false,reason:'dev'}`，不写系统；系统页开关 disabled 并提示（安装版 `F1` 为启用态，两者对照） |
| AC-12.5 单实例不重复启动 | ✅（沿用 v0.9） | `app.requestSingleInstanceLock()` 未改动；第二次启动聚焦设置窗口 |

### US-13 桌面时钟窗口

| AC | 结果 | 证据 |
|---|---|---|
| AC-13.1 独立开关 + 双入口 | ✅ | `settings.update({clock:{visible:true}})` 后 `/clock/` target 出现；Dock 末端时钟按钮（`dock-clock-toggle`，aria-pressed/is-on）与设置页开关代码就绪（`A6`，Dock 按钮见截图/代码审查） |
| AC-13.2 时间/日期格式 | ✅ | 默认 `19:45`（24h 无秒）、日期「10月30日 周五」；`showSeconds=true` → `19:45:59`；`hour12=true` → `07:46:00` + `.clock-period=下午`（`B1`/`B2`/`B3`） |
| AC-13.3 外观选项 | ✅ | `fontSize=64` → 计算 `font-size=64px`；`opacity=0.5` → 根节点计算 opacity≈0.5；`theme=light` → `data-theme=light`；置顶开关主进程 `setAlwaysOnTop` 联动（`B4`/`B5`/`B6`） |
| AC-13.4 拖动吸附 + 位置记忆 + 复位 | ✅（实现 + 代码审查） | `snapClockToNearestEdge` 只吸附最近一轴 + 12px 边距并写 `clock.freeX/freeY`；未定位默认主屏右上角；设置页「移回默认位置」patch `freeX/freeY=-1`；真实拖动列入人工项 |
| AC-13.5 不进任务栏 / 不抢焦点 / 内容等大 / hide 不销毁 | ✅ | 窗口 `skipTaskbar/showInactive/transparent`；`useContentSize('clock')` 首次回报后才显示（`clockContentSized` 门控，避免隐形点击区）；隐藏只 `hide()`（`A6` target 复跑仍存在） |
| AC-13.6 动效规范 | ✅（代码审查） | 入场淡入使用 `--nx-dur-slow/--nx-ease-out`，无硬编码毫秒；秒变化仅文本替换；reduced-motion 由 motion.css 全局降级（见 `docs/motion-spec.md` §3.4） |
| AC-13.7 纳入位置锁定 | ✅ | `lock.clock=true` 时 clock `data-locked='true'`、title「位置已锁定：设置 → 系统 解锁」、`app-region=no-drag`（`D1`） |

### US-14 窗口位置锁定

| AC | 结果 | 证据 |
|---|---|---|
| AC-14.1 总开关 | ✅ | 系统页「锁定全部窗口位置」存在；`checked = lock.dock && lock.music && lock.clock`；切换同时设置三字段（`C3` 页面文本 + 代码） |
| AC-14.2 单窗口覆盖 | ✅ | 三个独立开关直接 patch 对应字段，总开关按三者推导（`C3`；settings-ui SSR 冒烟 12/12 覆盖全锁/部分锁定场景） |
| AC-14.3 双层防护 | ✅（渲染层实测 + 主进程代码审查） | `lock` 三 true → dock/music/clock 的 `data-locked='true'`；主进程 `applyLockState()` → `win.setMovable(!locked)`（`windowManager.ts` `applyLockState`；`D1`/`D2`） |
| AC-14.4 锁定视觉可识别 | ✅ | Dock 手柄换锁形图标 + title「位置已锁定（设置 → 系统 解锁）」+ 降透明光标；音乐卡片 title 提示；时钟右上小锁图标（`D1`/`D2`） |
| AC-14.5 Dock 右键快捷开关 | ✅（代码审查） | `ipc.ts showDockMenu` 新增 checkbox「锁定全部窗口位置」；菜单每次打开实时读取设置（无法用 CDP 触发原生菜单，列入人工项） |
| AC-14.6 锁定不写位置 | ✅ | 三个 `moved` 处理器锁定守卫（含防抖回调二次守卫）；锁定期间 `data-locked` 下拖动区已 no-drag（`D1`/`D2`） |
| AC-14.7 设置窗口不受影响 | ✅ | `applyLockState` 只作用于 dock/music/clock；设置窗口无 `movable` 变更（代码审查） |
| AC-14.8 持久化 | ✅ | `settings.lock` 落盘 `${APPDATA}\nexus-dock\settings.json`，启动 `setupWindows` 再次 `applyLockState` 兜底（`G3` 落盘复核） |

### US-15 设置面板与配置迁移

| AC | 结果 | 证据 |
|---|---|---|
| AC-15.1 导航 7 项 | ✅ | 实测导航 `["Dock","音乐","时钟","应用","外观","系统","关于"]`，顺序正确；580×760 下不溢出（`C1`） |
| AC-15.2 即时生效 / 恢复默认 | ✅ | 新参数即时 patch；恢复默认会重置 clock/lock/system（UI 文案已更新）；验收结束时六组设置按快照完整还原并落盘（`G1`/`G3`） |
| AC-15.3 v4→v5 迁移 | ✅ | 真实旧配置启动：`schemaVersion=5`、旧 dock/music/appearance/apps 完整保留、`clock/lock/system` 补默认；`A3` 复核 `hasClockGroup/hasLockGroup/hasSystemGroup=true` |
| AC-15.4 统一动效 + 零新增依赖 | ✅ | 时钟使用 `motion.css` 令牌（`motion-spec.md` §3.4）；`package.json` 无新增运行时依赖（仅 devDependencies 未动） |
| AC-15.5 工程质量 | ✅ | typecheck 0 错误、build 成功、`Runtime.exceptionThrown=0`；报告 31/31 通过（`A8`） |

## 3. 截图证据（`docs/verification/v1.1/`）

| 文件 | 内容 |
|---|---|
| `clock-default.png` | 桌面时钟默认态（24h、无秒、有日期、深色） |
| `clock-seconds.png` | 显示秒（HH:mm:ss） |
| `clock-light.png` | 浅色主题 + 大字号/半透明样本 |
| `settings-clock.png` | 设置「时钟」页（显示/外观/位置三组） |
| `settings-system.png` | 设置「系统」页（开机自启 + 位置锁定总开关 + 三个独立开关） |
| `settings-music.png` | 设置「音乐」页（自动吸附屏幕边缘开关） |
| `dock-locked.png` | Dock 锁定态（手柄锁形图标 + 降透明） |
| `clock-locked.png` | 时钟锁定态（右上小锁 + 提示） |
| `music-locked.png` | 音乐卡片锁定态（整卡 no-drag + 提示） |

## 4. 验收夹具与现场恢复

- **设置快照**：脚本启动时快照 `dock/music/clock/lock/system/appearance` 六组，结束时一次 `settings.update` 还原并落盘复核（`G1`/`G3` 全组相等）。
- **开机自启**：真实写入 HKCU Run 后立即回读校验，`try/finally` 保证最后 `setAutoStart(false)`；独立 `reg query` 复核「启用前 / 启用后 / 清理后」三份快照，清理后与启用前 **0 差异**（`F4`/`F5`）。
- **窗口**：验收期间临时打开音乐卡片/桌面时钟/设置窗口，结束时恢复显隐并关闭设置窗口；音乐卡片 `visible` 与用户原配置一致（`G1`；本次用户配置为 false）。
- **备份**：`%APPDATA%\nexus-dock\settings.v11-behavior-before-verify.json`（验收前配置备份，可手工回滚）。

## 5. 已知限制与待人工验收

1. **真实拖动吸附**（US-11/US-13）：CDP 无法可靠模拟系统级窗口拖动，需人工拖动音乐卡片/时钟确认「松手吸附最近边 + 12px 间距」与关闭吸附后「拖到哪停在哪」。
2. **锁定后鼠标不可拖**（US-14）：主进程 `setMovable(false)` 无法从渲染层读取；已用「`windowManager.ts applyLockState` 代码审查 + 三窗口 `data-locked` 实测」双层证据，建议人工拖动确认。
3. **开机自启真实登录**（US-12）：注册表写入/清理已实测，真正「重启 Windows 后自动启动」需人工注销/重启验证一次。
4. **时钟/锁定观感**（US-13/US-14）：字号、透明度、主题、12 小时制视觉与锁定态手感建议人工确认。
5. **宿主环境注意事项**：本机从 agent 终端直接 `Start-Process` 的 Electron 会继承 `ELECTRON_RUN_AS_NODE=1` 而变成 Node 模式（报 `bad option`），验收前已清除该环境变量；普通用户从桌面快捷方式启动不受影响。冷启动时若 `music.visible=false` 则音乐窗口不创建（与 v1.0 行为一致），验收脚本会通过 API 按需打开。
6. **开机自启路径稳定性**：`setLoginItemSettings` 指向 `process.execPath`；用 `启动 Nexus Dock.cmd` / `npm run install:local` 装到 `%LOCALAPPDATA%\NexusDock` 后路径稳定；若直接把便携版 exe 放到临时目录运行，登录项可能指向临时路径（已在操作指南标注）。

---

# v1.2 时钟吸附开关 + 窗口行为准则 验收（2026-10-30）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限，无 `--no-sandbox`）· Electron 44.10.0 · **Nexus Dock v1.2.0**（`package.json` / 设置页 footer 实测 v1.2.0）
> 验收方式：`node scripts/v12-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动四个真实窗口，覆盖 US-16/US-17 并回归 v1.1 的 US-11 ~ US-15
> 机器证据：[`docs/verification/v1.2/v12-report.json`](verification/v1.2/v12-report.json)（**36 checks / 36 passed / 0 failed / 0 exceptions**）；截图目录：[`docs/verification/v1.2/`](verification/v1.2/)
> 对应规格：`docs/spec.md` §9；准则真源：`docs/window-conventions.md`；方案：`docs/plan.md` §14。

## 1. 构建与安装门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误 |
| 生产构建 | `npm run build` | ✅ 成功（settings 资源随新开关更新） |
| 配置迁移 | 旧 v5 `settings.json` 启动 | ✅ `schemaVersion=6`；日志 `[settings] 已从 v5 迁移到 v6`；`clock.snapToEdge` 补 `true`，时钟 `freeX/freeY`、字号、主题等字段原样保留 |
| 安装版更新 | `npm run install:local` | ✅ `%LOCALAPPDATA%\NexusDock` 更新至 v1.2.0，About/footer 显示 v1.2.0 |

## 2. AC 逐条验收（v12-report.json 字段）

### US-16 桌面时钟自动吸附开关

| AC | 结果 | 证据 |
|---|---|---|
| AC-16.1 开关存在、默认开启 | ✅ | 设置「时钟」→「位置」页含「自动吸附屏幕边缘」，开关与 `settings.clock.snapToEdge` 一致；v5→v6 迁移后该字段为布尔 `true`（`H1` / `A3` / `A3b`） |
| AC-16.2 开启时吸附最近边 | ✅（实现 + 代码审查） | `windowManager` 时钟 `moved` 分支：`snapToEdge=true` → `snapClockToNearestEdge()`（只吸附最近一轴、12px 边距）；真实拖动吸附列入人工项（`H3` + 代码审查） |
| AC-16.3 关闭后自由摆放并持久化 | ✅（实现 + 代码审查） | `snapToEdge=false` 时 `moved` 直接写回当前 bounds 到 `clock.freeX/freeY`；重启还原由 `computeClockBounds` 读取自由坐标（`H2` + 代码审查） |
| AC-16.4 运行中切换不跳变 | ✅ | `onSettingsChanged`：false→true 以当前位置反算最近边；true→false 固化当前坐标；`H2→H3` 往返实测通过 |
| AC-16.5 与位置锁定正交 | ✅（回归） | `lock.clock` 锁定时 `moved` 直接 return；`D1` 实测 clock `data-locked=true` + `app-region=no-drag` |
| AC-16.6 v5→v6 迁移保留旧配置 | ✅ | `H4`：除 `freeX/freeY`（按设计在开关翻转时重写）外，`visible/showSeconds/showDate/hour12/fontSize/opacity/alwaysOnTop/theme` 与迁移后快照一致；磁盘 `schemaVersion=6`、`clockSnapToEdge=true`（`G3`） |

### US-17 窗口行为准则

| AC | 结果 | 证据 |
|---|---|---|
| AC-17.1 准则文档 | ✅ | 新增 [`docs/window-conventions.md`](window-conventions.md)：设计原则、C1–C10 强制能力清单（C3=自动吸附开关默认 true）、DOM/IPC 契约、接入检查清单、符合性矩阵、评审与豁免流程 |
| AC-17.2 今后窗口强制吸附开关 | ✅（文档约束） | 准则 §2 C3 + §6 明确「未满足强制能力的窗口不得合入/发布」；设置窗口按 §2/§5 显式登记豁免理由 |
| AC-17.3 纳入 SDD 流程与引用 | ✅ | `docs/spec.md` §4/§9、`docs/plan.md` §14、README「文档」表、`操作指南.md` v1.2 段均引用准则 |
| AC-17.4 现有窗口符合性 | ✅ | 符合性矩阵：Dock / 音乐卡片 / 桌面时钟的吸附开关、位置锁定、位置记忆、显示开关全部 ✅；本轮补齐时钟吸附开关（`H1`–`H4`；音乐 `E1`–`E3`；Dock 既有 v0.2 能力回归 `C1`/`D1`） |
| AC-17.5 工程质量 | ✅ | typecheck/build 0 错误；`schemaVersion=6`；CDP **36/36 通过**、0 运行时异常（`A8`） |

## 3. 截图证据（`docs/verification/v1.2/`）

| 文件 | 内容 |
|---|---|
| `settings-clock-snap.png` | 设置「时钟」→「位置」组：新增「自动吸附屏幕边缘」开关（关闭态样本）+ v1.2.0 footer |
| `settings-clock.png` | 设置「时钟」页顶部（显示/外观） |
| `settings-system.png` | 设置「系统」页（开机自启 + 位置锁定，回归） |
| `settings-music.png` | 设置「音乐」页（吸附开关，回归） |
| `clock-default.png` / `clock-seconds.png` / `clock-light.png` | 桌面时钟默认 / 显示秒 / 浅色主题（回归） |
| `dock-locked.png` / `clock-locked.png` / `music-locked.png` | 位置锁定态（回归） |

## 4. 验收夹具与现场恢复（尊重用户真实配置）

- 本轮验收前用户已自行调整过配置：`music.snapToEdge=false`、`system.autoStart=true`（HKCU Run 已有 `com.nexus.dock`）、时钟位置记忆 `freeX/freeY=779,12`。脚本按「**用户状态感知**」执行：
  - 吸附开关类断言只校验「设置页 UI 与当前配置一致」，「默认开启」由契约默认值与迁移保证，避免把用户偏好误判为失败；
  - 开机自启测试先把基线**归零**再验证「开启 → 新增登录项」，结束后**恢复用户原有自启状态**（`registry.restoredToBaseline = {ok:true,autoStart:true}`，HKCU Run 条目恢复）；
  - 结束时六组设置按快照还原并落盘复核（`G1`/`G3`）。
- 最终磁盘状态：`schemaVersion=6`、`clock.snapToEdge=true`、`clock.freeX/freeY=779/12`、`music.snapToEdge=false`、`system.autoStart=true`、HKCU Run 存在 `com.nexus.dock` —— 与验收前一致，未被脚本破坏。

## 5. 已知限制与待人工验收

1. **真实拖动吸附**（US-16）：CDP 无法可靠模拟系统级窗口拖动，需人工：关闭开关后拖动时钟「拖到哪停在哪」并重启确认位置还原；开启后「松手吸附最近边（12px）」。
2. **时钟吸附关闭后的副屏坐标**：逻辑按绝对坐标就近选屏（与 v1.1 一致），多显示器场景建议人工确认一次。
3. **准则的人工约束**：`docs/window-conventions.md` 是流程准则，无法被脚本自动强制；新增窗口须在评审时对照 §2/§4 清单逐项签字（本文件 §5 矩阵同步更新）。
4. **脚本名称说明**：`scripts/v11-verify.mjs` 为 v1.1 历史快照（断言 `schemaVersion=5`），v1.2 起使用 `scripts/v12-verify.mjs`；后续版本请复制最新脚本并同步断言，不要修改历史快照。

---

# v1.3 设置信息架构重构 验收（2026-10-30）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限）· Electron 44.10.0 · **Nexus Dock v1.3.0**（设置页 footer 实测 v1.3.0）
> 验收方式：`node scripts/v13-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动四窗口，覆盖 US-18/US-19 并回归 v1.1/v1.2 能力
> 机器证据：[`docs/verification/v1.3/v13-report.json`](verification/v1.3/v13-report.json)（**44 checks / 44 passed / 0 failed / 0 exceptions**）；截图目录：[`docs/verification/v1.3/`](verification/v1.3/)
> 对应规格：`docs/spec.md` §10；准则真源：`docs/window-conventions.md` §2/§2.1；方案：`docs/plan.md` §15。

## 1. 构建与安装门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误 |
| 生产构建 | `npm run build` | ✅ 成功（settings 资源随重构更新） |
| 配置迁移 | 旧 v6 `settings.json` 启动 | ✅ `schemaVersion=7`；新增字段 `music.alwaysOnTop=true`、`music.onlyOnDesktop=false`、`clock.onlyOnDesktop=false`，旧字段与位置全部保留 |
| 安装版更新 | `npm run install:local` | ✅ `%LOCALAPPDATA%\NexusDock` 更新至 v1.3.0，footer 显示 v1.3.0 |

## 2. AC 逐条验收（v13-report.json 字段）

### US-18 设置分组重构与窗口共性统一管理

| AC | 结果 | 证据 |
|---|---|---|
| AC-18.1 系统页新增「窗口共性设置」+ 三个默认收起折叠栏 + 状态摘要 | ✅ | `C3`：页面含「窗口共性设置/锁定全部窗口位置/Dock/音乐卡片/桌面时钟」；`.nx-acc-head` 恰好 3 个、全部 `aria-expanded=false`、摘要含「吸附/置顶」状态；截图 `settings-system.png` |
| AC-18.2 折叠栏内五项设置 + 移回默认位置 | ✅ | `C6` Dock 折叠栏展开后含「自动吸附屏幕边缘/始终置顶/仅在桌面显示/锁定位置/移回默认位置」五项；`E0`/`H0` 音乐/时钟折叠栏同样五项；`E6` 点击音乐「移回默认位置」→ `anchor='dock'`、`freeX/freeY=-1` |
| AC-18.3 窗口页只保留独有特性 | ✅ | `C2` 时钟页含显示/秒/日期/字号/透明度且不含吸附/置顶/移回默认；`C4` 音乐页含音乐卡片/卡片宽度/进度样式/卡片位置且不含共性项；`C5` Dock 页含停靠边/沿边位置/图标尺寸/背景不透明度且不含共性项；截图 `settings-dock.png` / `settings-music.png` / `settings-clock.png` |
| AC-18.4 共性能力补齐（音乐 alwaysOnTop/onlyOnDesktop、时钟 onlyOnDesktop） | ✅ | `A3b` 三个新字段均为布尔；`E4` 音乐「始终置顶」切换落盘且 UI 同步；`E5` 音乐「仅在桌面显示」、`H4` 时钟「仅在桌面显示」切换落盘且 UI 同步 |
| AC-18.5 行为生效（置顶 / 仅在桌面显示） | ✅（渲染层 + 代码审查） | `windowManager`：音乐创建/设置变更走 `setAlwaysOnTop(settings.music.alwaysOnTop,'floating')`；`applyFloatingVisibility()` 对三窗口按 `onlyOnDesktop` 在最大化/全屏时隐藏、回桌面恢复，且不覆盖 `visible=false` 窗口；真实最大化/全屏行为列入人工项 |
| AC-18.6 v6→v7 迁移保留旧配置 | ✅ | `A3`：`schemaVersion=7`，`musicSnapToEdge/clockSnapToEdge/lock` 等旧字段保留；`H5`：时钟除 `visible/freeX/freeY`（测试操作会改写）外 9 个字段与测试前一致；`G3` 磁盘复核 `schemaVersion=7` |
| AC-18.7 折叠栏可键盘操作 + 动效降级 | ✅（实现 + 代码审查） | 原生 `<button aria-expanded>`；展开体使用 `nx-fade-in var(--nx-dur-base)`，`reduced-motion` 由 motion.css 全局降级；`C6`/`E0`/`H0` 展开/收起状态切换实测 |
| AC-18.8 工程质量 | ✅ | typecheck/build 0 错误；CDP 44/44、0 例外（`A8`） |

### US-19 窗口行为准则同步

| AC | 结果 | 证据 |
|---|---|---|
| AC-19.1 准则更新（C11/C12 + §2.1 信息架构规则） | ✅ | `docs/window-conventions.md`：C11「仅在桌面显示」、C12「移回默认位置」、§2.1「共性归系统/折叠栏/独有归窗口/能力一致/默认值稳定」 |
| AC-19.2 符合性矩阵 v1.3 | ✅ | 矩阵中三窗口 C3/C4/C5/C11/C12 均标注由系统页统一管理；设置窗口豁免项登记 |
| AC-19.3 交叉引用一致 | ✅ | spec §4/§10、plan §15、README 文档表、操作指南 v1.3 段均引用准则 |

## 3. 截图证据（`docs/verification/v1.3/`）

| 文件 | 内容 |
|---|---|
| `settings-system.png` | 系统页：开机自启 + 窗口共性设置（三个窗口折叠栏**默认收起** + 状态摘要，锁定 1/3 示例） |
| `settings-system-dock-expanded.png` | 展开 Dock 折叠栏：吸附/置顶/仅在桌面/锁定/移回默认位置五项 |
| `settings-system-music-expanded.png` | 展开音乐卡片折叠栏（v1.3 新增「始终置顶」「仅在桌面显示」） |
| `settings-system-clock-expanded.png` | 展开桌面时钟折叠栏 |
| `settings-dock.png` / `settings-music.png` / `settings-clock.png` | 三个窗口页面（仅独有特性，底部提示共性项已移至系统页） |
| `clock-default.png` / `clock-seconds.png` / `clock-light.png` | 时钟显示回归 |
| `dock-locked.png` / `clock-locked.png` / `music-locked.png` | 位置锁定回归 |

## 4. 验收夹具与现场恢复

- 验收前快照：用户已开启开机自启（HKCU Run 有 `com.nexus.dock`）、Dock 处于单独锁定状态（`lock.dock=true`）、音乐吸附关闭、时钟吸附关闭；脚本启动时快照六组设置，结束时一次 `settings.update` 还原并落盘复核（`G1`/`G3` 全组相等）。
- 开机自启测试沿用 v1.2 的「基线归一化 + finally 恢复」策略：先归零 → 验证开启新增登录项 → 关闭 → 恢复用户原有开启状态（`registry.restoredToBaseline={ok:true,autoStart:true}`，HKCU Run 条目恢复）。
- 折叠栏相关测试只改共性字段并在每个用例后还原，`E6` 位置复位的改动也由 `G1` 快照还原覆盖。

## 5. 已知限制与待人工验收

1. **「仅在桌面显示」真实表现**（US-18 / C11）：CDP 无法制造真实最大化/全屏前台窗口，脚本验证字段与 UI 联动；请人工最大化一个应用确认音乐卡片/时钟自动隐藏、回到桌面恢复（Dock 既有行为一并确认）。
2. **音乐卡片「始终置顶」层级效果**：脚本验证设置写入与 `setAlwaysOnTop` 调用路径（代码审查），实际覆盖其他窗口的视觉层级建议人工确认。
3. **折叠栏手感**：展开/收起动画 180ms 淡入、状态摘要可读性建议人工体验；键盘 Tab/Enter 可操作（原生 button）。
4. **脚本名称说明**：`scripts/v12-verify.mjs` 为 v1.2 历史快照（断言 `schemaVersion=6`），v1.3 起使用 `scripts/v13-verify.mjs`；后续版本继续复制最新脚本派生，不要修改历史快照。

---

# v1.3.1 修复验收：Dock 唤起保持应用窗口状态（2026-11-01）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限）· Electron 44.10.0 · **Nexus Dock v1.3.1**
> 验收方式：`node scripts/v131-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）调用 Dock 的 `apps:launch`，并用 Win32 窗口状态探测（`Win32 IsIconic/IsZoomed` + `ShowWindow`）验证窗口显示状态
> 机器证据：[`docs/verification/v1.3.1/v131-report.json`](verification/v1.3.1/v131-report.json)（**10 checks / 10 passed / 0 failed / 0 exceptions**）；截图目录：[`docs/verification/v1.3.1/`](verification/v1.3.1/)
> 对应规格：`docs/spec.md` §11；方案：`docs/plan.md` §16。

## 1. 构建与安装门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | ✅ 0 错误 |
| 生产构建 | `npm run build` | ✅ 成功 |
| 安装版更新 | `npm run install:local` | ✅ `%LOCALAPPDATA%\NexusDock` 更新至 v1.3.1（`env.appVersion=1.3.1`、`isPackaged=true`） |

## 2. AC 逐条验收（v131-report.json 字段）

| AC | 结果 | 证据 |
|---|---|---|
| AC-20.1 最大化状态保持 | ✅ | `W2` fixture 设为最大化（`max=true`，rect≈全屏）；`W3` 通过 Dock 唤起后仍 `max=true`、`min=false`，**不再出现「先最大化再还原」**；截图 `maximized-preserved.png` |
| AC-20.2 唤起仍置前 | ✅ | `W3`/`W5` 中 `foregroundTitle=Nexus WindowState Probe`，Dock 唤起后窗口获得前台焦点 |
| AC-20.3 最小化恢复并保留最大化 | ✅ | `W4` 最小化（`min=true`）；`W5` Dock 唤起后 `min=false` 且 `max=true`（恢复到最小化前的最大化状态）；截图 `minimized-restored-maximized.png` |
| AC-20.4 普通状态保持 / 首次启动正常 | ✅ | `W6` 普通窗口（`max=false,min=false`）唤起后仍普通；`W1` 未运行的 fixture 首次通过 Dock 启动成功（`result.ok=true`）并出现窗口 |
| AC-20.5 工程质量 | ✅ | typecheck/build 0 错误；验收 10/10、0 运行时异常；`W7` 验收后 apps 列表与验收前完全一致（11 项，无 fixture 残留） |

## 3. 截图证据（`docs/verification/v1.3.1/`）

| 文件 | 内容 |
|---|---|
| `maximized-preserved.png` | fixture 窗口最大化后经 Dock 唤起，仍保持最大化（核心用例） |
| `minimized-restored-maximized.png` | 最小化后经 Dock 唤起，恢复为最小化前的最大化状态 |

## 4. 验收夹具与现场恢复

- fixture 为独立编译的 WinForms 测试窗口（标题 `Nexus WindowState Probe`，编译到 `%LOCALAPPDATA%\NexusDock\v131-fixture`），**不启动、不关闭用户的真实应用**。
- 测试开始前把 fixture 临时注入 Dock apps 列表；结束时删除 fixture、恢复 `apps` 原始列表（`W7` 校验 11 项、JSON 全等）、只关闭 fixture 自己的进程。
- 不使用 `settings` 其他字段，验收后用户配置（schemaVersion 7、位置/外观/开机自启等）保持不变。

## 5. 已知限制与待人工验收

1. **本机自动化已全覆盖三种窗口状态**（最大化/最小化/普通）与首启置前；建议你用真实应用（如已最大化的浏览器/编辑器）再点一次 Dock 图标确认实际手感。
2. **应用自身记忆状态**：若某个应用被关闭后重新启动时自行恢复窗口状态，Dock 的唤起不会覆盖它（v1.3.1 只保证「唤起时不主动改变显示状态」）。
3. **脚本说明**：`scripts/v131-verify.mjs` 是本次修复的专用验收脚本；后续版本可继续派生，不要修改历史快照（`v12/v13` 脚本断言的是旧 schemaVersion）。

---

# v1.4 轻量化验收（2026-11-01）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限）· Electron 44.10.0 · **Nexus Dock v1.4.0**
> 验收方式：`node scripts/v14-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动时钟 / 音乐卡片 / 设置窗口；内存用 `scripts/mem-probe.ps1` 采样，Electron 进程归因来自 `app.getAppMetrics()`
> 机器证据：[`docs/verification/v1.4/v14-report.json`](verification/v1.4/v14-report.json)（**17 checks / 17 passed / 0 failed / 0 exceptions**）；截图目录：[`docs/verification/v1.4/`](verification/v1.4/)
> 对应文档：README「v1.4 轻量化」段、`操作指南.md`「7. 内存占用与轻量化」、任务 `docs/tasks.md` v1.4；准则回归：`docs/window-conventions.md` C6/C7/C10 未退化。

## 1. 量化对比（工作集 MB）

采样工具 `scripts/mem-probe.ps1`；Electron 进程归因来自 `app.getAppMetrics()`，桥进程按「启动前后 PID 差集」归因。基线为同一台机器 v1.3.1 安装版。

| 组成 | v1.3.1 基线 | v1.4 默认配置 | v1.4 + 低配模式（`NEXUS_LOW_END=1`） |
|---|---|---|---|
| GPU | 122.0 | 123.7 | 59.0 |
| Browser（主进程） | 108.1 | 108.5 | 109.4 |
| Tab（Dock） | 100.5 | 102.2 | 111.0 |
| Tab（时钟） | 78.0 | 75.7 | 77.7 |
| Utility（NetworkService） | 44.6 | 44.8 | 44.5 |
| **Electron 5 进程合计** | **457.4** | **459.2** | **406.9** |
| 常驻桥 | 198.6（smtc-bridge.ps1 ≈101.7 + desktop-state.ps1 ≈104.4，共 2 个） | 14.2（desktop-state.exe，1 个） | 14.2（desktop-state.exe，1 个） |
| **总计** | **656.0** | **473.4** | **421.1** |
| 相比基线 | – | **-182.6（-27.8%）** | **-234.9（-35.8%）** |

> 说明：v1.4 默认配置采样时 `music.visible=false`，SMTC 桥完全不启动（即本轮「按需启停」的验证点）；桌面状态桥由原 PowerShell 版换成原生 `desktop-state.exe`。Electron 5 进程合计与基线基本持平（+1.8MB，属采样波动），内存收益主要来自常驻桥从 198.6MB 降到 14.2MB；低配模式再通过关闭硬件加速把 GPU 从 123.7MB 降到 59.0MB。分项为采样中的主要进程，合计取同一时刻全部 Electron 进程（含未单列的约 4MB Utility 辅助进程），因此各分项相加略小于合计。

## 2. 本轮改动清单

1. **SMTC 桥按需启停**（`src/main/media/mediaHub.ts` + `src/main/index.ts`）：仅当 `music.visible === true && music.source === 'system'` 时拉起；条件不再满足立即 kill 子进程并广播空状态；设置变更 500ms 去抖，避免反复启停。
2. **桌面状态桥原生化**（`resources/desktop-state.cs` → `desktop-state.exe`，9.7KB）：C# P/Invoke（`GetForegroundWindow` / `GetWindowRect` / `IsZoomed` / `MonitorFromWindow` / `SPI_GETWORKAREA`）；协议与旧 `.ps1` 一致（JSON Lines / UTF-8 无 BOM / `--interval` / `--watch-stdin`）；找不到 exe 或启动失败自动回退 `.ps1`。采样 400ms → 800ms，且仅当任一窗口 `onlyOnDesktop=true` 时运行。
3. **时钟渲染层去 React**（`src/renderer/clock/main.ts` 原生 TS DOM，替代 `main.tsx` + `ClockWindow.tsx`）：`data-locked` / `data-theme` / `.clock-time` / `.clock-date` / `.clock-period` / title+aria 等 DOM 契约全部保留；构建产物中 clock 入口 JS `clock-BSHbl893.js` 为 9,994B（≈10KB，另有 0.8KB 共享模块），**不再加载 569,942B 的 `jsx-runtime`（react-dom）共享 chunk**（验收字段 `usesReact=false`）。
4. **music / clock 恢复 `backgroundThrottling: true`**（Dock 保持 `false`）：时钟隐藏时停走时、可见即补；音乐进度 rAF 加 visibility 门控、重新可见立即补帧；删除死代码 `useSmoothProgress`。
5. **运行态检测 `tasklist` 轮询 4s → 10s**。
6. **Chromium 轻量化开关**（`app ready` 前）：`--disable-background-networking` / `--disable-component-update` / `--disable-domain-reliability` / `--disable-sync` / `--disable-breakpad`；`NEXUS_LOW_END=1` 时 `app.disableHardwareAcceleration()`。
7. **新增内存自测**：`src/main/diagnostics.ts`（`NEXUS_MEM_REPORT=<文件>` 或 `%APPDATA%\nexus-dock\mem-report.on` 标记文件 → 每 5s 采样 `app.getAppMetrics()` 写 `logs\memory.jsonl`，默认零成本）；`scripts/mem-probe.ps1` 探针；`scripts/v14-verify.mjs` CDP 验收。

## 3. 验收项与结果（v14-report.json 字段）

| 验收项 | 结果 | 证据 |
|---|---|---|
| 时钟 DOM 契约（root / theme / data-locked / title+aria / 锁定图标） | ✅ | `clock-root-exists`：`className="clock-root nx-glass"`、`theme=dark`、`locked=true`、`title="位置已锁定：设置 → 系统 解锁"`、`aria="桌面时钟（位置已锁定：设置 → 系统 解锁）"`、`hasLockIcon=true`、**`usesReact=false`** |
| 时钟不再依赖 React | ✅ | 同上 `usesReact=false`；clock 入口 9,994B，无 `jsx-runtime` 引用（构建产物核对） |
| 时钟时间 / 日期格式 | ✅ | `clock-time-format=16:46`、`clock-date-format=11月1日 周日` |
| 时钟时间准确 | ✅ | `clock-time-accurate`：DOM `16:46` 与系统时间一致 |
| 时钟真实走时 | ✅ | `clock-ticks-live`：两次采样 `16:46:51 → 16:46:53`（秒级推进） |
| 时钟主题 / 锁定属性 / 锁定提示 | ✅ | `clock-data-theme=dark`、`clock-locked-attr=true`、`clock-lock-hint`（title+aria 含解锁路径） |
| Dock 渲染回归（11 项） | ✅ | `dock-api-available`（`hasNexus=true`、`items=11`、`locked=true`）、`dock-items-rendered`（11 项） |
| 音乐卡片开启 → SMTC 桥 +1 进程 | ✅ | `music-enabled-spawns-smtc-bridge`：powershell 3 → 4；`music-enabled-flag`（enabled=true / disabled=false） |
| 音乐卡片关闭 → 桥进程回收 | ✅ | `music-disabled-kills-smtc-bridge`：powershell 4 → 3 |
| music 窗口创建 | ✅ | `music-window-created`：`.../out/renderer/music/index.html` |
| 设置窗口可打开并渲染 | ✅ | `settings-window-opens`、`settings-renders`（标题「Nexus 设置」、textLength 414） |
| 内存量化对比 | ✅ | §1 表：默认 473.4MB（-27.8%）、低配 421.1MB（-35.8%） |
| C11「仅在桌面显示」端到端 | ✅（人工/端到端） | 最大化资源管理器 → Dock + 时钟 `visible=false`；还原 → `visible=true`；截图 `before-desktop.png` / `after-desktop.png` |
| 低配模式可用 | ✅ | `NEXUS_LOW_END=1` 采样 421.1MB（GPU 59.0MB）；截图 `after-lowend-desktop.png` |
| 静态门禁 | ✅ | `npx tsc --noEmit` exit 0；`npm run build` 成功 |

## 4. 证据文件

| 文件 | 内容 |
|---|---|
| `docs/verification/v1.4/v14-report.json` | CDP 验收报告（17 checks / 17 passed / 0 failed） |
| `docs/verification/v1.4/before-desktop.png` | v1.3.1 基线桌面（改造前） |
| `docs/verification/v1.4/after-desktop.png` | v1.4 默认配置桌面（最大化窗口还原后 Dock / 时钟可见） |
| `docs/verification/v1.4/dock-after.png` | v1.4 默认配置下 Dock 渲染 |
| `docs/verification/v1.4/clock-after.png` | v1.4 默认配置下时钟渲染 |
| `docs/verification/v1.4/after-lowend-desktop.png` | v1.4 低配模式桌面 |
| `docs/verification/v1.4/dock-after-lowend.png` | v1.4 低配模式下的 Dock 渲染 |
| `docs/verification/v1.4/clock-after-lowend.png` | v1.4 低配模式下的时钟渲染 |

## 5. 已知限制与说明

1. **内存为工作集瞬时采样**：同一机器、同一时段前后对比才有意义，单次采样有 ±几 MB 波动；Electron 5 进程合计与基线基本持平（+1.8MB）属正常波动，收益不来自这里。
2. **SMTC 桥完全退出意味着关闭期间不可控制系统媒体**：音乐卡片隐藏时没有 UI 入口，行为无变化；重新显示卡片会自动拉起桥（500ms 去抖）。
3. **桌面状态 exe 回退路径**：极端环境（无 .NET Framework 4 / 安全软件拦截）会回退到 `desktop-state.ps1`，此时该桥内存回到基线水平（约 104MB），功能不受影响。
4. **低配模式代价**：关闭硬件加速后透明窗口仍可用，但动画改由 CPU 合成，低端机可能掉帧；属可选模式，默认不开启。
5. **时钟去 React 的收益体现**：减少的是 JS 解析/编译与堆占用（时钟渲染进程工作集 78.0 → 75.7MB），主要内存收益仍来自桥进程的消除。

---

# v1.4.1 修复验收（2026-11-01）

> 环境：Windows 11 build 26200 · **安装版** `%LOCALAPPDATA%\NexusDock`（正常权限）· **Nexus Dock v1.4.1**
> 验收方式：`node scripts/v141-verify.mjs` 通过 CDP（`--remote-debugging-port=9224`）驱动 Dock / 设置窗口；窗口存在性用 `scripts/out/win-probe.exe WINS`（UIA 顶层窗口）核对
> 机器证据：[`docs/verification/v1.4.1/v141-report.json`](verification/v1.4.1/v141-report.json)（**17 checks / 17 passed / 0 failed / 0 exceptions**）；截图目录：[`docs/verification/v1.4.1/`](verification/v1.4.1/)
> 触发与对应文档：用户反馈「点开 Dock 栏的 DockApp 软件图标不会打开设置栏」；README「v1.4.1 修复」、`docs/spec.md` §12（US-21）、`docs/plan.md` §17、任务 `docs/tasks.md` 阶段 24

## 1. 修复前现场与根因（实测）

| 证据 | 内容 |
|---|---|
| Dock 配置 | 第一项 `custom-14d5c3098e71`（名称 `NexusDockApp`），`path = %LOCALAPPDATA%\NexusDock\NexusDockApp.exe` |
| `logs/launch.log` | 点击该图标后：`launch id=custom-14d5c3098e71 name=NexusDockApp ...` → `COM(path) found=true title=Nexus 时钟 activated=true` |
| UIA 顶层窗口 | 当时只有 `Nexus Dock` / `Nexus 时钟`，**没有 `Nexus 设置`** |

**根因链路**（逐环见 `docs/plan.md` §17.1）：自身图标指向本程序 exe → `launchApp` 走 `launchAndFocus` 的「已有窗口优先」分支 → 该分支用进程名匹配窗口，四个窗口的进程名都是 `NexusDockApp`，而 `$selfTitles` 漏了 `Nexus 时钟` → 时钟窗口被当成「目标应用已打开」并置前（`FOUND`），不启动第二实例 → `second-instance` 不触发 → `openSettingsWindow()` 不执行。

## 2. 修复内容与构建/安装门禁

| 项 | 结果 | 证据 |
|---|---|---|
| 入口识别 `isSelfApp()` | ✅ | 用 `app.getPath('exe')` / `process.execPath` 规范化比对 `item.path` / `aumid`；`.lnk` 经 `shell.readShortcutLink` 解析目标；命中即 `openSettingsWindow()` 并返回 `{ ok: true }`，不再启动进程 |
| 置前脚本兜底 | ✅ | `$selfTitles` 增加 `Nexus 时钟`，四个自身窗口标题齐全，自窗口一律不当目标窗口 |
| 类型检查 | ✅ | `npm run typecheck` → exit 0（无输出错误） |
| 构建 | ✅ | `npm run build` → `electron-vite build` 成功 |
| 安装版版本 | ✅ | `installed-build-v141`：`packaged=true`、`appVersion=1.4.1` |

## 3. 逐条 AC 验收（v141-report.json 字段）

| AC | 验收项 | 结果 | 机器证据（check id / detail 摘要） |
|---|---|---|---|
| AC-21.1 | 左键（IPC 路径）点击自身图标 → 设置面板出现 | ✅ | `self-launch-opens-settings`：`launchResult.ok=true` + `/settings/` target 出现 |
| AC-21.1 | 设置面板渲染完整 | ✅ | `settings-window-renders`：`title="Nexus 设置"`、`textLength=414`、`focus=true`、`hidden=false` |
| AC-21.1 | 设置窗口为真实顶层窗口、未最小化、在屏 | ✅ | `settings-window-on-screen`：`hwnd=987004`、`pid=313712`、`min=false`、`rect=[556,153,1150,922]` |
| AC-21.1 | 像素级证据（不受其它窗口遮挡） | ✅ | `settings-window-capture`：CDP 窗口截图 184,401B → `settings-window.png` |
| AC-21.2 | 已打开时再次点击不重复创建 | ✅ | `no-duplicate-settings-window`：`settingsTargets=1` |
| AC-21.3 | 真实鼠标左键点击 Dock 图标同样打开设置 | ✅ | `dock-icon-real-click-opens-settings`：点击坐标取自 `[data-dock-id]` 元素中心、`onScreen=true`、截图 184,401B |
| AC-21.3 | 右键「打开」与左键同链路 | ✅（代码走查） | `ipc.ts` 的 `showItemMenu`「打开」与 Dock 左键都调用 `launchApp(id)`，本次修复在 `launchApp` 入口生效；未对原生菜单做自动化点击 |
| AC-21.4 | `.lnk` 指向自身 exe 也打开设置 | ✅ | `lnk-self-opens-settings`：临时创建 `DockApp-link.lnk`（目标=安装 exe）→ `ok=true` + settings target |
| AC-21.4 | `aumid` 存 exe 路径分支 | ✅（代码保证，未单独自动化） | `isSelfApp` 的 candidates 同时包含 `item.path` 与 `item.aumid`；本机条目为 `path` 形式 |
| AC-21.5 | 非自身应用不误触发设置面板 | ✅ | `non-self-app-does-not-open-settings`：自定义 exe fixture（`win-probe.exe` 副本）→ `settingsTarget=null`；`launch.log` 记录正常启动链路 `COM ... FAILED ... 启动后未检测到窗口`，证明未走自身分支 |
| AC-21.6 | 桌面快捷方式二次启动 → 单实例 → 打开设置 | ✅ | `second-instance-opens-settings`：WMI 再启一次安装 exe（`spawnReturn=0`）→ settings target 出现，仍未出现第二个 Dock 主进程 |
| AC-21.7 | 不重复启动主进程 | ✅ | `no-second-main-process`：`before=1`、`after=1` |
| AC-21.7 | 启动日志记录自身识别 | ✅ | `launch-log-self-detected`：`→ 识别为 Nexus Dock 自身：打开设置面板` |
| AC-21.7 | 工程质量 | ✅ | `npm run typecheck` 0 错误、`npm run build` 成功（见 §2） |
| 前置 | 现场可重复 | ✅ | `dock-target-available`、`installed-build-v141`、`self-dock-item-found`、`settings-closed-before-test`、`single-main-process-before`、`dock-apps-restored`（11→11） |

## 4. 证据文件

| 文件 | 内容 |
|---|---|
| `docs/verification/v1.4.1/v141-report.json` | CDP 验收报告（17 checks / 17 passed / 0 failed），含每条 check 的 AC 标签与 detail |
| `docs/verification/v1.4.1/settings-window.png` | **设置窗口 CDP 窗口级截图**（标题栏「Nexus 设置」、底部版本 `Nexus Dock v1.4.1`） |
| `docs/verification/v1.4.1/dock-window.png` | Dock 窗口 CDP 截图（含自建 NexusDockApp 图标） |
| `docs/verification/v1.4.1/settings-opened.png` | 全屏截图：左键（IPC 路径）打开后设置面板置顶显示 |
| `docs/verification/v1.4.1/settings-after-dock-click.png` | 真实鼠标点击后设置窗口的 CDP 窗口级截图 |
| `docs/verification/v1.4.1/dock-click-opened-settings.png` | 全屏截图：真实鼠标点击 DockApp 图标后设置面板显示 |
| `docs/verification/v1.4.1/second-instance-opened-settings.png` | 全屏截图：二次启动（单实例）后设置面板显示 |

## 5. 已知限制与说明

1. **测试机前台遮挡**：验收时 DeepSeek Harness 会话窗口占满屏幕且常驻最前；CDP 合成点击不会把系统前台交给 Dock，因此设置窗口会落在 Harness 后面。取证方式为「先 CDP 窗口级截图（不受遮挡影响），再 `SetWindowPos(HWND_TOPMOST)` 临时置顶拍全屏图、拍完 `HWND_NOTOPMOST` 恢复」（report `notes`：`全屏截图前置顶设置窗口：OK:987004`）。真实鼠标点击的观感建议人工再确认一次。
2. **焦点口径**：`document.hasFocus=true` 为 Chromium 视角；系统前台仍为 Harness 是 Windows 前台锁造成的测试环境现象，非功能缺陷。设置窗口由既有 `openSettingsWindow()`（v1.0 起为右键「Dock 设置…」入口）负责 `show()` + `focus()`，本次修复只把入口指向它。
3. **右键菜单「打开」**：与左键共用 `launchApp(id)`，脚本未对原生菜单自动化点击，以代码走查 + 左键同链路覆盖。
4. **`aumid` 存 exe 路径分支**：本机条目为 `path` 形式；`.lnk` 已实测，`aumid` 分支仅由 `isSelfApp` 代码保证。
5. **负向用例 fixture**：`win-probe.exe` 副本是无窗口程序，其启动结果为「启动后未检测到窗口」属 fixture 特性；结论只看「未打开设置面板」且走了正常启动链路。
6. **验收后现场**：安装版已按正常方式（不带调试端口）重启；Dock 条目恢复为 11 项；`v141-fixture` 目录已删除；设置窗口已关闭。

## 6. 复现方式

```powershell
npm run build
npm run install:local
# 用调试端口启动安装版（或直接运行 %LOCALAPPDATA%\NexusDock\NexusDockApp.exe --remote-debugging-port=9224）
node scripts/v141-verify.mjs
```

脚本流程：关闭遗留设置窗口 → 从 `apps:list` 取指向安装 exe 的自身条目 → 依次跑 AC-21.1~21.7 → 恢复 `apps` 列表 → 删除 fixture → 关闭设置窗口；不修改用户其它设置。




---

# v1.5.0 验收记录（2026-11-01）

> 版本：`package.json` **1.5.0**；设置 schemaVersion **7 → 8**；对应任务 `docs/tasks.md` 阶段 25。
> 结论：**自动化 9/9 通过 + 溢出压力 5/5 通过**；配置迁移零丢失；用户原有 11 个应用、三窗口锁定、Dock 自由坐标全部保留。

## 1. 环境与命令

```powershell
npm run check            # typecheck + 12 项共享契约单测（无需 Electron）
npm run build
npm run install:local    # 同步 out/ + resources/ + package.json 到 %LOCALAPPDATA%\NexusDock

# 安装版带调试端口启动（本宿主环境从受限终端启动需要 --no-sandbox；正常双击快捷方式不需要）
& "$env:LOCALAPPDATA\NexusDock\NexusDockApp.exe" --no-sandbox --remote-debugging-port=9333
$env:NEXUS_CDP_PORT='9333'
$env:NEXUS_SETTINGS_BACKUP="$env:APPDATA\nexus-dock\settings.v141-<时间戳>.json"   # 迁移前备份，用于校验零丢失
node scripts/v15-verify.mjs
node scripts/v15-overflow-check.mjs
```

## 2. 自动化验收（scripts/v15-verify.mjs，9/9）

| AC | 验收项 | 结果 | 证据（report.detail 摘要） |
|---|---|---|---|
| AC-25.1 | 版本 1.5.0 且设置 v7→v8 迁移零丢失 | ✅ | `version=1.5.0 schema=8 musicTheme=dark apps=11（迁移前 11）`；dock.edge/alongPercent 与迁移前一致 |
| AC-25.2 | 托盘图标创建成功 | ✅ | 主进程日志 `[tray] 托盘图标已创建`；启动 stderr 无 `notify_icon` 报错 |
| AC-25.3 | Dock 渲染层：上限注入 + roving tabindex + 菜单语义 | ✅ | `items=11/11 maxW=1682px roving=1 haspopup=11 scrollable=null`（11 图标不溢出，符合预期） |
| AC-25.4 | 方向键在 Dock 图标间移动焦点 | ✅ | `bottom ArrowRight: NexusDockApp → 文件资源管理器` |
| AC-25.5 | 末端开关点击区 ≥24px | ✅ | `[{w:32,h:32},{w:32,h:32}]`（iconSize 45 × 0.72 = 32） |
| AC-25.6 | `dock:snap` 死通道修复（不再 reject） | ✅ | `返回 true`；测试后已把 Dock 位置/吸附开关还原 |
| AC-25.7 | 音乐卡片 data-theme 生效且空闲态不扫光 | ✅ | `{found:true, theme:"dark", sweeping:false, hasProgress:true}` |
| AC-25.8 | 设置面板：7 分组/无错误条/锁定 x/3/恢复默认应用列表/音乐主题 | ✅ | `{navCount:7, hasErrorBanner:false, systemLockLabel:true, resetAppList:true, musicTheme:true, version:"Nexus Dock v1.5.0"}` |
| AC-25.9 | 日志单文件 ≤1MB（轮转生效） | ✅ | `{main.log:264, desktop.log:31010, media.log:557426, launch.log:61623}`（未到 1MB，阈值生效路径已由单测/代码保证） |

证据文件：
- `docs/verification/v1.5/v15-report.json`（9 条 check 的 AC 标签与 detail）
- `docs/verification/v1.5/dock-v1.5.png`（Dock 窗口截图：11 图标 + 运行点 + 末端音乐/时钟按钮）
- `docs/verification/v1.5/settings-v1.5.png`（设置窗口：7 分组、音乐页新增「主题」、底部 `Nexus Dock v1.5.0`）
- `docs/verification/v1.5/music-card.png`（音乐卡片空闲态：进度条静止、上一首/播放/下一首禁用）

## 3. 溢出压力验收（scripts/v15-overflow-check.mjs，5/5）

场景：临时把 11 个图标复制为 **25 个** + `iconSize 80` + `gap 32`，跑完自动还原。

| AC | 验收项 | 结果 | 证据 |
|---|---|---|---|
| AC-25.10 | Dock 窗口宽度被夹紧到工作区（不伸出屏幕） | ✅ | `windowW=1684` ≤ `screenAvailW=1707`（1707−24=1683 上限，含 1px 亚像素余量） |
| AC-25.11 | 溢出时挂载 `data-scrollable` 且图标区可滚动 | ✅ | `.dock-items[data-scrollable="true"]`，`scrollWidth=2768 > clientWidth=1475` |
| AC-25.12 | 末端音乐/时钟开关仍在可视区内 | ✅ | 两个开关 rect 右边界 1589/1653 < 窗口 1684 |
| AC-25.13 | 滚动到末尾后最后一个图标可达 | ✅ | `scrollLeft=1293 = maxScroll=1293`，最后一项 `inView=true` |
| AC-25.14 | 压力测试后设置已还原 | ✅ | `apps=11 iconSize=45 gap=9` |

证据文件：`docs/verification/v1.5/overflow-report.json`、`dock-overflow-25-items.png`、`dock-restored.png`。

## 4. 共享契约单测（npm test，12/12）

覆盖：任意垃圾输入收敛不抛错、数值夹紧、非法枚举回退、**空应用列表是合法状态（旧 bug：删空会复活 6 个内置应用）**、条目过滤、深合并不破坏其它分组、apps 整体替换、patch 夹紧、默认设置 sanitize 幂等、IPC 通道唯一性、屏幕边距与方向判定、托盘图标资源合法性（PNG magic + 16/32 尺寸）。

## 5. 未能自动化、需人工确认的项

1. **托盘图标的视觉与单击/双击手感**：本会话里 Windows 11 的 XAML 托盘在任务栏自动隐藏时 UI Automation 读不到图标名，只能从主进程日志 + 无 `notify_icon` 报错证明 `Shell_NotifyIcon` 成功。请肉眼确认图标样式与三种操作（单击显隐 / 双击设置 / 右键菜单）。
2. **真实拖动吸附手感、锁定后鼠标不可拖、动效主观手感**：物理交互，脚本只能验字段与几何。
3. **开机自启在真实登录后的行为**：需要注销/重启；写入/回读/回滚已由 v1.1 覆盖，本轮只增加 portable 路径修正。

## 6. 已知未做（本轮范围外，含证据与接入点）

| # | 缺口 | 证据 | 原因 |
|---|---|---|---|
| 1 | Dock 自动隐藏（贴边滑出） | `DockConfig` 无 autoHide 字段；悬停仅放大 | 本轮用户只选了「托盘」一项新功能 |
| 2 | 应用搜索 / 全局热键启动器 | 全仓无 `globalShortcut`；唯一搜索框只过滤开始菜单候选 | 工作量大（3–5 天） |
| 3 | 拖拽 .exe/.lnk 到 Dock 添加 | Dock 的 drag 全是指针排序，无 onDrop | 同上 |
| 4 | UWP（开始菜单添加的 Store 应用）无图标、运行点不亮 | `apps.ts` 中 UWP 的 `path` 为空；`EXE_BY_ID` 仅内存态、重启丢失；`.lnk` 取到的是快捷方式名 | 需要给 `DockItem` 持久化 exePath + 迁移，风险中等 |
| 5 | 点击图标启动链路仍走 UIA 全量窗口枚举（最坏 4 个 PowerShell、20s+） | `apps.ts` Get-Wins + 18×350ms 轮询 | 改动核心启动链路，需完整回归 UWP/快捷键/置前，单独排期 |
| 6 | 多显示器"选屏/每屏一个 Dock" | `computeDockBounds` 只跟随窗口所在屏 | spec 明确非目标 |
| 7 | 设置窗/音乐卡片的 `.lnk` 参数带引号会被 `split(/\s+/)` 切坏 | `apps.ts:287` | 低概率（仅自定义条目的 args），单独修 |
| 8 | `desktop-state.ps1` 回退路径缓存主屏尺寸（多屏失真） | `resources/desktop-state.ps1` 循环外取 PrimaryScreen | 原生 .exe 路径正确；仅 fallback 受影响 |

## 7. 本轮验收过程中修正的两处「测试脚本自身误报」

记录以证明结论可信（都是脚本问题，不是产品问题）：
1. AC-25.8 首轮 FAIL：点击设置导航后立刻读 `innerText`，React 尚未重渲染（分组切换还有 220ms 转场）→ 改为分步点击 + 420ms 等待后 PASS。
2. AC-25.11 首轮 FAIL：`data-scrollable` 实际挂在滚动容器 `.dock-items` 上，脚本错读了 `.dock-root` → 修正探测位置后 PASS（同期滚动本身已生效：maxScroll=1293）。

## 8. 验收后现场

- 安装版已按正常方式重启（不带调试端口），5 个进程在跑，用户配置零改动（仅 `music.theme` 新增默认值、`schemaVersion` 升到 8）。
- 迁移前配置备份：`%APPDATA%\nexus-dock\settings.v141-<时间戳>.json`；旧安装树备份：`dist/_backup-v141-<时间戳>/`。

---

# v1.6 验收（2026-11-02）：Dock 应用自定义显示名称与图标

> 环境：Windows 11 · **开发构建**（`out/`，Electron 44.7.0）· **Nexus Dock v1.6.0**
> 验收方式：`scripts/v16-verify.mjs` —— 隔离 userData（`.userdata\v16`）+ `--remote-debugging-port=9344` + CDP 驱动 Dock / 设置窗口，原生文件对话框用 user32/uia 关闭。
> 机器证据：[`docs/verification/v1.6/v16-report.json`](verification/v1.6/v16-report.json)（**18 checks / 18 passed / 0 failed / 0 exceptions**，23 张截图）+ [`docs/verification/v1.6/v16-pick.json`](verification/v1.6/v16-pick.json)（真实选图补测 2/2，含 `importEvidence`）。
> 安全边界：用户安装版 `NexusDockApp` 6 个进程 PID 全程未变；未读写 `%APPDATA%\nexus-dock`（测试日志确认 `[userData] 使用目录：E:\AI WorkRegion\app_creator\.userdata\v16`）。

## 1. 验收项与结果

| AC | 验收项 | 结果 | 证据 |
|---|---|---|---|
| AC-26.1 | 版本 1.6.0 + 设置 v8→v9 迁移零丢失 | ✅ | `version=1.6.0`、`schemaVersion=9`、6 应用名称/图标齐全、`dock.alongPercent=62`/`iconSize=46` 保留、主进程日志出现 `[settings] 已从 v8 迁移到 v9`、落盘配置无 customName/customIcon |
| AC-26.2 | Dock 改名（`updateItem(customName)`） | ✅ | `.dock-item[data-dock-id="explorer"]` 的 `aria-label`/`title` 均为「测试新名字」，设置侧 `customName` 同步 |
| AC-26.3a | 自定义 PNG 图标真实渲染 | ✅ | `icon://v16-test.png`，`<img> naturalWidth=64`、`complete=true`，截图 `dock-custom-icon-png.png` |
| AC-26.3b | 自定义 SVG 图标：MIME + 渲染 | ✅ | CDP `Network.responseReceived`：`icon://v16-test.svg` → 200、`Content-Type: image/svg+xml`；`<img> naturalWidth=64`，截图 `dock-custom-icon-svg.png` |
| AC-26.4 | 恢复默认：DOM 回原值、配置无残留 | ✅ | 名称/图标回默认，`settings.get()` 中该条目 `customName/customIcon` 为 undefined（无 null/空串），`noResidue=true` |
| AC-26.5a | 设置页每行有 ✎，点开弹层且输入框自动聚焦 | ✅ | 6 行 / 6 个编辑按钮，`.nx-app-edit` 唯一，`.nx-app-edit-input focused=true`，截图 `settings-app-edit-open.png` |
| AC-26.5b | 设置页改名保存：弹层关闭、行显示新名+「自定义」徽标、Dock 同步 | ✅ | 受控输入真实改值 → 点「保存」→ 行 `name=设置页改名`、`badge=自定义`、title 含原名，Dock `aria-label` 同步，截图 `settings-apps-customized.png` / `dock-settings-rename.png` |
| AC-26.5c | `requestEdit(id)`（Dock 右键路径）：切「应用」页并打开唯一弹层 | ✅ | 弹层 `count=1`、`previewSub=C:\Windows\explorer.exe`；1.2s 后仍为 1（无重复打开），截图 `settings-request-edit.png` |
| AC-26.5d | 关闭 requestEdit 弹层后不自动复弹 | ✅ | 取消关闭后 1.2s `.nx-app-edit` 数量 0，`consumeEditRequest()` 返回 null（主进程无残留请求） |
| AC-26.5e | 弹层内「恢复默认」生效 | ✅ | Dock 名称/图标回默认，条目对象只剩 `id/name/path/aumid/icon/source`，截图 `settings-apps-after-reset.png` / `dock-after-edit-reset.png` |
| AC-26.6 | 「选择图片…」原生对话框真实打开并可取消 | ✅ | UIA/user32 找到 `#32770`「选择自定义图标图片」→ 截图 `native-icon-dialog.png` → WM_CLOSE 关闭、无残留窗口、IPC 返回 `{ok:false,error:'canceled'}` |
| AC-26.7 | 回归：设置 Dock/应用/音乐/系统四页渲染、无错误条 | ✅ | 四页 `errorBanner=false`、正文长度正常，截图 `settings-*-regression.png` |
| AC-26.8 | 回归：Dock 图标数=配置数、重载后无自身 console error | ✅ | `itemCount=6/6`、`hasRoot=true`、`hasEmpty=false`；页面自身 error 0（已过滤测试探测产生的跨源 fetch 噪声并注明原因） |
| AC-26.9 | 回归：音乐卡片仍可创建并渲染 | ✅ | `data-theme=dark`、进度条存在，截图 `music-card-v16.png` |
| AC-26.10 | 主进程日志无协议/核心异常 | ✅ | 无 protocol/apps 失败、无 Unhandled rejection / TypeError |
| AC-26.11 | 质量门禁：typecheck + 15 tests + build | ✅ | `scripts/out/v16-gates.json`：`checkExit=0`、`testsPassed=15`、`buildExit=0`（18:33 独立复跑） |
| AC-26.6b | 原生对话框真实选 PNG → `importCustomIcon` 归一化导入 → Dock 渲染 | ✅ | 源 640×512 / 5068B → `icon://custom-ef2f9576143e.png`；落盘 7492B、PNG magic + IHDR、**256×205**（最长边 256、比例保持）；Dock `<img naturalWidth=256>`，截图 `dock-pick-png.png` |
| AC-26.6c | 原生对话框真实选 SVG → 原样导入（MIME）→ Dock 渲染 | ✅ | `icon://custom-04c0da75edb8.svg`；导入文件与源**字节级一致**；CDP Network：200 + `Content-Type: image/svg+xml`；Dock `<img naturalWidth=96>`，截图 `dock-pick-svg.png` |

## 2. 补测：真实图片选择完整链路（AC-26.6b/c，2/2 PASS）

AC-26.3 的自定义图标是把夹具直接写进 `icons\` 目录，绕过了 `importCustomIcon()`；AC-26.6 只验证了对话框打开/取消。为覆盖「用户真的选一张图」的完整链路，追加 `--pick` 模式补测：

1. 从 Dock 页面调用 `window.nexus.apps.pickIcon()`（不 await，挂到 `window`）；
2. 原生「打开」对话框用 **user32 子窗口**驱动：`EnumChildWindows` 命中 `ComboBoxEx32 → ComboBox → Edit`（`GetDlgCtrlID=1148`）与 `Button(id=1, 打开(&O))`，`WM_SETTEXT` 写入绝对路径 → `CBN_EDITCHANGE` 刷新按钮状态 → `BM_CLICK` 点「打开」；
3. `await window.__pick` 返回 `{ok:true, icon:'icon://custom-<hash>.<ext>'}`；检查隔离 userData 的 `icons\` 落盘文件、PNG magic/IHDR、尺寸与比例；
4. `updateItem` 后 Dock `<img>` 真实加载并截图。

| 用例 | 源文件 | 导入结果 | 断言 |
|---|---|---|---|
| PNG | 640×512 / 5068B | `icon://custom-ef2f9576143e.png`（7492B） | magic `89 50 4E 47`、IHDR **256×205**（比例 640:512 保持）、Dock `naturalWidth=256` |
| SVG | `pick-source.svg` | `icon://custom-04c0da75edb8.svg` | 导入文件与源**字节级一致**；CDP Network：200 + `Content-Type: image/svg+xml`；Dock `naturalWidth=96` |

证据：`docs/verification/v1.6/v16-pick.json`（`importEvidence` 含 dialog/automation、源尺寸、导入头、Network MIME）、截图 `dock-pick-png.png` / `dock-pick-svg.png` / `native-pick-dialog.png`（PrintWindow 渲染对话框本身）。

> 方法说明：本机中文 Win11「打开」对话框的 UIA 树不暴露文件名框与「打开」按钮（42 个 Edit 全是文件列表属性与搜索框），因此改用上面 user32 子窗口方案；对话框选择后自行关闭，`leftoverDialogs=0`。

## 3. 测试方法说明（避免误判）

1. **不要用页面 `fetch('icon://…')` 验证协议**：`file://` 页面请求自定义协议属跨源，Electron 自定义协议默认不开放 CORS，会误报 `Failed to fetch`；产品设计只用 `<img>` 渲染图标。MIME 断言改用 CDP `Network.responseReceived` 的响应头，并静态核对 `protocol.ts` 的 `ICON_MIME` 映射。
2. 设置页分组切换有 220ms 转场，读取正文前需等待；图标选择是原生模态对话框，测试必须确保对话框已关闭，否则会阻塞整个测试实例。
3. 测试实例使用独立 `--user-data-dir`，因此单实例锁与用户正在运行的安装版互不干扰；结束时按 PID + 命令行含 `.userdata\v16` 清理。

## 4. 需人工确认

1. 自定义图标在真实桌面缩放比例（125%/150%/多屏）下的观感。
2. 选择 1–8MB 大图时的缩放效果（已限制 ≤8MB 并缩到最长边 256px，文件大小会显著下降）。
3. Dock 右键菜单的视觉与点击手感（菜单项文字已由代码与 UI 快照覆盖，但原生菜单不参与自动化截图）。

## 5. 验收后现场（真实安装版）

- 已执行 `scripts/install-local.ps1` 把 v1.6.0 同步到 `%LOCALAPPDATA%\NexusDock`：manifest 版本 **1.6.0**、桌面快捷方式已刷新；旧安装树 `dist/NexusDock-portable` 作为同步源保留。
- 安装前备份用户配置：`%APPDATA%\nexus-dock\settings.v15-backup-20261102-185016.json`。
- 真机迁移结果：`schemaVersion` **8 → 9**；`apps=12`、`dock.edge=bottom`、`iconSize=45`、`freeX/freeY`、`alongPercent` 全部保留；旧条目没有新增 `customName/customIcon` 字段（零污染）。
- 以正常权限运行确认：`launch.log` 记录 `env: lowIntegrity=false`（经 Explorer 启动，5 个进程）；托盘创建成功。
- 真机 UI 本地证据（PNG 已被 gitignore，保留在目录内供复核）：`docs/verification/v1.6/installed-settings-apps.png`（安装版「应用」页：每行 ✎ + 页脚 `Nexus Dock v1.6.0`）、`installed-settings-editor.png`（编辑弹层真实打开）、`installed-settings-editor-closed.png`（Esc 关闭；关闭后 `customFields=0`，未改动用户配置）。
- 说明：安装脚本以 `Start-Process` 直接拉起时会被 DSH 宿主注入的 `ELECTRON_RUN_AS_NODE=1` 影响（Electron 以 Node 模式启动后立即退出，属宿主环境已知问题）；本次改用 Explorer 启动以同时获得正常权限与干净环境变量。日常请双击根目录「启动 Nexus Dock.cmd」或桌面快捷方式。

---

## §v1.7（2026-11-04）：窗口注册表接入 + 设置面板重构 + 「显示桌面」修复

> 环境：Windows 11 · **开发构建**（`out/`，Electron 44.7.0 / Chrome 152.0.7977.130 / Node 24.21.0）· **Nexus Dock v1.7.0**（`isPackaged=false`）
> 验收方式：`scripts/v17-verify.mjs` —— 隔离 userData（`.userdata\v17-verify`）+ `--remote-debugging-port=9352`；启动前写入 **v9** 种子 `settings.json`（UTF-8 无 BOM、不含 `extraWindows` 字段）；CDP 驱动 Dock / 设置窗口；「显示桌面」用内联 PowerShell user32 helper 对**隔离实例自己的** Dock 窗口执行 `ShowWindow(SW_MINIMIZE=6)`（等价 shell 对顶层窗口的最小化）。
> 机器证据：[`docs/verification/v1.7/report.json`](verification/v1.7/report.json) —— **36 checks / 36 passed / 0 failed / 0 exceptions**；同一隔离实例连续跑 2 轮，两轮 check id / ok 完全一致（稳定）。
> 安全边界：未用 `Shell.Application.MinimizeAll` / Win+D；只操作隔离实例 `electron.exe` PID 树内、类名 `Chrome_WidgetWin_1`、标题 `Nexus Dock` 的窗口；用户安装版 `NexusDockApp` 进程 PID 集合全程未变；未重建 `out/`、未改 `src/`、未读写 `%APPDATA%\nexus-dock`。

### 1. 复现方式

```powershell
node scripts/v17-verify.mjs --prepare
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& "node_modules\electron\dist\electron.exe" --no-sandbox --remote-debugging-port=9352 `
    "--user-data-dir=$PWD\.userdata\v17-verify" .
node scripts/v17-verify.mjs          # 端口可用 $env:NEXUS_CDP_PORT 覆盖；结束后按 PID 清理隔离实例
```

`scripts/v17-verify.mjs` 头注释包含同样的运行方式、覆盖清单与安全边界；`--prepare` 会重建 v9 种子配置并清掉上一轮隔离实例的日志，保证「自动恢复」日志不串轮。

### 2. AC 验收表

| AC | 验收项 | 结果 | 证据（check id / detail 摘要） |
|---|---|---|---|
| AC-27.1 | 设置迁移：v9 → v10，`extraWindows=[]`，旧值零丢失 | 通过 | `AC-27.1a` `schemaVersion=10`；`AC-27.1b` `extraWindows=[]`；`AC-27.1c` `onlyOnDesktop=true`、`music.visible=false`、`clock.visible=false`、`lock` 全 false、6 个应用、`appearance=standard` 保留；`AC-27.1d` 落盘 `settings.json` 2,710B、schemaVersion 10、BOM=false（种子与落盘均 UTF-8 无 BOM）；运行日志 `.userdata\v17-verify\launch.out.log` 记录 `[settings] 已从 v9 迁移到 v10` |
| AC-27.2 | 导航分组：「窗口」组 + 6 项，默认内置窗口页 | 通过 | `AC-27.2a` 设置页 3 折叠栏 / 6 导航项；`AC-27.2b` `.settings-nav-group` 文本「窗口」，`.settings-nav-item` 依次 内置窗口/附加窗口/应用/外观/系统/关于；`AC-27.2c` 默认 active=内置窗口 且页内标题为「内置窗口」 |
| AC-27.3 | 内置窗口页：3 折叠栏 + 共性 4 开关 + 独有设置 + 开关写回 | 通过 | `AC-27.3a` 3 个 `.nx-acc-item`（Dock/音乐卡片/桌面时钟，默认收起）；`AC-27.3b` 锁定全部「0/3」+ 摘要「0/3 · 无窗口锁定」；`AC-27.3c` 展开 Dock 后 4 个共性开关（自动吸附屏幕边缘/始终置顶/仅在桌面显示/锁定位置）；`AC-27.3d` `.nx-window-unique`「该窗口独有设置」+ 3 个 `ui-section`（停靠位置/图标/外观与行为）；`AC-27.3e` 点击「始终置顶」→ `settings.dock.alwaysOnTop` true→false（`aria-checked=false`），随后还原 |
| AC-27.4 | 附加窗口页：空状态 + 接入说明 | 通过 | `AC-27.4a` `.nx-empty`「暂无附加窗口」、无折叠栏；`AC-27.4b`「接入说明」section + 恰 4 个 `.nx-steps li`（注册窗口类型/新建渲染页/增加构建入口/（可选）独有选项） |
| AC-27.5 | 系统页：移除窗口共性设置，保留跳转且真实生效 | 通过 | `AC-27.5a` section 仅「启动」「窗口」，正文不含「窗口共性设置」，保留开机自启开关；`AC-27.5b` 按钮「前往内置窗口」「前往附加窗口」；`AC-27.5c` 点「前往内置窗口」→ active=内置窗口 且 3 折叠栏；`AC-27.5d` 点「前往附加窗口」→ active=附加窗口 且空状态 |
| AC-27.7 | 「显示桌面」修复：Dock 窗口被 shell 最小化后自动恢复 | 通过 | `AC-27.7a` 定位到隔离实例 PID 树内 hwnd（标题 `Nexus Dock`、类 `Chrome_WidgetWin_1`）；`AC-27.7a2` 测试前临时关闭 `dock.onlyOnDesktop`（桌面状态桥停用，隔离出 guard 路径；测后恢复 true）并确认 Dock 可见；`AC-27.7b` 最小化前 `IsWindowVisible=true / IsIconic=false`；`AC-27.7c` **`ShowWindow(SW_MINIMIZE=6)` 后立即 `IsIconic=true`（`AC-27.7c1`，证明最小化真实生效）→ 200/400/…/1800ms 采样均为 `IsIconic=false && IsWindowVisible=true`**；`AC-27.7c2` 本轮主进程日志新增 `[dock] 窗口被系统最小化（如「显示桌面」），已自动恢复显示`（before=1→after=2，第 1 次尝试即恢复）；`AC-27.7d` 恢复后 Dock 仍可正常渲染并截图；`AC-27.7e` `resources/desktop-state.exe --once` 最后一行 state JSON 含 `minimized:false / visible:true`（布尔）+ `type/foregroundPid/maximized/fullscreen/desktop/className` 类型正确；`AC-27.7f` `npm test` 命中契约测试「v1.7 契约：isDesktopBusy 只在「可见 + 未最小化 + 最大化/全屏」时判定占用桌面」 |
| AC-27.8 | 回归：Dock / 设置页渲染、无 console error、安装版不受影响 | 通过 | `AC-27.8a` Dock 页 `title=Nexus Dock`、`.dock-root` 存在、6 个 `[data-dock-id]`（explorer/notepad/calc/paint/settings/cmd）、无 `.dock-empty`；`AC-27.6a` 设置页无错误横幅、正文 418 字、6 导航项、无 console error/exception；`AC-27.8b` Dock 页 console error/未捕获异常 0（诊断总数 0，无过滤项）；`AC-27.8c` 安装版 5 个 `NexusDockApp` 进程 PID 验收前后一致（`installedPidsBefore === installedPidsAfter`） |
| AC-27.9 | 工程门禁：typecheck + tests；构建产物为 1.7.0 | 通过 | `AC-27.9a` `npx tsc --noEmit` 退出码 0；`AC-27.9b` `npm test` **24/24 通过、0 失败**（含 isDesktopBusy 契约测试）；`AC-27.9c` `package.json` 1.7.0 且 `out/main/index.js` 存在（`out/` 由 Lead 预先构建，本轮不重建，避免与运行实例冲突） |

### 3. 截图证据（`docs/verification/v1.7/`）

截图统一用 CDP `Page.captureScreenshot` 只截目标窗口（验收期间用户桌面有其他窗口，全屏截图会拍进用户内容，故未采用全屏截图；确需桌面全屏可人工运行 `pwsh -File scripts/capture-screen.ps1 -Out docs\verification\v1.7\xxx.png`）。

| 文件 | 内容 |
|---|---|
| [`settings-builtin-collapsed.png`](verification/v1.7/settings-builtin-collapsed.png) | 设置页默认「内置窗口」：导航「窗口」分组、6 导航项、3 个折叠栏（收起）、锁定全部 0/3、页脚 `Nexus Dock v1.7.0` |
| [`settings-builtin-dock-expanded.png`](verification/v1.7/settings-builtin-dock-expanded.png) | 展开 Dock 折叠栏：4 个共性开关 +「该窗口独有设置」（停靠位置/图标/外观与行为） |
| [`settings-extra.png`](verification/v1.7/settings-extra.png) | 附加窗口页：空状态「暂无附加窗口」+「接入说明」4 步 |
| [`settings-system.png`](verification/v1.7/settings-system.png) | 系统页：仅「启动」（开机自启）+「窗口」跳转按钮，无窗口共性设置 |
| [`dock-desktop.png`](verification/v1.7/dock-desktop.png) | 最小化前隔离实例 Dock 窗口（6 个内置应用图标） |
| [`dock-after-showdesktop.png`](verification/v1.7/dock-after-showdesktop.png) | `ShowWindow(SW_MINIMIZE=6)` → 自动恢复后的 Dock 窗口（与最小化前一致） |

> PNG 已被 `.gitignore` 忽略（`docs/verification/**/*.png`），文件保留在目录内供复核；机器可读结论见 `report.json`。

### 4. 待人工确认

1. **真实点击 Windows 右下角「显示桌面」按钮的手感与观感**：自动化用等效的 shell 行为（对隔离实例 Dock 窗口 `ShowWindow(SW_MINIMIZE=6)`）验证「1800ms 内自动恢复」，但未注入真实全局 Show Desktop；且为确定性观测 guard 路径，测试期间临时关闭了 `dock.onlyOnDesktop`（测后恢复）。请人工确认 `onlyOnDesktop=true` 时真实「显示桌面 → 恢复」的延迟、是否有闪烁/抢焦点。
2. **托盘菜单新增附加窗口入口**：当前 `EXTRA_WINDOW_KINDS=[]`，托盘不会产生附加窗口菜单项；等注册第一个真实附加窗口后，确认托盘「显示/隐藏附加窗口」等入口文案、点击行为与多窗口（内置+附加）联动。
3. **拖拽吸附**：Dock / 音乐卡片 / 桌面时钟在「内置窗口」页的吸附开关，以及附加窗口注册后的拖拽吸附手感（脚本只验证 settings 字段与窗口几何，不模拟真实拖动）。

### 5. 说明与限制

1. **两条恢复路径**：「显示桌面」恢复有 `guardAgainstMinimize`（60ms 起多次重试）与 `applyFloatingVisibility` 的 800ms 桌面状态轮询（`isShown` 已含 `!isMinimized`）两条路径。为让 guard 路径可确定性复现，最小化测试前临时把 `dock.onlyOnDesktop` 置 false（桌面状态桥停用），测后恢复 true；`AC-27.7a2` / `AC-27.7c2` 记录了该处理与日志增量。
2. **验收后现场**：隔离实例已按 PID 清理，确认无命令行含 `v17-verify` 的残留 electron / desktop-state 进程；用户安装版 5 个 `NexusDockApp` 进程保持运行、PID 未变；未改动用户配置（`%APPDATA%\nexus-dock`）。
3. **门禁口径**：`npx tsc --noEmit` 与 `npm test`（24/24）由本验收脚本独立复跑；`npm run build` 由 Lead 在验收前完成，本轮不重建 `out/`（运行中的隔离实例正从 `out/` 加载，重建会污染证据）。



### 6. 安装版复核（Lead，2026-11-04 13:00）

- 门禁：`npm run check` 通过（typecheck 0 错误 + `npm test` 24/24），随后 `npm run build` + `powershell -File scripts/install-local.ps1` 安装到 `%LOCALAPPDATA%\NexusDock`；`resources/app/package.json` 版本 **1.7.0**，安装版 5 个 `NexusDockApp` 进程正常运行（启动环境已移除 DSH 宿主注入的 `ELECTRON_RUN_AS_NODE`）。
- 真实用户配置迁移：`%APPDATA%\nexus-dock\settings.json` `schemaVersion 9 → 10`、`extraWindows=[]`；12 个 Dock 应用、`lock{dock,music,clock}=true`、Dock 自由坐标等旧值全部保留。
- 安装版 UI 一次性复核（临时 `--remote-debugging-port=9357`，复核后恢复正常启动）：`isPackaged=true`、`appVersion=1.7.0`；设置导航分组「窗口」+ 6 项（内置窗口/附加窗口/应用/外观/系统/关于）；默认「内置窗口」页 3 个折叠栏；「锁定全部窗口位置（3/3）」及摘要「Dock、音乐卡片、桌面时钟（3/3）」；页脚 `Nexus Dock v1.7.0`。
- 截图：`docs/verification/v1.7/installed-settings-builtin.png`（安装版内置窗口页，Dock 折叠栏展开；PNG 被 `.gitignore` 忽略，文件保留在目录内）。

---

## §v1.8（2026-11-04）：附加窗口栏「英语单词学习」+ 词库自由修改

> 环境：Windows 11 · **开发构建**（`out/`，Electron 44.7.0 / Chrome 152.0.7977.130 / Node 24.21.0）· **Nexus Dock v1.8.0**（`isPackaged=false`）
> 验收方式（两套独立证据，互相印证）：
> 1. **Lead 冒烟脚本**：隔离实例 + CDP（`.userdata/v18-smoke`、端口 9352），**39/39 全部 PASS**，结果 [`docs/verification/v1.8/runtime-smoke.json`](verification/v1.8/runtime-smoke.json)，截图 5 张；
> 2. **仓库正式脚本** `scripts/v18-verify.mjs`：隔离 userData（`.userdata/v18-verify`）+ CDP（端口 9362），`--prepare → --launch → --check → --cleanup` 全流程实跑，**43 项检查 42 通过 / 0 失败 / 1 项跳过（原生文件对话框，列手动项）**，机器报告 [`docs/verification/v1.8/report.json`](verification/v1.8/report.json)。
> 本文件以正式脚本的 check id 为准；两套证据结论一致（39/39 与 42/43 均覆盖同一批功能点）。
> 安全边界：只操作隔离 userData 与命令行含 `v18-verify` 的 `electron.exe`；脚本按 PID 清理（`--cleanup` killed=1，leftovers=[]）；用户安装版 `NexusDockApp` 的 6 个进程 PID 验收前后一致（`[266704, 289840, 290312, 309088, 328556, 333068]`）；未重建 `out/`、未改 `src/`、未读写 `%APPDATA%\nexus-dock` 的用户真实配置。

### 1. 复现方式（三步 + 清理）

```powershell
# 1) 准备：写 v10 种子 settings.json（schemaVersion=10、无 wordstudy）、清空上一轮词库/日志
node scripts/v18-verify.mjs --prepare

# 2) 启动隔离实例（推荐；用 spawn + 参数数组，从根上规避路径空格）
node scripts/v18-verify.mjs --launch

#    或 PowerShell 手工启动（仓库路径含空格，必须用单条带引号的参数字符串！）
#    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
#    $exe = Join-Path $PWD 'node_modules\electron\dist\electron.exe'
#    $ud  = Join-Path $PWD '.userdata\v18-verify'
#    $argLine = "--no-sandbox --remote-debugging-port=9362 --user-data-dir=`"$ud`" ."
#    Start-Process -FilePath $exe -ArgumentList $argLine -WorkingDirectory $PWD `
#        -RedirectStandardOutput '.userdata\v18-verify\launch.out.log' `
#        -RedirectStandardError  '.userdata\v18-verify\launch.err.log'

# 3) 断言 + 截图（产物 docs/verification/v1.8/report.json + PNG）
node scripts/v18-verify.mjs --check

# 4) 清理自己启动的隔离实例（按 PID / 命令行过滤，不按进程名全杀）
node scripts/v18-verify.mjs --cleanup
```

端口默认 9362，可用 `NEXUS_CDP_PORT` 覆盖（四个动作必须同端口）。脚本头注释写清了三个坑：① 路径含空格 → PowerShell 参数必须整体加引号（`--launch` 用参数数组规避）；② DSH 宿主注入 `ELECTRON_RUN_AS_NODE=1` 必须先清除；③ 不要按进程名杀全部 electron.exe，也不能动安装版 `NexusDockApp`。

### 2. AC 验收表

| AC | 验收项 | 结果 | 证据（check id / detail 摘要） |
|---|---|---|---|
| AC-28.1 | 注册表注册 wordstudy 并默认显示（右 32%，默认选项） | 通过 | `AC-28.0` 隔离实例 `appVersion=1.8.0 / isPackaged=false`（Electron 44.7.0 / Chrome 152.0.7977.130 / Node 24.21.0）；`AC-28.2a` `/wordstudy/` target 存在；`AC-28.1b` 迁移后配置 `kind=wordstudy, visible=true, edge=right, alongPercent=32, theme=dark, options={showPhonetic:true,showExample:true,hideMeaning:true,shuffle:false,autoNext:true}` |
| AC-28.2 | 渲染页 / vite 入口 / 实际加载一致 | 通过 | `AC-28.2a` target URL `file:///.../out/renderer/wordstudy/index.html`；`AC-28.2b` `document.title='Nexus 英语单词学习'`、`.ws-root` 存在、首词 `ability`；`out/renderer/wordstudy/index.html` 存在（`AC-28.7c`） |
| AC-28.3 | 根节点 data-theme / data-locked / .ws-word | 通过 | `AC-28.2b` `data-theme=dark`、`data-locked` 缺失（未锁定）、`.ws-word=ability`、`.ws-meaning[data-revealed=false]`、`.ws-progress='1 / 59'`、`.ws-stats='已掌握 0/共 59'` |
| AC-28.4 | C7 尺寸自适应（学习视图 360 级） | 通过 | `AC-28.2d` inner **362×252** / `.ws-root` **360×250.33**（差值 ≤2px）；`AC-28.4b` 词库管理视图 inner **482×548**（切视图后 ResizeObserver 重新上报） |
| AC-28.5 | 释义默认遮住 / 显示释义 | 通过 | `AC-28.2b` 默认 `data-revealed=false`；`AC-28.3a` 点「显示释义」→ `data-revealed=true`、文本「n. 能力；才能」；`AC-28.3c` 空格键同样显示释义 |
| AC-28.6 | 上一词 / 下一词 / 快捷键 / 隐藏按钮 | 通过 | `AC-28.3b` 下一词 `ability → achieve` 且切词后重新遮住、上一词切回 `ability`；`AC-28.3c` `→` 切到下一词；`AC-28.6a` 卡片右上 ✕ → `settings.extraWindows[wordstudy].visible=false`（不销毁窗口），随后经 Dock 侧 `settings.update` 恢复 `visible=true`（托盘/设置恢复同一条数据通路）；`AC-28.6b` Dock 回归 6 图标、无空状态 |
| AC-28.7 | 认识度标记写入进度 | 通过 | `AC-28.3d` 关闭 autoNext 后标「认识」→ `progress['achieve']={status:'mastered', seen:1, remembered:1}`，停留当前词；`AC-28.3e` 统计变「已掌握 1/共 59」 |
| AC-28.8 | autoNext 行为 | 通过 | `AC-28.3d` autoNext=false 时不切词；默认 true 由注册表默认选项 `AC-28.1b` 与 Lead 冒烟脚本覆盖 |
| AC-28.9 | 途径①：窗口内词库管理 / 新增 / 删除 | 通过 | `AC-28.4a` `.ws-editor` 打开、59 行 `.ws-bank-row`、工具栏 8 项齐全（搜索/新增/导入/导出/打开文件/重新读取/恢复默认/重置进度）；`AC-28.4d` 表单新增 `cdp-verify-word` → 内存 60 词、toast「已添加」；`AC-28.4i` 删除 → 58 词 |
| AC-28.10 | 词库文件结构 `{version, words}` / 原子写 / 无 BOM | 通过 | `AC-28.1d` 首次播种 `{version:1, words:59}`，磁盘键恰为 `['version','words']`、UTF-8 无 BOM（10,017B）；`AC-28.4d` 新增后磁盘 60 词且键仍只有 version/words；`AC-28.4h` 恢复默认后重新落盘 59 词 |
| AC-28.11 | 途径③：外部改文件 + 重新读取（只读不覆盖） | 通过 | `AC-28.4e` 外部把 `wordbank.json` 换成**裸数组** 2 词 → 点「重新读取」→ 内存/计数 2 词、toast「已重新读取磁盘文件：2 个单词」，且磁盘文件**仍是裸数组**（reload 未写回/未覆盖）；`AC-28.4f` 学习视图变 1 / 2 |
| AC-28.12 | 学习进度独立文件 | 通过 | `AC-28.3d` 标记后 `wordBank.get().progress['achieve']` 有记录；`AC-28.4h` 恢复默认后 `progressKeys=0`（进度清空）；进度文件路径由 `wordBank.paths()` 暴露（设置页 `AC-28.5e` 展示） |
| AC-28.13 | 途径②：导入 / 导出（原生对话框） | 手动 | 原生 `dialog.showOpenDialog/showSaveDialog` 无法由 CDP 驱动；代码路径已审查（取消 → `canceled`、非法 JSON / 空词条 → `ok:false,error`），列入手动项 **M-28.4**。设置页 6 个动作按钮存在且文案正确（`AC-28.5f`） |
| AC-28.14 | 恢复默认 / 重置进度 / 二次确认 | 通过 | `AC-28.4h` 窗口内恢复默认（`window.confirm` 经 CDP 自动接受）→ 59 词 + 进度 0 + toast；`AC-28.4i` 删除确认；`AC-28.5i` 设置页内联确认条 `.nx-confirm-bar` 出现，点「取消」不执行 |
| AC-28.15 | 设置页「窗口 → 附加窗口」出现 wordstudy 折叠栏 | 通过 | `AC-28.5d` 导航点击「附加窗口」、`.nx-acc-head` 含「英语单词学习」可展开、`.ws-settings` 渲染；`AC-28.5f` 旧空状态文案（「暂无附加窗口」/「当前还没有注册附加窗口」）在页面 DOM 中不再出现 |
| AC-28.16 | 概览 / 路径 / 5 开关 / 6 动作 | 通过 | `AC-28.5e` 统计「共 58 词 / 已掌握 0 / 学习中 0 / 未学 58」+ 路径含 `wordbank.json`；`AC-28.5f` 5 个 `.ui-switch`、6 个动作按钮文案依次为 导入词库/导出词库/打开词库文件/重新读取文件/恢复默认词库/重置学习进度 |
| AC-28.17 | 设置开关写回 + 即时广播 + 可见消息 | 通过 | `AC-28.5h` 点第一个开关 `showPhonetic true→false` 写入 `extraWindows[].options`；`AC-28.5a` 设置改浅色 + hideMeaning=false 后卡片 `data-theme=light` 且释义常显；`AC-28.5j` 设置页「重新读取文件」→ `.ws-settings-msg`「已重新读取词库文件：共 58 个单词」 |
| AC-28.18 | 迁移 10 → 11 零丢失 | 通过 | `AC-28.1a` 落盘 `settings.json` 3,219B / schemaVersion **11** / 无 BOM；`AC-28.1c` `dock.iconSize=52 / opacity=0.35 / padding=16 / onlyOnDesktop=true`、`music{visible:false,progressStyle:'ring',theme:'light'}`、`clock{showSeconds:true,showDate:false,hour12:true,freeX:120}`、`lock` 全 false、`appearance{light,reducedMotion:true,clickSound:true}`、6 个应用且首个 `customName='我的文件（v10 自定义名）'` 保留；`AC-28.1e` 主进程日志记录「已从 v10 迁移到 v11」 |
| AC-28.19 | 首次播种 / 初始化顺序 / 变更广播 | 通过 | `AC-28.1d` 首次启动播种 59 词；`AC-28.4d`/`AC-28.4e` 词库变更后设置页与窗口同步（统计/列表即时更新，广播通路 `wordbank:changed`）；`AC-28.6b` preload 暴露 `window.nexus.wordBank` |
| AC-28.20 | 异常兜底 / 损坏备份 / 不覆盖用户文件 | 通过（部分手动） | 代码审查：IPC handler 统一兜底不 reject、损坏文件先 `.corrupt-<ts>.bak` 再回种子、备份失败不覆盖；`AC-28.4e` 证明 reload 只读不写。真实「损坏文件 → 备份」路径建议人工制造一次非法 JSON 复核（含在 M-28.4 流程里） |
| AC-28.21 | 契约 / 接线门禁 | 通过 | `AC-28.7b`：共享契约 **24/24** + 词库契约 **9/9** + 静态接线门禁 **8/8**，共 **41/41**、0 失败（`npm test` 的等价逐文件执行；测试文件 `tests/shared-contract.test.mjs`、`tests/wordbank-contract.test.mjs`、`tests/wiring.test.mjs`） |
| AC-28.22 | typecheck / 构建产物 / 运行时脚本 | 通过 | `AC-28.7a` `npx tsc --noEmit` 退出码 0；`AC-28.7c` `package.json=1.8.0`、`out/main/index.js` 与 `out/renderer/wordstudy/index.html` 存在（`out/` 由 Lead 预先构建，脚本不重建）；`AC-28.6c` Dock / 单词窗口 / 设置页 console error 与未捕获异常均为 **0**（诊断总数 0） |

### 3. 截图证据（`docs/verification/v1.8/`）

截图统一用 CDP `Page.captureScreenshot` 只截目标窗口（不拍用户桌面；确需桌面全屏可人工运行 `pwsh -File scripts/capture-screen.ps1`）。灯箱背景为脚本注入的渐变，仅用于让透明卡片在截图中可读，不影响应用本身。

| 文件 | 内容 |
|---|---|
| [`wordstudy-study-dark.png`](verification/v1.8/wordstudy-study-dark.png) | 深色学习卡片：单词 / 音标 / 遮住的释义 / 例句 / 已掌握统计 / 1 / 59 / 认识度按钮 |
| [`wordstudy-study-light.png`](verification/v1.8/wordstudy-study-light.png) | 浅色主题 + 「先遮住释义」关闭后的学习卡片（设置广播即时生效） |
| [`wordstudy-study-2words.png`](verification/v1.8/wordstudy-study-2words.png) | 外部替换 `wordbank.json`（裸数组 2 词）并「重新读取」后的学习视图（1 / 2） |
| [`wordstudy-editor-dark.png`](verification/v1.8/wordstudy-editor-dark.png) | 词库管理视图：59 行、搜索、新增/导入/导出/打开文件/重新读取/恢复默认/重置进度、文件路径 |
| [`settings-extra-windows.png`](verification/v1.8/settings-extra-windows.png) | 设置页「窗口 → 附加窗口 → 英语单词学习」展开：词库概览（共 58 词）、路径、5 个开关、6 个词库动作 |

> 另：Lead 冒烟脚本产出的 `runtime-smoke.json`（39/39）与本目录 5 张 PNG 为同一轮隔离实例证据；PNG 已被 `.gitignore` 忽略（`docs/verification/**/*.png`），文件保留在目录内供复核；机器可读结论见 `report.json`。

### 4. 手动项（自动化无法覆盖，需人工执行）

| 编号 | 项目 | 原因 | 怎么做 |
|---|---|---|---|
| M-28.4 | 导入 / 导出词库（原生文件对话框） | `dialog.showOpenDialog/showSaveDialog` 是系统对话框，CDP 无法操作系统 UI | 单词窗口 → 词库 → 导出 JSON → 删一个词 → 导入刚导出的 JSON；再测一次取消不报错 |
| M-28.4b | 「打开词库文件」唤起系统默认编辑器 | 会启动外部程序，自动化不点击 | 点「打开词库文件」→ 改一个释义保存 → 回窗口点「重新读取」→ 确认释义更新 |
| M-28.5 | 托盘 / Dock 右键的「英语单词学习」显隐入口 | Tray 与原生右键菜单由主进程原生渲染，不能稳定 CDP 驱动 | 托盘单击/右键、Dock 空白处右键，各切一次显示/隐藏并核对设置同步 |
| M-28.6 | 真实拖动吸附 / 锁定 / 仅在桌面显示 | 脚本只验证配置字段、窗口几何与布局 IPC，不模拟真实鼠标拖动 | 拖卡片到屏幕边缘吸附；开关吸附/锁定/仅在桌面各试一次（最大化窗口下观察） |
| M-28.6b | 真实桌面合成观感（透明/圆角/主题） | 截图只渲染页面本身，不含 Windows 桌面合成与亚克力效果 | 真实桌面切换深/浅主题，确认无「看得见点不到 / 点得到看不见」区域 |

### 5. 说明与限制

1. **两套运行时证据口径**：Lead 冒烟脚本 39/39（功能点覆盖）+ 仓库正式脚本 43 项 42 通过 / 0 失败 / 1 跳过（原生对话框手动）。正式脚本把迁移零丢失、C7、三种词库修改途径、设置页写回、隐藏与回归都做成了带 check id 的断言，可直接重跑；两者结论一致。
2. **门禁口径**：`npx tsc --noEmit` 与三个测试文件由验收脚本在 `--check` 内独立复跑（41/41）；`npm run build` 由 Lead 在验收前完成，本文不重建 `out/`（运行中的隔离实例正从 `out/` 加载，重建会污染证据）。
3. **`npm test` 口径**：最终验证 `npm test` **41/41 通过、0 失败**（`tests/*.test.mjs` 三个文件；node:test，不需要 Electron）；验收脚本内部按 `node tests/<file>.test.mjs` 逐文件执行，是为了分别断言 24 / 9 / 8 三项计数，结论与 `npm test` 等价。
4. **验收后现场**：隔离实例已按 PID 清理（`--cleanup` killed=1 → PID 310540，leftovers=[]）；用户安装版 6 个 `NexusDockApp` 进程 PID 未变；未改动 `%APPDATA%\nexus-dock` 的用户真实配置；`docs/verification/v1.8/runtime-smoke.json`（Lead）与本轮 `report.json` 并存、互不覆盖，5 张截图由本轮脚本重写同名文件。
5. **已知限制**：
   - 外部删除 `wordbank.json` 后点「重新读取」不会重建种子词库（`reloadFromDisk` 只读语义，保留当前内存值；下次启动才重新播种 59 词）。
   - 导入词库只替换词条；导入文件不含 `progress` 时，同名单词原有进度保留、不同名丢弃；「导出词库」只导出词条，完整备份请直接复制两个 JSON 文件。
   - 学习进度采用乐观更新 + `markSeq` 序号保护，极端并发下以最后一次写入为准；失败会回滚并显示可见错误条。
   - 原生导入/导出、托盘菜单、真实拖动与桌面合成观感仍需人工确认（见 §4）。

---

## §v1.9（2026-11-04）：单词状态整理 + 遗忘曲线复习

> 环境：Windows 11 · 开发构建（`out/`，Electron 44.7.0 / Chrome 152.0.7977.130 / Node 24.21.0）· **Nexus Dock v1.9.0**（`isPackaged=false`）
> 验收方式：
> 1. **静态门禁**：`npx tsc --noEmit`、`npm test`（`tests/*.test.mjs`）、`npm run build`，结果见下方 §1（Lead 复跑确认）；
> 2. **运行时验收**：`scripts/v19-verify.mjs`（隔离 userData + CDP，`--prepare / --launch / --check / --cleanup`），机器证据见 [`docs/verification/v1.9/report.json`](verification/v1.9/report.json)（**由运行时验收任务产出，Lead 汇总**；本节不写未复核的通过率）。
> 安全边界：运行时脚本只操作隔离 userData 与命令行含 `v19-verify` 的 `electron.exe`，不读写 `%APPDATA%\nexus-dock` 的真实用户配置；`npm run build` 只重建 `out/`。

### 1. 静态门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | ✅ 通过（0 error） |
| 单元测试 | `npm test`（Node 内置 test runner，`tests/*.test.mjs`，不需要 Electron） | ✅ 54 项全部通过（shared-contract 24 + wordbank-contract 22 + wiring 8；0 fail / 0 skipped；v1.8 基线 41/41） |
| 构建 | `npm run build` | ✅ 通过（130ms；含 `out/renderer/wordstudy/index.html`、`wordstudy-CC8R3Dkt.js` 56.08 kB、`wordstudy-Bk_cVJrA.css` 33.40 kB） |

`npm run check`（typecheck + test）整体通过。以上为静态门禁结果；运行时 Electron 证据由 task-7 产出，见 §4 与 [`docs/verification/v1.9/report.json`](verification/v1.9/report.json)。

### 2. AC 验收表

| AC | 验收项 | 静态证据（测试 / 代码） | 运行时证据 |
|---|---|---|---|
| AC-15.1 | 状态整理 | 单词表视图：5 档筛选（全部 / 待复习 / 未学 / 学习中 / 已掌握，带计数）+ 搜索（单词 / 释义）+ 3 档排序（词库顺序 / 到期优先 / 字母 A→Z）+ 每行状态下拉 + ▶ 学习该词。`tests/wordbank-contract.test.mjs` 覆盖 `filterWordBank` / `sortWordList` / `studyQueueKeys`；`tests/wiring.test.mjs` 断言 56 个窗口 DOM class（含全部 `ws-list-*`）。代码：`src/renderer/wordstudy/WordListView.tsx`、`src/renderer/wordstudy/WordStudyCard.tsx`、`src/shared/wordBank.ts:611`（`filterWordBank`）、`:649`（`sortWordList`） | `report.json` d/e/f/g：5 档筛选计数（全部 8 / 待复习 1 / 未学 4 / 学习中 3 / 已掌握 1）与 8 行渲染、待复习 / 已掌握筛选各 1 行、行内改「已掌握」落盘 `status=mastered`、▶ 回学习视图定位 `achieve` |
| AC-15.2 | 遗忘曲线排期 | 简化 SM-2：again / hard / good 三档排期与 ease 1.3–2.8、10 分钟重练、1 → 3 → 7 → 15 → 30 天递增、365 天上限；`isWordDue` / `wordDueLabel` / `formatReviewInterval` / `formatDueAt` / `wordBankReviewStats` / `studyQueueKeys`（到期优先）。`tests/wordbank-contract.test.mjs` 以固定 `now` 覆盖上述边界。代码：`src/shared/wordBank.ts:491-554`（`reviewWord`）、`:562-581`（`setWordStatus`）、`:597`（`wordBankReviewStats`）、`:677`（`studyQueueKeys`） | `report.json` a/b/c：pill「待复习 4」、记忆计划条「下次复习 待复习 · 连续 0」、`1 / 2 / 3` 标记后 again=10 分钟后 / hard·good=明天，toast「已记录 · 10 分钟后复习」「明天复习」 |
| AC-15.3 | 旧进度迁移 | `WORD_PROGRESS_VERSION=2`；迁移发生在**读取时**：主进程 `combineWordBank` 调 `sanitizeWordProgressMap`，在内存中把 v1 记录补齐 `dueAt / intervalDays / ease / streak / lapses`（已学词 `dueAt=lastSeenAt`，故升级后立即到期），磁盘文件保持 `version=1` 直到下一次进度写入才以 `version=2` 落盘；`sanitizeWordProgressMap` 只在 `seen=0 && status='new'` 时丢弃条目（手动改状态可持久化）。`tests/wordbank-contract.test.mjs` 覆盖 v1 旧记录迁移；`tests/shared-contract.test.mjs` 断言 `schemaVersion` 仍 11。代码：`src/shared/wordBank.ts:28`、`:330`、`:377` | `report.json` a/c：隔离 userData 写入 v1 进度 4 条（无 5 个复习字段）→ 真实 main 读成 v2（`dueAt=lastSeenAt`、`ease=2.5`），磁盘仍 `version=1`；首次标记后 `wordbank-progress.json` 写成 `version=2` 且 5 字段齐全 |
| AC-15.4 | 设置项 | 设置页概览新增「待复习 n」；学习选项 5 → 7（新增「优先复习到期单词」「显示复习计划」，默认都开）；新增「记忆曲线」说明区；`tests/wiring.test.mjs` 断言 7 个选项中文标签与 `WordStudySettings` 引用 `wordBankReviewStats`。代码：`src/renderer/settings/sections/WordStudySettings.tsx`、`src/shared/wordBank.ts:181`（`DEFAULT_WORD_STUDY_OPTIONS`） | `report.json` h：真实设置窗口 7 个学习开关、「待复习 N」统计、记忆曲线区「当前待复习 N 词 / 最近到期」 |
| AC-15.5 | 零 IPC 变更 | 仍复用 v1.8 的 11 个 `wordbank` IPC 通道；主进程 `src/main/wordBank.ts` 未新增通道 / 接口（仅随共享常量写 v2 进度版本）；preload 无新增 API。`tests/wiring.test.mjs` 断言词库 IPC 渲染层 / 主进程 / preload 三方一致；`schemaVersion` 仍 11。代码：`src/main/wordBank.ts:159-166`（`writeProgressFile`）、`src/shared/wordBank.ts:28` | `report.json` j：wordstudy 与 settings 两页面 0 条 console error / 0 次未捕获异常；运行时仍走 v1.8 的 11 个 `wordbank` 通道 |

### 3. 手动项（自动化无法覆盖，需人工执行）

| 编号 | 项目 | 原因 | 怎么做 |
|---|---|---|---|
| M-29.1 | 单词表筛选 / 搜索 / 排序的交互手感，列表内部滚动手感 | 脚本只验证 DOM class 与筛选结果文本，不模拟真实鼠标 / 滚轮 | 打开单词表，快速切换 5 档筛选、输入 / 清空搜索、切换 3 档排序，确认不卡顿、无横向溢出；滚动到底部再切筛选 |
| M-29.2 | 状态下拉误操作（「未学」＝清空进度，无二次确认） | 产品交互选择，脚本自动接受确认框，无法替真人评估风险 | 选一个测试词改成「未学」，确认它从「已掌握」列表消失；再改回「学习中」，确认立即到期 |
| M-29.3 | 记忆计划条 / toast 的可读性（时间文案、强度条长度、深 / 浅主题对比度） | 截图可看静态，动效与可读性需真人判断 | 分别用深色 / 浅色主题各标记一次「认识」「不认识」，看 toast 与计划条是否清楚、是否遮挡 |
| M-29.4 | 真实桌面合成观感（透明 / 圆角 / 亚克力）与真实拖动吸附 | 同 §v1.8 M-28.6b，截图不含桌面合成 | 真实桌面拖动卡片、切主题、开关「仅在桌面显示」各试一次 |
| M-29.5 | 老用户真实进度升级观感（升级后立即出现待复习） | 隔离脚本只验证迁移逻辑；真实用户进度规模与观感需真人确认 | 先备份自己的 `%APPDATA%\nexus-dock`，再用 v1.9 启动，确认「待复习 n」符合预期、没有进度丢失 |

### 4. 运行时验收（真实 Electron 10/10 通过）

真实 Electron 44.7.0（隔离 userData `.userdata/v19-verify/electron-userdata`，预置 v1 旧进度 4 条）主路径 **10/10 通过、0 失败**；Edge headless + `window.nexus` stub 对照路径同样 **10/10**。报告：[`docs/verification/v1.9/report.json`](verification/v1.9/report.json)。

- 脚本：`scripts/v19-verify.mjs`（四步 `--prepare → --launch → --check → --cleanup`，与 v1.8 一致；只操作隔离 userData，不触碰真实 `%APPDATA%\nexus-dock`）。
- 环境事实：本机 `electron --version` 会崩（exit `2147483651` / `0x80000003`，疑无控制台上下文），但 `electron . --no-sandbox --remote-debugging-port=9393 --user-data-dir=隔离目录` 主进程 / preload / IPC / 磁盘读写与 CDP 均正常，故主路径使用真实 Electron。
- 结果（`report.json` 项号）：
  - a 迁移：v1 旧进度 4 条读取时补齐 5 个复习字段，`dueAt=lastSeenAt`（`ability`：`lastSeenAt=dueAt`、`ease=2.5`、`intervalDays=0`），pill「待复习 4」。
  - b 学习视图：`advantage` + 音标 + 释义遮罩（`data-revealed=false`）+ 记忆计划条「下次复习 待复习 · 连续 0」。
  - c 标记：空格显示释义；`1 / 2 / 3` 后 `wordbank-progress.json` 落盘 `version=2` 且 `dueAt / intervalDays / ease / streak / lapses` 齐全（again→`learning` / 10 分钟后，hard→`learning` / 明天，good→`mastered` / 明天），toast「已记录 · 10 分钟后复习」「明天复习」。
  - d/e 单词表：5 档筛选计数 `全部 8 / 待复习 1 / 未学 4 / 学习中 3 / 已掌握 1`、8 行；待复习筛 1 行、已掌握筛 1 行。
  - f/g 行操作：行内下拉改「已掌握」→ 磁盘 `status=mastered` 且徽标 / 下拉同步；▶ 回学习视图且当前词 `achieve`。
  - h 设置页：真实设置窗口 7 个学习开关、「当前待复习 N 词」统计、词库路径。
  - i 窗口尺寸：真实 `BrowserWindow` 内容宽度 study 362 / list 482 / 回 study 362（360 / 480 + 1 上取整）。
  - j 稳定性：wordstudy 与 settings 两页面均 0 条 console error、0 次未捕获异常。
- 截图（`docs/verification/v1.9/`，PNG 被 `.gitignore` 忽略但文件保留）：[electron-study.png](verification/v1.9/electron-study.png)、[electron-study-revealed.png](verification/v1.9/electron-study-revealed.png)、[electron-word-list-due.png](verification/v1.9/electron-word-list-due.png)、[electron-settings-review-curve.png](verification/v1.9/electron-settings-review-curve.png)；另有 4 张 Edge 对照（`study.png`、`study-revealed.png`、`word-list-due.png`、`settings-review-curve.png`）。

### 5. 说明与限制

1. **数字口径**：§1 的 typecheck / `npm test` / build 结果由 Lead 复跑确认（静态门禁，2026-11-04：typecheck 0 error、`npm test` 54 项全通过、build 130ms）；本文只写实跑数字，不臆测通过率。运行时结论只看 `report.json`。
2. **简化 SM-2**：不是严格 SuperMemo；「1 → 3 → 7 → 15 → 30 天」为产品文案的近似序列，实际第 4 次起按 `max(上次间隔 + 1, 上次间隔 × ease)` 增长并封顶 365 天（`src/shared/wordBank.ts:531-553`），ease 步进 ±0.1 / −0.2 且限制在 1.3–2.8。
3. **旧进度迁移语义**：v1 进度没有 `dueAt`，读取时迁移把已学词的 `dueAt` 设为 `lastSeenAt`，因此升级后它们会**立即进入待复习**——这是刻意设计（先按遗忘曲线过一遍），不是数据损坏；出现次数 / 记住次数 / 最后学习时间全部保留。迁移只发生在读取后的内存快照里，磁盘 `wordbank-progress.json` 仍是 `version=1`，直到下一次学习 / 改状态写入进度才以 `version=2` 落盘；在此期间重启无影响（每次读取都会重新迁移），不要手工改版本号。
4. **手动改状态**：只改状态、不计入 `seen / remembered`；「未学」会删除该词进度且无二次确认（已在操作指南中提示）。
5. **设置兼容**：`schemaVersion` 仍 11（无设置形状变更），新增的 2 个选项由 `resolveWordStudyOptions` 在缺失时回落默认值；旧 `settings.json` 无需手工迁移。
6. **安装版复核**：本轮以开发构建 + 隔离实例验收；安装版（`%LOCALAPPDATA%\NexusDock`）的复跑与版本号显示仍为遗留项，待打包后人工确认。
