import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkspaceResults, resultRoute } from './searchModel.js'

test('normalizes cross-workspace results', () => {
  assert.deepEqual(normalizeWorkspaceResults([{ type: 'requirement', code: 'REQ-1', title: '需求', workspaceName: 'A' }])[0], {
    type: 'requirement', code: 'REQ-1', title: '需求', workspaceName: 'A', objectType: 'requirement', fieldLabel: 'A'
  })
})

test('routes every supported result type', () => {
  assert.equal(resultRoute({ objectType: 'requirement', requirementCode: 'REQ 1' }), '/requirements/REQ%201')
  assert.equal(resultRoute({ objectType: 'milestone', milestoneName: 'S 1' }), '/milestones/S%201')
  assert.equal(resultRoute({ objectType: 'version', project: 'orders', versionNo: 'v1' }), '/projects/orders/versions/v1')
  assert.equal(resultRoute({ objectType: 'project', project: 'orders' }), '/projects/orders')
})

test('does not create routes with missing identifiers', () => {
  assert.equal(resultRoute({ objectType: 'requirement' }), '')
  assert.equal(resultRoute({ objectType: 'milestone' }), '')
  assert.equal(resultRoute({ objectType: 'version', project: 'orders' }), '/projects/orders')
  assert.equal(resultRoute({ objectType: 'version', versionNo: 'v1' }), '')
})
