import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMilestoneSyncPlan, hashProjection } from '../src/core/milestone-sync-plan.js'

const baseMilestone = {
  name: 'S12',
  title: '订单迭代',
  goal: '完成订单联调',
  owner: 'pm',
  status: 'reviewing',
  startAt: '2026-08-01',
  endAt: '2026-08-21',
  items: [
    { requirement: 'REQ-1', project: 'orders', version: 'v1' },
    { requirement: 'REQ-1', project: 'marketing', version: 'v2' }
  ],
  external: null
}

const requirement = {
  code: 'REQ-1',
  title: '批量关闭订单',
  description: '支持批量关闭',
  priority: 'P1',
  owner: 'dev',
  dueDate: '2026-08-18',
  spec: '# 验收\n可以批量关闭',
  externalTasks: []
}

const mapping = {
  server: 'assess-task-local',
  projectId: 123,
  ownerId: 7,
  taskType: 2,
  priorities: { P1: 1 },
  members: { dev: 8 },
  timezoneOffset: '+08:00'
}

function context(overrides = {}) {
  return {
    milestone: structuredClone(baseMilestone),
    requirements: [structuredClone(requirement)],
    remoteSprint: null,
    remoteTasks: [],
    mapping: structuredClone(mapping),
    action: null,
    now: new Date('2026-08-28T00:00:00Z'),
    ...overrides
  }
}

test('deduplicates requirements and builds a stable create plan', () => {
  const first = buildMilestoneSyncPlan(context())
  const second = buildMilestoneSyncPlan(context())
  assert.equal(first.operations.filter((operation) => operation.kind === 'task.create').length, 1)
  assert.equal(first.summary.createTask, 1)
  assert.equal(first.summary.createSprint, 1)
  assert.match(first.hash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(first.hash, second.hash)
  assert.equal(first.blockers.length, 0)
})

test('blocks unknown priority and warns about missing member mapping', () => {
  const local = structuredClone(requirement)
  local.priority = 'P9'
  local.owner = 'missing-user'
  const result = buildMilestoneSyncPlan(context({ requirements: [local] }))
  assert.ok(result.blockers.some((item) => item.code === 'TASK_PRIORITY_UNMAPPED'))
  assert.ok(result.warnings.some((item) => item.code === 'TASK_ASSIGNEE_UNMAPPED'))
})

test('plans a task move without updating unchanged owned fields', () => {
  const initial = buildMilestoneSyncPlan(context())
  const sprintCreate = initial.operations.find((operation) => operation.kind === 'sprint.create')
  const taskCreate = initial.operations.find((operation) => operation.kind === 'task.create')
  const milestone = structuredClone(baseMilestone)
  milestone.external = { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10, lastSyncHash: sprintCreate.contentHash }
  const localRequirement = structuredClone(requirement)
  localRequirement.externalTasks = [{
    provider: 'assess-task', server: mapping.server, projectId: 123, taskId: 20,
    revision: 2, lastSyncHash: taskCreate.contentHash
  }]
  const result = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [localRequirement],
    remoteSprint: { id: 10, revision: 3, ...sprintCreate.after },
    remoteTasks: [{ id: 20, revision: 2, sprintId: 9, ...taskCreate.after }]
  }))
  assert.equal(result.operations.filter((operation) => operation.kind === 'task.update').length, 0)
  assert.equal(result.operations.filter((operation) => operation.kind === 'task.move').length, 1)
})

test('detects out-of-band drift and requires an explicit resolution', () => {
  const initial = buildMilestoneSyncPlan(context())
  const taskCreate = initial.operations.find((operation) => operation.kind === 'task.create')
  const milestone = structuredClone(baseMilestone)
  const localRequirement = structuredClone(requirement)
  localRequirement.externalTasks = [{
    provider: 'assess-task', server: mapping.server, projectId: 123, taskId: 20,
    revision: 2, lastSyncHash: taskCreate.contentHash
  }]
  const remote = { id: 20, revision: 3, sprintId: null, ...taskCreate.after, title: '平台人工改名' }
  assert.notEqual(hashProjection(remote, 'task'), taskCreate.contentHash)
  const result = buildMilestoneSyncPlan(context({ milestone, requirements: [localRequirement], remoteTasks: [remote] }))
  assert.ok(result.blockers.some((item) => item.code === 'REMOTE_DRIFT'))
  assert.ok(result.operations.some((operation) => operation.kind === 'conflict'))
})

test('adds high-risk lifecycle operations after synchronization work', () => {
  const milestone = structuredClone(baseMilestone)
  milestone.status = 'frozen'
  const result = buildMilestoneSyncPlan(context({ milestone, action: 'start' }))
  const operation = result.operations.at(-1)
  assert.equal(operation.kind, 'sprint.start')
  assert.equal(operation.risk, 'high')
})
