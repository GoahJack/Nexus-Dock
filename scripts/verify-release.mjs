import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { releasePolicy } from './release-policy.mjs'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Stable updates require an x.y.z version')
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`, 'Release tag must match package.json')
}
assert.equal(pkg.dependencies?.['electron-updater'], '6.8.12', 'Keep the updater compatible with builder 26')
if (process.argv.includes('--request')) {
  const request = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_TYPE === 'branch'
    ? JSON.parse(readFileSync(resolve(root, '.github/release-request.json'), 'utf8')) : undefined
  const publish = releasePolicy({
    version: pkg.version,
    eventName: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    manualPublish: process.env.MANUAL_PUBLISH,
    request
  })
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nversion=${pkg.version}\n`)
  console.log(`Explicit publication requested: ${publish}`)
}
if (process.argv.includes('--artifacts')) {
  // Parse exactly as electron-updater does, resolving its own declared YAML dependency.
  const require = createRequire(import.meta.url)
  const updaterRequire = createRequire(require.resolve('electron-updater/package.json'))
  const { load } = updaterRequire('js-yaml')
  const installer = `NexusDock-${pkg.version}-setup.exe`
  const manifest = load(readFileSync(resolve(root, 'dist/latest.yml'), 'utf8'))
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.path, installer, 'latest.yml must point to the installer, never portable')
  assert.equal(manifest.files.length, 1, 'A stable Windows feed must contain one x64 installer')
  const file = manifest.files[0]
  assert.equal(file.url, installer)
  const bytes = readFileSync(resolve(root, 'dist', installer))
  const checksum = createHash('sha512').update(bytes).digest('base64')
  assert.equal(file.size, bytes.length)
  assert.equal(file.sha512, checksum)
  assert.equal(manifest.sha512, checksum)
  assert.ok(existsSync(resolve(root, 'dist', `${installer}.blockmap`)))
  console.log(`Verified ${installer}: ${bytes.length} bytes, SHA-512 matches latest.yml`)
}
console.log(`Release version validated: v${pkg.version}`)
