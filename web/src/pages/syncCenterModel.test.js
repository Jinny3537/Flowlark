import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countSyncStatuses,
  filterSyncRecords,
  linkRequiredStep,
  syncEntityMeta,
  syncRecordBatchEligible,
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
  assert.equal(syncPrimaryAction({
    status: 'paused',
    operations: [{
      key: 'task:REQ-1:create', kind: 'task.create', status: 'paused',
      error: { code: 'MCP_SYNC_LINK_REQUIRED' }
    }]
  }), 'link')
})

test('labels milestone and binding entities with stable repair routes', () => {
  assert.deepEqual(syncEntityMeta({ entityType: 'requirement', entityKey: 'REQ-1' }), {
    label: '需求任务绑定', route: '/requirements/REQ-1'
  })
  assert.deepEqual(syncEntityMeta({ entityType: 'milestone-binding', entityKey: 'S 1' }), {
    label: '迭代 Sprint 绑定', route: '/milestones/S%201'
  })
  assert.equal(syncEntityMeta({ entityType: 'unknown', entityKey: 'x' }).label, '未知对象')
})

test('finds only exact link-required create steps and keeps high risk out of batch', () => {
  const record = {
    status: 'paused',
    operations: [
      { key: 'task:REQ-1:create', kind: 'task.create', status: 'paused', error: { code: 'MCP_SYNC_LINK_REQUIRED' } },
      { key: 'task:REQ-2:update', kind: 'task.update', status: 'failed', error: { code: 'REMOTE' } }
    ]
  }
  assert.equal(linkRequiredStep(record).key, 'task:REQ-1:create')
  assert.equal(linkRequiredStep({ status: 'paused', operations: [{ kind: 'task.create', status: 'failed' }] }), null)
  assert.equal(syncRecordBatchEligible({ status: 'pending-confirmation', plan: { operations: [{ kind: 'task.update', risk: 'normal' }] } }), true)
  assert.equal(syncRecordBatchEligible({ status: 'pending-confirmation', plan: { operations: [{ kind: 'task.move', risk: 'high' }] } }), false)
  assert.equal(syncRecordBatchEligible(record), false)
})

test('returns text labels in addition to colors', () => {
  assert.equal(syncStatusMeta('failed').label, '同步失败')
  assert.deepEqual(countSyncStatuses(records), { attention: 2, running: 0, completed: 1 })
})

test('uses neutral metadata and inspection-only action for unknown statuses', () => {
  assert.deepEqual(syncStatusMeta('invented'), { label: '未知状态', color: 'default' })
  assert.equal(syncPrimaryAction({ status: 'invented' }), 'open')
})
