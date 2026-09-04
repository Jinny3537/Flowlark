import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allowedMilestoneActions,
  groupFreezeBlockers,
  groupPlanOperations,
  isHighRiskAction,
  milestonePrimaryAction,
  milestoneStatusMeta,
  syncHealth
} from './milestoneSyncModel.js'

test('returns lifecycle actions for each state', () => {
  assert.deepEqual(allowedMilestoneActions({ status: 'frozen', ready: true }), ['start', 'unfreeze', 'cancel'])
  assert.deepEqual(allowedMilestoneActions({ status: 'active' }), ['end', 'cancel'])
  assert.deepEqual(allowedMilestoneActions({ status: 'archived' }), [])
  assert.deepEqual(milestonePrimaryAction({ status: 'reviewing' }), {
    key: 'freeze', label: '预览并冻结', planAction: 'freeze'
  })
  assert.equal(milestonePrimaryAction({ status: 'planning' }), null)
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
  assert.equal(isHighRiskAction('freeze'), true)
  assert.equal(isHighRiskAction('review'), false)
})

test('groups freeze blockers into repairable workflow categories', () => {
  const groups = groupFreezeBlockers([
    { code: 'REQUIREMENT_SPEC_REQUIRED', requirement: 'REQ-1', message: '缺需求规格', repairTo: '/requirements/REQ-1' },
    { code: 'SPEC_MISSING', project: 'orders', version: 'v1', message: '缺版本规格', repairTo: '/projects/orders/versions/v1' },
    { code: 'PROJECT_SYNC_TARGET_REQUIRED', project: 'orders', message: '缺项目目标', repairTo: '/projects/orders/sync' },
    { code: 'MILESTONE_SYNC_REQUIRED', message: '尚未验证同步', repairTo: '/sync' }
  ])
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.items.length]), [
    ['requirement', '需求完整性', 1],
    ['version', '版本交付', 1],
    ['project', '项目同步目标', 1],
    ['remote', '远端同步验证', 1]
  ])
  assert.equal(groups.every((group) => group.items.every((item) => item.repairTo)), true)
})
