/**
 * v1.8 静态接线门禁（不需要 Electron / 不需要构建产物）。
 *
 * 为什么需要这层测试：
 * 共享契约测试只钉「纯数据/纯函数」，但 v1.8 新增的是**跨进程跨文件的接线**——
 * 一个词库通道如果只改了 `IPC` 常量、忘了在 `ipc.ts` 注册、或在 preload 漏了 invoke，
 * 单测全绿、运行起来却是「按钮没反应」。这类错误只有在真实窗口里才暴露，成本高；
 * 这里用源码静态断言把「声明 ↔ handler ↔ preload」「注册表 ↔ 渲染页 ↔ vite 入口 ↔ 主进程加载」
 * 「DOM class 契约」「设置页注册」「版本与迁移」「词库文件结构」全部提前钉成回归门禁。
 *
 * 说明：
 * - 断言刻意保持「宽松但稳定」：只钉关键 token / 结构，不逐字符比对实现，避免小改就红；
 * - 必须运行时才能验证的项（真实窗口、C7 尺寸、导入导出对话框）由 `scripts/v18-verify.mjs`
 *   在交互式环境执行，不在本文件范围。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, EXTRA_WINDOW_KINDS, IPC, findWindowKind } from '../src/shared/types.ts'
import { DEFAULT_WORD_STUDY_OPTIONS, WORD_STUDY_KIND } from '../src/shared/wordBank.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = (relPath) => readFileSync(join(repoRoot, relPath), 'utf8')
const exists = (relPath) => existsSync(join(repoRoot, relPath))

/** 词库 IPC 里「一请求一响应」的通道（wordBankChanged 是主进程 → 渲染层的广播，单独断言） */
const WORD_BANK_INVOKE_KEYS = [
  'wordBankGet',
  'wordBankSetWords',
  'wordBankSetProgress',
  'wordBankResetWords',
  'wordBankResetProgress',
  'wordBankImport',
  'wordBankExport',
  'wordBankOpenFile',
  'wordBankReload',
  'wordBankPaths'
]

/** 任务约定的窗口 DOM 契约：恰好 28 个稳定 `.ws-*` class（供 CDP / 后续改动做回归） */
const WS_DOM_CONTRACT = [
  'ws-root',
  'ws-study',
  'ws-header',
  'ws-title',
  'ws-stats',
  'ws-bank-toggle',
  'ws-hide',
  'ws-main',
  'ws-word',
  'ws-phonetic',
  'ws-meaning',
  'ws-example',
  'ws-status',
  'ws-progress',
  'ws-nav',
  'ws-prev',
  'ws-next',
  'ws-reveal',
  'ws-marks',
  'ws-mark',
  'ws-mark-unknown',
  'ws-mark-vague',
  'ws-mark-known',
  'ws-editor',
  'ws-editor-head',
  'ws-editor-back',
  'ws-bank-toolbar',
  'ws-bank-list'
]

/** 验收脚本 / 设置页额外依赖的控件 class（不在 28 项窗口契约内，但同样不能改名） */
const WS_CONTROL_CLASSES = [
  'ws-bank-row',
  'ws-bank-count',
  'ws-bank-add',
  'ws-bank-save',
  'ws-bank-search',
  'ws-bank-path',
  'ws-import',
  'ws-export',
  'ws-open-file',
  'ws-reload',
  'ws-reset-words',
  'ws-reset-progress',
  'ws-bank-delete-btn',
  'ws-bank-edit-btn',
  'ws-bank-input-word',
  'ws-bank-input-phonetic',
  'ws-bank-input-meaning',
  'ws-bank-input-example',
  'ws-toast',
  'ws-error',
  'ws-empty',
  'ws-editor-loading'
]

/** 读取 src/renderer/wordstudy 下所有 TSX 源码拼成一份（class 字符串可能出现在任一组件里） */
function wordstudySource() {
  return ['WordStudyCard.tsx', 'WordBankEditor.tsx', 'main.tsx']
    .map((file) => source(`src/renderer/wordstudy/${file}`))
    .join('\n')
}

/** 断言源文件是 UTF-8 且无 BOM（Windows 记事本/旧工具容易写 BOM，JSON/TS 会出怪问题） */
function assertUtf8NoBom(relPath) {
  const bytes = readFileSync(join(repoRoot, relPath))
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  assert.equal(hasBom, false, `${relPath} 不应带 UTF-8 BOM`)
  assert.equal(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes), true, `${relPath} 必须是合法 UTF-8`)
}

test('词库 IPC 三方一致：IPC 常量 ↔ 主进程 ipcMain.handle/removeHandler ↔ preload invoke/subscribe', () => {
  const ipcSource = source('src/main/ipc.ts')
  const preloadSource = source('src/preload/index.ts')
  const mainSource = source('src/main/index.ts')
  const typesSource = source('src/shared/types.ts')

  // 1) 声明：11 个 wordbank 通道，命名空间统一且值唯一
  const channels = Object.entries(IPC).filter(([key, value]) => key.startsWith('wordBank') && typeof value === 'string')
  assert.equal(channels.length, 11, 'wordBank* 通道应为 11 个（10 个 invoke + 1 个 changed 广播）')
  const values = channels.map(([, value]) => value)
  assert.equal(new Set(values).size, values.length, 'wordbank 通道值必须唯一')
  for (const [key, value] of channels) {
    assert.match(value, /^wordbank:[a-zA-Z]+$/, `${key} 的通道名应形如 wordbank:xxx`)
  }

  // 2) 请求/响应通道：主进程注册 + 注销；preload 用 ipcRenderer.invoke
  assert.ok(ipcSource.includes('registerWordBankIpc'), 'ipc.ts 必须有 registerWordBankIpc() 集中注册')
  assert.ok(ipcSource.includes('ipcMain.handle('), 'ipc.ts 必须用 ipcMain.handle 注册词库通道')
  assert.ok(ipcSource.includes('ipcMain.removeHandler('), 'ipc.ts 必须在 disposeIpc 里 removeHandler 词库通道')
  for (const key of WORD_BANK_INVOKE_KEYS) {
    assert.equal(IPC[key]?.startsWith('wordbank:'), true, `IPC.${key} 应存在`)
    const mainHits = ipcSource.split(`IPC.${key}`).length - 1
    assert.ok(mainHits >= 2, `ipc.ts 中 IPC.${key} 应至少出现 2 次（注册 + 注销），实际 ${mainHits}`)
    assert.match(
      preloadSource,
      new RegExp(`ipcRenderer\\.invoke\\(\\s*IPC\\.${key}\\b`),
      `preload 应用 ipcRenderer.invoke(IPC.${key}) 暴露能力`
    )
  }

  // 3) 广播通道：主进程 broadcast + preload subscribe（不是 invoke）
  assert.equal(IPC.wordBankChanged, 'wordbank:changed')
  assert.match(typesSource, /wordBank:\s*\{[\s\S]*?onChanged:\s*\(cb:/, 'NexusApi.wordBank 必须声明 onChanged 订阅')
  assert.match(mainSource, /subscribeWordBank\(/, 'main/index.ts 必须订阅词库变更')
  assert.match(mainSource, /broadcast\(\s*IPC\.wordBankChanged\s*,\s*bank\s*\)/, '词库变更必须广播 wordBankChanged')
  assert.match(preloadSource, /subscribe<WordBank>\(\s*IPC\.wordBankChanged/, 'preload 必须用 subscribe 暴露 onChanged')
})

test('注册表 ↔ 渲染页 ↔ vite 入口 ↔ 主进程加载路径一致（wordstudy 通用链路）', () => {
  const spec = EXTRA_WINDOW_KINDS.find((item) => item.kind === WORD_STUDY_KIND)
  assert.ok(spec, `EXTRA_WINDOW_KINDS 必须注册 kind=${WORD_STUDY_KIND}`)
  assert.equal(spec.page, 'wordstudy', '注册表 page 必须与渲染页目录名一致')
  assert.equal(spec.category, 'extra')
  assert.equal(spec.defaults?.visible, true, '首次升级应默认显示（用户明确要求新增该窗口）')
  assert.equal(spec.placement?.edge, 'right')
  assert.deepEqual(spec.defaultOptions, { ...DEFAULT_WORD_STUDY_OPTIONS }, '注册表默认选项必须与共享契约一致')
  assert.ok(spec.defaultSize.width > 0 && spec.defaultSize.height > 0)

  // 渲染页文件齐全（index.html / 入口 / 组件 / 样式）
  for (const file of [
    'src/renderer/wordstudy/index.html',
    'src/renderer/wordstudy/main.tsx',
    'src/renderer/wordstudy/wordstudy.css',
    'src/renderer/wordstudy/WordStudyCard.tsx',
    'src/renderer/wordstudy/WordBankEditor.tsx',
    'src/renderer/wordstudy/useOwnContentSize.ts'
  ]) {
    assert.equal(exists(file), true, `缺少渲染页文件：${file}`)
  }
  assert.match(source('src/renderer/wordstudy/index.html'), /英语单词学习/, '页面 title 应能辨识该窗口')

  // vite 入口（renderer.input）必须登记同名页面，否则生产构建不会产出该窗口
  const viteSource = source('electron.vite.config.ts')
  assert.match(viteSource, /wordstudy\s*:\s*resolve\(__dirname,\s*['"]src\/renderer\/wordstudy\/index\.html['"]\)/)

  // 附加窗口管理器只认注册表 page（说明通用链路存在，新增窗口无需改这里）
  const extraSource = source('src/main/extraWindows.ts')
  assert.match(extraSource, /EXTRA_WINDOW_KINDS/)
  assert.match(extraSource, /loadRenderer\(win,\s*spec\.page\)/, 'extraWindows.ts 必须按注册表 page 调 loadRenderer')
})

test('窗口 DOM 契约：28 个 .ws-* class 全部存在（CDP 验收与后续改动的稳定锚点）', () => {
  const dom = wordstudySource()
  for (const className of WS_DOM_CONTRACT) {
    assert.ok(dom.includes(className), `窗口源码缺少约定 class：.${className}`)
  }
})

test('窗口控件 DOM：词库管理按钮 / 输入框 / toast 等验收依赖的 class 存在', () => {
  const dom = wordstudySource()
  for (const className of WS_CONTROL_CLASSES) {
    assert.ok(dom.includes(className), `窗口源码缺少控件 class：.${className}`)
  }
})

test('设置页接入：ExtraWindowsSection 注册 WORD_STUDY_KIND → WordStudySettings，且无旧空栏文案', () => {
  const extraSource = source('src/renderer/settings/sections/ExtraWindowsSection.tsx')
  const wordStudySource = source('src/renderer/settings/sections/WordStudySettings.tsx')

  assert.match(extraSource, /import\s*\{\s*WordStudySettings\s*\}\s*from\s*['"]\.\/WordStudySettings['"]/)
  assert.match(extraSource, /import\s*\{[^}]*WORD_STUDY_KIND[^}]*\}\s*from\s*['"]@shared\/wordBank['"]/)
  assert.match(extraSource, /\[WORD_STUDY_KIND\]\s*:\s*WordStudySettings/, '必须注册 WORD_STUDY_KIND → WordStudySettings')
  assert.match(extraSource, /EXTRA_WINDOW_SETTINGS/, '注册表组件映射必须存在（新增窗口可插拔）')
  assert.equal(
    extraSource.includes('当前版本还没有注册附加窗口') || extraSource.includes('当前还没有注册附加窗口'),
    false,
    'v1.7 的「还没有注册附加窗口」旧文案必须移除（v1.8 已有真实附加窗口）'
  )

  for (const className of [
    'ws-settings',
    'ws-settings-stats',
    'ws-settings-actions',
    'ws-settings-msg',
    'ws-settings-path',
    'ws-settings-switches'
  ]) {
    assert.ok(wordStudySource.includes(className), `WordStudySettings 缺少 class：.${className}`)
  }
  // 5 个学习选项 + 6 个词库管理动作（文案与验收脚本 / 文档一致）
  for (const label of ['显示音标', '显示例句', '先遮住释义', '随机顺序', '标记后自动下一词']) {
    assert.ok(wordStudySource.includes(label), `WordStudySettings 缺少选项「${label}」`)
  }
  for (const label of ['导入词库', '导出词库', '打开词库文件', '重新读取文件', '恢复默认词库', '重置学习进度']) {
    assert.ok(wordStudySource.includes(label), `WordStudySettings 缺少动作按钮「${label}」`)
  }
  assert.ok(wordStudySource.includes('window.nexus?.wordBank') || wordStudySource.includes('window.nexus.wordBank'), '设置页必须走 preload 暴露的 wordBank API')
})

test('版本与迁移：package.json=1.8.0、DEFAULT_SETTINGS.schemaVersion=11、settingsStore 有 v10→v11 说明', () => {
  const packageJson = JSON.parse(source('package.json'))
  assert.equal(packageJson.version, '1.8.0', 'package.json 版本必须是 1.8.0')
  assert.equal(DEFAULT_SETTINGS.schemaVersion, 11, 'DEFAULT_SETTINGS.schemaVersion 必须是 11（v1.8）')
  assert.equal(findWindowKind(WORD_STUDY_KIND)?.kind, WORD_STUDY_KIND)
  assert.equal(
    DEFAULT_SETTINGS.extraWindows.some((item) => item.kind === WORD_STUDY_KIND),
    true,
    '默认设置必须按注册表生成 wordstudy 配置'
  )

  const settingsStore = source('src/main/settingsStore.ts')
  assert.match(settingsStore, /v10\s*→\s*v11/, 'settingsStore 必须写明 v10 → v11 迁移')
  assert.match(settingsStore, /wordstudy/, '迁移注释必须说明新增 wordstudy 附加窗口')
  assert.match(settingsStore, /normalizeExtraWindows/, '迁移依赖注册表收敛（按 kind 补默认配置）')
})

test('源码编码：v1.8 关键文件均为 UTF-8 无 BOM', () => {
  const files = [
    'src/shared/types.ts',
    'src/shared/wordBank.ts',
    'src/main/wordBank.ts',
    'src/main/ipc.ts',
    'src/main/settingsStore.ts',
    'src/preload/index.ts',
    'src/renderer/wordstudy/WordStudyCard.tsx',
    'src/renderer/wordstudy/WordBankEditor.tsx',
    'src/renderer/settings/sections/WordStudySettings.tsx',
    'src/renderer/settings/sections/ExtraWindowsSection.tsx',
    'tests/wordbank-contract.test.mjs',
    'docs/verification.md'
  ]
  for (const file of files) assert.equal(exists(file), true, `缺少文件：${file}`)
  for (const file of files) assertUtf8NoBom(file)
})

test('词库文件结构契约：主进程只写 {version, words}，reloadFromDisk 只读不覆盖用户文件', () => {
  const wordBankSource = source('src/main/wordBank.ts')

  // 双文件常量必须来自共享契约（词库与进度分离，用户可以直接改）
  assert.match(wordBankSource, /\bWORD_BANK_FILE\b/, '主进程必须使用共享的 WORD_BANK_FILE')
  assert.match(wordBankSource, /\bWORD_PROGRESS_FILE\b/, '主进程必须使用共享的 WORD_PROGRESS_FILE')
  assert.match(wordBankSource, /app\.getPath\(['"]userData['"]\)/, '词库文件应落在 userData 下')

  // 词库文件只写 { version, words }：不把进度写进同一个文件，保证用户可整体替换
  assert.match(
    wordBankSource,
    /writeJsonAtomic\(\s*filePath\s*,\s*\{\s*version:\s*WORD_BANK_VERSION\s*,\s*words\s*\}\s*\)/,
    'writeWordEntriesFile 必须只写 { version, words }'
  )
  assert.match(
    wordBankSource,
    /writeJsonAtomic\(\s*filePath\s*,\s*\{\s*version:\s*WORD_PROGRESS_VERSION\s*,\s*progress\s*\}\s*\)/,
    '进度文件必须只写 { version, progress }'
  )

  // reloadWordBankFromDisk 只读不写：用户手工改完文件点「重新读取」，任何失败都不能覆盖用户文件
  const reloadStart = wordBankSource.indexOf('export function reloadWordBankFromDisk')
  assert.ok(reloadStart >= 0, '必须存在 reloadWordBankFromDisk()')
  const reloadEnd = wordBankSource.indexOf('\n/*', reloadStart)
  const reloadBody = wordBankSource.slice(reloadStart, reloadEnd > reloadStart ? reloadEnd : undefined)
  assert.match(reloadBody, /readJsonFile\(/, 'reloadFromDisk 必须读取磁盘文件')
  assert.equal(reloadBody.includes('writeJsonAtomic('), false, 'reloadFromDisk 不允许写文件（防止覆盖用户手工编辑）')
  assert.equal(reloadBody.includes('writeWordBankFiles('), false, 'reloadFromDisk 不允许整体重写两个文件')
  assert.match(reloadBody, /不会重建|保留当前内存/, 'reloadFromDisk 必须写明「文件缺失/损坏时保留内存值」')

  // 启动时必须在注册 IPC / 创建窗口之前初始化词库，并订阅变更做广播
  const mainSource = source('src/main/index.ts')
  assert.match(mainSource, /initWordBank\(\)/, 'main/index.ts 必须在 ready 后 initWordBank()')
  assert.match(mainSource, /subscribeWordBank\(/, 'main/index.ts 必须订阅词库变更')
})
