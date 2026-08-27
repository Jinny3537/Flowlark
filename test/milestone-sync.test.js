import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import { buildMilestoneSyncPlan } from '../src/core/milestone-sync-plan.js'
import { executeMilestoneSync, resumeMilestoneSync } from '../src/core/milestone-sync.js'
import { readMilestoneSyncJournal } from '../src/core/milestone-sync-journal.js'
import * as milestones from '../src/core/milestones.js'
import * as requirements from '../src/core/requirements.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture({ action = null } = {}) {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-1', title: '需求一', description: '说明', priority: 'P1', owner: 'dev' })
  hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-1'] })
  hub.createMilestone({
    name: 'S1', title: '迭代一', goal: '完成联调', owner: 'pm',
    startAt: '2026-08-01', endAt: '2026-08-21',
    items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  })
  if (action === 'start') milestones.updateMilestone(root, 'S1', { status: 'frozen' }, { system: true })
  const milestone = milestones.inspectMilestone(root, 'S1')
  const requirement = { ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }
  const mapping = {
    server: 'assess-task-local', projectId: 123, ownerId: 7, taskType: 2,
    priorities: { P1: 1 }, members: { dev: 8 }, timezoneOffset: '+08:00'
  }
  const plan = buildMilestoneSyncPlan({
    milestone, requirements: [requirement], mapping, action
  })
  return { root, plan, mapping }
}

function adapter({ failTaskOnce = false } = {}) {
  const calls = []
  let taskFailed = false
  const state = {
    sprint: { id: 10, projectId: 123, sprintName: '迭代一', sprintGoal: '完成联调', ownerId: 7, planStartDate: '2026-08-01T00:00:00+08:00', planEndDate: '2026-08-21T00:00:00+08:00', revision: 1, status: 0 },
    task: null
  }
  return {
    calls,
    state,
    async saveSprint(body) {
      calls.push(['saveSprint', body])
      state.sprint = { ...state.sprint, ...body, id: body.id || 10, revision: Number(body.revision || 0) + 1 }
      return state.sprint
    },
    async getSprint() {
      calls.push(['getSprint'])
      return state.sprint
    },
    async createTask(body) {
      calls.push(['createTask', body])
      if (failTaskOnce && !taskFailed) {
        taskFailed = true
        throw Object.assign(new Error('temporary task failure'), { code: 'MCP_UNAVAILABLE' })
      }
      state.task = { ...body, id: 20, revision: 1, sprintId: body.currentSprintId, status: 0 }
      return state.task
    },
    async updateTask(body) {
      calls.push(['updateTask', body])
      state.task = { ...state.task, ...body, revision: Number(body.revision || 0) + 1 }
      return state.task
    },
    async getTask() {
      calls.push(['getTask'])
      return state.task
    },
    async moveTasks(body) {
      calls.push(['moveTasks', body])
      state.task.sprintId = body.toSprintId
      state.task.revision++
      return { ok: true }
    },
    async startSprint(body) {
      calls.push(['startSprint', body])
      state.sprint.status = 'active'
      state.sprint.revision++
      return state.sprint
    },
    async endSprint(body) {
      calls.push(['endSprint', body])
      state.sprint.status = 'ended'
      state.sprint.revision++
      return state.sprint
    },
    async cancelSprint(body) {
      calls.push(['cancelSprint', body])
      state.sprint.status = 'canceled'
      state.sprint.revision++
      return state.sprint
    }
  }
}

test('requires confirmation before any remote mutation', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: false, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_CONFIRMATION_REQUIRED'
  )
  assert.equal(remote.calls.length, 0)
})

test('persists external ids after each create and completes the journal', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  const result = await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(milestones.readMilestone(root, 'S1').external.sprintId, 10)
  assert.equal(requirements.readRequirement(root, 'REQ-1').externalTasks[0].taskId, 20)
  assert.equal(readMilestoneSyncJournal(root, 'S1').status, 'completed')
})

test('resumes failed work without recreating the completed sprint', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failTaskOnce: true })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    /temporary task failure/
  )
  assert.equal(readMilestoneSyncJournal(root, 'S1').status, 'failed')
  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 2)
})

test('starts a sprint with a fresh revision and transitions local state only after verification', async () => {
  const { root, plan } = fixture({ action: 'start' })
  const remote = adapter()
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan, confirmed: true, reason: '开始执行', adapter: remote
  })
  const call = remote.calls.find(([name]) => name === 'startSprint')
  assert.equal(call[1].sprintId, 10)
  assert.equal(typeof call[1].revision, 'number')
  assert.equal(milestones.readMilestone(root, 'S1').status, 'active')
})

test('refreshes the remote revision before updating a sprint', async () => {
  const { root, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  milestones.updateMilestone(root, 'S1', { goal: '调整后的目标' })
  const nextPlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping
  })
  await executeMilestoneSync({ root, milestoneName: 'S1', plan: nextPlan, confirmed: true, adapter: remote })
  const saves = remote.calls.filter(([name]) => name === 'saveSprint')
  assert.equal(saves.length, 2)
  assert.equal(saves[1][1].id, 10)
  assert.equal(saves[1][1].revision, 1)
})

test('accepts a reviewed remote task value as an explicit local edit', async () => {
  const { root, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  remote.state.task.title = '[REQ-1] 平台调整标题'
  remote.state.task.descriptionDoc = '平台调整说明'
  remote.state.task.revision++
  const nextPlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping,
    resolutions: { 'task:20': 'accept-remote' }
  })
  assert.ok(nextPlan.operations.some((operation) => operation.kind === 'local.accept-remote'))
  await executeMilestoneSync({ root, milestoneName: 'S1', plan: nextPlan, confirmed: true, adapter: remote })
  const local = requirements.readRequirement(root, 'REQ-1')
  assert.equal(local.title, '平台调整标题')
  assert.equal(local.description, '平台调整说明')
})

test('rejects expired plans before creating a journal', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  await assert.rejects(
    executeMilestoneSync({
      root, milestoneName: 'S1', plan: { ...plan, expiresAt: '2000-01-01T00:00:00Z' },
      confirmed: true, adapter: remote
    }),
    (error) => error.code === 'MCP_SYNC_PLAN_EXPIRED'
  )
  assert.equal(remote.calls.length, 0)
})
