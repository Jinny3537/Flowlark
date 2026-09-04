import assert from 'node:assert/strict'
import test from 'node:test'
import { presentSyncOperation, syncOperationDiff } from './syncOperationModel.js'

test('describes Sprint and task creation with readable targets', () => {
  assert.deepEqual(presentSyncOperation({
    kind: 'sprint.create',
    after: { projectId: 123, sprintName: '九月迭代' }
  }), {
    kind: 'sprint.create',
    title: '创建平台冲刺',
    subject: '九月迭代',
    summary: '在平台项目 123 中创建冲刺「九月迭代」',
    tone: 'processing',
    highRisk: false,
    recovery: null
  })

  assert.equal(presentSyncOperation({
    kind: 'task.create',
    requirement: 'REQ-12',
    after: { title: '[REQ-12] 支持批量处理' }
  }).summary, '为需求 REQ-12 创建平台任务「[REQ-12] 支持批量处理」')
  assert.deepEqual(syncOperationDiff({ kind: 'task.create', after: { title: '新任务' } }).sections, [
    { label: '将创建', value: { title: '新任务' }, present: true, emptyText: '无目标值' }
  ])
})

test('summarizes only changed managed fields for updates', () => {
  const operation = {
    kind: 'task.update',
    requirement: 'REQ-8',
    before: { title: '旧标题', descriptionDoc: '说明', priority: 1 },
    after: { title: '新标题', descriptionDoc: '说明', priority: 2 }
  }

  assert.equal(presentSyncOperation(operation).summary, '同步 2 个托管字段：标题、优先级')
  assert.deepEqual(syncOperationDiff(operation).changes, [
    { field: 'title', label: '标题', before: '旧标题', after: '新标题' },
    { field: 'priority', label: '优先级', before: 1, after: 2 }
  ])

  assert.equal(presentSyncOperation({
    kind: 'sprint.update',
    before: { sprintName: '旧冲刺', sprintGoal: '目标' },
    after: { sprintName: '新冲刺', sprintGoal: '目标' }
  }).summary, '同步 1 个托管字段：冲刺名称')
})

test('describes task moves as non-deleting membership changes', () => {
  const moveIn = presentSyncOperation({
    kind: 'task.move', taskId: 20,
    before: { sprintId: null }, after: { sprintId: 10 }
  })
  assert.equal(moveIn.title, '移入冲刺')
  assert.equal(moveIn.summary, '将平台任务 20 移入冲刺 10，不删除平台任务')

  const moveOut = presentSyncOperation({
    kind: 'task.move', taskId: 20,
    before: { sprintId: 10 }, after: { sprintId: null }, risk: 'high'
  })
  assert.equal(moveOut.title, '移出冲刺')
  assert.equal(moveOut.summary, '将平台任务 20 移出当前冲刺，不删除平台任务')
  assert.equal(moveOut.highRisk, true)
  assert.equal(syncOperationDiff({
    kind: 'task.move', before: { sprintId: 10 }, after: { sprintId: null }
  }).summary, '冲刺归属变化；平台任务会保留')
})

test('makes restore-local conflict semantics explicit and high risk', () => {
  const conflict = {
    kind: 'conflict', key: 'task:20:conflict', requirement: 'REQ-2', risk: 'high',
    before: { title: '平台修改' }, after: { title: 'Flowlark 标题' }
  }
  const presented = presentSyncOperation(conflict)
  assert.equal(presented.title, '远端修改冲突')
  assert.equal(presented.summary, '远端值已变化；确认“保留 Flowlark”后才会覆盖托管字段')
  assert.equal(presented.highRisk, true)
  assert.equal(presented.recovery, 'restore-local')
  assert.equal(syncOperationDiff(conflict).summary, '平台当前值 → Flowlark 权威值')

  const restore = presentSyncOperation({
    kind: 'task.update', risk: 'high', requirement: 'REQ-2',
    before: { title: '平台修改' }, after: { title: 'Flowlark 标题' }
  })
  assert.equal(restore.summary, '使用 Flowlark 值覆盖 1 个远端托管字段：标题')
  assert.equal(restore.recovery, 'restore-local')
})

test('describes verified freeze as a local operation after remote work', () => {
  const presented = presentSyncOperation({
    kind: 'milestone.freeze', milestone: 'S10', risk: 'high',
    before: { status: 'reviewing' }, after: { status: 'frozen' }
  })
  assert.equal(presented.title, '冻结本地迭代')
  assert.equal(presented.summary, '远端范围验证完成后冻结迭代 S10')
  assert.equal(presented.highRisk, true)
  assert.equal(presentSyncOperation({
    key: 'milestone:S11:freeze', kind: 'milestone.freeze', risk: 'high'
  }).summary, '远端范围验证完成后冻结迭代 S11')
})

test('prioritizes link-required recovery over the underlying create operation', () => {
  const presented = presentSyncOperation({
    status: 'paused',
    error: {
      code: 'MCP_SYNC_LINK_REQUIRED',
      message: '冲刺创建结果不明确，请先关联远端对象'
    },
    operation: { kind: 'sprint.create', after: { sprintName: 'S11' } }
  })
  assert.equal(presented.title, '需要关联远端对象')
  assert.equal(presented.summary, '冲刺创建结果不明确，请先关联远端对象')
  assert.equal(presented.tone, 'warning')
  assert.equal(presented.recovery, 'link-required')
  assert.deepEqual(syncOperationDiff({
    error: { code: 'MCP_SYNC_LINK_REQUIRED' },
    operation: { kind: 'task.create', after: { title: '可能已创建' } }
  }), { summary: '创建结果不明确，需先关联已创建的远端对象', sections: [], changes: [] })
})

test('uses neutral inspection-only semantics for unknown operations', () => {
  assert.deepEqual(presentSyncOperation({
    kind: 'admin.delete-everything', risk: 'high',
    before: { value: 'a' }, after: { value: 'b' }
  }), {
    kind: 'admin.delete-everything',
    title: '未知同步操作',
    subject: '同步对象',
    summary: '无法识别该操作；请仅查看详情并核对服务端计划',
    tone: 'default',
    highRisk: true,
    recovery: 'inspect'
  })
  assert.equal(syncOperationDiff({ kind: 'admin.delete-everything', before: 1, after: 2 }).summary, '未知操作，字段仅供核对')
})
