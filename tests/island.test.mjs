import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IslandExpansion, ISLAND_LEAVE_MS, nextIslandProximity } from '../src/shared/island.ts'
import { DEFAULT_SETTINGS, IPC, mergeSettings, patchExtraWindows, sanitizeSettings } from '../src/shared/types.ts'

const empty = () => ({ near: false, anchor: null, bounds: null })
const rect = { x: -500, y: 200, width: 200, height: 50 }

test('proximity: expands before pointer reaches window; hysteresis avoids boundary flutter', () => {
  assert.equal(nextIslandProximity(empty(), { x: -525, y: 220 }, rect).near, false)
  const entered = nextIslandProximity(empty(), { x: -524, y: 220 }, rect)
  assert.equal(entered.near, true)
  assert.equal(nextIslandProximity(entered, { x: -535, y: 220 }, rect).near, true)
  assert.equal(nextIslandProximity(entered, { x: -541, y: 220 }, rect).near, false)
})

test('proximity: retains original capsule footprint across resize; clears stale anchor on move', () => {
  const capsule = { x: 1000, y: 300, width: 200, height: 50 }
  const point = { x: 1210, y: 325 }
  const entered = nextIslandProximity(empty(), point, capsule)
  const resized = nextIslandProximity(entered, point, { x: 600, y: 100, width: 400, height: 150 })
  assert.equal(resized.near, true)
  const moved = nextIslandProximity(resized, point, { x: 100, y: 100, width: 400, height: 150 })
  assert.equal(moved.near, false)
  assert.equal(moved.anchor, null)
})

test('proximity: reentry catches a shrinking edge between polls, without an idle ghost zone', () => {
  const full = { x: 1000, y: 200, width: 360, height: 400 }
  const shrinking = { x: 1060, y: 250, width: 300, height: 120 }
  const far = nextIslandProximity(empty(), { x: 0, y: 0 }, full)
  const entered = nextIslandProximity(far, { x: 1020, y: 300 }, shrinking)
  assert.equal(entered.near, true, 'old edge remains reachable during the shrinking poll')
  const idle = nextIslandProximity(far, { x: 0, y: 0 }, shrinking)
  assert.equal(nextIslandProximity(idle, { x: 1020, y: 300 }, shrinking).near, false, 'old edge is forgotten once geometry stops changing')
})

test('expansion: immediate approach, delayed exit, reentry cancels collapse', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const states = []
  const behavior = new IslandExpansion(value => states.push(value))
  behavior.configure(true, false)
  assert.deepEqual(states, [true])
  behavior.setNear(true)
  assert.deepEqual(states, [true, false])
  behavior.setNear(false)
  t.mock.timers.tick(ISLAND_LEAVE_MS - 1)
  assert.equal(states.at(-1), false)
  behavior.setNear(true)
  t.mock.timers.tick(ISLAND_LEAVE_MS * 2)
  assert.equal(states.at(-1), false)
  behavior.setNear(false)
  t.mock.timers.tick(ISLAND_LEAVE_MS)
  assert.equal(states.at(-1), true)
  behavior.dispose()
})

test('expansion: pin survives pointer exit; unpin resumes mode; disabling mode stays open', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const states = []
  const behavior = new IslandExpansion(value => states.push(value))
  behavior.configure(true, true)
  behavior.setNear(true)
  behavior.setNear(false)
  t.mock.timers.tick(5000)
  assert.deepEqual(states, [])
  behavior.configure(true, false)
  assert.equal(states.at(-1), true)
  behavior.configure(false, false)
  assert.equal(states.at(-1), false)
  behavior.setNear(false)
  t.mock.timers.tick(5000)
  assert.equal(states.at(-1), false)
})

test('expansion: typing/keyboard/drag protection and disposal cancel timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const states = []
  const behavior = new IslandExpansion(value => states.push(value))
  behavior.configure(true, false)
  behavior.setInteracting(true)
  behavior.setNear(false)
  t.mock.timers.tick(5000)
  assert.equal(states.at(-1), false)
  behavior.setInteracting(false)
  t.mock.timers.tick(ISLAND_LEAVE_MS - 1)
  assert.equal(states.at(-1), false)
  behavior.dispose()
  t.mock.timers.tick(5000)
  assert.equal(states.at(-1), false)
})

test('pinned settings: old/manual configurations migrate and all widgets persist independent pins', () => {
  const old = sanitizeSettings({ music: { collapsed: true }, clock: { pinned: 'true' } })
  assert.equal(old.music.collapsed, true)
  assert.equal(old.music.pinned, false)
  assert.equal(old.clock.pinned, false)
  let pinned = mergeSettings(DEFAULT_SETTINGS, { music: { collapsed: true, pinned: true }, clock: { pinned: true } })
  pinned = mergeSettings(pinned, { extraWindows: patchExtraWindows(pinned, 'wordstudy', { pinned: true }) })
  const persisted = sanitizeSettings(JSON.parse(JSON.stringify(pinned)))
  assert.equal(persisted.music.pinned, true)
  assert.equal(persisted.clock.pinned, true)
  assert.equal(persisted.extraWindows.find(w => w.kind === 'wordstudy').pinned, true)
  assert.equal('pinned' in persisted.dock, false)
})

test('proximity IPC: own-window read and subscription wired through main and preload', () => {
  const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
  assert.ok(read('main/ipc.ts').includes('ipcMain.handle(IPC.islandProximityGet'))
  assert.ok(read('main/ipc.ts').includes('getOwnIslandProximity(event.sender.id)'))
  assert.ok(read('main/ipc.ts').includes('ipcMain.removeHandler(IPC.islandProximityGet)'))
  assert.ok(read('preload/index.ts').includes('ipcRenderer.invoke(IPC.islandProximityGet)'))
  assert.ok(read('preload/index.ts').includes('subscribe<boolean>(IPC.islandProximityChanged, cb)'))
  assert.equal(IPC.islandProximityChanged, 'island:proximityChanged')
})
