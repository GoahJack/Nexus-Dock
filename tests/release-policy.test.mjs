import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releasePolicy } from '../scripts/release-policy.mjs'

const main = { version: '1.10.0', eventName: 'push', refType: 'branch', refName: 'main', request: { version: '1.10.0', publish: true } }

test('release: only an explicit matching main request publishes', () => {
  assert.equal(releasePolicy(main), true)
  assert.equal(releasePolicy({ ...main, request: { version: '1.10.0', publish: false } }), false)
})
test('release: missing request or mismatched version blocks publication', () => {
  assert.throws(() => releasePolicy({ ...main, request: undefined }))
  assert.throws(() => releasePolicy({ ...main, request: { version: '1.9.0', publish: true } }))
})
test('release: string and truthy publish flags are rejected', () => {
  for (const publish of ['true', 'false', 1, null, undefined]) {
    assert.throws(() => releasePolicy({ ...main, request: { version: '1.10.0', publish } }))
  }
})
test('release: branch requests outside main cannot publish', () => {
  assert.throws(() => releasePolicy({ ...main, refName: 'feature/test' }))
  assert.throws(() => releasePolicy({ ...main, refType: 'unknown' }))
})
test('release: version-matched tag builds remain drafts', () => {
  assert.equal(releasePolicy({ ...main, refType: 'tag', refName: 'v1.10.0' }), false)
  assert.throws(() => releasePolicy({ ...main, refType: 'tag', refName: 'v1.9.0' }))
})
test('release: manual publish defaults to draft and requires an explicit boolean input', () => {
  const manual = { ...main, eventName: 'workflow_dispatch', request: undefined }
  assert.equal(releasePolicy(manual), false)
  assert.equal(releasePolicy({ ...manual, manualPublish: 'true' }), true)
  assert.throws(() => releasePolicy({ ...manual, manualPublish: 'yes' }))
})
test('release: unexpected event or unstable version cannot publish', () => {
  assert.throws(() => releasePolicy({ ...main, eventName: 'pull_request' }))
  assert.throws(() => releasePolicy({ ...main, version: '1.10.0-beta.1' }))
})
