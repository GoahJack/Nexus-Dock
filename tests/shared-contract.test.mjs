/**
 * 共享契约测试（v1.5 新增，`npm test`）。
 *
 * 目的：src/shared/types.ts 是主进程 / preload / 三套渲染层的「唯一真源」，
 * sanitizeSettings + mergeSettings 是所有设置的入口与迁移收敛点。
 * 这里用 Node 内置测试跑纯函数（不需要 Electron），把「设置边界收敛」钉成回归门禁：
 *   - 非法值必须被夹紧/回退，绝不能抛出；
 *   - 旧/缺失配置必须补齐默认值（向后兼容）；
 *   - 空应用列表是合法状态（旧 bug：删空会复活 6 个内置应用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILTIN_WINDOW_SPECS,
  CUSTOM_NAME_MAX_LENGTH,
  DEFAULT_APPS,
  DEFAULT_SETTINGS,
  EXTRA_WINDOW_KINDS,
  IPC,
  SCREEN_MARGIN,
  displayIconOf,
  displayNameOf,
  findWindowKind,
  hasOnlyOnDesktopWindow,
  isDesktopBusy,
  isExtraWindowKind,
  isHorizontalEdge,
  mergeSettings,
  normalizeExtraWindows,
  patchExtraWindows,
  sanitizeSettings,
  sanitizeWindowOptions,
  windowLockSummary,
  withAllWindowsLocked
} from '../src/shared/types.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('sanitizeSettings：任意垃圾输入都能收敛为合法设置且不抛错', () => {
  for (const raw of [null, undefined, 0, 'x', [], {}, { dock: null }, { apps: 'nope' }]) {
    const settings = sanitizeSettings(raw)
    assert.equal(typeof settings.schemaVersion, 'number')
    assert.ok(Array.isArray(settings.apps))
    assert.ok(settings.apps.length > 0, '缺失/非法应用列表应回退内置应用')
  }
})

test('sanitizeSettings：数值必须夹紧到合法区间', () => {
  const clamped = sanitizeSettings({
    dock: { iconSize: 999, magnification: 0.1, gap: -5, padding: 999, opacity: 9, alongPercent: 400 },
    music: { width: 9999 },
    clock: { fontSize: 1, opacity: 0 }
  })
  assert.equal(clamped.dock.iconSize, 80)
  assert.equal(clamped.dock.magnification, 1)
  assert.equal(clamped.dock.gap, 0)
  assert.equal(clamped.dock.padding, 32)
  assert.equal(clamped.dock.opacity, 1)
  assert.equal(clamped.dock.alongPercent, 100)
  assert.equal(clamped.music.width, 520)
  assert.equal(clamped.clock.fontSize, 28)
  assert.equal(clamped.clock.opacity, 0.2)
})

test('sanitizeSettings：非法枚举/布尔回退默认值', () => {
  const settings = sanitizeSettings({
    dock: { edge: 'diagonal', theme: 'neon', snapToEdge: 'yes' },
    music: { source: 'spotify', progressStyle: 'pie', visible: 1 },
    appearance: { motionIntensity: 'insane', reducedMotion: 'no' }
  })
  assert.equal(settings.dock.edge, DEFAULT_SETTINGS.dock.edge)
  assert.equal(settings.dock.theme, DEFAULT_SETTINGS.dock.theme)
  assert.equal(settings.dock.snapToEdge, DEFAULT_SETTINGS.dock.snapToEdge)
  assert.equal(settings.music.source, DEFAULT_SETTINGS.music.source)
  assert.equal(settings.music.progressStyle, DEFAULT_SETTINGS.music.progressStyle)
  assert.equal(settings.music.visible, DEFAULT_SETTINGS.music.visible)
  assert.equal(settings.appearance.motionIntensity, DEFAULT_SETTINGS.appearance.motionIntensity)
  assert.equal(settings.appearance.reducedMotion, DEFAULT_SETTINGS.appearance.reducedMotion)
})

test('sanitizeSettings：空应用列表是合法状态（不能复活内置应用）', () => {
  // 回归：旧实现 `apps.length > 0 ? apps : DEFAULT_APPS` 把「合法的空数组」当成数据缺失，
  // 于是用户逐个删到最后一个图标时，6 个内置应用会全部回来。
  const settings = sanitizeSettings({ apps: [] })
  assert.deepEqual(settings.apps, [])
})

test('sanitizeSettings：应用条目过滤非法项但保留合法项', () => {
  const settings = sanitizeSettings({
    apps: [
      { id: 'a', name: 'A', path: 'C:\\a.exe', source: 'custom' },
      { id: 'b' }, // 缺 name
      null,
      { id: 'c', name: 'C', aumid: 'Microsoft.Foo_123!App', source: 'startmenu', icon: 'icon://c.png' }
    ]
  })
  assert.equal(settings.apps.length, 2)
  assert.deepEqual(
    settings.apps.map((a) => a.id),
    ['a', 'c']
  )
  assert.equal(settings.apps[1].aumid, 'Microsoft.Foo_123!App')
})

test('mergeSettings：深合并且不破坏其他分组', () => {
  const base = sanitizeSettings(undefined)
  const merged = mergeSettings(base, { dock: { iconSize: 64 } })
  assert.equal(merged.dock.iconSize, 64)
  assert.equal(merged.dock.gap, base.dock.gap, '未涉及的字段必须保留')
  assert.equal(merged.music.width, base.music.width)
  // 备注：默认应用列表在「字段缺失」时是原样回退（未走条目规整），
  // 因此这里只比较 id 顺序，不比较 icon/args 这类可选字段的空值形态。
  assert.deepEqual(
    merged.apps.map((a) => a.id),
    base.apps.map((a) => a.id)
  )
})

test('mergeSettings：apps 整体替换（不是逐项合并）', () => {
  const base = sanitizeSettings(undefined)
  const next = [{ id: 'only', name: 'Only', path: 'C:\\only.exe', source: 'custom' }]
  const merged = mergeSettings(base, { apps: next })
  assert.equal(merged.apps.length, 1)
  assert.equal(merged.apps[0].id, 'only')
})

test('mergeSettings：patch 非法值同样被夹紧', () => {
  const base = sanitizeSettings(undefined)
  const merged = mergeSettings(base, { clock: { fontSize: 9999 } })
  assert.equal(merged.clock.fontSize, 96)
})

test('sanitizeSettings：自定义显示名称/图标合法值保留、非法值剔除', () => {
  const settings = sanitizeSettings({
    apps: [
      {
        id: 'a',
        name: 'A',
        path: 'C:\\a.exe',
        source: 'custom',
        customName: '  我的 A\u0007  ',
        customIcon: 'icon://custom-abc.png'
      },
      {
        id: 'b',
        name: 'B',
        path: 'C:\\b.exe',
        source: 'custom',
        customName: '   ',
        // 只允许本地 icon:// 与 data:image/，外部 URL 必须被丢弃（不能让 Dock 去加载网络图片）
        customIcon: 'https://evil.example/x.png'
      },
      {
        id: 'c',
        name: 'C',
        path: 'C:\\c.exe',
        source: 'custom',
        customName: 'x'.repeat(200),
        customIcon: 'data:image/png;base64,AAA'
      }
    ]
  })
  assert.equal(settings.apps[0].customName, '我的 A', '应去控制字符与首尾空白')
  assert.equal(settings.apps[0].customIcon, 'icon://custom-abc.png')
  assert.equal(settings.apps[1].customName, undefined, '纯空白名称应被丢弃')
  assert.equal(settings.apps[1].customIcon, undefined, '外部 URL 图标应被丢弃')
  assert.equal(Array.from(settings.apps[2].customName).length, CUSTOM_NAME_MAX_LENGTH, '超长名称按码点截断')
  assert.equal(settings.apps[2].customIcon, 'data:image/png;base64,AAA')
})

test('显示辅助：自定义名称/图标优先，否则回退默认值', () => {
  const base = { id: 'a', name: '原名称', path: 'C:\\a.exe', icon: 'icon://default.png', source: 'custom' }
  assert.equal(displayNameOf(base), '原名称')
  assert.equal(displayIconOf(base), 'icon://default.png')
  assert.equal(displayNameOf({ ...base, customName: '新名字' }), '新名字')
  assert.equal(displayIconOf({ ...base, customIcon: 'icon://custom-1.png' }), 'icon://custom-1.png')
  // 非法自定义图标不能覆盖默认图标
  assert.equal(displayIconOf({ ...base, customIcon: 'https://evil.example/a.png' }), 'icon://default.png')
  // 空字符串走回退，便于「恢复默认」只清空字段
  assert.equal(displayNameOf({ ...base, customName: '  ' }), '原名称')
})

test('mergeSettings：自定义显示字段随 apps 整体替换保留', () => {
  const base = sanitizeSettings(undefined)
  const merged = mergeSettings(base, {
    apps: [
      { id: 'x', name: 'X', path: 'C:\\x.exe', source: 'custom', customName: '小X', customIcon: 'icon://c.png' }
    ]
  })
  assert.equal(merged.apps.length, 1)
  assert.equal(merged.apps[0].customName, '小X')
  assert.equal(merged.apps[0].customIcon, 'icon://c.png')
})

test('默认设置自身必须合法（sanitize 幂等）', () => {
  const once = sanitizeSettings(DEFAULT_SETTINGS)
  const twice = sanitizeSettings(once)
  assert.deepEqual(twice, once)
  // 默认内置应用清单不能为空，且 id 唯一
  assert.ok(DEFAULT_APPS.length > 0)
  assert.equal(new Set(DEFAULT_SETTINGS.apps.map((a) => a.id)).size, DEFAULT_SETTINGS.apps.length)
})

test('IPC 通道名唯一且非空（防止复制粘贴造成重复通道）', () => {
  const channels = Object.values(IPC)
  assert.ok(channels.length > 20)
  for (const channel of channels) {
    assert.equal(typeof channel, 'string')
    assert.ok(channel.length > 0)
    assert.ok(channel.includes(':'), `通道名应带分组前缀：${channel}`)
  }
  assert.equal(new Set(channels).size, channels.length, '存在重复的 IPC 通道名')
})

test('屏幕边距与横竖方向判定', () => {
  assert.ok(SCREEN_MARGIN > 0 && SCREEN_MARGIN < 64)
  assert.equal(isHorizontalEdge('top'), true)
  assert.equal(isHorizontalEdge('bottom'), true)
  assert.equal(isHorizontalEdge('left'), false)
  assert.equal(isHorizontalEdge('right'), false)
})

test('托盘图标资源存在且是合法 PNG（打包 extraResources 依赖它）', () => {
  for (const size of [16, 32]) {
    const path = join(repoRoot, 'resources', `tray-${size}.png`)
    assert.ok(existsSync(path), `缺少托盘图标：${path}`)
    const bytes = readFileSync(path)
    // PNG magic: 89 50 4E 47
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${path} 不是 PNG`)
    // IHDR 宽高（大端，偏移 16..24）
    assert.equal(bytes.readUInt32BE(16), size)
    assert.equal(bytes.readUInt32BE(20), size)
  }
})

/* ============================ v1.7 窗口体系 ============================
 *
 * v1.7 把「窗口」从三个硬编码窗口升级为注册表驱动：
 *   - schemaVersion 10 新增 extraWindows（附加窗口接入位，当前注册表为空）；
 *   - 共性项（吸附/置顶/仅在桌面/锁定/复位）从「系统」页迁到「窗口 → 内置窗口」；
 *   - 新增窗口只需在 EXTRA_WINDOW_KINDS 注册 + 新建渲染页 + vite 入口。
 * 这里把「脏数据收敛 / 注册表唯一 / 锁定汇总 / 仅在桌面判定 / 附加窗口补丁」钉成回归门禁。
 */

/** 构造一条合法的附加窗口配置（当前注册表为空，只能手工拼对象做纯函数断言） */
function fakeExtraWindow(overrides = {}) {
  return {
    kind: 'weather',
    visible: true,
    snapToEdge: true,
    edge: 'top',
    alongPercent: 50,
    freeX: -1,
    freeY: -1,
    alwaysOnTop: true,
    onlyOnDesktop: false,
    locked: false,
    theme: 'dark',
    options: {},
    ...overrides
  }
}

test('v1.7 契约：schemaVersion=10，extraWindows 默认值与注册表一致（当前为空）', () => {
  assert.equal(DEFAULT_SETTINGS.schemaVersion, 10)
  assert.equal(EXTRA_WINDOW_KINDS.length, 0, 'v1.7 附加窗口注册表应为空（仅预留接入位）')
  assert.deepEqual(DEFAULT_SETTINGS.extraWindows, [])
  assert.deepEqual(
    DEFAULT_SETTINGS.extraWindows.map((item) => item.kind),
    EXTRA_WINDOW_KINDS.map((spec) => spec.kind)
  )
  // 旧配置（schemaVersion 9，没有 extraWindows 字段）读入后补空数组，不抛错
  const migrated = sanitizeSettings({ schemaVersion: 9, extraWindows: undefined })
  assert.equal(migrated.schemaVersion, 10)
  assert.deepEqual(migrated.extraWindows, [])
})

test('v1.7 契约：extraWindows 脏数据收敛，未注册 kind 一律丢弃', () => {
  // 非数组、null、数字等垃圾输入不能抛错
  for (const raw of [undefined, null, 'garbage', 0, {}, { kind: 'weather' }]) {
    assert.deepEqual(normalizeExtraWindows(raw), [], `normalizeExtraWindows(${JSON.stringify(raw)})`)
  }
  assert.deepEqual(sanitizeSettings({ extraWindows: 'garbage' }).extraWindows, [])
  // 未注册 kind（注册表为空时的任意 kind）不得复活成配置项
  assert.deepEqual(normalizeExtraWindows([{ kind: 'weather', visible: true }]), [])
  assert.deepEqual(sanitizeSettings({ extraWindows: [{ kind: 'weather', visible: true }] }).extraWindows, [])
})

test('v1.7 契约：sanitizeWindowOptions 只保留 JSON 安全标量', () => {
  const options = sanitizeWindowOptions(
    {
      a: 'x'.repeat(5000),
      b: 1,
      c: true,
      d: null,
      e: [1],
      f: () => 1,
      ['g'.repeat(80)]: 1
    },
    { d: 'default', keep: 2 }
  )
  assert.equal(options.a.length, 2000, '超长字符串截断到 2000')
  assert.equal(options.a, 'x'.repeat(2000))
  assert.equal(options.b, 1)
  assert.equal(options.c, true)
  assert.equal(options.d, null, 'null 保留并覆盖默认值')
  assert.equal(options.keep, 2, 'defaults 合并进结果')
  assert.equal('e' in options, false, '数组不是 JSON 标量，丢弃')
  assert.equal('f' in options, false, '函数丢弃')
  assert.equal('g'.repeat(80) in options, false, '超长键丢弃')
  // 非对象输入收敛为空对象，不抛错
  assert.deepEqual(sanitizeWindowOptions(undefined, undefined), {})
  assert.deepEqual(sanitizeWindowOptions('nope', { keep: 1 }), { keep: 1 })
})

test('v1.7 契约：hasOnlyOnDesktopWindow 覆盖内置三窗口与附加窗口', () => {
  const base = sanitizeSettings(undefined)
  // Dock 默认 onlyOnDesktop=true → 默认设置即需要桌面状态桥
  assert.equal(hasOnlyOnDesktopWindow(base), true)
  const none = {
    ...base,
    dock: { ...base.dock, onlyOnDesktop: false },
    music: { ...base.music, onlyOnDesktop: false },
    clock: { ...base.clock, onlyOnDesktop: false }
  }
  assert.equal(hasOnlyOnDesktopWindow(none), false)
  // 任一附加窗口开启「仅在桌面显示」也要启用
  assert.equal(hasOnlyOnDesktopWindow({ ...none, extraWindows: [fakeExtraWindow({ onlyOnDesktop: true })] }), true)
  assert.equal(hasOnlyOnDesktopWindow({ ...none, extraWindows: [fakeExtraWindow({ onlyOnDesktop: false })] }), false)
})

test('v1.7 契约：windowLockSummary 汇总内置 3 窗口 + 附加窗口（n/N）', () => {
  const base = sanitizeSettings(undefined)
  assert.deepEqual(windowLockSummary(base), { locked: 0, total: 3, allLocked: false })
  const allLockedBuiltin = { ...base, lock: { dock: true, music: true, clock: true } }
  assert.deepEqual(windowLockSummary(allLockedBuiltin), { locked: 3, total: 3, allLocked: true })
  // 1 个附加窗口：total=4；内置全锁但附加未锁 → 未全部锁定
  const withUnlockedExtra = {
    ...allLockedBuiltin,
    extraWindows: [fakeExtraWindow({ locked: false })]
  }
  assert.deepEqual(windowLockSummary(withUnlockedExtra), { locked: 3, total: 4, allLocked: false })
  const withLockedExtra = {
    ...allLockedBuiltin,
    extraWindows: [fakeExtraWindow({ locked: true })]
  }
  assert.deepEqual(windowLockSummary(withLockedExtra), { locked: 4, total: 4, allLocked: true })
})

test('v1.7 契约：withAllWindowsLocked 同时锁定/解锁内置与附加窗口', () => {
  const base = sanitizeSettings(undefined)
  const settings = {
    ...base,
    extraWindows: [fakeExtraWindow({ kind: 'weather', locked: false }), fakeExtraWindow({ kind: 'notes', locked: true })]
  }
  const lockPatch = withAllWindowsLocked(settings, true)
  assert.deepEqual(lockPatch.lock, { dock: true, music: true, clock: true })
  assert.equal(lockPatch.extraWindows.length, 2)
  assert.ok(lockPatch.extraWindows.every((item) => item.locked === true))
  // 通过 mergeSettings 应用补丁后，内置锁定的落盘结果正确
  const applied = mergeSettings(settings, lockPatch)
  assert.deepEqual(applied.lock, { dock: true, music: true, clock: true })

  const unlockPatch = withAllWindowsLocked(settings, false)
  assert.deepEqual(unlockPatch.lock, { dock: false, music: false, clock: false })
  assert.ok(unlockPatch.extraWindows.every((item) => item.locked === false))
  // 纯函数：不得修改传入的 settings
  assert.equal(settings.extraWindows[0].locked, false)
  assert.equal(settings.extraWindows[1].locked, true)
})

test('v1.7 契约：窗口注册表 kind/page 唯一且不与内置窗口冲突', () => {
  const builtinKinds = BUILTIN_WINDOW_SPECS.map((spec) => spec.kind)
  assert.deepEqual([...builtinKinds].sort(), ['clock', 'dock', 'music'])
  assert.equal(new Set(builtinKinds).size, builtinKinds.length, '内置窗口 kind 重复')
  assert.equal(new Set(BUILTIN_WINDOW_SPECS.map((spec) => spec.page)).size, BUILTIN_WINDOW_SPECS.length)

  const extraKinds = EXTRA_WINDOW_KINDS.map((spec) => spec.kind)
  const extraPages = EXTRA_WINDOW_KINDS.map((spec) => spec.page)
  assert.equal(new Set(extraKinds).size, extraKinds.length, '附加窗口 kind 重复')
  assert.equal(new Set(extraPages).size, extraPages.length, '附加窗口 page 重复')
  for (const spec of EXTRA_WINDOW_KINDS) {
    assert.equal(spec.category, 'extra')
    assert.ok(spec.label.length > 0 && spec.description.length > 0)
    assert.ok(spec.page.length > 0)
    assert.ok(spec.defaultSize.width > 0 && spec.defaultSize.height > 0)
    assert.equal(builtinKinds.includes(spec.kind), false, '附加窗口 kind 不得与内置重复')
    assert.equal(
      BUILTIN_WINDOW_SPECS.some((builtin) => builtin.page === spec.page),
      false,
      '附加窗口 page 不得与内置重复'
    )
  }

  assert.equal(findWindowKind('dock')?.kind, 'dock')
  assert.equal(findWindowKind('music')?.page, 'music')
  assert.equal(findWindowKind('nope'), null)
  assert.equal(isExtraWindowKind('weather'), false, '当前注册表为空，weather 还不是附加窗口')
})

test('v1.7 契约：patchExtraWindows 只改目标项并返回新数组', () => {
  const base = sanitizeSettings(undefined)
  const settings = {
    ...base,
    extraWindows: [
      fakeExtraWindow({ kind: 'weather', visible: true }),
      fakeExtraWindow({ kind: 'notes', visible: false })
    ]
  }
  const next = patchExtraWindows(settings, 'weather', { visible: false })
  assert.notEqual(next, settings.extraWindows, '必须返回新数组（交给 settings.update 整体替换）')
  assert.equal(next.length, 2)
  assert.equal(next[0].kind, 'weather')
  assert.equal(next[0].visible, false)
  assert.deepEqual(next[1], settings.extraWindows[1], '其他项不得被修改')
  assert.equal(settings.extraWindows[0].visible, true, '不得原地修改传入数组')
  // 注册表为空时 extraWindows 默认为空数组：补丁是安全 no-op
  assert.deepEqual(patchExtraWindows(base, 'weather', { visible: true }), [])
})

test('v1.7 契约：isDesktopBusy 只在「可见 + 未最小化 + 最大化/全屏」时判定占用桌面', () => {
  const state = (over = {}) => ({
    foregroundPid: 1234,
    maximized: true,
    fullscreen: false,
    desktop: false,
    className: 'Chrome_WidgetWin_1',
    minimized: false,
    visible: true,
    ...over
  })
  // 最大化 + 可见 + 未最小化 + 非本应用 → 占用桌面
  assert.equal(isDesktopBusy(state(), false), true)
  // 全屏 + 可见 + 未最小化 → 占用桌面
  assert.equal(isDesktopBusy(state({ maximized: false, fullscreen: true }), false), true)
  // 「显示桌面」bug 的核心回归点：窗口被最小化后即使 maximized 仍为 true 也不算占用桌面
  assert.equal(isDesktopBusy(state({ minimized: true }), false), false)
  // 显示桌面也可能用 SW_HIDE 隐藏窗口：不可见不算占用桌面
  assert.equal(isDesktopBusy(state({ visible: false }), false), false)
  // 前台窗口属于本应用自身 → 不算占用
  assert.equal(isDesktopBusy(state(), true), false)
  // 没有桌面状态（桥未启动/首帧未到）→ 不算占用
  assert.equal(isDesktopBusy(null, false), false)
  // 普通窗口（非最大化/非全屏）→ 不算占用
  assert.equal(isDesktopBusy(state({ maximized: false, fullscreen: false }), false), false)
})
