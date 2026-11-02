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
  CUSTOM_NAME_MAX_LENGTH,
  DEFAULT_APPS,
  DEFAULT_SETTINGS,
  IPC,
  SCREEN_MARGIN,
  displayIconOf,
  displayNameOf,
  isHorizontalEdge,
  mergeSettings,
  sanitizeSettings
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
