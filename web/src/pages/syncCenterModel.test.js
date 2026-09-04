import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countSyncStatuses,
  filterSyncRecords,
  syncPrimaryAction,
  syncStatusMeta
} from './syncCenterModel.js'

const records = [
  { id: '1', status: 'failed', entityType: 'milestone', entityKey: 'S1', updatedAt: '2026-09-04T10:00:00Z' },
  { id: '2', status: 'pending-confirmation', entityType: 'milestone', entityKey: 'S2', updatedAt: '2026-09-04T11:00:00Z' },
  { id: '3', status: 'completed', entityType: 'milestone', entityKey: 'S3', updatedAt: '2026-09-03T11:00:00Z' }
]

test('sorts newest first and filters by state', () => {
  assert.deepEqual(filterSyncRecords(records, 'attention').map((item) => item.id), ['2', '1'])
})

test('keeps input order for equal timestamps without mutating records', () => {
  const sameTime = [
    { id: 'first', status: 'running', updatedAt: '2026-09-04T11:00:00Z' },
    { id: 'second', status: 'running', updatedAt: '2026-09-04T11:00:00Z' }
  ]

  assert.deepEqual(filterSyncRecords(sameTime, 'running').map((item) => item.id), ['first', 'second'])
  assert.deepEqual(sameTime.map((item) => item.id), ['first', 'second'])
})

test('maps only safe server-owned actions', () => {
  assert.equal(syncPrimaryAction(records[0]), 'retry')
  assert.equal(syncPrimaryAction(records[1]), 'execute')
  assert.equal(syncPrimaryAction(records[2]), 'open')
})

test('returns text labels in addition to colors', () => {
  assert.equal(syncStatusMeta('failed').label, '同步失败')
  assert.deepEqual(countSyncStatuses(records), { attention: 2, running: 0, completed: 1 })
})

test('uses neutral metadata and inspection-only action for unknown statuses', () => {
  assert.deepEqual(syncStatusMeta('invented'), { label: '未知状态', color: 'default' })
  assert.equal(syncPrimaryAction({ status: 'invented' }), 'open')
})
