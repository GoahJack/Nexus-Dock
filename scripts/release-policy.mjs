import assert from 'node:assert/strict'

/** Only an explicit version-matched request on main, or the manual publish input, goes public. */
export function releasePolicy({ version, eventName, refType, refName, request, manualPublish = 'false' }) {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'A stable release must use an x.y.z version')
  if (eventName === 'workflow_dispatch') {
    assert.ok(['true', 'false'].includes(manualPublish), 'Manual publish input must be a boolean')
    return manualPublish === 'true'
  }
  assert.equal(eventName, 'push', 'Unsupported publication event')
  if (refType === 'tag') {
    assert.equal(refName, `v${version}`, 'Release tag must match package.json')
    return false // Preserve the existing tag-to-draft workflow.
  }
  assert.equal(refType, 'branch', 'Publication request must be a branch push')
  assert.equal(refName, 'main', 'Only main accepts publication requests')
  assert.equal(request?.version, version, 'Publication request must match package.json')
  assert.equal(typeof request?.publish, 'boolean', 'Publication request must contain a boolean publish flag')
  return request.publish
}
