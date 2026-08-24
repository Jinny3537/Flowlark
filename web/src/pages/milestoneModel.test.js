import test from 'node:test'
import assert from 'node:assert/strict'
import { milestoneItems, withoutMilestoneItem } from './milestoneModel.js'

const source = [
  { requirement: 'REQ-1', project: 'orders', version: 'v1', title: 'ignored' },
  { requirement: 'REQ-2', project: 'orders', versionNo: 'v2' }
]

test('keeps only persisted milestone item fields', () => {
  assert.deepEqual(milestoneItems(source), [
    { requirement: 'REQ-1', project: 'orders', version: 'v1' },
    { requirement: 'REQ-2', project: 'orders', version: 'v2' }
  ])
})

test('removes one exact scope item', () => {
  assert.deepEqual(withoutMilestoneItem(source, source[0]), [{ requirement: 'REQ-2', project: 'orders', version: 'v2' }])
})
