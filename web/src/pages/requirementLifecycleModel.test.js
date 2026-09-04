import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROTOTYPE_PROGRESS_OPTIONS,
  REQUIREMENT_STATUS_OPTIONS,
  externalBindingMeta,
  prototypeProgressMeta,
  requirementPrimaryAction,
  requirementStatusMeta,
  writeActionGuard,
} from './requirementLifecycleModel.js'

test('provides text labels for all six requirement lifecycle states', () => {
  assert.deepEqual(REQUIREMENT_STATUS_OPTIONS.map((item) => item.value), [
    'draft', 'confirmed', 'developing', 'pending-acceptance', 'completed', 'archived',
  ])
  assert.deepEqual(REQUIREMENT_STATUS_OPTIONS.map((item) => item.label), [
    '草稿', '已确认', '开发中', '待验收', '已完成', '已归档',
  ])
  assert.equal(requirementStatusMeta('unexpected').label, 'unexpected')
})

test('keeps prototype progress mapped from legacy derived status', () => {
  assert.deepEqual(PROTOTYPE_PROGRESS_OPTIONS.map((item) => item.value), [
    'not_started', 'designing', 'finalized', 'delivered',
  ])
  assert.equal(prototypeProgressMeta('not_started').label, '未开始')
  assert.equal(prototypeProgressMeta('designing').label, '设计中')
  assert.equal(prototypeProgressMeta('finalized').label, '已定稿')
  assert.equal(prototypeProgressMeta('delivered').label, '已交付')
  assert.equal(prototypeProgressMeta('').label, '未开始')
})

test('exposes only the three v0.7.3 primary actions', () => {
  assert.deepEqual(requirementPrimaryAction({ status: 'draft' }), {
    key: 'confirm', label: '确认需求', targetStatus: 'confirmed', requiresWrite: true,
  })
  assert.deepEqual(requirementPrimaryAction({ status: 'confirmed' }), {
    key: 'join-milestone', label: '加入迭代', targetStatus: null, requiresWrite: true,
  })
  assert.deepEqual(requirementPrimaryAction({ status: 'developing' }), {
    key: 'view-milestone', label: '查看迭代', targetStatus: null, requiresWrite: false,
  })
  for (const status of ['pending-acceptance', 'completed', 'archived', 'unexpected']) {
    assert.equal(requirementPrimaryAction({ status }), null)
  }
})

test('summarizes external task binding and synchronization states', () => {
  assert.deepEqual(externalBindingMeta({ externalTasks: [] }), {
    state: 'unbound', tone: 'default', label: '未关联任务平台', detail: '', binding: null,
  })

  const binding = { taskId: 42, remoteStatus: '进行中', lastSyncHash: '', syncedAt: null }
  assert.deepEqual(externalBindingMeta({ externalTasks: [binding] }), {
    state: 'pending', tone: 'warning', label: '已关联，待同步', detail: '平台任务 #42 · 进行中', binding,
  })

  assert.equal(externalBindingMeta({ externalTasks: [{ ...binding, lastSyncHash: 'sha256:x', syncedAt: '2026-09-04T08:00:00Z' }] }).state, 'synced')
  assert.equal(externalBindingMeta({ externalTasks: [{ ...binding, driftState: 'conflict' }] }).state, 'drift')
  assert.equal(externalBindingMeta({ externalTasks: [{ ...binding, syncStatus: 'failed' }] }).state, 'failed')
})

test('read-only guard preserves inspection while disabling writes with a reason', () => {
  assert.deepEqual(writeActionGuard({ canWrite: true }), { allowed: true, disabled: false, reason: '' })
  assert.deepEqual(writeActionGuard({ canWrite: false, readonlyReason: 'Git 只读' }), {
    allowed: false, disabled: true, reason: 'Git 只读',
  })
  assert.equal(writeActionGuard({ canWrite: false }).reason, '当前为只读模式，只能查看需求信息。')
  assert.equal(writeActionGuard({ canWrite: true, blockers: [{ message: '请先补充验收标准' }] }).reason, '请先补充验收标准')
})
