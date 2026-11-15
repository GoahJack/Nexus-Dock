import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { UpdateController, UPDATE_START_DELAY, UPDATE_INTERVAL, UPDATE_RETRY_DELAY } from '../src/main/updateController.ts'
import { DEFAULT_SETTINGS, sanitizeSettings, mergeSettings, IPC } from '../src/shared/types.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(options = {}) {
  let now = 1000, nextId = 1
  const timers = new Map(), events = [], calls = []
  const scheduler = {
    now: () => now,
    setTimeout(fn, delay) { const id = nextId++; timers.set(id, { fn, at: now + delay, delay }); return id },
    clearTimeout(id) { timers.delete(id) }
  }
  const engine = new EventEmitter()
  engine.on('error', () => {}) // Same permanent error sink as electron-updater.
  engine.checkForUpdates = async () => { calls.push('check'); engine.emit('update-not-available', { version: '1.10.0' }); return {} }
  engine.downloadUpdate = async () => { calls.push('download'); engine.emit('update-downloaded', { version: '1.11.0' }); return [] }
  engine.quitAndInstall = (...args) => calls.push(['install', ...args])
  const controller = new UpdateController({
    engine, mode: 'installer', currentVersion: '1.10.0', automatic: true,
    onChanged: state => events.push(state), beforeInstall: () => calls.push('flush'), scheduler,
    ...options
  })
  const advance = async ms => {
    now += ms
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn() }
    await tick()
  }
  return { controller, engine, timers, events, calls, advance, setNow: value => { now = value } }
}

test('updates: development, portable and legacy layouts never schedule or execute updates', async () => {
  for (const mode of ['development', 'portable', 'unsupported']) {
    const f = fixture({ mode })
    assert.equal(f.controller.getState().phase, 'unsupported')
    await f.controller.check(); await f.controller.download(); f.controller.install()
    f.controller.setAutomatic(false); f.controller.setAutomatic(true)
    assert.equal(f.timers.size, 0)
    assert.deepEqual(f.calls, [])
    f.controller.dispose()
  }
})

test('updates: staggered startup, six-hour checks, disabling and reenabling the setting', async () => {
  const f = fixture()
  assert.equal([...f.timers.values()][0].delay, UPDATE_START_DELAY)
  await f.advance(UPDATE_START_DELAY)
  assert.deepEqual(f.calls, ['check'])
  assert.equal(f.controller.getState().phase, 'idle')
  assert.ok(f.controller.getState().checkedAt)
  assert.equal([...f.timers.values()][0].delay, UPDATE_INTERVAL)
  f.controller.setAutomatic(false)
  await f.advance(UPDATE_INTERVAL)
  assert.deepEqual(f.calls, ['check'])
  f.controller.setAutomatic(true)
  await f.advance(UPDATE_START_DELAY)
  assert.deepEqual(f.calls, ['check', 'check'])
  f.controller.dispose()
  assert.equal(f.timers.size, 0)
})

test('updates: concurrent checks/downloads are coalesced; ready package stays ready until explicit install', async () => {
  const f = fixture(), checking = deferred(), downloading = deferred()
  f.engine.checkForUpdates = async () => {
    f.calls.push('check'); await checking.promise
    f.engine.emit('update-available', { version: '1.11.0' })
    return {}
  }
  f.engine.downloadUpdate = async () => {
    f.calls.push('download'); await downloading.promise
    f.engine.emit('update-downloaded', { version: '1.11.0' })
    return []
  }
  const first = f.controller.check(), second = f.controller.check()
  await tick()
  assert.deepEqual(f.calls, ['check'])
  checking.resolve(); await tick()
  assert.equal(f.controller.getState().phase, 'downloading')
  await f.controller.check()
  const extraDownload = f.controller.download()
  downloading.resolve()
  await Promise.all([first, second, extraDownload])
  await f.controller.check()
  assert.deepEqual(f.calls, ['check', 'download'])
  assert.equal(f.controller.getState().phase, 'downloaded')
  await f.advance(UPDATE_INTERVAL)
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.calls, ['check', 'download'])
  assert.equal(f.controller.install().phase, 'installing')
  f.controller.install()
  await f.advance(150)
  assert.deepEqual(f.calls, ['check', 'download', 'flush', ['install', true, true]])
  f.controller.dispose()
})

test('updates: automatic off permits manual checks and downloads; switching off during a check prevents download', async () => {
  const f = fixture({ automatic: false })
  f.engine.checkForUpdates = async () => { f.engine.emit('update-available', { version: '1.11.0' }) }
  assert.equal((await f.controller.check()).phase, 'available')
  assert.deepEqual(f.calls, [])
  assert.equal((await f.controller.download()).phase, 'downloaded')
  assert.deepEqual(f.calls, ['download'])
  f.controller.dispose()
  const g = fixture(), checking = deferred()
  g.engine.checkForUpdates = async () => { await checking.promise; g.engine.emit('update-available', { version: '1.11.0' }) }
  const task = g.controller.check()
  await tick(); g.controller.setAutomatic(false); checking.resolve(); await task
  assert.equal(g.controller.getState().phase, 'available')
  assert.deepEqual(g.calls, [])
  assert.equal(g.timers.size, 0)
  g.controller.dispose()
})

test('updates: no published release is distinct from latest, network failures retry after 30 minutes', async () => {
  const f = fixture()
  f.engine.checkForUpdates = async () => { throw Object.assign(new Error('No published versions'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }) }
  await f.advance(UPDATE_START_DELAY)
  assert.equal(f.controller.getState().phase, 'error')
  assert.match(f.controller.getState().message, /尚未发布/)
  assert.equal(f.controller.getState().checkedAt, undefined)
  assert.equal([...f.timers.values()][0].delay, UPDATE_RETRY_DELAY)
  f.engine.checkForUpdates = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED') }
  await f.advance(UPDATE_RETRY_DELAY)
  assert.match(f.controller.getState().message, /网络/)
  f.engine.checkForUpdates = async () => { f.engine.emit('update-not-available', { version: '1.10.0' }) }
  assert.equal((await f.controller.check()).phase, 'idle')
  assert.equal(f.controller.getState().message, undefined)
  f.controller.dispose()
})

test('updates: checksum failure blocks install, reports error and supports download retry', async () => {
  const f = fixture({ automatic: false })
  f.engine.checkForUpdates = async () => { f.engine.emit('update-available', { version: '1.11.0' }) }
  let failed = true
  f.engine.downloadUpdate = async () => {
    if (failed) {
      const error = Object.assign(new Error('sha512 checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' })
      f.engine.emit('error', error); throw error
    }
    f.engine.emit('update-downloaded', { version: '1.11.0' })
  }
  await f.controller.check(); await f.controller.download()
  assert.equal(f.controller.getState().errorStage, 'download')
  assert.match(f.controller.getState().message, /校验未通过/)
  f.controller.install(); await f.advance(500)
  assert.deepEqual(f.calls, [])
  failed = false
  assert.equal((await f.controller.download()).phase, 'downloaded')
  f.controller.dispose()
})

test('updates: progress is throttled, finite and clamped; exposed snapshots cannot mutate internal state', async () => {
  const f = fixture({ automatic: false }), downloading = deferred()
  f.engine.checkForUpdates = async () => { f.engine.emit('update-available', { version: '1.11.0' }) }
  f.engine.downloadUpdate = () => downloading.promise
  await f.controller.check()
  const task = f.controller.download(); await tick()
  f.engine.emit('download-progress', { percent: 20, total: 500, transferred: 100, bytesPerSecond: 50 })
  const revision = f.controller.getState().revision
  f.setNow(1200)
  f.engine.emit('download-progress', { percent: 21, total: 500, transferred: 105, bytesPerSecond: 50 })
  assert.equal(f.controller.getState().revision, revision)
  f.setNow(1500)
  f.engine.emit('download-progress', { percent: 150, total: NaN, transferred: -1, bytesPerSecond: Infinity })
  const state = f.controller.getState()
  assert.deepEqual(state.progress, { percent: 100, total: 0, transferred: 0, bytesPerSecond: 0 })
  state.progress.percent = 5
  assert.equal(f.controller.getState().progress.percent, 100)
  f.engine.emit('update-downloaded', { version: '1.11.0' }); downloading.resolve(); await task
  const readyRevision = f.controller.getState().revision
  f.engine.emit('error', new Error('late network error'))
  assert.equal(f.controller.getState().revision, readyRevision)
  f.controller.dispose()
})

test('updates: disposal removes timers/listeners, ignores late checks and cancels scheduled installation', async () => {
  const f = fixture(), checking = deferred()
  f.engine.checkForUpdates = () => checking.promise
  const task = f.controller.check(); await tick()
  const count = f.events.length
  f.controller.dispose()
  checking.reject(new Error('offline')); await task
  assert.equal(f.events.length, count)
  assert.equal(f.engine.listenerCount('update-available'), 0)
  assert.equal(f.timers.size, 0)
  const g = fixture()
  g.engine.checkForUpdates = async () => { g.engine.emit('update-available', { version: '1.11.0' }) }
  await g.controller.check(); g.controller.install(); g.controller.dispose(); await g.advance(500)
  assert.deepEqual(g.calls, ['download'])
})

test('updates: installation failures remain visible, ordinary lifecycle never installs a downloaded package', async () => {
  const f = fixture()
  f.engine.checkForUpdates = async () => { f.engine.emit('update-available', { version: '1.11.0' }) }
  f.engine.quitAndInstall = () => { throw new Error('spawn EACCES') }
  await f.controller.check(); f.controller.install(); await f.advance(150)
  assert.equal(f.controller.getState().phase, 'error')
  assert.equal(f.controller.getState().errorStage, 'install')
  assert.match(f.controller.getState().message, /安装程序/)
  f.controller.dispose()
})

test('updates: schema v11 migration adds default, preserves explicit opt-out and all existing settings', () => {
  const old = structuredClone(DEFAULT_SETTINGS)
  old.schemaVersion = 11
  delete old.system.autoUpdate
  old.music.pinned = true
  old.dock.freeX = 317
  old.apps = []
  const upgraded = sanitizeSettings(old)
  assert.equal(upgraded.schemaVersion, 12)
  assert.equal(upgraded.system.autoUpdate, true)
  assert.equal(upgraded.music.pinned, true)
  assert.equal(upgraded.dock.freeX, 317)
  assert.deepEqual(upgraded.apps, [])
  assert.deepEqual(upgraded.extraWindows, old.extraWindows)
  const disabled = mergeSettings(upgraded, { system: { autoUpdate: false } })
  assert.equal(sanitizeSettings(JSON.parse(JSON.stringify(disabled))).system.autoUpdate, false)
  assert.equal(sanitizeSettings({ system: { autoUpdate: 'false' } }).system.autoUpdate, true)
})

test('updates: IPC is restricted, updater lifecycle and safe install settings stay wired', () => {
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const main = source('src/main/updater.ts'), preload = source('src/preload/index.ts'), pkg = JSON.parse(source('package.json'))
  for (const name of ['updateGet', 'updateCheck', 'updateDownload', 'updateInstall', 'updateOpenReleases']) {
    assert.ok(IPC[name])
    assert.match(main, new RegExp(`ipcMain\\.handle\\(IPC\\.${name}`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(IPC\\.${name}`))
  }
  assert.match(main, /autoInstallOnAppQuit = false/)
  assert.match(main, /allowDowngrade = false/)
  assert.match(main, /allowPrerelease = false/)
  assert.match(main, /disableWebInstaller = true/)
  assert.match(main, /beforeInstall: flushSettings/)
  assert.match(main, /shell.openExternal\(RELEASES_URL\)/)
  assert.doesNotMatch(main, /setFeedURL|verifyUpdateCodeSignature\s*=\s*false|GH_TOKEN|GITHUB_TOKEN/)
  assert.equal(pkg.name, 'nexus-dock')
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false)
  assert.equal(pkg.build.nsis.perMachine, false)
  assert.equal(pkg.build.publish[0].releaseType, 'draft')
  assert.deepEqual(pkg.build.win.target.map(t => t.target), ['nsis', 'portable'])
})
