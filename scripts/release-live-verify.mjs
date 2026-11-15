/** Verify the public GitHub feed with a real packaged client and isolated cache.
 * The baseline check uses the real version. A second check changes only the test
 * engine's comparison version to 1.9.0 to exercise detection/download of v1.10.0.
 * Never executes the installer or opens a Computer Use capture session.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { resolve, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const root = process.cwd(), profile = resolve(root, '.userdata/release-live-verify')
const output = resolve(root, 'docs/verification/auto-update')
mkdirSync(profile, { recursive: true }); mkdirSync(output, { recursive: true })
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const repository = 'GoahJack/Nexus-Dock'
const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('electron-updater/package.json'))('js-yaml')
const pause = ms => new Promise(r => setTimeout(r, ms))
const report = { version, generatedAt: new Date().toISOString(), installerExecuted: false }
let child, socket, ownedPid, evaluate

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Nexus-Dock-release-verification' } })
  assert.equal(response.status, 200, `Public endpoint must be accessible: ${url}`)
  return response
}
async function until(fn, label, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) { const result = await fn(); if (result) return result; await pause(300) }
  throw Error(`Timed out: ${label}`)
}

try {
  const release = await (await get(`https://api.github.com/repos/${repository}/releases/latest`)).json()
  assert.equal(release.tag_name, `v${version}`)
  assert.equal(release.draft, false); assert.equal(release.prerelease, false)
  const names = [`NexusDock-${version}-setup.exe`, `NexusDock-${version}-setup.exe.blockmap`, `NexusDock-${version}-portable.exe`, 'latest.yml']
  for (const name of names) {
    const asset = release.assets.find(asset => asset.name === name)
    assert.ok(asset && asset.state === 'uploaded' && asset.size > 0, `Missing asset ${name}`)
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/)
    const response = await fetch(asset.browser_download_url, { method: 'HEAD', signal: AbortSignal.timeout(30000) })
    assert.equal(response.status, 200, `Public download unavailable: ${name}`)
  }
  const manifest = load(await (await get(`https://github.com/${repository}/releases/latest/download/latest.yml`)).text())
  assert.equal(manifest.version, version)
  assert.equal(manifest.path, names[0]); assert.equal(manifest.files[0].url, names[0])
  assert.equal(manifest.sha512, manifest.files[0].sha512)
  report.release = { url: release.html_url, tag: release.tag_name, publishedAt: release.published_at, assets: release.assets.map(({ name, size, digest }) => ({ name, size, digest })) }
  console.log('Public stable release, four downloads and latest.yml verified')

  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.system.autoUpdate = false; settings.music.visible = false; settings.music.source = 'local'
  settings.dock.onlyOnDesktop = false; settings.extraWindows.forEach(window => { window.visible = false })
  writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings))
  const listener = createServer()
  await new Promise(r => listener.listen(0, '127.0.0.1', r))
  const port = listener.address().port
  await new Promise(r => listener.close(r))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_FILE
  child = spawn(resolve(root, 'dist/win-unpacked/Nexus Dock.exe'), [
    '--no-sandbox', `--inspect=127.0.0.1:${port}`, `--user-data-dir=${profile}`
  ], { env, windowsHide: true, stdio: ['ignore', openSync(join(profile, 'stdout.log'), 'w'), openSync(join(profile, 'stderr.log'), 'w')] })
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0] } catch { return null }
  }, 'isolated packaged client inspector')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let serial = 0
  const pending = new Map()
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (!data.id || !pending.has(data.id)) return
    const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer)
    data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result)
  }
  evaluate = expression => new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Inspector evaluation timed out')) }, 60000)
    pending.set(id, { resolve: result => result.exceptionDetails ? reject(Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)) : resolve(result.result.value), reject, timer })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  const identity = await evaluate('({pid:process.pid,argv:process.argv})')
  assert.ok(identity.argv.includes(`--user-data-dir=${profile}`)); ownedPid = identity.pid
  await until(() => evaluate("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('/dock/index.html'))"), 'dock renderer')
  await evaluate(`(() => {
    globalThis.__liveUpdate = {
      engine:process.mainModule.require('electron-updater').autoUpdater,
      renderer:process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dock/index.html')).webContents
    };
    Object.defineProperty(__liveUpdate.engine.app, 'baseCachePath', {get:()=>${JSON.stringify(join(profile, 'cache'))}});
    __liveUpdate.engine.disableDifferentialDownload=true;
  })()`)
  const invoke = expression => evaluate(`__liveUpdate.renderer.executeJavaScript(${JSON.stringify(expression)})`)
  report.baseline = await invoke('window.nexus.updates.check()')
  assert.equal(report.baseline.currentVersion, version); assert.equal(report.baseline.phase, 'idle')
  assert.ok(report.baseline.checkedAt)
  assert.equal(await evaluate('__liveUpdate.engine.autoInstallOnAppQuit'), false)
  console.log('Real current-version client recognizes the published stable feed')
  await evaluate("__liveUpdate.engine.currentVersion = new (process.mainModule.require('semver').SemVer)('1.9.0');true")
  report.simulatedOlderClient = await invoke('window.nexus.updates.check()')
  assert.equal(report.simulatedOlderClient.phase, 'available'); assert.equal(report.simulatedOlderClient.latestVersion, version)
  await evaluate("__liveUpdate.renderer.executeJavaScript('window.nexus.updates.download()').then(s=>__liveUpdate.result=s);true")
  let lastPrinted = -1
  const downloaded = await until(async () => {
    const state = await invoke('window.nexus.updates.getState()')
    if (state.phase === 'error') throw Error(state.message)
    const percent = Math.floor(state.progress?.percent ?? 0)
    if (percent >= lastPrinted + 10) { lastPrinted = percent; console.log(`Public installer download: ${percent}%`) }
    return state.phase === 'downloaded' ? state : null
  }, 'public installer download and integrity check', 240000)
  const downloadedFile = await evaluate('__liveUpdate.engine.downloadedUpdateHelper.file')
  assert.ok(downloadedFile.startsWith(profile), 'Update cache must stay isolated')
  const hash512 = createHash('sha512'), hash256 = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(downloadedFile)) { hash512.update(chunk); hash256.update(chunk); size += chunk.length }
  const digest512 = hash512.digest('base64'), digest256 = `sha256:${hash256.digest('hex')}`
  assert.equal(digest512, manifest.sha512)
  assert.equal(size, manifest.files[0].size)
  assert.equal(digest256, release.assets.find(asset => asset.name === names[0]).digest)
  report.download = { state: downloaded.phase, size, sha512: digest512, digest: digest256 }
  report.pass = true
  report.limitation = 'Only the comparison version was simulated for download testing; no installer was run and no installed-version replacement is claimed.'
  console.log('Public GitHub installer downloaded; SHA-512 and GitHub SHA-256 both match; installer not executed')
} catch (error) {
  report.pass = false; report.error = String(error); process.exitCode = 1; console.error(String(error))
} finally {
  if (evaluate) await evaluate("setTimeout(()=>process.mainModule.require('electron').app.quit(),50);true").catch(() => {})
  socket?.close()
  await pause(1000)
  if (ownedPid) { try { process.kill(ownedPid, 0); process.kill(ownedPid) } catch {} }
  if (child && child.exitCode === null) child.kill()
  writeFileSync(join(output, 'live-release-report.json'), JSON.stringify(report, null, 2))
}
