# PLAN — 技术方案与架构（SDD 阶段 2）

> 对应规格：`docs/spec.md` v0.1 + §7 v1.0
> 技术栈：Electron 45 + electron-vite 6 + Vite 8 + React 19 + TypeScript 7（Windows only）
> v1.0 动效方案见 §12，设计细则见 `docs/motion-spec.md`

## 1. 架构总览

```
┌─────────────────────────── Electron 主进程 (Node) ───────────────────────────┐
│  index.ts                                                                     │
│   ├── settingsStore.ts   读写 %APPDATA%\nexus-dock\settings.json，深合并默认值  │
│   ├── windowManager.ts   创建 Dock / 音乐卡片 / 设置 三类窗口 + 位置计算 + 吸附  │
│   ├── ipc.ts             统一注册 ipcMain.handle / on（通道见 §4）              │
│   ├── apps.ts            开始菜单扫描 / .lnk 解析 / 图标提取 / 启动 / 运行态    │
│   └── media/                                                                    │
│        ├── smtcBridge.ts  常驻 powershell.exe 子进程 ⇄ JSON Lines 协议          │
│        └── mediaHub.ts    聚合系统媒体状态，向所有窗口广播 media:update          │
└───────────────┬───────────────────────────────────────────────┬──────────────┘
                │ contextBridge（preload/index.ts，唯一通道）     │
┌───────────────▼───────────────┐ ┌─────────────────────────────▼────────────┐
│ Dock 渲染进程 (React)          │ │ 音乐卡片渲染进程 (React)                    │
│ 图标放大/拖拽排序/右键菜单/手柄 │ │ 封面/标题/进度/控制 + 本地 <audio> 播放器   │
└───────────────────────────────┘ └──────────────────────────────────────────┘
┌───────────────────────────────┐
│ 设置面板渲染进程 (React)        │   ← 复用 preload，共用 settings:get/update
└───────────────────────────────┘
┌───────────────────────────────┐
│ PowerShell 子进程 (SMTC 桥)     │   stdout: JSON Lines 事件；stdin: 命令
└───────────────────────────────┘
```

安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、preload 只暴露 `window.nexus`（白名单方法），渲染层不接触 `require`/`fs`。

## 2. 目录结构

```
src/
  shared/
    types.ts            # IPC 契约 + 配置模型 + 默认值/深合并（主/渲染共用）
  main/
    index.ts            # app 生命周期 + 装配
    settingsStore.ts
    windowManager.ts
    ipc.ts
    apps.ts
    media/
      smtcBridge.ts
      smtc-bridge.ps1   # WinRT SMTC 读写脚本（JSON Lines 协议）
      mediaHub.ts
    protocol.ts         # media:// 与 icon:// 自定义协议（本地音频流/图标缓存）
  preload/
    index.ts
  renderer/
    dock/index.html, main.tsx, Dock.tsx, DockItem.tsx, dock.css
    music/index.html, main.tsx, MusicCard.tsx, LocalPlayer.ts, music.css
    settings/index.html, main.tsx, SettingsApp.tsx, sections/*.tsx, settings.css
    shared/             # 主题变量、公共 hooks、通用组件
```

## 3. 窗口与位置模型

### 3.1 Dock 窗口
- `frame:false, transparent:true, skipTaskbar:true, alwaysOnTop:true, resizable:false, movable:true, hasShadow:false`
- 窗口尺寸由渲染层内容决定：渲染层 `ResizeObserver` 量出底条实际像素 → `dock:setSize {width,height}` → 主进程 `setBounds`（避免透明窗口里留大片可点击空白区）。
- 位置算法 `computeDockBounds(display, dockConfig, contentSize)`：
  - `bottom`：`x = round(display.x + (display.width - w) * alongPercent/100)`，`y = display.y + display.height - h - MARGIN`
  - `top`：`y = display.y + MARGIN`
  - `left`：`x = display.x + MARGIN`，`y = display.y + (display.height - h) * alongPercent/100`
  - `right`：`x = display.x + display.width - w - MARGIN`
  - `MARGIN = 12`
- 拖动：渲染层手柄 CSS `-webkit-app-region: drag`。主进程监听窗口 `moved` 事件（拖动结束触发），计算 Dock 中心到四条屏幕边的距离，取最近边 → 反算 `alongPercent` → 写回设置并 `setPosition` 吸附（保证贴边 + 保留沿边位置，满足 AC-1.2/1.3）。
- 拖动期间不打断：`moved` 事件用 80ms 防抖，确保只在松手后吸附。
- 置顶层级 `setAlwaysOnTop(true, 'pop-up-menu')`，高于任务栏。

### 3.2 音乐卡片窗口
- 同样透明无边框、`alwaysOnTop`、`skipTaskbar`、可拖动（整卡都是 drag 区，按钮设置 `no-drag`）。
- `anchor:'dock'`：位置由 Dock 位置 + 卡片尺寸推导（Dock 在底部时卡片悬于 Dock 左/右侧上方 12px，越界自动翻转到另一侧）。
- `anchor:'free'`：独立的 `freeX/freeY`，拖动后写回；同样支持吸附到最近屏幕边。
- 尺寸来自 `music.width` 与内容高度。

### 3.3 设置窗口
- 580×760，`frame:false`、`alwaysOnTop`、`skipTaskbar:false`（方便找回）、单实例；自定义标题栏（可拖动 + 关闭按钮）。

## 4. IPC 契约（`src/shared/types.ts` 为唯一真源）

| 通道 | 方向 | 载荷 | 返回 |
|---|---|---|---|
| `settings:get` | R→M invoke | – | `Settings` |
| `settings:update` | R→M invoke | `DeepPartial<Settings>` | `Settings` |
| `settings:reset` | R→M invoke | – | `Settings` |
| `settings:changed` | M→R send | `Settings` | – |
| `dock:setSize` | R→M send | `{width,height}` | – |
| `dock:setEdge` | R→M invoke | `{edge, alongPercent?}` | `Settings['dock']` |
| `dock:snap` | M→内 | – | – |
| `apps:list` | R→M invoke | – | `DockItem[]` |
| `apps:launch` | R→M invoke | `id` | `{ok:boolean, error?:string}` |
| `apps:remove` | R→M invoke | `id` | `DockItem[]` |
| `apps:addByDialog` | R→M invoke | – | `DockItem[]` |
| `apps:reorder` | R→M invoke | `ids:string[]` | `DockItem[]` |
| `apps:menu` | R→M invoke | `{id, screenX, screenY}` | – |
| `apps:running` | M→R send | `Record<string,boolean>` | – |
| `apps:pickFromStartMenu` | R→M invoke | – | `DockItem[]`（候选列表） |
| `media:getState` | R→M invoke | – | `MediaState` |
| `media:control` | R→M invoke | `{action:'playpause'\|'next'\|'prev'\|'seek', positionMs?}` | `{ok:boolean}` |
| `media:pickLocalFiles` | R→M invoke | – | `LocalTrack[]` |
| `media:update` | M→R send | `MediaState` | – |
| `media:setLocalState` | R→M send | `MediaState` | – |
| `window:openSettings` | R→M send | – | – |
| `window:closeSettings` / `window:quit` | R→M send | – | – |
| `window:capture` | R→M invoke | `{target:'dock'\|'music'\|'settings'\|'screen'}` | `{dataUrl}`（验收截图用） |

## 5. SMTC 桥设计（关键技术选型）

**不用** node-gyp 原生模块（`@nodert-win10-*` 在 Node 24 上编译风险高）。**改用**常驻 `powershell.exe` 子进程调用 WinRT：

```powershell
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
```

协议：行长 JSON（JSON Lines）。
- 子进程每 **700ms** 轮询 `GetSessions()`，选 `PlaybackStatus=Playing` 的会话，否则取第一个；读 `TryGetMediaPropertiesAsync()`（标题/歌手/专辑/缩略图）、`GetPlaybackInfo()`、`GetTimelineProperties()`。
- 有变化时输出 `{"type":"media","state":{...}}`；缩略图另存临时 PNG，以 `data:` URL 或 `media://thumb` 返回（脚本内 `AsStreamForRead` 写文件）。
- 主进程写入一行命令（`playpause|next|prev|seek <ms>`），脚本 `ReadLine` 后调用 `TryTogglePlayPauseAsync()` / `TrySkipNextAsync()` / `TrySkipPreviousAsync()` / `TryChangePlaybackPositionAsync()`。
- 进程管理：`spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File', scriptPath])`，stdout 按行解析；`exit` 后 3s 内重启（最多 5 次指数退避）；应用退出时 kill。
- 已在本机实测：读到 `MSEdge` 会话的标题/状态/进度，说明接口可用。

本地播放器：音乐卡片渲染进程持有 `HTMLAudioElement`，文件经 `media://` 自定义协议（`protocol.handle` + 支持 Range 的 `net.fetch(pathToFileURL())`）流式加载，渲染层上报 `media:setLocalState` 供主进程广播（Dock 不依赖音乐状态）。

## 6. 应用扫描 / 图标 / 启动

- 扫描 `%ProgramData%\Microsoft\Windows\Start Menu\Programs` + `%APPDATA%\Microsoft\Windows\Start Menu\Programs` 下的 `.lnk`（递归，最多 200 个），一次 `powershell.exe` 批量用 `WScript.Shell.CreateShortcut()` 解析目标 exe。
- 图标：主进程 `app.getFileIcon(targetExe, {size:'large'})` → `nativeImage.toPNG()` → 写 `userData/icons/<hash>.png` → 渲染层用 `icon://<hash>` 自定义协议读取（比 base64 更省内存，且带缓存）。
- 启动：`.lnk` 用 `shell.openPath(lnk)`（继承快捷方式参数与工作目录）；纯 exe 用 `shell.openPath(exe)`；失败回退 `spawn(exe, {detached:true})`。
- 运行态：每 3s `powershell.exe -Command "Get-Process | Select -Expand ProcessName"` 取进程名集合，与图标目标 exe 的 basename（去扩展名）匹配 → 广播 `apps:running`。失败静默降级为全 false。

## 7. 渲染层设计要点

- **Dock**：`dock.edge` 决定 `flex-direction`；`gap`、`iconSize` 走 CSS 变量；悬停放大用 `:hover` + React state 计算每项 `scale`，`transform-origin` 按停靠边指向屏幕内侧，`transition: transform .16s cubic-bezier(.2,.9,.3,1.2)`；`will-change: transform`。
- **拖拽排序**：pointer events 记录按下项与位移，超过 6px 判定为拖动；用「目标槽位 + translateX 占位」实现，松手提交 `apps:reorder`。
- **拖动手柄**：底条最左侧 18px 宽竖向圆点区，`-webkit-app-region: drag`（按钮/图标区域 `no-drag`）。
- **音乐卡片**：`requestAnimationFrame` 本地插值进度（避免 700ms 抖动），每 700ms 用主进程真实进度校准；封面切换做 220ms 淡入；本地模式接管控制按钮。
- **设置面板**：受控组件 + `useDebouncedSettings`（250ms）写回；分组用折叠面板；改动即时预览。

## 8. 构建与运行

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖（`.npmrc` 已固定 npmmirror + 工作区内 npm cache） |
| `npm run dev` | electron-vite 开发模式：主/预加载热重启 + 渲染层 HMR |
| `npm run build` | 产物到 `out/`（main / preload / renderer 三份） |
| `npm run typecheck` | `tsc --noEmit` 全量类型检查 |
| `npm run dist` | （验收通过后）electron-builder 打 NSIS 安装包 |

## 9. 实施顺序（详见 `docs/tasks.md`）

阶段 0 脚手架 → 阶段 1 主进程骨架与位置引擎 → 阶段 2 Dock UI → 阶段 3 音乐子系统 → 阶段 4 设置与图标 → 阶段 5 集成/构建/视觉验收 → 阶段 6 文档与交付。

## 10. 并行分工（Agent Teams）

| 角色 | 写作用域 | 交付 |
|---|---|---|
| Lead | `package.json`、`electron.vite.config.ts`、`tsconfig.json`、`src/shared/**`、`src/preload/**`、`src/main/index.ts`、`src/main/ipc.ts`、`src/main/settingsStore.ts`、`src/main/windowManager.ts`、`docs/**` | 契约、窗口骨架、集成与验收 |
| 子代理 A（dock-core） | `src/main/apps.ts`、`src/main/protocol.ts` | 应用扫描/图标/启动/运行态、自定义协议 |
| 子代理 B（dock-ui） | `src/renderer/dock/**`、`src/renderer/shared/**` | Dock 视觉与交互（放大、拖拽排序、手柄、右键） |
| 子代理 C（media） | `src/main/media/**`、`src/renderer/music/**` | SMTC 桥、本地播放器、音乐卡片 |
| 子代理 D（settings-ui） | `src/renderer/settings/**` | 设置面板三组参数 + 恢复默认 |

> 写作用域互不重叠；Lead 在阶段 5 统一集成、构建、截图验收，所有跨文件改动由 Lead 收口。

## 11. v0.2 方案变更（2026-10-29）

| 需求 | 实现方式 | 文件 |
|---|---|---|
| Dock 自由定位 | `DockConfig.snapToEdge`（默认 false）+ `freeX/freeY`；`computeDockBounds` 在此模式下使用自由坐标；`moved` 事件写回坐标；打开吸附时用当前位置反算 `edge/alongPercent` | `windowManager.ts`、`shared/types.ts` |
| 背景完全透明 | `opacity` 允许 0（默认 0）；渲染层按 opacity 决定是否渲染底条背景/描边/阴影 | `shared/types.ts`、`dock.css` |
| 仅桌面显示 | 新增 `resources/desktop-state.ps1`：UIA 读取焦点控件并向上走到顶层窗口，比较窗口矩形与屏幕/工作区 → 输出最大化/全屏/桌面状态（JSON Lines，400ms 采样，仅变化时输出）；主进程 `desktopState.ts` 管理子进程（含 env 注入与退避重启），`windowManager.applyDesktopState()` 决定 `hide()/showInactive()`，前台进程 == 本应用主进程时不隐藏 | `desktop-state.ps1`、`desktopState.ts`、`windowManager.ts`、`index.ts` |
| 音乐开关 | Dock 末端音符按钮 + 卡片右上角 ✕ + 设置开关，三者都只改 `music.visible` | dock/music/settings 渲染层 |
| 时间准确性 | ps1 用 `Position + (now - LastUpdatedTime)` 推算；时长未知时 `durationMs=0`，卡片显示 `--:--` 且不参与比例计算 | `smtc-bridge.ps1`、`MusicCard.tsx` |
| 应用启动 | `DockItem.aumid` 保存 `Get-StartApps` 的 AppID，统一 `explorer.exe shell:AppsFolder\<AppID>` 启动，失败按序回退并在 Dock 顶部提示 | `apps.ts`、`shared/types.ts` |
| 应用目录 | `scanStartMenu()` 改用 `Get-StartApps`（199 项本机实测），AppID 为 exe 路径时顺便提取图标；`Get-StartApps` 不可用时回退到 .lnk 扫描 | `apps.ts` |
| 环境健壮性 | 所有 PowerShell 子进程显式注入 TEMP/TMP/APPDATA/LOCALAPPDATA/ProgramData；SMTC 封面目录回退 | `apps.ts`、`desktopState.ts`、`smtcBridge.ts`、`smtc-bridge.ps1` |
| 配置迁移 | `schemaVersion 1 → 2`：把旧内置应用替换为带 AUMID 的新集合（保留自定义/开始菜单项与顺序），opacity 重置为 0 | `settingsStore.ts` |

### 验证口径变化
- 「拖动吸附」由默认行为改为**可选开关**，人工验收时应先确认「关闭吸附时拖到哪停在哪」，再打开开关确认吸附恢复。
- 「Dock 只在桌面显示」需用真实最大化/全屏窗口验证（评审时可最大化任意窗口观察 Dock 消失，最小化后恢复）。

## 12. v1.0 方案：精细化交互与动效体系（2026-10-30）

> 对应规格：`docs/spec.md` §7；设计细则：`docs/motion-spec.md`。

### 12.1 总体思路

不引入动效库，用「CSS 令牌 + 少量原生 JS 工具 + React 状态」实现：

```
settings.appearance (schemaVersion 4)
        │  useSettings() 订阅
        ▼
document.documentElement.dataset: motion=light|standard|expressive
                                  reducedMotion=true|false
                                  clickSound=true|false
        │
        ▼
motion.css 令牌（时长/曲线/幅度）+ 组件样式（dormant by data-*）
        │
        ├─ shared/motion.ts：spawnRipple()（涟漪 DOM 图层）、playClickSound()（WebAudio 合成音）
        ├─ dock：按压/启动弹跳/悬停光效/指示点呼吸/FLIP 排序/入场错峰
        ├─ music：控件按压涟漪/播放图标 morph/切歌微动/进度条跟手
        └─ settings：控件四态/页面转场/新「外观与动效」页
```

### 12.2 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 动效强度如何生效 | `:root[data-motion]` 只改 `--nx-motion-scale`（0.72 / 1 / 1.28）与 `--nx-press-scale`；所有时长用 `calc(基准 * var(--nx-motion-scale))` | 一处切换、全局生效，无 JS 重复计算 |
| 按压状态怎么作用 | Dock 图标的放大/抬升在 `DockItemView` 内联 `transform` 上，按压系数直接乘进同一表达式；普通按钮用 `.nx-pressable:active`（CSS） | 避免内联 transform 与 CSS `:active` 冲突 |
| 涟漪实现 | `spawnRipple(host, event)` 动态创建 `<span class="nx-ripple">`，`animationend` 自动移除；宿主加 `.nx-ripple-host`（相对定位 + overflow 裁剪）或 `.nx-ripple-glow`（不裁剪，用于透明 Dock） | 零依赖、无 React state 抖动、可被 reduced-motion 规整关闭 |
| Dock 排序过渡 | FLIP：重排前记录每项 `getBoundingClientRect()`，`useLayoutEffect` 中反算 `translate` 后 rAF 过渡回 0 | 不改数据流，只在 `.dock-item`（外层）做位移，和 `.dock-item-inner` 的缩放互不冲突 |
| 启动弹跳 | 点击时立即触发乐观反馈（弹跳 + 光晕），主进程结果只决定是否追加 toast | 启动耗时 1–2s，等结果再动会显得迟钝；乐观反馈是桌面启动器通用做法 |
| 音效 | WebAudio 振荡器 + 指数包络合成 50ms 点击音（约 1.4kHz→0.9kHz），无外部资源 | 避免打包音频文件与版权问题，开关即时生效 |
| 减少动效 | 三重保障：系统 `prefers-reduced-motion`、`settings.appearance.reducedMotion`、`data-motion` 令牌；统一用 `animation-duration/transition-duration: 0.01ms !important` 降级 | 满足可访问性且不破坏布局 |
| 配置迁移 | schemaVersion 3 → 4：`appearance` 走 `sanitizeSettings` 默认值补全，无需改写历史字段 | 旧用户配置零丢失 |

### 12.3 文件级改动（写作用域）

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/shared/types.ts`、`src/main/settingsStore.ts` | `AppearanceConfig`、默认值/校验/迁移、schemaVersion 4 |
| Lead | `src/renderer/shared/theme.css`、`motion.css`（新增）、`ui.css`、`ui.tsx`、`hooks.ts`、`motion.ts`（新增） | 设计令牌、动效令牌、涟漪/音效工具、通用控件四态、`data-*` 注入 |
| 子代理 dock-ui | `src/renderer/dock/**` | 按压/涟漪/启动弹跳/悬停光效/指示点呼吸/FLIP/入场/Toast 进出 |
| 子代理 music-ui | `src/renderer/music/**` | 控件按压涟漪/播放 morph/切歌微动/进度条跟手/封面交叉淡入 |
| 子代理 settings-ui | `src/renderer/settings/**` | 新「外观与动效」页、导航、页面转场、列表与控件样式 |
| Lead | `docs/**`、`README.md` | spec/plan/tasks/motion-spec/verification 回填 |

### 12.4 验收方法（可复现）

1. `npm run typecheck`、`npm run build` 零错误。
2. `npm run dev`（带 CDP 9222）启动三窗口，用 `scripts/` 下 CDP 脚本：
   - 读取 `document.documentElement.dataset.motion/reducedMotion` 验证设置联动；
   - 读取按钮 `getComputedStyle` 的 `transition-duration`、`transform` 验证按压/回弹；
   - 用 `Input.dispatchMouseEvent` 模拟 pointerdown 后 60ms 截图，验证按压变形与涟漪存在；
   - 读取 Dock item 的 FLIP 过渡后的 `transform` 是否归零。
3. 截图证据存入 `docs/verification/v1/`，逐条 AC 写入 `docs/verification.md` §v1.0。
4. 人工体验项（拖拽排序手感、启动弹跳、音效）单独标注。

## 13. v1.1 方案：吸附开关 / 开机自启 / 桌面时钟 / 位置锁定（2026-10-30）

> 对应规格：`docs/spec.md` §8（US-11 ~ US-15）。设计原则与 v1.0 一致：**设置唯一真源、主进程统一位置引擎、渲染层白名单 IPC、零新增运行时依赖**。
> 状态：已按本方案实现并验收（`docs/verification.md` §v1.1，31/31 通过）。与 13.3 决策的差异：音乐 `snapToEdge` 翻转仅在 `anchor==='free'` 时换算坐标（避免跟随 Dock 模式跳变），时钟首次内容尺寸回报后才显示（避免初始透明窗口隐形点击区）。

### 13.1 总体思路

```
settings.json (schemaVersion 5)
  dock{} music{snapToEdge,...} clock{...} lock{dock,music,clock} system{autoStart} appearance{} apps[]
        │ initSettings() + migrate(v4→v5) + sanitizeSettings()
        ▼
settingsStore ── updateSettings() ── emit() ─┬─ subscribeSettings(windowManager.onSettingsChanged)
        │                                    ├─ subscribeSettings(autostart.syncFromSettings)
        │                                    └─ broadcast('settings:changed') → 四个渲染窗口
        ▼
windowManager：四窗口生命周期 + 位置引擎
  ├─ Dock：edge/alongPercent 或 freeX/freeY；snapToEdge 为「拖动后吸附」开关（v0.2 已有）
  ├─ 音乐：anchor=dock 跟随；anchor=free 时按 music.snapToEdge 决定「吸附边」或「自由坐标」
  ├─ 时钟：freeX/freeY（-1 = 未定位 → 主屏右上角），拖动松手吸附最近边
  └─ 位置锁定：lock.{dock,music,clock} → win.setMovable(!locked) + 渲染层 data-locked
        ▼
渲染层（四窗口）
  Dock：末尾新增时钟开关按钮、手柄锁定态、右键菜单新增锁定/时钟项（主进程菜单）
  音乐：data-locked 关闭整卡拖动区
  时钟：新增渲染页（时间显示/拖动/锁定/动效降级）
  设置：导航 7 项；音乐页加吸附开关；新增「时钟」「系统」两页
```

### 13.2 契约模型（schemaVersion 5）

```ts
export type WindowTarget = 'dock' | 'music' | 'settings' | 'clock'

interface MusicConfig {            // 既有字段略
  snapToEdge: boolean              // 新增：true=拖动松手吸附最近边（默认）；false=自由摆放
}
interface ClockConfig {            // 新增
  visible: false
  showSeconds: false; showDate: true; hour12: false
  fontSize: 40                     // 28–96
  opacity: 1                       // 0.2–1
  alwaysOnTop: true
  theme: 'dark'
  freeX: -1; freeY: -1             // -1 = 未定位 → 主屏右上角
}
interface LockConfig  { dock: false; music: false; clock: false }   // 单窗口锁定；总开关在 UI 层按「三者是否全锁」推导
interface SystemConfig { autoStart: false }
interface Settings {
  schemaVersion: 5
  dock; music; clock; lock; system; appearance; apps
}
```

- **总开关语义**：`总开关勾选 === (lock.dock && lock.music && lock.clock)`。打开总开关 = 三者都置 true；关闭 = 都置 false；之后可单独覆盖。不额外存储 `all` 字段，避免两个真源打架。
- **迁移 v4→v5**：`music.snapToEdge = true`；`music.freeX/freeY = -1`（旧值 60/60 从未被使用，重置为「未定位」避免关闭吸附后位置跳到 (60,60)）；`clock/lock/system` 由 `sanitizeSettings` 补默认；`dock/appearance/apps` 原样保留。
- **`env.isPackaged`**：主进程在创建窗口前写 `process.env.NEXUS_PACKAGED = app.isPackaged ? '1' : '0'`，preload 读取后暴露给渲染层（沙箱 preload 无法直接访问 `app`）。

### 13.3 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 位置锁定的双层防护 | 渲染层给窗口根节点加 `data-locked`，CSS 把拖动区改成 `-webkit-app-region: no-drag`（光标同步改 `default`）；主进程 `win.setMovable(false)` 兜底 | CSS 负责视觉/交互意图，主进程负责不可绕过；两者都关闭后 OS 不会再移动窗口 |
| 锁定状态从哪来 | 渲染层通过已有 `settings:changed` 广播读取 `settings.lock`，不新增推送通道 | 复用 v1.0 已验证的设置广播，零额外 IPC |
| 锁定期间的位置写回 | `moved` 事件处理器先判锁，锁定直接 return；`applyLayout` 仍可程序化改位置（改设置/切边/跟 Dock） | 锁定只防「用户拖动」，不阻断布局引擎 |
| 音乐吸附开关的数据模型 | `anchor`（跟随 Dock / 自由）与 `snapToEdge`（自由模式下是否吸附）正交；拖动时 `anchor` 自动切 `free` | 语义清晰：跟随 Dock 与吸附是两件事；拖动即脱离 Dock 是 v0.2 既有行为 |
| 音乐关闭吸附后的坐标 | 复用 `music.freeX/freeY`（此前仅占位）；自由布局计算优先级：`!snapToEdge && freeX>=0` → 自由坐标；否则回到 edge/alongPercent 计算 | 不改窗口字段结构，重启可精确还原；旧配置迁移后 freeX=-1 保证首次行为正确 |
| 音乐开关切换不跳变 | `onSettingsChanged` 检测 `snapToEdge` 翻转：false→true 用当前 bounds 反算最近边（复用 `snapMusicToNearestEdge`）；true→false 把当前 bounds 固化为 `freeX/freeY` | 与 Dock 在 v0.2 的开关处理完全一致，用户无跳变 |
| 时钟位置模型 | 只存 `freeX/freeY`（屏幕 DIP 绝对坐标，-1 = 未定位）；拖动松手后吸附最近边：只调整离边最近的那一轴，另一轴保持 | 时钟不需要「沿边百分比」，精确坐标记忆即可；吸附逻辑比 Dock/音乐更简单，避免第三套百分比语义 |
| 时钟尺寸 | 复用 `useContentSize('clock')` + 主进程 `contentSizes.clock`，渲染层量出内容尺寸回报 | 透明窗口必须与内容等大（v1.0 已验证的硬约束），字号/日期变化自动适配窗口 |
| 时钟显示节流 | 秒显示时 250ms 定时器对齐整秒；不显示秒时 1s；不显示秒且跨分钟才更新 | 避免每秒 React 全量重渲染；读时稳定 |
| 开机自启真源 | 操作系统登录项为唯一真源：启动时 `app.getLoginItemSettings().openAtLogin` 回写 `settings.system.autoStart`；开关走 `system:setAutoStart` IPC 写 OS 后回读校验并回写设置 | 用户可能在任务管理器里禁用启动项，设置页不能显示假状态 |
| 开机自启入口 | `app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: [] })`（HKCU Run） | 无管理员权限、无需计划任务；Electron 官方 API，跨版本稳定 |
| 开发模式自启 | `!app.isPackaged` 时 IPC 直接返回 `{ ok:false, reason:'dev' }`，设置页开关禁用并提示 | 开发态 `process.execPath` 指向 electron.exe，写入会导致错误的登录启动项 |
| Dock 快捷解锁入口 | Dock 右键菜单（原生 Menu）新增「显示桌面时钟」与「锁定全部窗口位置」两个 checkbox | 锁定后 Dock 仍可右键；避免用户被锁死后必须找设置页 |
| 新增页面位置 | 导航：Dock / 音乐 / 时钟 / 应用 / 外观 / 系统 / 关于 | 时钟页紧邻音乐（同属桌面组件）；系统页承载自启与锁定 |
| 时钟动效 | 入场 `nx-fade-in`（v1.0 令牌）+ 秒数字仅内容切换不做位移动画；样式统一使用 `--nx-*` 变量 | 遵循「不硬编码毫秒」约束（AC-9.1）；时钟以可读性优先 |

### 13.4 IPC 契约增量（`src/shared/types.ts` 的 `IPC` 为唯一真源）

| 通道 | 方向 | 参数 | 返回 | 说明 |
|---|---|---|---|---|
| `system:setAutoStart` | R→M invoke | `enabled: boolean` | `{ ok: boolean; autoStart: boolean; reason?: 'dev' \| 'os' \| string }` | 写 OS 登录项并回读校验；失败时返回实际状态，设置页据此回滚 |
| `window:setContentSize` | R→M send | `target: 'dock'\|'music'\|'clock'`（扩展） | – | 新增 clock 目标 |
| `window:capture` | R→M invoke | `target: 'dock'\|'music'\|'settings'\|'clock'`（扩展） | `dataUrl` | 验收截图用 |
| `apps:dockMenu` | R→M invoke | `point` | – | 既有通道；菜单模板新增「显示桌面时钟」「锁定全部窗口位置」两项 |

`NexusApi` 增量：

```ts
env: { ..., isPackaged: boolean }
system: {
  setAutoStart: (enabled: boolean) => Promise<{ ok: boolean; autoStart: boolean; reason?: string }>
}
```

### 13.5 窗口行为矩阵（v1.1 验收口径）

| 窗口 | 拖动方式 | 拖动后位置 | 位置锁定 | 隐藏/显隐 |
|---|---|---|---|---|
| Dock | 左侧 ⋮ 手柄（`app-region: drag`） | `snapToEdge` 开：吸附最近边 + 沿边百分比；关：自由坐标（v0.2 现状，不改） | `lock.dock` | 仅桌面显示（v0.2 现状） |
| 音乐卡片 | 整卡（标题/封面区域） | `anchor=dock` 跟随 Dock；拖动后 `anchor=free`；`snapToEdge` 开：吸附最近边 + 沿边百分比；关：自由坐标 | `lock.music` | `music.visible` |
| 时钟 | 整卡 | 拖动后吸附最近边（只吸附最近的一轴）；`freeX/freeY` 持久化；首次右上角 | `lock.clock` | `clock.visible` |
| 设置 | 标题栏（保持现状） | 不受位置锁定影响 | 不参与 | 打开/关闭（保持现状） |

### 13.6 文件级改动与并行分工（写作用域）

| 角色 | 写作用域 | 交付 |
|---|---|---|
| **Lead** | `src/shared/types.ts`、`src/preload/index.ts`、`electron.vite.config.ts`、`docs/**`、`README.md`、`操作指南.md`、`scripts/v11-verify.mjs` | 契约、四窗口渲染入口构建配置、SDD 文档、集成验收 |
| **主进程 main-core** | `src/main/settingsStore.ts`、`src/main/windowManager.ts`、`src/main/ipc.ts`、`src/main/index.ts`、`src/main/autostart.ts`（新增） | schemaVersion 5 迁移、时钟窗口生命周期/布局、位置锁定、音乐吸附、开机自启、IPC handler、Dock 右键菜单 |
| **时钟 UI clock-ui** | `src/renderer/clock/**`（全部新增） | 时钟渲染页：时间/日期显示、尺寸自适应、拖动与锁定态、动效降级 |
| **设置 UI settings-ui** | `src/renderer/settings/**` | 导航 7 项、「时钟」页、「系统」页、音乐页吸附开关、样式补充 |
| **Dock/音乐 UI dock-music-ui** | `src/renderer/dock/**`、`src/renderer/music/**` | Dock 时钟开关按钮 + 手柄锁定态 + 样式、音乐卡片锁定态样式 |
| **验证 verifier** | `scripts/v11-verify.mjs`（与 Lead 协同）、`docs/verification/v1.1/**` | CDP 四窗口自动化验收脚本、JSON 报告、截图证据 |

> **依赖顺序**：Lead 先落 `types.ts` / `preload` / `vite.config`（契约门禁）→ 四个实现角色并行 → Lead 集成 + typecheck/build → verifier 运行时验收 → Lead 回填验收文档。
> 写作用域互不重叠：`settings.css` 只由 settings-ui 改；`dock.css` / `music.css` 只由 dock-music-ui 改；`clock.css` 只由 clock-ui 改；跨文件改动一律由 Lead 收口。

### 13.7 验收方法（可复现）

1. **静态门禁**：`npm run typecheck` 零错误；`npm run build` 成功（renderer 产物含 `clock/index.html`）。
2. **配置迁移**：用 v4 版 `settings.json` 启动（可在 `scripts/out/` 造样例），确认迁移后 `schemaVersion=5`、旧字段保留、日志打印 `[settings] 已从 v4 迁移到 v5`。
3. **CDP 自动化**（`scripts/v11-verify.mjs`，参考 v1.0 的 `cdp-*.mjs`）：
   - 四窗口 target 可发现（dock / music / clock / settings）；
   - 设置面板导航 7 项文本正确，切到「时钟」「系统」页截图；
   - 打开时钟后读取时钟窗口 `document.body.innerText` 时间格式；切换 `showSeconds` / `hour12` / `fontSize` 后读取计算样式；
   - 锁定开关联动：读取三窗口根节点 `data-locked` 与 `window.nexus.settings.get()`；
   - 音乐 `snapToEdge` 切换后读取设置落盘值；
   - 截图存入 `docs/verification/v1.1/`，检查项写入 `v11-report.json`。
4. **主进程侧验证**：通过 CDP `Runtime.evaluate` 调用白名单 API 读取设置；开机自启在开发态验证「禁用 + 提示」；安装版行为标注为人工验收（需要安装后重启登录）。
5. **人工体验项**：真实拖动吸附手感、锁定后不可拖动、时钟读秒观感、开机自启实际登录行为。
6. 逐条 AC 回填 `docs/verification.md` §v1.1，并更新 README / 操作指南。

## 14. v1.2 方案：时钟吸附开关 + 窗口行为准则（2026-10-30）

> 对应规格：`docs/spec.md` §9（US-16 / US-17）。准则真源：`docs/window-conventions.md`。
> 状态：已实现并验收（`docs/verification.md` §v1.2）。

### 14.1 变更范围

1. **时钟吸附开关**：`ClockConfig.snapToEdge`（默认 `true`）；关闭后拖动时钟停在原地并持久化绝对坐标；运行中切换不跳变。复用音乐卡片 v1.1 的成熟模式（吸附/自由分支 + `onSettingsChanged` 翻转换算），不引入新 IPC。
2. **窗口行为准则**：新增 `docs/window-conventions.md`，把吸附开关列为**今后所有悬浮窗口的强制能力（C3）**，同时规定位置记忆、位置锁定、显示开关、动效令牌、尺寸自适应、配置迁移、窗口接入与验收契约；附接入检查清单与当前符合性矩阵。

### 14.2 契约与迁移（`src/shared/types.ts`）

```ts
interface ClockConfig {            // 既有字段略
  snapToEdge: boolean              // v1.2 新增：true=拖动松手吸附最近边（默认）；false=自由摆放
}
// DEFAULT_SETTINGS.schemaVersion 5 → 6；clock.snapToEdge 默认 true
```

- **迁移 v5→v6**：`clock.snapToEdge = true`；`clock` 其余字段（含已记忆 `freeX/freeY`、字号、透明度、主题、置顶）原样保留；`dock/music/lock/system/appearance/apps` 不动。
- **sanitize**：`snapToEdge` 非布尔值回退默认 `true`；`mergeSettings` 自动覆盖新字段（clock 组已深合并，无需新增分支）。

### 14.3 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 时钟位置模型是否改变 | 不改变：仍只存 `freeX/freeY`（绝对坐标，-1=未定位→主屏右上角） | 吸附时把吸附后的坐标写回 `freeX/freeY`，自由时写原始坐标；一套字段同时满足两种模式，零额外迁移风险 |
| `moved` 处理分支 | `applyingClock → 锁定 → snapToEdge ? snapClockToNearestEdge() : 写入当前 bounds` | 与音乐卡片一致；锁定守卫随防抖回调再判一次 |
| 开关翻转不跳变 | `onSettingsChanged` 检测翻转：false→true 以当前位置反算最近边；true→false 固化当前坐标；其余情况 `applyClockLayout()` | 复用 v1.1 模式；`updateSettings` 相同值短路避免重复 emit |
| 布局函数是否重写 | 不重写：`computeClockBounds` 已优先使用 `freeX/freeY`，自由/吸附只影响「什么时候写坐标」 | 改动面最小，回归风险最低 |
| 准则如何落地 | 独立文件 `docs/window-conventions.md` 作为唯一标准真源，spec §4/§9、plan §14、README、操作指南交叉引用 | 用户要求「直接写进准则文档」；独立文件便于后续窗口评审逐项对照，不与需求历史混写 |
| 设置窗口是否要补吸附开关 | 豁免：管理面板不是桌面悬浮组件，在准则 §2/§5 显式登记豁免理由 | 避免为「所有窗口」机械加装无意义选项；豁免必须书面留痕 |

### 14.4 文件级改动（写作用域）

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/shared/types.ts` | `ClockConfig.snapToEdge`、默认值、sanitize、schemaVersion 6 |
| Lead | `src/main/settingsStore.ts` | v5→v6 迁移 |
| Lead | `src/main/windowManager.ts` | 时钟 `moved` 吸附/自由分支；`onSettingsChanged` 开关翻转处理 |
| Lead | `src/renderer/settings/sections/ClockSection.tsx` | 「位置」组新增「自动吸附屏幕边缘」开关 + 文案 |
| Lead | `docs/window-conventions.md`（新增）、`docs/spec.md` §4/§9、`docs/plan.md` §14、`docs/tasks.md` v1.2、`docs/verification.md` §v1.2、`README.md`、`操作指南.md`；`package.json` 版本 1.2.0 | 准则与 SDD 文档、版本 |
| Lead | `scripts/v12-verify.mjs`、`docs/verification/v1.2/` | 从 v11 脚本派生：schemaVersion 6 断言 + 时钟吸附开关检查 + 截图 |

### 14.5 验收方法（可复现）

1. `npm run typecheck` 零错误；`npm run build` 成功。
2. 旧 v5 配置启动：日志 `[settings] 已从 v5 迁移到 v6`，`schemaVersion=6`、`clock.snapToEdge=true`、旧字段保留。
3. `node scripts/v12-verify.mjs`（安装版 + CDP 9224）：
   - `schemaVersion===6`、四窗口 target；
   - 设置「时钟」页含「自动吸附屏幕边缘」且默认 checked=true；
   - API 切 `clock.snapToEdge=false` → 落盘值 false、页面开关同步；切回 true；
   - 迁移后 `clock.freeX/freeY` 与旧位置一致；截图 `settings-clock-snap.png`；
   - 回归：7 项导航、时钟格式/字号、锁定 `data-locked`、音乐吸附开关、自启 dev/安装版分支、设置快照恢复。
4. 结果写 `docs/verification/v1.2/v12-report.json` 与截图，逐条回填 `docs/verification.md` §v1.2。
5. 人工验收项：关闭吸附后真实拖动时钟「拖到哪停在哪」、开启后「松手吸附最近边」；锁定状态下不可拖动。

## 15. v1.3 方案：设置信息架构重构（2026-10-30）

> 对应规格：`docs/spec.md` §10（US-18 / US-19）。准则真源：`docs/window-conventions.md` §2/§2.1。
> 状态：已实现并验收（`docs/verification.md` §v1.3）。

### 15.1 变更范围

1. **系统页重构**：新增「窗口共性设置」分组 —— 「锁定全部窗口位置」总开关 + 三个默认收起的窗口折叠栏（Dock / 音乐卡片 / 桌面时钟）。每个折叠栏内统一管理：自动吸附屏幕边缘、始终置顶、仅在桌面显示、锁定位置、移回默认位置；标题行显示「吸附开 · 置顶开 · 始终显示 · 未锁定」摘要。
2. **窗口页瘦身**：Dock 页移除吸附/置顶/仅在桌面显示；音乐页移除吸附；时钟页移除吸附/置顶/位置组；各页只保留独有特性，并提示「共性项已统一到系统页」。
3. **共性能力补齐**（用户要求「窗口没有的选项就补上」）：
   - `music.alwaysOnTop`（默认 true，保持旧行为）、`music.onlyOnDesktop`（默认 false，保持旧行为）；
   - `clock.onlyOnDesktop`（默认 false，保持旧行为）；
   - `dock` 既有 `alwaysOnTop`/`onlyOnDesktop` 不变。
4. **行为实现**：音乐「始终置顶」接入 `win.setAlwaysOnTop`；「仅在桌面显示」由 Dock 专用逻辑泛化为三窗口共用 `applyFloatingVisibility()`。
5. **文档与准则**：spec §10、plan §15、tasks v1.3、conventions §2.1/C11/C12/矩阵、README、操作指南、verification §v1.3。

### 15.2 契约与迁移（`src/shared/types.ts`）

```ts
interface MusicConfig {            // 既有字段略
  alwaysOnTop: boolean             // v1.3 新增，默认 true（保持旧行为）
  onlyOnDesktop: boolean           // v1.3 新增，默认 false（保持旧行为）
}
interface ClockConfig {            // 既有字段略
  onlyOnDesktop: boolean           // v1.3 新增，默认 false（保持旧行为）
}
// DEFAULT_SETTINGS.schemaVersion 6 → 7；sanitizeSettings 补布尔收敛
```

- **迁移 v6→v7**：仅补新字段默认值；`dock/music/clock` 既有字段（含位置、吸附、锁定）原样保留；`settingsStore.migrate` 显式记录迁移。
- **不新增 IPC**：全部共性开关复用 `settings:update` → `subscribeSettings` → `settings:changed` 广播。

### 15.3 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 共性项放哪 | 「系统」页新增「窗口共性设置」分组，三窗口折叠栏 | 用户明确要求共性归系统；系统页已有「位置锁定」，语义一致 |
| 折叠栏默认状态 | 全部收起；标题行显示状态摘要（吸附/置顶/仅在桌面/锁定） | 用户确认；系统页更清爽，同时不展开也能看出各窗口状态 |
| 折叠栏实现 | 原生 `<button aria-expanded>` + 条件渲染 + `nx-fade-in` 令牌过渡 | 可键盘操作、可访问性好；不引入动画库，遵循动效令牌 |
| 独有特性边界 | Dock=停靠边/沿边位置/图标/背景/主题；音乐=显示/来源/宽度/进度样式/卡片位置；时钟=显示内容/字号/透明度/主题 | 只有真正共性的行为才进系统页，避免把所有开关都堆过去 |
| 缺失能力如何补 | 只补共性能力（alwaysOnTop/onlyOnDesktop），默认值保留旧观感 | 满足「三窗口一致」且不改变用户现有体验；迁移显式兜底 |
| 「仅在桌面显示」泛化 | 抽出 `applyFloatingVisibility()`：按 `hiddenByDesktop` 记录每个窗口的桌面隐藏态；前台最大化/全屏隐藏，回桌面恢复；`visible=false` 的窗口不受影响 | 原逻辑只服务 Dock，抽成通用后可复用于音乐/时钟，行为边界清晰 |
| 音乐置顶 | 创建窗口与设置变更时 `setAlwaysOnTop(settings.music.alwaysOnTop,'floating')` | 与 Dock/时钟置顶实现一致；关闭后卡片不再压住其他窗口 |
| 位置复位 | 系统页折叠栏内按钮：Dock→`freeX/freeY=-1`（底部居中）；音乐→`anchor='dock'`+`freeX/freeY=-1`（跟随 Dock）；时钟→`freeX/freeY=-1`（主屏右上角） | 用户要求位置操作也统一进系统页；复用既有布局引擎，无需新字段 |
| 默认值语义 | Dock onlyOnDesktop=true；音乐/时钟 onlyOnDesktop=false；音乐 alwaysOnTop=true；吸附默认沿用各窗口既有值 | 保留旧观感优先；准则 §2.1 要求「新增开关默认值不改变既有行为」 |

### 15.4 文件级改动（写作用域）

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/shared/types.ts` | `MusicConfig.alwaysOnTop/onlyOnDesktop`、`ClockConfig.onlyOnDesktop`、默认值、sanitize、schemaVersion 7 |
| Lead | `src/main/settingsStore.ts` | v6→v7 迁移 |
| Lead | `src/main/windowManager.ts` | 音乐 `alwaysOnTop` 创建/联动；`applyFloatingVisibility()` 三窗口「仅在桌面显示」 |
| Lead | `src/renderer/settings/sections/SystemSection.tsx` | 系统页重构：窗口共性设置 + 三窗口折叠栏（默认收起 + 摘要） |
| Lead | `src/renderer/settings/sections/{DockSection,MusicSection,ClockSection}.tsx` | 移除已迁移到系统页的共性项，保留独有特性 + 提示文案 |
| Lead | `src/renderer/settings/settings.css` | 折叠栏样式（令牌、开合指示、摘要、淡入） |
| Lead | `docs/window-conventions.md`、`docs/spec.md` §10、`docs/plan.md` §15、`docs/tasks.md`、`docs/verification.md` §v1.3、`README.md`、`操作指南.md`；`package.json` 1.3.0 | 准则、SDD 文档、版本 |
| Lead | `scripts/v13-verify.mjs`、`docs/verification/v1.3/` | 从 v12 派生：schemaVersion 7、折叠栏/页面归属/字段迁移检查 + 截图 |

### 15.5 验收方法（可复现）

1. `npm run typecheck` 零错误；`npm run build` 成功。
2. 旧 v6 配置启动：`schemaVersion=7`，`music.alwaysOnTop=true`、`music.onlyOnDesktop=false`、`clock.onlyOnDesktop=false`，其余字段保留。
3. `node scripts/v13-verify.mjs`（安装版 + CDP 9224）：
   - 系统页含「窗口共性设置」，三个折叠栏标题（Dock/音乐卡片/桌面时钟）默认 `aria-expanded=false`；点击 Dock 后展开，含五项设置（自动吸附屏幕边缘/始终置顶/仅在桌面显示/锁定位置/移回默认位置）；
   - Dock/音乐/时钟页面不再包含已迁移的共性文案（吸附/置顶/仅在桌面/移回默认位置）；
   - 通过展开栏切换共性开关：`music.alwaysOnTop`、`music.onlyOnDesktop`、`clock.onlyOnDesktop`、三窗口 `snapToEdge` 落盘与 UI 同步；
   - 点击「移回默认位置」后对应位置字段复位；截图保存；
   - 回归：7 项导航、时钟显示、锁定 `data-locked`、音乐吸附、自启（基线感知/还原）、设置快照恢复、`schemaVersion=7`。
4. 结果写 `docs/verification/v1.3/v13-report.json` 与截图，逐条回填 `docs/verification.md` §v1.3。
5. 人工验收项：三窗口「仅在桌面显示」在真实最大化/全屏窗口下的隐藏与恢复；音乐卡片置顶开关的实际层级效果；折叠栏手感。

## 16. v1.3.1 修复方案：Dock 唤起保持应用窗口状态（2026-11-01）

> 对应规格：`docs/spec.md` §11（US-20）。状态：已实现并验收（`docs/verification.md` §v1.3.1，10/10 通过）。

### 16.1 根因

`src/main/apps.ts` 中 `launchAndFocus` 的 PowerShell 置前函数 `Activate-Win` 无论窗口当前状态，都会调用：

```powershell
[NexusFg2]::ShowWindow([IntPtr]$w.Hwnd, 9)   # 9 = SW_RESTORE
```

`SW_RESTORE` 会把已最大化窗口还原为普通窗口。Dock 唤起已运行应用时（`launchAndFocus` step 1）会立刻走该函数，于是用户看到「先最大化、后被还原」。

### 16.2 修复方案

把「显示状态」与「置前」解耦：

| 窗口当前状态 | 处理 |
|---|---|
| 最小化（`IsIconic=true`） | 调用 `ShowWindow(SW_RESTORE=9)` 恢复；Windows 会自动回到最小化前的最大化/普通状态 |
| 最大化（`IsZoomed=true`） | **不调用 ShowWindow**，只 `BringWindowToTop` + `SetForegroundWindow`，状态保持不变 |
| 普通 | **不调用 ShowWindow**，只置前，保持普通 |

保留原有置前兜底链（`AllowSetForegroundWindow` → Alt 键解锁 → `SetForegroundWindow` → `AppActivate` → `SwitchToThisWindow`），它们只影响前台归属、不改变最大化/普通状态；C# 辅助类新增 `IsIconic` / `IsZoomed` 的 P/Invoke 声明。

### 16.3 文件级改动

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/main/apps.ts` | `NexusFg2` 增加 `IsIconic`/`IsZoomed`；`Activate-Win` 仅在 `IsIconic` 时 `SW_RESTORE`，其余状态只置前 |
| Lead | `scripts/v131-verify.mjs`（新增）、`docs/verification/v1.3.1/` | 独立 WinForms fixture（编译到 `%LOCALAPPDATA%`）状态验收脚本、报告与截图 |
| Lead | `docs/spec.md` §11、`docs/plan.md` §16、`docs/tasks.md` v1.3.1、`docs/verification.md` §v1.3.1、`README.md`、`操作指南.md`；`package.json` 1.3.1 | 补丁文档与版本 |

### 16.4 验收方法（可复现）

1. `npm run typecheck` 0 错误、`npm run build` 成功；安装版更新到 v1.3.1。
2. `node scripts/v131-verify.mjs`（安装版 + CDP 9224）：
   - 临时向 Dock 注入测试应用 fixture（独立 WinForms 窗口，标题 `Nexus WindowState Probe`，编译到 `%LOCALAPPDATA%`，不触碰用户真实应用）；
   - W1 首次启动并找到窗口 → W2 设为最大化 → **W3 Dock 唤起：仍为最大化 + 前台**（核心用例）；
   - W4 最小化 → **W5 Dock 唤起：恢复显示且仍为最大化**；
   - W6 设为普通 → Dock 唤起：保持普通；
   - W7 结束后 apps 列表原样恢复、删除 fixture 文件、只关闭自己的测试进程。
3. 结果写 `docs/verification/v1.3.1/v131-report.json` 与 2 张截图。
4. 人工验收：用你自己的工作流（例如已最大化的浏览器/编辑器）点 Dock 图标，确认不再出现「先最大化再还原」。

## 17. v1.4.1 修复方案：Dock 自身图标 → 打开设置（2026-11-01）

> 对应规格：`docs/spec.md` §12（US-21）。状态：已实现并验收（2026-11-01，CDP 17/17，记录见 `docs/verification.md` §v1.4.1）。

### 17.1 根因

用户把安装版 `NexusDockApp.exe` 加进 Dock 当「设置入口」。点击后 `launchApp` → `launchAndFocus` 先走「已有窗口优先」分支，而该分支对「同进程的自身窗口」识别不全：

```powershell
# 修复前
$selfTitles = 'NexusDockApp|Nexus Dock|Nexus Music|Nexus 设置'   # 漏了 'Nexus 时钟'
...
function Test-TargetWindow($w, $hint, $procName) {
  if ($w.Name -match $selfTitles) { return $false }
  if ($procName -and $w.Proc -and ($w.Proc -ieq $procName)) { return $true }
  ...
}
```

链路逐环如下：

1. 自身图标 `path` 就是本程序 exe，`procName` 解析为 `NexusDockApp`；
2. Dock / 音乐卡片 / 设置 / 桌面时钟四窗口的可执行文件都是 `NexusDockApp.exe`（Electron 多进程同名），各自标题为 `Nexus Dock` / `Nexus Music` / `Nexus 设置` / `Nexus 时钟`；
3. 前三个标题在 `$selfTitles` 名单里被排除，**`Nexus 时钟` 不在**，于是时钟窗口通过「进程名相等」被判断为目标应用窗口；
4. `Activate-Win` 把时钟置前并返回 `FOUND`，「已有窗口优先」短路，**不会启动第二个实例**；
5. 第二个实例不启动 → `second-instance` 不触发 → `openSettingsWindow()` 不执行。

即：本该打开设置的操作，被「已有窗口优先」误判成「应用已打开，置前即可」。另外，即使不误判，靠「启动第二实例 → 单实例锁退出 → `second-instance` 打开设置」这条路也不可靠：单实例锁下新进程会静默退出，属于副作用而非设计入口。

### 17.2 修复方案

**① 入口识别（`isSelfApp`）**：用当前进程真实 exe 路径做规范化比对，而不是猜名称：

```ts
export function isSelfApp(item: DockItem): boolean {
  const selfPaths = new Set([app.getPath('exe'), process.execPath].filter(Boolean).map(normalizePath))
  const candidates = [item.path, item.aumid].filter(
    (value): value is string =>
      typeof value === 'string' && value.length > 0 && (isExePath(value) || value.toLowerCase().endsWith('.lnk'))
  )
  return candidates.some((candidate) => selfPaths.has(normalizePath(resolveShortcutTarget(candidate))))
}
```

`resolveShortcutTarget` 对 `.lnk` 调 `shell.readShortcutLink(path).target`（解析失败原样返回，不把判断变成硬失败）；`normalizePath` 统一小写 + `resolve()` 绝对化，容忍大小写与斜杠差异。

**② 命中即打开设置**：`launchApp` 开头判断，命中直接 `openSettingsWindow()` 并返回 `{ ok: true }`，不再启动进程、也不再进 16s 置前脚本：

```ts
if (isSelfApp(item)) {
  logLaunch('  → 识别为 Nexus Dock 自身：打开设置面板')
  openSettingsWindow()
  return { ok: true }
}
```

`openSettingsWindow()` 本身已实现「已存在则 `show()` + `focus()` 前置、否则新建」，因此不会出现重复设置窗口。

**③ 置前脚本兜底**：`$selfTitles` 增加 `Nexus 时钟`，把四个自身窗口标题补齐——即使 `isSelfApp` 漏判（例如条目被手工改坏），自窗口也不会被当成目标应用窗口。

**关键设计决策**：

| 决策 | 方案 | 理由 |
|---|---|---|
| 自身如何判定 | 用 `app.getPath('exe')` + `process.execPath` 的绝对路径规范化比对条目的 `path` / `aumid` | 路径是唯一可靠标识；按名称含「Nexus」或进程名猜会把 Windows「设置」等条目误判（AC-21.5） |
| 命中后是否仍启动进程 | 否：直接 `openSettingsWindow()` 并返回成功 | 单实例锁下第二实例必然静默退出，拉起无意义；省掉一次 PowerShell 置前脚本（最长约 16s 空等） |
| `.lnk` / `aumid` 兼容 | `.lnk` 经 `shell.readShortcutLink` 解析目标；`aumid` 一并参与比对 | 用户手工添加的条目可能是快捷方式；历史迁移数据里 `aumid` 可能存 exe 路径 |
| 置前脚本名单 | `$selfTitles` 增加 `Nexus 时钟`，自窗口一律不当目标窗口 | 与入口识别形成双保险；即使入口判断失效也不会误把时钟当目标 |
| 单实例与 `second-instance` | 不改 `src/main/index.ts` 与 `launchAndFocus` 启动分支 | 桌面快捷方式二次启动 → 打开设置的行为必须保留（AC-21.6），只修误判点 |
| 是否新增 IPC / 设置项 | 不新增：纯主进程内部判断，渲染层零改动 | 设置入口不需要新契约；`schemaVersion` 仍为 7，v1.4.0 配置原样可用 |

### 17.3 文件级改动（写作用域）

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/main/apps.ts` | 新增 `isSelfApp()`（复用 `normalizePath` / `resolveShortcutTarget`）；`launchApp` 增加自身图标分支；`$selfTitles` 增加 `Nexus 时钟` |
| Lead | `package.json` | `version` 1.4.0 → 1.4.1 |
| Lead | `scripts/v141-verify.mjs`（新增）、`docs/verification/v1.4.1/` | CDP 验收脚本、报告与截图证据 |
| docs-writer | `docs/spec.md` §12、`docs/plan.md` §17、`docs/tasks.md` v1.4.1、`README.md` | 补丁文档、任务表与版本表述 |

### 17.4 验收方法（可复现）

1. `npm run typecheck` 零错误；`npm run build` 成功；安装版更新到 v1.4.1（`env.appVersion=1.4.1`）。
2. `node scripts/v141-verify.mjs`（安装版 + CDP 9224）：
   - 用真实鼠标左键点击指向自身 exe 的 Dock 条目 → 设置窗口出现并获得焦点，前台窗口标题为 `Nexus 设置`；
   - 再次点击 → 仍是同一个设置窗口（target 数量不增加），不新增进程；
   - 条目换成指向自身的 `.lnk`、以及 `aumid` 存 exe 路径的条目 → 同样打开设置；
   - 回归：非自身应用（如记事本）点击仍正常启动 / 置前；Windows「设置」条目仍打开系统设置（不被误判为自身）；
   - 桌面快捷方式再次启动 → 只打开设置、不出现第二个 Dock（单实例链路未回退）；
   - 结果与截图写入 `docs/verification/v1.4.1/`。
3. 逐条 AC 回填 `docs/verification.md` §v1.4.1。
4. 人工验收：把 `NexusDockApp.exe` 加进 Dock，点它确认设置面板弹出并聚焦；在时钟窗口可见时再点一次，确认行为不变。

## 18. v1.7 方案：窗口注册表与设置分组重构（2026-11-04）

> 对应规格：`docs/spec.md` §13（US-22 ~ US-25）。准则真源：`docs/window-conventions.md` §2.1 / §5。
> 状态：实现与验收以 `docs/verification.md` §v1.7（由验收脚本生成）为准；本方案描述代码结构与写作用域。

### 18.1 变更范围

1. **设置导航重构**：导航改为「**窗口**（内置窗口 / 附加窗口）/ 应用 / 外观 / 系统 / 关于」；默认页 = 内置窗口。新增 `BuiltinWindowsSection.tsx`（三窗口合并页：n/N 锁定总开关 + 三个默认收起折叠栏 + 各窗口独有设置）与 `ExtraWindowsSection.tsx`（注册表驱动页：空状态 + 4 步接入说明）；`SystemSection.tsx` 移除窗口共性设置、只留系统项 + 跳转按钮。
2. **窗口注册表**：新增 `WindowKindSpec` / `BUILTIN_WINDOW_SPECS` / `EXTRA_WINDOW_KINDS`（当前为空数组）/ `ExtraWindowConfig` / `Settings.extraWindows`；新增 `normalizeExtraWindows`、`sanitizeWindowOptions`、`hasOnlyOnDesktopWindow`、`windowLockSummary`、`withAllWindowsLocked`、`patchExtraWindows`、`findWindowKind`、`isExtraWindowKind`、`defaultExtraWindowConfig(s)`。
3. **附加窗口管理器**：新增 `src/main/extraWindows.ts`——按注册表创建/销毁窗口、加载 `src/renderer/<page>/`、内容尺寸自适应、拖动落盘、吸附、锁定、置顶、仅在桌面、托盘/Dock 右键菜单项；不写死任何具体功能窗口。
4. **窗口工具抽取**：新增 `src/main/windowUtils.ts`（窗口加固/渲染进程自愈/`isShown`/`showRestored`/`guardAgainstMinimize`/`loadRenderer`），内置与附加窗口共用。
5. **显示桌面修复**：桌面状态桥协议新增 `minimized`/`visible`；「是否占用桌面」抽为 `src/shared/types.ts` 的纯函数 `isDesktopBusy`（空状态/自身窗口/最小化/不可见 → false）；`applyFloatingVisibility` 用它判定；三窗口监听 `minimize` 自恢复；可见性判定改 `isShown`。
6. **契约迁移**：`schemaVersion 9 → 10`，新增 `extraWindows`（由注册表生成，当前 `[]`）；IPC 新增 `window:setOwnContentSize`（按发送者定位窗口）。
7. **文档与测试**：spec §13、plan §18、tasks 阶段 27、conventions §2.1/§5/§6、README / 操作指南；契约测试 +9 项 v1.7 用例（共 24 项）。

### 18.2 契约与迁移（`src/shared/types.ts`）

```ts
// schemaVersion 9 → 10
export interface ExtraWindowConfig {
  kind: string                 // 注册表 kind，同时是实例唯一键
  visible: boolean
  snapToEdge: boolean
  edge: DockEdge
  alongPercent: number
  freeX: number
  freeY: number
  alwaysOnTop: boolean
  onlyOnDesktop: boolean
  locked: boolean
  theme: ThemeMode
  options: Record<string, unknown>   // 只存 JSON 安全标量
}
export interface WindowKindSpec {
  kind: string
  label: string
  description: string
  category: 'builtin' | 'extra'
  page: string                 // src/renderer/<page>/index.html，与 vite renderer.input 同名
  defaultSize: Size
  defaults?: Partial<Pick<ExtraWindowConfig, 'visible' | 'snapToEdge' | 'edge' | 'alongPercent' | 'alwaysOnTop' | 'onlyOnDesktop' | 'locked' | 'theme'>>
  placement?: { edge?: DockEdge; alongPercent?: number }
  defaultOptions?: Record<string, unknown>
}
export const BUILTIN_WINDOW_SPECS: readonly WindowKindSpec[]   // dock / music / clock
export const EXTRA_WINDOW_KINDS: readonly WindowKindSpec[] = [] // v1.7 接入位（当前为空）
export interface Settings { /* 既有字段略 */ extraWindows: ExtraWindowConfig[] }
// 收敛/派生
normalizeExtraWindows(raw): ExtraWindowConfig[]        // 按注册表逐 kind，未知/重复丢弃
sanitizeWindowOptions(raw, defaults?): Record<string, unknown>  // JSON 标量白名单
hasOnlyOnDesktopWindow(settings): boolean
windowLockSummary(settings): { locked: number; total: number; allLocked: boolean } // total = 3 + extras
withAllWindowsLocked(settings, locked): DeepPartial<Settings>
patchExtraWindows(settings, kind, patch): ExtraWindowConfig[]
// IPC / NexusApi
IPC.windowSetOwnContentSize = 'window:setOwnContentSize'
NexusApi.window.setOwnContentSize(size: Size): void
// 桌面状态契约（v1.7 从 src/main/desktopState.ts 上移，主进程与契约测试共用）
export interface DesktopState {
  foregroundPid: number; maximized: boolean; fullscreen: boolean
  desktop: boolean; className: string
  minimized: boolean            // 前台窗口被最小化（「显示桌面」核心特征）
  visible: boolean              // 前台窗口可见（显示桌面也可能 SW_HIDE）
}
export function isDesktopBusy(state: DesktopState | null, selfActive: boolean): boolean
// 空 / 自身 / minimized / visible=false → false；否则 maximized || fullscreen
```

- **迁移 v9→v10**：`settingsStore.migrate` 只提升 `schemaVersion`；`sanitizeSettings` 调 `normalizeExtraWindows` 按注册表生成 `extraWindows`，旧字段原样保留、零丢失。
- **不新增设置项**：附加窗口当前无实例，不需要用户手动增删窗口的 UI（一个 kind 一个实例）。

### 18.3 关键设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 导航结构 | 「窗口」组（内置窗口 / 附加窗口）+ 应用 / 外观 / 系统 / 关于；默认页=内置窗口 | 用户明确要求按「窗口」分组；日常窗口管理收敛到一页 |
| 共性项归属 | 内置窗口页折叠栏（默认收起 + 状态摘要）；系统页只留跳转按钮 | 沿用 v1.3 的折叠栏交互；把「系统」页还给系统项 |
| 权威数据源 | `WindowKindSpec` 注册表驱动设置页分组、托盘入口、窗口生命周期 | 新增窗口只登记类型，不改通用代码 |
| 附加窗口配置 | 只存状态（`ExtraWindowConfig`），类型来自注册表；按 kind 唯一化、未知 kind 丢弃 | 防配置漂移；收敛逻辑单一 |
| options 边界 | 只保留 JSON 标量（字符串 ≤2000、键 ≤64） | 不把函数/数组/巨型字符串写进 `settings.json` |
| 新窗口接入 | 4 步：注册表 + 渲染页 + vite 入口 +（可选）独有设置组件 | 满足用户「以后新增功能窗口」的接入位要求 |
| 显示桌面恢复 | 监听 `minimize` → 守卫恢复（restore + showInactive）；`isShown = isVisible && !isMinimized` | shell 直接最小化顶层窗口，Electron 不会自动恢复 |
| 桌面桥 | 协议新增 `minimized`/`visible`；「是否占用桌面」收口为纯函数 `isDesktopBusy`（空/自身/最小化/不可见 → 不占用），主进程与测试共用 | 旧桥只看 maximized/fullscreen，误判导致 onlyOnDesktop 永久隐藏；纯函数可被 `npm test` 直接钉住 |
| 窗口工具 | `windowUtils.ts` 抽 harden/self-heal/isShown/showRestored/guardAgainstMinimize | 内置与附加窗口共用，避免复制粘贴 |
| schema | 9→10，`extraWindows` 由注册表生成 | 契约测试钉住，旧配置零丢失 |

### 18.4 文件级改动（写作用域）

| 角色 | 文件 | 改动 |
|---|---|---|
| Lead | `src/shared/types.ts` | v1.7 注册表/配置/收敛/锁定汇总/`DesktopState`+`isDesktopBusy`/IPC/NexusApi；schemaVersion 10 |
| Lead | `src/main/windowUtils.ts`（新增） | 窗口加固/自愈/`isShown`/`showRestored`/`guardAgainstMinimize`/`loadRenderer` |
| Lead | `src/main/extraWindows.ts`（新增） | 注册表驱动附加窗口创建/布局/显隐/锁定/置顶/仅在桌面/内容尺寸/托盘菜单项 |
| Lead | `src/main/windowManager.ts` | 接入 `windowUtils`、附加窗口同步与布局、「仅桌面」新判定、最小化自恢复 |
| Lead | `src/main/{index,ipc,preload,tray,settingsStore,desktopState}.ts`、`resources/desktop-state.cs/.ps1/.exe` | 桥协议 minimized/visible、IPC `setOwnContentSize`、托盘/Dock 菜单、v9→v10 迁移、桥监控 |
| settings-ui | `src/renderer/settings/SettingsApp.tsx`、`sections/{BuiltinWindowsSection,ExtraWindowsSection,SystemSection,ClockSection,DockSection,MusicSection}.tsx`、`settings.css`、`shared/hooks.ts` | 分组导航、内置窗口合并页、附加窗口空状态/接入说明、系统页跳转、样式 |
| docs-tests | `tests/shared-contract.test.mjs`、`README.md`、`操作指南.md`、`docs/{spec,plan,tasks,window-conventions}.md` | v1.7 契约测试（+9 项）与 v1.7 文档 |
| Lead / verifier | 验收脚本 + `docs/verification/v1.7/` | CDP 验收与证据（脚本名以实际交付为准；记录见 `docs/verification.md` §v1.7） |

### 18.5 验收方法（可复现）

1. `npm run typecheck` 零错误；`npm run build` 成功；安装版 `env.appVersion=1.7.0`。
2. `npm test`：24 项契约测试全绿（v1.6 的 15 项 + v1.7 的 9 项，含 `isDesktopBusy`；实测 24/24）。
3. CDP / 端到端验收（记录见 `docs/verification.md` §v1.7，由验收脚本生成）：
   - 导航分组：「窗口」组含内置窗口 / 附加窗口；默认页内置窗口；系统页无窗口共性设置、跳转按钮可用；
   - 内置窗口页：三折叠栏默认收起 + 摘要；展开后五项共性设置 + 独有设置；
   - 附加窗口页：「暂无附加窗口」空状态 + 4 步接入说明；
   - 迁移：旧 v9 配置启动后 `schemaVersion=10`、`extraWindows=[]`、其余配置保留；
   - 显示桌面：Win+D / shell 最小化后三窗口恢复；onlyOnDesktop 窗口回到桌面显示；
   - 回归：Dock/音乐/时钟原有设置项、托盘菜单、锁定 n/N。
4. 结果写 `docs/verification/v1.7/` 与 `docs/verification.md` §v1.7。
5. 人工验收：真实 Win+D 后 Dock 的恢复手感、折叠栏交互、附加窗口空状态文案。
