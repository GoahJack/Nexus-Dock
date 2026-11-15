/** Isolated packaged Electron + real updater/HTTP/SHA-512; never executes an installer.
 * Run after npm run dist. Profiles and update cache stay inside .userdata/update-verify.
 * A loopback feed advertises the next patch using the just-built installer bytes. This
 * tests transport/integrity/UI, not a two-version installation. Only quitAndInstall
 * is intercepted, through the inspector in this test process; production has no test flags.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const root = process.cwd(), base = resolve(root, '.userdata/update-verify')
const output = resolve(root, 'docs/verification/auto-update')
mkdirSync(base, { recursive: true }); mkdirSync(output, { recursive: true })
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const parts = version.split('.').map(Number)
const testVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`
const testInstaller = `NexusDock-${testVersion}-setup.exe`
const installerBytes = readFileSync(resolve(root, `dist/NexusDock-${version}-setup.exe`))
const sha512 = createHash('sha512').update(installerBytes).digest('base64')
const pause = ms => new Promise(r => setTimeout(r, ms))
const results = [], requests = []
let feedState = 'offline', bytesServed = 0
const server = createServer(async (request, response) => {
  requests.push(request.url)
  if (request.url.startsWith('/latest.yml')) {
    if (feedState === 'offline') { response.writeHead(503); response.end('Service unavailable'); return }
    const checksum = feedState === 'bad-checksum' ? Buffer.alloc(64).toString('base64') : sha512
    const manifest = `version: ${testVersion}\nfiles:\n  - url: ${testInstaller}\n    sha512: ${checksum}\n    size: ${installerBytes.length}\npath: ${testInstaller}\nsha512: ${checksum}\nreleaseDate: 2026-11-15T00:00:00.000Z\n`
    response.writeHead(200, { 'Content-Type': 'application/yaml' }); response.end(manifest); return
  }
  if (!request.url.startsWith(`/${testInstaller}`)) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installerBytes.length })
  for (let at = 0; at < installerBytes.length && !response.destroyed; at += 512 * 1024) {
    const chunk = installerBytes.subarray(at, at + 512 * 1024)
    response.write(chunk); bytesServed += chunk.length
    await pause(20)
  }
  response.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const feedUrl = `http://127.0.0.1:${server.address().port}/`
async function freePort() {
  const server = createTcpServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise(r => server.close(r))
  return port
}
async function until(fn, label, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, pass: true, detail }); console.log('PASS', name) }
  catch (e) { results.push({ name, pass: false, error: String(e) }); console.log('FAIL', name, String(e)) }
}
async function connect(port, segment, sockets, errors) {
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => !segment || t.url.includes(`/${segment}/index.html`)) } catch { return null }
  }, `${segment ?? 'main'} debugger`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  sockets.push(socket)
  let serial = 0
  const pending = new Map()
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text)
    if (segment && data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params.args.map(a => a.value ?? a.description).join(' '))
    if (!data.id || !pending.has(data.id)) return
    const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer)
    data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)) }, 45000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const screenshot = async name => {
    const result = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(output, name), Buffer.from(result.data, 'base64'))
  }
  return { evaluate, screenshot }
}

async function launch(mode, run) {
  const profile = join(base, mode), sockets = [], errors = []
  mkdirSync(profile, { recursive: true })
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.schemaVersion = 11
  settings.system.autoUpdate = false
  settings.music.source = 'local'; settings.music.visible = false
  settings.dock.onlyOnDesktop = false; settings.dock.freeX = 317
  settings.extraWindows.forEach(w => { w.visible = false })
  const words = JSON.stringify({ version: 1, words: [{ word: 'update', meaning: '更新', phonetic: '', example: '' }] })
  const progress = JSON.stringify({ version: 2, progress: {} })
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
  writeFileSync(join(profile, 'wordbank.json'), words)
  writeFileSync(join(profile, 'wordbank-progress.json'), progress)
  const cdp = await freePort(), inspector = await freePort()
  const executable = mode === 'portable' ? resolve(root, `dist/NexusDock-${version}-portable.exe`)
    : mode === 'development' ? resolve(root, 'node_modules/electron/dist/electron.exe')
    : resolve(root, 'dist/win-unpacked/Nexus Dock.exe')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_FILE
  const child = spawn(executable, [
    '--no-sandbox', `--inspect=127.0.0.1:${inspector}`, `--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`,
    ...(mode === 'development' ? [root] : [])
  ], { env, windowsHide: true, stdio: ['ignore', openSync(join(profile, 'stdout.log'), 'w'), openSync(join(profile, 'stderr.log'), 'w')] })
  let main, ownedPid
  child.on('error', error => errors.push(String(error)))
  try {
    main = await connect(inspector, null, sockets, errors)
    const identity = await main.evaluate(`({pid:process.pid,argv:process.argv})`)
    assert.ok(identity.argv.includes(`--user-data-dir=${profile}`), 'Only attach to this isolated test instance')
    ownedPid = identity.pid
    const dock = await connect(cdp, 'dock', sockets, errors)
    await dock.evaluate('window.nexus.window.openSettings()')
    const page = await connect(cdp, 'settings', sockets, errors)
    await until(() => page.evaluate("!![...document.querySelectorAll('.settings-nav-item')].find(b=>b.textContent.includes('关于'))"), 'settings navigation')
    await page.evaluate("[...document.querySelectorAll('.settings-nav-item')].find(b=>b.textContent.includes('关于')).click()")
    await until(() => page.evaluate("document.querySelector('.nx-update-card')?.dataset.updatePhase !== 'loading' && !!document.querySelector('.nx-update-card')"), 'update section')
    await run({ main, dock, page, errors, profile, words, progress })
    assert.deepEqual(errors, [], 'No renderer errors or unhandled exceptions')
    assert.equal(readFileSync(join(profile, 'wordbank.json'), 'utf8'), words, 'Word bank bytes preserved')
    assert.equal(readFileSync(join(profile, 'wordbank-progress.json'), 'utf8'), progress, 'Progress bytes preserved')
  } finally {
    if (main) await main.evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),50);true").catch(() => {})
    for (const socket of sockets) socket.close()
    await pause(1000)
    if (ownedPid) { try { process.kill(ownedPid, 0); process.kill(ownedPid) } catch {} }
    if (child.exitCode === null) child.kill()
  }
}

try {
  await check('Packaged updater: real network error, SHA-512 rejection, automatic download, restart request and preserved data', async () => {
    await launch('installer', async ({ main, page, profile }) => {
      assert.equal((await page.evaluate('window.nexus.updates.getState()')).mode, 'installer')
      await main.evaluate(`(() => {
        globalThis.__updaterTest = { engine:process.mainModule.require('electron-updater').autoUpdater, installs:[] };
        const engine = __updaterTest.engine;
        Object.defineProperty(engine.app, 'baseCachePath', { get:()=>${JSON.stringify(join(base, 'cache'))} });
        engine.setFeedURL({provider:'generic',url:${JSON.stringify(feedUrl)}});
        engine.disableDifferentialDownload = true;
        engine.quitAndInstall = (...args) => __updaterTest.installs.push(args);
      })()`)
      const options = await main.evaluate('({autoInstall:__updaterTest.engine.autoInstallOnAppQuit,autoDownload:__updaterTest.engine.autoDownload,allowDowngrade:__updaterTest.engine.allowDowngrade})')
      assert.deepEqual(options, { autoInstall: false, autoDownload: false, allowDowngrade: false })
      const offline = await page.evaluate('window.nexus.updates.check()')
      assert.equal(offline.phase, 'error'); assert.match(offline.message, /网络/)
      await page.screenshot('offline.png')
      feedState = 'bad-checksum'
      assert.equal((await page.evaluate('window.nexus.updates.check()')).phase, 'available')
      await page.evaluate('window.nexus.updates.download().then(s=>window.__downloadResult=s);true')
      await until(() => page.evaluate("document.querySelector('.nx-update-download progress')?.value > 0"), 'real download progress')
      await page.screenshot('downloading.png')
      const bad = await until(async () => { const s = await page.evaluate('window.nexus.updates.getState()'); return s.phase === 'error' ? s : null }, 'bad SHA-512 rejected')
      assert.match(bad.message, /校验未通过/)
      assert.equal((await page.evaluate('window.nexus.updates.install()')).phase, 'error')
      assert.deepEqual(await main.evaluate('__updaterTest.installs'), [])
      feedState = 'good'
      await page.evaluate('window.nexus.settings.update({system:{autoUpdate:true}})')
      await page.evaluate('window.nexus.updates.check().then(s=>window.__checkResult=s);true')
      await until(async () => (await page.evaluate('window.nexus.updates.getState()')).phase === 'downloaded', 'automatic verified download')
      await page.screenshot('ready.png')
      assert.equal(await page.evaluate("[...document.querySelectorAll('.nx-update-actions button')].some(b=>b.textContent==='重启更新'&&!b.disabled)"), true)
      assert.deepEqual(await main.evaluate('__updaterTest.installs'), [])
      const before = await page.evaluate('window.nexus.updates.getState()')
      assert.equal((await page.evaluate('window.nexus.updates.check()')).revision, before.revision, 'Ready status survives repeated check')
      await page.evaluate("[...document.querySelectorAll('.nx-update-actions button')].find(b=>b.textContent==='重启更新').click()")
      await until(async () => (await main.evaluate('__updaterTest.installs.length')) === 1, 'explicit install request')
      assert.deepEqual(await main.evaluate('__updaterTest.installs'), [[true, true]])
      const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
      assert.equal(saved.dock.freeX, 317); assert.equal(saved.schemaVersion, 12)
      assert.equal(saved.system.autoUpdate, true)
    })
    return { currentVersion: version, advertisedTestVersion: testVersion, sha512, bytesServed, installerExecuted: false }
  })
  for (const mode of ['portable', 'development']) await check(`${mode}: updater disabled with correct guidance; no network work`, async () => {
    const before = requests.length
    await launch(mode, async ({ page }) => {
      const state = await page.evaluate('window.nexus.updates.getState()')
      assert.equal(state.mode, mode); assert.equal(state.phase, 'unsupported')
      assert.equal((await page.evaluate('window.nexus.updates.check()')).phase, 'unsupported')
      assert.equal((await page.evaluate('window.nexus.updates.download()')).phase, 'unsupported')
      await page.screenshot(`${mode}.png`)
    })
    assert.equal(requests.length, before)
  })
} finally {
  server.closeAllConnections()
  await new Promise(r => server.close(r))
  const report = { version, generatedAt: new Date().toISOString(), results, requests, bytesServed,
    limitation: `Installer execution is intercepted. The loopback ${testVersion} fixture uses built ${version} installer bytes; actual installed-version replacement and live GitHub Release require release validation.` }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length, bytesServed }))
  if (results.some(r => !r.pass)) process.exitCode = 1
}
