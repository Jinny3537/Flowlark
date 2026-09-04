import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMilestoneSourceHash, buildMilestoneSyncPlan, hashProjection, linkedMilestoneSourceHash } from '../src/core/milestone-sync-plan.js'

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

test('detects out-of-band drift and only restore-local resolves it as high risk', () => {
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

  const resolved = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [localRequirement],
    remoteTasks: [remote],
    resolutions: { 'task:20': 'accept-remote' }
  }))
  assert.ok(resolved.blockers.some((item) => item.code === 'REMOTE_DRIFT'))
  assert.equal(resolved.operations.some((operation) => operation.kind === 'local.accept-remote'), false)

  const restored = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [localRequirement],
    remoteTasks: [remote],
    resolutions: { 'task:20': 'restore-local' }
  }))
  assert.equal(restored.blockers.some((item) => item.code === 'REMOTE_DRIFT'), false)
  assert.equal(restored.operations.find((operation) => operation.kind === 'task.update').risk, 'high')
})

test('adds high-risk lifecycle operations after synchronization work', () => {
  const milestone = structuredClone(baseMilestone)
  milestone.status = 'frozen'
  const result = buildMilestoneSyncPlan(context({ milestone, action: 'start' }))
  const operation = result.operations.at(-1)
  assert.equal(operation.kind, 'sprint.start')
  assert.equal(operation.risk, 'high')
})

test('moves a previously managed task out when it leaves local scope', () => {
  const milestone = structuredClone(baseMilestone)
  milestone.external = { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10 }
  const result = buildMilestoneSyncPlan(context({
    milestone,
    remoteSprint: { id: 10, projectId: 123, ownerId: 7, sprintName: '订单迭代', sprintGoal: '完成订单联调', planStartDate: '2026-08-01T00:00:00+08:00', planEndDate: '2026-08-21T00:00:00+08:00' },
    remoteTasks: [{ id: 99, revision: 3, sprintId: 10 }],
    managedTaskBindings: [{ requirement: 'REQ-OLD', taskId: 99 }]
  }))
  const move = result.operations.find((operation) => operation.key === 'task:99:move-out')
  assert.equal(move.kind, 'task.move')
  assert.equal(move.after.sprintId, null)
  assert.equal(move.risk, 'high')
})

test('plan hash covers authority, normalized managed fields, lifecycle status and remote observations', () => {
  const options = {
    ...context(),
    managedFields: ['title', 'status'],
    mapping: { ...mapping, statuses: { draft: 0, confirmed: 1 } }
  }
  const base = buildMilestoneSyncPlan(options)
  assert.equal(base.hash, buildMilestoneSyncPlan({ ...options, managedFields: ['status', 'title', 'title'] }).hash)
  assert.notEqual(base.hash, buildMilestoneSyncPlan({ ...options, mapping: { ...options.mapping, server: 'other-server' } }).hash)
  assert.notEqual(base.hash, buildMilestoneSyncPlan({ ...options, mapping: { ...options.mapping, projectId: 456 } }).hash)
  assert.notEqual(base.hash, buildMilestoneSyncPlan({ ...options, managedFields: ['title'] }).hash)
  assert.notEqual(base.hash, buildMilestoneSyncPlan({
    ...options,
    requirements: [{ ...requirement, status: 'confirmed' }]
  }).hash)

  const sprintCreate = base.operations.find((operation) => operation.kind === 'sprint.create')
  const taskCreate = base.operations.find((operation) => operation.kind === 'task.create')
  const boundMilestone = {
    ...structuredClone(baseMilestone),
    external: {
      provider: 'assess-task', server: mapping.server, projectId: 123,
      sprintId: 10, lastSyncHash: sprintCreate.contentHash
    }
  }
  const observed = {
    ...options,
    milestone: boundMilestone,
    requirements: [{
      ...requirement,
      externalTasks: [{
        provider: 'assess-task', server: mapping.server, projectId: 123,
        taskId: 20, lastSyncHash: taskCreate.contentHash
      }]
    }],
    remoteSprint: { id: 10, revision: 3, status: 'planned', ...sprintCreate.after },
    remoteTasks: [{ id: 20, revision: 5, status: 0, sprintId: 10, ...taskCreate.after }]
  }
  const first = buildMilestoneSyncPlan(observed)
  assert.notEqual(first.hash, buildMilestoneSyncPlan({
    ...observed,
    remoteSprint: { ...observed.remoteSprint, revision: 4 }
  }).hash)
  assert.notEqual(first.hash, buildMilestoneSyncPlan({
    ...observed,
    remoteSprint: { ...observed.remoteSprint, status: 'active' }
  }).hash)
  assert.notEqual(first.hash, buildMilestoneSyncPlan({
    ...observed,
    remoteTasks: [{ ...observed.remoteTasks[0], revision: 6 }]
  }).hash)
  assert.notEqual(first.hash, buildMilestoneSyncPlan({
    ...observed,
    remoteTasks: [{ ...observed.remoteTasks[0], status: 9 }]
  }).hash)
})

test('existing task and sprint compare only managed fields and update with managed patches', () => {
  const initial = buildMilestoneSyncPlan(context({ managedFields: ['title'] }))
  const sprintCreate = initial.operations.find((operation) => operation.kind === 'sprint.create')
  const taskCreate = initial.operations.find((operation) => operation.kind === 'task.create')
  const milestone = {
    ...structuredClone(baseMilestone),
    external: {
      provider: 'assess-task', server: mapping.server, projectId: 123,
      sprintId: 10, lastSyncHash: sprintCreate.contentHash
    }
  }
  const localRequirement = {
    ...structuredClone(requirement),
    externalTasks: [{
      provider: 'assess-task', server: mapping.server, projectId: 123,
      taskId: 20, revision: 2, lastSyncHash: taskCreate.contentHash
    }]
  }
  const remoteSprint = {
    id: 10, revision: 3, ...sprintCreate.after,
    sprintGoal: '平台保留目标', ownerId: 999
  }
  const remoteTask = {
    id: 20, revision: 2, sprintId: 10, ...taskCreate.after,
    descriptionDoc: '平台保留说明', acceptanceDoc: '平台保留验收', priority: 9,
    assigneeId: 999, status: 8
  }
  const unchanged = buildMilestoneSyncPlan(context({
    milestone, requirements: [localRequirement], remoteSprint, remoteTasks: [remoteTask], managedFields: ['title']
  }))
  assert.equal(unchanged.operations.some((operation) => operation.kind.endsWith('.update')), false)

  const changed = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [{ ...localRequirement, title: '本地新标题' }],
    remoteSprint: { ...remoteSprint, sprintName: '平台改名' },
    remoteTasks: [remoteTask],
    managedFields: ['title'],
    resolutions: { 'sprint:10': 'restore-local' }
  }))
  assert.deepEqual(changed.operations.find((operation) => operation.kind === 'sprint.update').after, {
    sprintName: '订单迭代',
    planStartDate: '2026-08-01T00:00:00+08:00',
    planEndDate: '2026-08-21T00:00:00+08:00'
  })
  assert.deepEqual(changed.operations.find((operation) => operation.kind === 'task.update').after, {
    title: '[REQ-1] 本地新标题',
    planStartDate: '2026-08-01T00:00:00+08:00',
    planEndDate: '2026-08-18T00:00:00+08:00'
  })
})

test('schedule fields always participate in hashes, drift, and update patches', () => {
  const initial = buildMilestoneSyncPlan(context({ managedFields: [] }))
  const sprintCreate = initial.operations.find((operation) => operation.kind === 'sprint.create')
  const taskCreate = initial.operations.find((operation) => operation.kind === 'task.create')
  assert.notEqual(
    hashProjection(taskCreate.after, 'task', []),
    hashProjection({ ...taskCreate.after, planEndDate: '2026-08-19T00:00:00+08:00' }, 'task', [])
  )

  const milestone = {
    ...structuredClone(baseMilestone),
    external: {
      provider: 'assess-task', server: mapping.server, projectId: 123,
      sprintId: 10, lastSyncHash: sprintCreate.contentHash
    }
  }
  const localRequirement = {
    ...structuredClone(requirement),
    externalTasks: [{
      provider: 'assess-task', server: mapping.server, projectId: 123,
      taskId: 20, revision: 2, lastSyncHash: taskCreate.contentHash
    }]
  }
  const changed = buildMilestoneSyncPlan(context({
    milestone: { ...milestone, startAt: '2026-08-02', endAt: '2026-08-22' },
    requirements: [{ ...localRequirement, dueDate: '2026-08-20' }],
    remoteSprint: { id: 10, revision: 3, ...sprintCreate.after },
    remoteTasks: [{ id: 20, revision: 2, sprintId: 10, ...taskCreate.after }],
    managedFields: []
  }))
  assert.deepEqual(changed.operations.find((operation) => operation.kind === 'sprint.update').after, {
    planStartDate: '2026-08-02T00:00:00+08:00',
    planEndDate: '2026-08-22T00:00:00+08:00'
  })
  assert.deepEqual(changed.operations.find((operation) => operation.kind === 'task.update').after, {
    planStartDate: '2026-08-02T00:00:00+08:00',
    planEndDate: '2026-08-20T00:00:00+08:00'
  })

  const remoteDrift = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [localRequirement],
    remoteSprint: { id: 10, revision: 4, ...sprintCreate.after, planEndDate: '2026-09-01T00:00:00+08:00' },
    remoteTasks: [{ id: 20, revision: 3, sprintId: 10, ...taskCreate.after, planEndDate: '2026-09-01T00:00:00+08:00' }],
    managedFields: []
  }))
  assert.equal(remoteDrift.blockers.filter((item) => item.code === 'REMOTE_DRIFT').length, 2)
})

test('maps status explicitly, blocks missing mappings, and keeps delivery warning-only', () => {
  const local = { ...structuredClone(requirement), status: 'confirmed', dueDate: '2026-09-30' }
  const blocked = buildMilestoneSyncPlan(context({
    requirements: [local], managedFields: ['status', 'delivery']
  }))
  assert.ok(blocked.blockers.some((item) => item.code === 'TASK_STATUS_UNMAPPED'))
  assert.ok(blocked.warnings.some((item) => item.code === 'DELIVERY_SYNC_UNSUPPORTED'))

  const mapped = buildMilestoneSyncPlan(context({
    requirements: [local],
    managedFields: ['delivery', 'status'],
    mapping: { ...mapping, statuses: { confirmed: 4 } }
  }))
  const create = mapped.operations.find((operation) => operation.kind === 'task.create')
  assert.equal(create.after.status, 4)
  assert.equal(create.after.planEndDate, '2026-09-30T00:00:00+08:00')
  assert.ok(mapped.warnings.some((item) => item.code === 'DELIVERY_SYNC_UNSUPPORTED'))
})

test('create bodies stay complete while sprint ownership follows managed field mappings', () => {
  const result = buildMilestoneSyncPlan(context({
    managedFields: ['assignee', 'description', 'title'],
    mapping: { ...mapping, members: { ...mapping.members, pm: 11 } }
  }))
  const sprint = result.operations.find((operation) => operation.kind === 'sprint.create').after
  const task = result.operations.find((operation) => operation.kind === 'task.create').after
  assert.deepEqual(sprint, {
    projectId: 123,
    ownerId: 11,
    sprintName: '订单迭代',
    sprintGoal: '完成订单联调',
    planStartDate: '2026-08-01T00:00:00+08:00',
    planEndDate: '2026-08-21T00:00:00+08:00'
  })
  assert.deepEqual(Object.keys(task).sort(), [
    'acceptanceDoc', 'assigneeId', 'currentSprintId', 'descriptionDoc', 'planEndDate',
    'planStartDate', 'priority', 'projectId', 'taskType', 'title'
  ])
})

test('source hash is deterministic and covers only local milestone authority', () => {
  const localRequirement = {
    ...structuredClone(requirement),
    status: 'confirmed',
    externalTasks: [{ provider: 'assess-task', server: mapping.server, projectId: 123, taskId: 20 }]
  }
  const milestone = {
    ...structuredClone(baseMilestone),
    external: { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10 }
  }
  const versionSources = [{
    project: 'orders', version: 'v1', versionStatus: 'READY', reviewStatus: 'confirmed',
    currentBaseline: 'v1', spec: '# 版本规格'
  }, {
    project: 'marketing', version: 'v2', versionStatus: 'READY', reviewStatus: 'confirmed',
    currentBaseline: 'v2', spec: '# 营销规格'
  }]
  const input = { milestone, requirements: [localRequirement], mapping, managedFields: ['title', 'sprint'], versionSources }
  const first = buildMilestoneSourceHash(input)
  assert.equal(first, buildMilestoneSourceHash({
    ...input,
    milestone: { ...milestone, items: [...milestone.items].reverse() },
    managedFields: ['sprint', 'title', 'title']
  }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, milestone: { ...milestone, goal: '新目标' } }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, requirements: [{ ...localRequirement, status: 'developing' }] }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, requirements: [{ ...localRequirement, spec: '# 新规格' }] }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, mapping: { ...mapping, projectId: 456 } }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, mapping: { ...mapping, ownerId: 99 } }))
  assert.notEqual(first, buildMilestoneSourceHash({ ...input, managedFields: ['title'] }))
  assert.notEqual(first, buildMilestoneSourceHash({
    ...input,
    versionSources: [{ ...versionSources[0], reviewStatus: 'pending' }, versionSources[1]]
  }))
  assert.notEqual(first, buildMilestoneSourceHash({
    ...input,
    versionSources: [{ ...versionSources[0], spec: '# 已修改版本规格' }, versionSources[1]]
  }))
  assert.notEqual(first, buildMilestoneSourceHash({
    ...input,
    versionSources: [{ ...versionSources[0], currentBaseline: 'v0' }, versionSources[1]]
  }))
  assert.notEqual(first, buildMilestoneSourceHash({
    ...input,
    milestone: { ...milestone, external: { ...milestone.external, sprintId: 11 } }
  }))
})

test('freeze is a final high-risk local operation and requires stable bindings', () => {
  const missing = buildMilestoneSyncPlan(context({ action: 'freeze' }))
  assert.ok(missing.blockers.some((entry) => entry.code === 'MILESTONE_SPRINT_BINDING_REQUIRED'))
  assert.ok(missing.blockers.some((entry) => entry.code === 'REQUIREMENT_TASK_BINDING_REQUIRED'))

  const initial = buildMilestoneSyncPlan(context())
  const sprintCreate = initial.operations.find((operation) => operation.kind === 'sprint.create')
  const taskCreate = initial.operations.find((operation) => operation.kind === 'task.create')
  const milestone = {
    ...structuredClone(baseMilestone),
    external: { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10, lastSyncHash: sprintCreate.contentHash }
  }
  const localRequirement = {
    ...structuredClone(requirement), status: 'confirmed',
    externalTasks: [{ provider: 'assess-task', server: mapping.server, projectId: 123, taskId: 20, lastSyncHash: taskCreate.contentHash }]
  }
  const plan = buildMilestoneSyncPlan(context({
    milestone,
    requirements: [localRequirement],
    remoteSprint: { id: 10, revision: 2, status: 0, ...sprintCreate.after },
    remoteTasks: [{ id: 20, revision: 2, status: 0, sprintId: 10, ...taskCreate.after }],
    action: 'freeze'
  }))
  const freeze = plan.operations.at(-1)
  assert.equal(freeze.kind, 'milestone.freeze')
  assert.equal(freeze.risk, 'high')
  assert.equal(freeze.after.scopeHash, plan.sourceHash)
  assert.deepEqual(freeze.dependsOn, plan.operations.slice(0, -1).filter((operation) => operation.kind !== 'conflict').map((operation) => operation.key))
  assert.deepEqual(plan.verification.tasks.map((entry) => entry.requirement), ['REQ-1'])
})

test('linked create source validation permits only the verified binding delta', () => {
  const plan = buildMilestoneSyncPlan(context())
  const linkedSteps = plan.operations.map((operation) => ({
    key: operation.key,
    kind: operation.kind,
    operation,
    status: 'remote-complete',
    remoteResult: { id: operation.kind === 'sprint.create' ? 10 : 20 }
  }))
  const milestone = {
    ...structuredClone(baseMilestone),
    external: { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10 }
  }
  const linkedRequirement = {
    ...structuredClone(requirement),
    externalTasks: [{ provider: 'assess-task', server: mapping.server, projectId: 123, taskId: 20 }]
  }
  const current = buildMilestoneSourceHash({ milestone, requirements: [linkedRequirement], mapping })
  assert.equal(linkedMilestoneSourceHash(plan, linkedSteps), current)
  assert.notEqual(linkedMilestoneSourceHash(plan, linkedSteps), buildMilestoneSourceHash({
    milestone,
    requirements: [{ ...linkedRequirement, title: '预览后被修改' }],
    mapping
  }))
})
