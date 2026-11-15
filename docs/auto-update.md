# v1.10：安装版自动更新

## 产品目标与方案

让日常使用者及时收到新版本，同时自行选择重启时间；升级保留窗口位置、灵动岛/图钉状态、应用列表、自定义图标、词库和学习进度。用户已选择「新增安装版自动更新，保留便携版」。

| 路径 | 复杂度与成本 | 扩展性 | 风险 |
| --- | --- | --- | --- |
| 自行替换便携 EXE | 高，需要退出后辅助程序、锁文件处理、校验与恢复 | 后续每种分发形式都需维护 | Windows 正在运行文件替换、杀毒拦截、配置路径易出错 |
| NSIS + electron-updater（采用） | 中，成熟组件处理文件替换与下载校验 | 可沿用 GitHub Release，支持差分下载 | 首次需安装；依赖正式发布的完整更新资产 |

兼容组合：electron-builder 26.18.0 + electron-updater **6.8.12**，不混用 v27/updater 7 的 `autoInstallEvent` API。参考 [v26 自动更新说明](https://www.electron.build/v26/docs/features/auto-update/)与 [v26 AppUpdater API](https://www.electron.build/v26/docs/api/electron-updater.class.appupdater/)。

## 用户交互

- 入口：**设置 → 关于 → 软件更新**。
- 安装版默认开启「自动检查并下载更新」。启动 **12 秒**后第一次检查，之后每 **6 小时**检查；自动任务失败后 **30 分钟**重试。错峰启动，不添加常驻辅助进程。
- 用户可随时手动检查。关闭自动开关后，手动检查只显示「下载更新」；关闭开关会停止后续自动任务，已开始的下载继续。
- 显示检查状态、目标版本、下载百分比/大小/速度、上次成功检查时间与失败原因。
- 下载和校验成功后显示「重启更新」。**仅点击此按钮才安装**；普通退出、关机、下次启动均不会自行安装已下载的包。
- 安装前同步保存设置；由 NSIS 完成替换并重新启动应用。已下载状态不会被定时检查/重复点击覆盖。
- 便携版不自动替换自身、不后台检查或下载；提供「下载安装版」入口。开发态与不包含更新配置的旧手工安装目录也不检查更新。
- 仓库尚无正式 Release / 缺少更新资产时显示真实错误，不显示「已是最新版」。更新失败不弹阻塞对话框、不影响 Dock 与各组件。

## 状态、IPC 与生命周期

`src/shared/updates.ts` 是共享契约。主进程 `updater.ts` 按分发形式选择可用性，`updateController.ts` 管理状态、合并重复操作和定时器，实际网络/校验/安装使用 electron-updater。

```text
idle → checking → idle（已是最新）
                 → available → downloading → downloaded → installing
                       ↑           ↓                           ↓
                       └──────── error（可重试）────────────────┘
portable / development / legacy → unsupported
```

只向 preload 暴露 `getState/check/download/install/openReleases/onChanged`。渲染层不能提供更新 URL、文件路径、命令或令牌。状态包含递增 `revision`，防止迟到的 IPC 响应覆盖广播。进度最多每 500ms 广播一次；退出时移除监听、订阅与定时器。

生产更新源由 electron-builder 生成到 `resources/app-update.yml`：公共仓库 `GoahJack/Nexus-Dock` 的正式 GitHub Release。跳过预发布和降级；禁用 NSIS Web 安装器。下载使用 SHA-512 校验，保留组件默认的签名校验行为。当前项目未配置 Windows Authenticode 证书，因此不宣称已做发布者签名认证；后续配置证书时需同时验证签名链与新旧包的发布者兼容性。

## 配置与从便携版迁移

应用版本 **1.10.0**，设置 `schemaVersion` **11 → 12**，新增 `system.autoUpdate: boolean`，缺省 `true`，明确的 `false` 会保留。其余配置字段不变；词库版本仍 1，学习进度版本仍 2。

1. 退出正在运行的旧便携版 / 旧手工安装版，避免单实例锁把新程序转交给旧程序。
2. 首次运行 `NexusDock-1.10.0-setup.exe`，按向导为当前 Windows 用户安装。
3. 从新快捷方式启动，在设置 → 关于确认版本 **1.10.0**。以后由这个安装版自动更新。
4. 两种版本沿用同一 `package.name=nexus-dock` 和 `appId=com.nexus.dock`，正常配置目录均为 `%APPDATA%\nexus-dock`；无需复制或清空配置。`settings.json`、`wordbank.json`、`wordbank-progress.json` 与图标缓存保留；卸载安装版也不自动删除这些数据。
5. 首次从便携版迁移后检查「开机自启」：登录项以操作系统的实际程序路径为准，旧便携版路径不会被当成新安装版的有效登录项；按需在新安装版中重新开启。后续安装版更新沿用安装路径。

极端环境曾因权限问题使用备用 userData 目录的，先在旧版备份实际目录，再迁移到新运行环境的目录；不要删除旧文件。安装器只管理自身注册目录，不清理旧便携 EXE。

旧 `install-local.ps1` 通过镜像目录覆盖程序、全局终止 NexusDockApp 并改写打包清单，不能可靠支持自动更新，已改为打开当前版本的 NSIS 向导。`启动 Nexus Dock.cmd` 同步调整，不再手工覆盖安装目录。

## 构建与发布

```powershell
npm ci
npm run check
npm run dist                # 同时生成安装版与便携版，不上传
npm run verify:release      # 检查版本、安装包大小及 SHA-512
# 可单独构建：npm run dist:installer / npm run dist:portable
# 本地安装向导：npm run install:local
```

每个正式版本必须使用同一次构建的资产：

| 文件 | 用途 |
| --- | --- |
| `NexusDock-1.10.0-setup.exe` | 安装与自动更新的完整离线安装包 |
| `NexusDock-1.10.0-setup.exe.blockmap` | 差分下载映射 |
| `latest.yml` | 版本、文件名、大小与 SHA-512；必须指向 setup，不能指向 portable |
| `NexusDock-1.10.0-portable.exe` | 保留的便携版手动下载 |

`.github/workflows/release.yml` 可手动运行，或由 `v*` 标签触发。在 Windows + Node 24 上检查版本、运行测试、打包、校验资产，再通过仓库 `GITHUB_TOKEN` 上传到 **Release 草稿**。标签必须等于 `v${package.version}`；已公开的同版本 Release 拒绝覆盖，应递增版本号。无需向客户端植入令牌。

正式发布入口：在 `main` 提交 `.github/release-request.json`，明确填写与 package.json 一致的 `version` 和布尔型 `publish`。只有该文件发生变化才触发分支发布，普通源码提交不会触发；`publish: true` 表示已明确请求公开此版本。手动运行工作流也可选择 `publish`（默认 false）；标签触发仍保留草稿。所有发布串行执行，四个已上传资产的大小和 GitHub SHA-256 摘要均与构建文件一致后，才公开为最新正式版。版本专属说明优先读取 `docs/releases/v${version}.md`。规则由 `scripts/release-policy.mjs` 校验并有独立测试，拒绝版本不匹配、非 main 分支、字符串冒充布尔值及未知事件。

也可在 GitHub 手动检查草稿后点击 **Publish release**。只有已公开、非 prerelease 的 Release 才进入自动更新源。以后发布：先递增 package/lock 中的版本，更新验证门禁与记录，再提交明确的发布请求，或用标签/手动工作流生成草稿。不要把源码 ZIP 当更新包，不要在同一版本名下重新上传不同字节的安装文件。

**上线前置条件：**当前仓库尚无 Release；此轮新增代码、工作流与本地安装包，未代替维护者公开首个 Release。旧便携客户端没有更新代码，无法凭空自升级，首次需手动安装。首个公开版本提供基线；后续更高版本发布后，已安装的客户端才会下载它。

## 验证与边界

- `npm run check`：原有回归 + 更新状态机、并发合并、定时与开关、离线重试、校验失败阻止安装、显式安装与设置迁移。
- `npm run verify:release`：校验当前构建的 `latest.yml` 指向正确的 NSIS 包，文件大小、SHA-512 和 blockmap 均匹配。
- `node scripts/update-verify.mjs`：隔离 userData 与更新缓存，真实打包 Electron + preload/IPC/React + electron-updater + 本地 HTTP。真实下载安装文件、观察进度、故意错误 SHA-512 验证拒绝、恢复正确校验后自动下载，最后拦截安装调用验证只由按钮触发。另验证便携版/开发态禁用更新。
- 运行报告在 `docs/verification/auto-update/report.json`，截图在同目录。脚本不读取或写入用户真实配置，不运行安装器；只按自身实例 PID 收尾，不建立 Computer Use 采集会话。
- 本地测试源用 1.10.1 元数据指向实际构建的 1.10.0 安装文件，仅用于验证传输、校验和界面链路。**不等于两个真实版本的安装替换验收。** 首次正式发布后，需在干净测试环境安装基线版本，再从下一版正式 GitHub Release 验证真实下载安装、版本号变化、快捷方式及数据保留。
