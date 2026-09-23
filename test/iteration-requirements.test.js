import assert from 'node:assert/strict'
import test from 'node:test'
import { readMilestoneSyncJournal } from '../src/core/milestone-sync-journal.js'
import { newHub, cleanup } from './helpers.js'
import * as milestones from '../src/core/milestones.js'
import { buildMilestoneSyncPlan } from '../src/core/milestone-sync-plan.js'
import { executeMilestoneSync, resumeMilestoneSync } from '../src/core/milestone-sync.js'

function setup(t) {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.createRequirement({ code: 'A', title: '无需原型的需求', project: '甲' })
  hub.createRequirement({ code: 'B', title: '另一项目', project: '乙' })
  const input = { name: 'IT-1', project: '甲', versionNo: 'v1-S1', title: '首轮交付', goal: '完成需求', startAt: '2026-09-14', endAt: '2026-09-25', requirements: ['A'], items: [] }
  return { root, hub, input }
}
const mapping = { server: 'test', projectId: 1, ownerId: 8, taskType: 2 }

test('direct requirements persist without prototypes and generate sprint tasks', t => {
  const { root, hub, input } = setup(t)
  const item = hub.createMilestone(input)
  assert.deepEqual(item.requirements, ['A']); assert.deepEqual(item.items, [])
  const plan = buildMilestoneSyncPlan({ milestone: item, requirements: [hub.getRequirement('A')], mapping })
  assert.equal(plan.blockers.length, 0)
  assert.equal(plan.summary.createSprint, 1); assert.equal(plan.summary.createTask, 1)
  assert.equal(plan.operations[0].after.sprintName, 'v1-S1 · 首轮交付')
  assert.deepEqual(milestones.readMilestone(root, item.name).requirements, ['A'])
})

test('rejects cross-project scope, duplicate versions, occupied requirements and reversed dates', t => {
  const { hub, input } = setup(t)
  assert.throws(() => hub.createMilestone({ ...input, requirements: ['B'] }), { code: 'MILESTONE_REQUIREMENT_PROJECT' })
  assert.throws(() => hub.createMilestone({ ...input, endAt: '2026-09-01' }), { code: 'MILESTONE_DATES_INVALID' })
  hub.createMilestone(input)
  assert.throws(() => hub.createMilestone({ ...input, name: 'IT-2' }), { code: 'MILESTONE_VERSION_EXISTS' })
  assert.throws(() => hub.createMilestone({ ...input, name: 'IT-2', versionNo: 'v1-S2' }), { code: 'MILESTONE_REQUIREMENT_OCCUPIED' })
  assert.throws(() => hub.updateMilestone(input.name, { requirements: ['B'] }), { code: 'MILESTONE_REQUIREMENT_PROJECT' })
  assert.throws(() => hub.updateMilestone(input.name, { project: '乙' }), { code: 'MILESTONE_PROJECT_LOCKED' })
})

test('empty draft is saved but cannot create a sprint', t => {
  const { hub, input } = setup(t)
  const item = hub.createMilestone({ ...input, requirements: [] })
  assert.equal(item.ready, false)
  const plan = buildMilestoneSyncPlan({ milestone: item, mapping })
  assert.ok(plan.blockers.some(b => b.code === 'MILESTONE_SCOPE_EMPTY'))
})

test('existing unassigned task moves to the newly created sprint; occupied task blocks', t => {
  const { hub, input } = setup(t)
  const item = hub.createMilestone(input)
  const requirement = { code: 'A', title: '无需原型的需求', externalTasks: [{ provider: 'assess-task', server: 'test', projectId: 1, taskId: 20 }] }
  const args = { milestone: item, requirements: [requirement], mapping, remoteTasks: [{ id: 20, sprintId: null }], resolutions: { 'task:20': 'restore-local' } }
  const plan = buildMilestoneSyncPlan(args)
  assert.equal(plan.operations.find(op => op.kind === 'task.move').after.sprintId, '$sprint')
  const blocked = buildMilestoneSyncPlan({ ...args, remoteTasks: [{ id: 20, sprintId: 99 }] })
  assert.ok(blocked.blockers.some(b => b.code === 'TASK_SPRINT_OCCUPIED'))
})

test('confirmed new iteration creates one sprint and one task; repeat execution does not duplicate', async t => {
  const { root, hub, input } = setup(t)
  const item = hub.createMilestone(input)
  const plan = buildMilestoneSyncPlan({ milestone: item, requirements: [hub.getRequirement('A')], mapping })
  let sprint, task, creates = 0
  const adapter = {
    saveSprint: async body => { creates++; return sprint = { ...body, id: 10 } },
    createTask: async body => { creates++; return task = { ...body, id: 20 } },
    getSprint: async () => sprint,
    getTask: async () => task,
  }
  const args = { root, milestoneName: item.name, plan, confirmed: true, adapter }
  await executeMilestoneSync(args); await executeMilestoneSync(args)
  assert.equal(creates, 2); assert.equal(task.currentSprintId, 10)
  assert.equal(milestones.readMilestone(root, item.name).external.sprintId, 10)
  hub.updateMilestone(item.name, { goal: '调整目标' })
  assert.equal(readMilestoneSyncJournal(root, item.name).status, 'stale')
  await assert.rejects(resumeMilestoneSync(args), { code: 'MCP_SYNC_PLAN_CHANGED' })
})

test('active direct requirement scope is applied only after confirmed synchronization', async t => {
  const { root, hub, input } = setup(t)
  hub.createRequirement({ code: 'C', title: '新增范围', project: '甲' })
  hub.createMilestone(input)
  milestones.updateMilestone(root, input.name, { status: 'active' }, { system: true })
  const item = { ...milestones.readMilestone(root, input.name), requirements: ['A', 'C'] }
  const plan = buildMilestoneSyncPlan({ milestone: item, requirements: [hub.getRequirement('A'), hub.getRequirement('C')], mapping, scopeRequirements: ['A', 'C'], scopeChangeReason: '补充需求' })
  assert.deepEqual(milestones.readMilestone(root, item.name).requirements, ['A'])
  let sprint; const tasks = new Map()
  const adapter = {
    saveSprint: async body => sprint = { ...body, id: 10 }, getSprint: async () => sprint,
    createTask: async body => { const task = { ...body, id: 20 + tasks.size }; tasks.set(task.id, task); return task },
    getTask: async id => tasks.get(id),
  }
  await executeMilestoneSync({ root, milestoneName: item.name, plan, adapter, confirmed: true, reason: '补充需求', confirmUnfinished: true })
  assert.deepEqual(milestones.readMilestone(root, item.name).requirements, ['A', 'C'])
  assert.equal(tasks.size, 2)
})
