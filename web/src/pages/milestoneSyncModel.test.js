import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allowedMilestoneActions,
  groupPlanOperations,
  isHighRiskAction,
  milestoneStatusMeta,
  syncHealth
} from './milestoneSyncModel.js'

test('returns lifecycle actions for each state', () => {
  assert.deepEqual(allowedMilestoneActions({ status: 'frozen', ready: true }), ['start', 'unfreeze', 'cancel'])
  assert.deepEqual(allowedMilestoneActions({ status: 'active' }), ['end', 'cancel'])
  assert.deepEqual(allowedMilestoneActions({ status: 'archived' }), [])
})

test('groups plan operations for a scannable confirmation', () => {
  const grouped = groupPlanOperations({ operations: [
    { kind: 'sprint.create' }, { kind: 'task.create' }, { kind: 'task.update' },
    { kind: 'task.move' }, { kind: 'conflict' }, { kind: 'sprint.start' }
  ] })
  assert.equal(grouped.create.length, 2)
  assert.equal(grouped.update.length, 1)
  assert.equal(grouped.move.length, 1)
  assert.equal(grouped.conflict.length, 1)
  assert.equal(grouped.lifecycle.length, 1)
})

test('sync health and lifecycle labels always include text', () => {
  assert.deepEqual(syncHealth({ journal: { status: 'failed' } }), { tone: 'error', label: '同步失败', detail: '可查看失败步骤并重试' })
  assert.equal(syncHealth({ external: null }).label, '未连接平台')
  assert.equal(milestoneStatusMeta('active').label, '进行中')
  assert.equal(isHighRiskAction('start'), true)
  assert.equal(isHighRiskAction('review'), false)
})
