# 桌面视觉与浮窗折叠

日期：2026-11-14。用户修正后的当前方案，替代首版 Dock 灵动岛自动收起方案。基于 v1.9.0，沿用 Electron / React / 原生时钟，无新增依赖。

## 当前行为

**Dock 始终展开。** 删除胶囊、延迟收起、固定展开按钮及 Dock 折叠设置。旧 `dock.islandMode` 在配置收敛时被忽略，不会让 Dock 再次折叠。

其它桌面浮窗采用手动折叠。与悬停自动收起相比，手动折叠不打断播放操作、学习或编辑，也不需要增加指针轮询和收起计时器。

| 窗口 | 收起内容 | 设置入口 |
| --- | --- | --- |
| 音乐 | 封面、曲名、播放/暂停、展开按钮 | 窗口 → 内置窗口 → 音乐卡片 → 收起为胶囊 |
| 时钟 | 小号时间，不显示秒与日期、展开按钮 | 窗口 → 内置窗口 → 桌面时钟 → 收起为胶囊 |
| 英语单词 | 当前单词、待复习数量、展开按钮 | 窗口 → 附加窗口 → 英语单词学习 → 收起为胶囊 |

所有窗口默认展开。设置和窗口按钮双向同步，状态保存到 settings.json，重启后恢复。关闭/隐藏窗口与折叠相互独立。时钟折叠不修改 showSeconds/showDate/fontSize；展开恢复原偏好。位置锁定不阻止按钮操作。

单词完整内容始终挂载，用 hidden 隐藏，保留当前词、视图、输入框内容和编辑状态。胶囊状态不响应评分/切词/显示释义的学习快捷键，避免看不见内容时误操作；展开按钮仍支持键盘。错误提示继续可见。

## 数据与架构

- 新增 `music.collapsed`、`clock.collapsed`、`extraWindows[].collapsed` 布尔字段。
- 默认 false；缺失或非法值回落 false；JSON 回读保留显式 true/false。schemaVersion 沿用 11，使用已有配置补齐流程。
- 复用现有 settings.update / onChanged 与尺寸 IPC，不新增通道。
- 音乐、单词使用现有 useSettings；时钟继续原生 DOM，不引入 React。
- 音乐播放器在折叠时保持挂载；关闭逐帧进度更新，展开按时间锚点补齐。暂停时根据锚点推算当前位置，避免显示折叠前的旧进度。
- 附加窗口按现有 patchExtraWindows 更新，学习 options 与进度文件格式不变。

## 视觉与动效

石墨色 `#171e28`、设置内容 `#1e2835`、浮层 `#222c3a`、冰蓝强调 `#9ccdf5`、文字 `#f3f4f8`。保留原深浅主题与透明度选择，字体使用本机 Segoe UI Variable / Microsoft YaHei UI。

胶囊采用圆形两端；展开 Dock 28px 圆角，音乐与单词卡片 24px，设置外壳 20px，内部折叠项 14px。以表面层次、留白和字重区分信息。

根测量节点不做 transform 或尺寸过渡。折叠后 ResizeObserver 汇报最终尺寸，原生窗口跟随调整，不逐帧 resize。内部元素淡入使用现有动效令牌；系统或用户减少动效时按全局规则收敛。Dock 仅保留悬停放大、按压、启动反馈，运行指示点不再持续呼吸。

## 性能

保留首版的并发进程采集保护、指示点关闭/无应用时跳过采集、无变化运行状态不触发 React 更新、音乐进度最高 30fps、迷你音乐停止进度动画帧、移除每图标永久 will-change、减少持续阴影和背景模糊。

时钟胶囊按分钟显示，走时不再使用显示秒的 250ms 计时频率。未做统一硬件与负载下的前后 CPU/GPU/内存基准，不宣称降低某个百分比。

## 验证

```powershell
npm run check
npm run build
node scripts/window-fold-verify.mjs
npm run dist
```

类型检查与 56 项测试通过。真实 Electron 验证脚本使用 `.userdata/window-fold-verify` 隔离配置、真实 preload 与 IPC，不使用真实用户配置或词库，不点击启动应用。调试端口 9463 需空闲。报告和截图：`docs/verification/folding/`，截图依现有 gitignore 不提交。

覆盖：Dock 移出后保持展开、音乐条形/环形胶囊、时钟还原显示偏好、单词快捷键保护、编辑内容跨折叠保留、设置入口与双向同步、配置实际写盘及渲染进程重载、Dock 四边尺寸、减少动效和 JS 异常。

打包后可设置 `$env:NEXUS_ISLAND_EXE = Join-Path (Get-Location) 'dist\win-unpacked\Nexus Dock.exe'` 再执行相同脚本。保留既有环境变量名以兼容之前的测试调用，变量只用于选择测试的可执行文件。

便携包：`dist/NexusDock-1.9.0-portable.exe`。本次沿用发布版本号，未发布 GitHub Release。

仍需真人体验：多屏混合 DPI 移动、真实播放器续播、原生菜单与拖拽手感、Win+D 与开机登录。历史 island 目录只代表首版方案，当前实现与验收以本文件及 folding 报告为准。
