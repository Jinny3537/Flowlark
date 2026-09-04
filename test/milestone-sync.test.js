import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import { buildMilestoneSyncPlan } from '../src/core/milestone-sync-plan.js'
import {
  executeMilestoneSync,
  linkMilestoneCreateResult,
  resumeMilestoneSync
} from '../src/core/milestone-sync.js'
import {
  newMilestoneSyncJournal,
  readMilestoneSyncJournal,
  writeMilestoneSyncJournal
} from '../src/core/milestone-sync-journal.js'
import { listSyncAudit } from '../src/core/sync-audit.js'
import { findSyncRecord } from '../src/core/sync-queue.js'
import * as milestones from '../src/core/milestones.js'
import * as requirements from '../src/core/requirements.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture({ action = null, managedFields } = {}) {
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
    milestone, requirements: [requirement], mapping, action, managedFields
  })
  return { root, hub, plan, mapping }
}

function adapter({
  failSprintOnce = false,
  sprintFailureCode = 'MCP_TIMEOUT',
  failTaskOnce = false,
  taskFailureCode = 'MCP_UNAVAILABLE',
  afterSaveSprint = null
} = {}) {
  const calls = []
  let sprintFailed = false
  let taskFailed = false
  const state = {
    sprint: { id: 10, projectId: 123, sprintName: '迭代一', sprintGoal: '完成联调', ownerId: 7, planStartDate: '2026-08-01T00:00:00+08:00', planEndDate: '2026-08-21T00:00:00+08:00', revision: 1, status: 0 },
    task: null,
    tasks: new Map()
  }
  return {
    calls,
    state,
    async saveSprint(body) {
      calls.push(['saveSprint', body])
      if (failSprintOnce && !sprintFailed) {
        sprintFailed = true
        throw Object.assign(new Error('uncertain sprint result'), { code: sprintFailureCode })
      }
      state.sprint = { ...state.sprint, ...body, id: body.id || 10, revision: Number(body.revision || 0) + 1 }
      if (afterSaveSprint) await afterSaveSprint()
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
        throw Object.assign(new Error('temporary task failure'), {
          code: taskFailureCode, accessToken: 'private-task-token'
        })
      }
      const id = 20 + state.tasks.size
      state.task = { ...body, id, revision: 1, sprintId: body.currentSprintId, status: 0 }
      state.tasks.set(id, state.task)
      return state.task
    },
    async updateTask(body) {
      calls.push(['updateTask', body])
      state.task = { ...state.task, ...body, revision: Number(body.revision || 0) + 1 }
      return state.task
    },
    async getTask(taskId) {
      calls.push(['getTask'])
      return state.tasks.get(Number(taskId)) || state.task
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

test('serializes concurrent executions for the same milestone before a second remote mutation', async () => {
  const { root, plan } = fixture()
  let releaseSave
  let saveStarted
  const started = new Promise((resolve) => { saveStarted = resolve })
  const gate = new Promise((resolve) => { releaseSave = resolve })
  const remote = adapter({ afterSaveSprint: async () => { saveStarted(); await gate } })

  const first = executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  await started
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_EXECUTION_CONFLICT' && error.status === 409
  )
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  releaseSave()
  await first
})

test('reclaims an execution lock left by a crashed process', async () => {
  const { root, plan } = fixture()
  const key = crypto.createHash('sha256').update('milestone:S1').digest('hex')
  const lock = path.join(root, '.flowlark', 'cache', 'sync-locks', key)
  fs.mkdirSync(lock, { recursive: true })
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, token: 'orphan' }))
  const remote = adapter()

  const result = await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(fs.existsSync(lock), false)
})

test('lifecycle plan hashes include the observed remote status and revision', () => {
  const { root, mapping } = fixture({ action: 'start' })
  const milestone = milestones.inspectMilestone(root, 'S1')
  milestones.updateMilestone(root, 'S1', {
    external: { provider: 'assess-task', server: mapping.server, projectId: 123, sprintId: 10 }
  }, { system: true })
  const bound = milestones.inspectMilestone(root, 'S1')
  const requirement = { ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }
  const remoteSprint = {
    id: 10, projectId: 123, sprintName: milestone.title, sprintGoal: milestone.goal,
    ownerId: 7, planStartDate: '2026-08-01T00:00:00+08:00', planEndDate: '2026-08-21T00:00:00+08:00',
    status: 'planned', revision: 3
  }
  const first = buildMilestoneSyncPlan({ milestone: bound, requirements: [requirement], remoteSprint, mapping, action: 'start' })
  const changed = buildMilestoneSyncPlan({
    milestone: bound, requirements: [requirement], remoteSprint: { ...remoteSprint, status: 'active', revision: 4 }, mapping, action: 'start'
  })
  const operation = first.operations.find((item) => item.kind === 'sprint.start')

  assert.deepEqual(operation.before, { status: 'planned', revision: 3 })
  assert.notEqual(changed.hash, first.hash)
})

test('persists external ids after each create and completes the journal', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  const result = await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(milestones.readMilestone(root, 'S1').external.sprintId, 10)
  assert.equal(requirements.readRequirement(root, 'REQ-1').externalTasks[0].taskId, 20)
  assert.equal(readMilestoneSyncJournal(root, 'S1').status, 'completed')
  const actions = listSyncAudit(root, { syncId: result.id, limit: 100 })
    .reverse()
    .map((entry) => entry.action)
  assert.deepEqual(actions, [
    'sync.running',
    'step.executing', 'step.completed',
    'step.executing', 'step.completed',
    'sync.completed'
  ])
})

test('pauses an uncertain sprint create and never creates it again without an explicit link', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failSprintOnce: true, sprintFailureCode: 'MCP_TIMEOUT' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'MCP_TIMEOUT'
  )
  const journal = readMilestoneSyncJournal(root, 'S1')
  assert.equal(journal.status, 'paused')
  assert.equal(journal.operations[0].status, 'paused')
  assert.deepEqual(journal.operations[0].error, {
    code: 'MCP_SYNC_LINK_REQUIRED',
    causeCode: 'MCP_TIMEOUT',
    message: '冲刺创建结果不明确，请先关联远端对象'
  })
  assert.ok(listSyncAudit(root).some((entry) =>
    entry.action === 'step.paused' && entry.error?.causeCode === 'MCP_TIMEOUT'))

  await assert.rejects(
    resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'MCP_TIMEOUT'
  )
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
})

test('pauses an uncertain task create and never creates it again without an explicit link', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failTaskOnce: true, taskFailureCode: 'ECONNRESET' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'ECONNRESET'
  )
  const journal = readMilestoneSyncJournal(root, 'S1')
  assert.equal(journal.status, 'paused')
  assert.equal(journal.operations[1].status, 'paused')
  assert.equal(journal.operations[1].error.causeCode, 'ECONNRESET')

  await assert.rejects(
    resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'ECONNRESET'
  )
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 1)
})

test('links an uncertain sprint result and resumes without replaying create', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failSprintOnce: true, sprintFailureCode: 'MCP_TIMEOUT' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED'
  )

  const linked = await linkMilestoneCreateResult({
    root,
    milestoneName: 'S1',
    operationKey: plan.operations[0].key,
    remoteId: 10,
    remote: remote.state.sprint,
    reason: '人工核对平台冲刺'
  })
  assert.equal(linked.status, 'paused')
  assert.equal(linked.operations[0].status, 'remote-complete')
  assert.equal(linked.operations[0].remoteResult.id, 10)
  assert.equal(milestones.readMilestone(root, 'S1').external.sprintId, 10)

  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 1)
})

test('links an uncertain task result and resumes without replaying create', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failTaskOnce: true, taskFailureCode: 'ECONNRESET' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED'
  )
  const operation = plan.operations.find((item) => item.kind === 'task.create')
  const candidate = {
    ...operation.after,
    id: 88,
    projectId: plan.projectId,
    sprintId: 10,
    revision: 2,
    status: 0
  }
  remote.state.task = candidate
  remote.state.tasks.set(candidate.id, candidate)

  const linked = await linkMilestoneCreateResult({
    root,
    milestoneName: 'S1',
    operationKey: operation.key,
    remoteId: candidate.id,
    remote: candidate,
    reason: '人工核对平台任务'
  })
  assert.equal(linked.status, 'paused')
  assert.equal(linked.operations.find((item) => item.key === operation.key).status, 'remote-complete')
  assert.equal(requirements.readRequirement(root, 'REQ-1').externalTasks[0].taskId, 88)

  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 1)
})

test('keeps the verified binding and remote-complete step when link audit append fails', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failSprintOnce: true, sprintFailureCode: 'MCP_TIMEOUT' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED'
  )
  const auditFile = path.join(root, '.flowlark', 'sync-audit.ndjson')
  fs.rmSync(auditFile)
  fs.mkdirSync(auditFile)

  await assert.rejects(
    linkMilestoneCreateResult({
      root,
      milestoneName: 'S1',
      operationKey: plan.operations[0].key,
      remoteId: 10,
      remote: remote.state.sprint,
      reason: '人工核对平台冲刺'
    }),
    (error) => error.code === 'SYNC_AUDIT_WRITE_FAILED'
  )
  assert.equal(milestones.readMilestone(root, 'S1').external.sprintId, 10)
  const paused = readMilestoneSyncJournal(root, 'S1')
  assert.equal(paused.status, 'paused')
  assert.equal(paused.error.code, 'SYNC_AUDIT_WRITE_FAILED')
  assert.equal(paused.operations[0].status, 'remote-complete')

  fs.rmSync(auditFile, { recursive: true })
  const resumed = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(resumed.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
})

test('recovers a remote-complete sprint create by persisting its binding without creating again', async () => {
  const { root, plan } = fixture()
  const journal = newMilestoneSyncJournal(plan)
  journal.status = 'paused'
  journal.operations[0].status = 'remote-complete'
  journal.operations[0].remoteResult = { id: 77, revision: 4, status: 0, url: 'https://tasks.test/sprints/77' }
  writeMilestoneSyncJournal(root, 'S1', journal)
  const remote = adapter()

  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })

  assert.equal(result.status, 'completed')
  assert.equal(milestones.readMilestone(root, 'S1').external.sprintId, 77)
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 0)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 1)
  assert.ok(listSyncAudit(root).some((entry) =>
    entry.action === 'step.completed' && entry.operationKey === plan.operations[0].key))
})

test('recovers a remote-complete task create by persisting its binding without creating again', async () => {
  const { root, plan } = fixture()
  milestones.updateMilestone(root, 'S1', {
    external: { provider: 'assess-task', server: plan.server, projectId: plan.projectId, sprintId: 10 }
  }, { system: true })
  const journal = newMilestoneSyncJournal(plan)
  journal.status = 'paused'
  journal.operations[0].status = 'completed'
  journal.operations[0].remoteResult = { id: 10, revision: 1, status: 0 }
  journal.operations[1].status = 'remote-complete'
  journal.operations[1].remoteResult = { id: 88, revision: 2, status: 0, url: 'https://tasks.test/tasks/88' }
  writeMilestoneSyncJournal(root, 'S1', journal)
  const remote = adapter()

  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })

  assert.equal(result.status, 'completed')
  assert.equal(requirements.readRequirement(root, 'REQ-1').externalTasks[0].taskId, 88)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 0)
})

test('pauses a remote-complete create that lacks an id instead of replaying it', async () => {
  const { root, plan } = fixture()
  const journal = newMilestoneSyncJournal(plan)
  journal.status = 'paused'
  journal.operations[0].status = 'remote-complete'
  journal.operations[0].remoteResult = { id: null, revision: 4, status: 0 }
  writeMilestoneSyncJournal(root, 'S1', journal)
  const remote = adapter()

  await assert.rejects(
    resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'REMOTE_ID_MISSING'
  )
  const saved = readMilestoneSyncJournal(root, 'S1')
  assert.equal(saved.status, 'paused')
  assert.equal(saved.operations[0].status, 'paused')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 0)
})

test('resumes a known failed create without recreating the completed sprint', async () => {
  const { root, plan } = fixture()
  const remote = adapter({ failTaskOnce: true, taskFailureCode: 'REMOTE_VALIDATION_FAILED' })
  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    /temporary task failure/
  )
  assert.equal(readMilestoneSyncJournal(root, 'S1').status, 'failed')
  const failedAudit = listSyncAudit(root).find((entry) => entry.action === 'step.failed')
  assert.equal(failedAudit.status, 'failed')
  assert.equal(failedAudit.operationKey, plan.operations[1].key)
  assert.equal(failedAudit.error.code, 'REMOTE_VALIDATION_FAILED')
  assert.doesNotMatch(JSON.stringify(failedAudit), /private-task-token/)
  const result = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(result.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 2)
})

test('starts a sprint with a fresh revision and transitions local state only after verification', async () => {
  const { root, plan } = fixture({ action: 'start' })
  const remote = adapter()
  await assert.rejects(
    executeMilestoneSync({
      root, milestoneName: 'S1', plan, confirmed: true, reason: '开始执行', adapter: remote
    }),
    (error) => error.code === 'MCP_SYNC_IMPACT_CONFIRMATION_REQUIRED'
  )
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan, confirmed: true, reason: '开始执行', confirmUnfinished: true, adapter: remote
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

test('rejects legacy accept-remote operations without changing local authority', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  const legacy = {
    ...plan,
    hash: 'sha256:legacy-accept-remote',
    operations: [{
      key: 'task:20:accept-remote', kind: 'local.accept-remote', entity: 'task',
      requirement: 'REQ-1', localPatch: { title: '平台调整标题' }, dependsOn: []
    }]
  }

  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan: legacy, confirmed: true, adapter: remote }),
    (error) => error.code === 'MCP_SYNC_OPERATION_INVALID'
  )
  const local = requirements.readRequirement(root, 'REQ-1')
  assert.equal(local.title, '需求一')
})

test('merges managed task and sprint updates into fresh remote bodies', async () => {
  const { root, plan, mapping } = fixture({ managedFields: ['description', 'title'] })
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })

  requirements.updateRequirement(root, 'REQ-1', { title: '本地新标题' })
  requirements.updateRequirement(root, 'REQ-1', { dueDate: '2026-08-20' })
  milestones.updateMilestone(root, 'S1', {
    goal: '本地新目标', startAt: '2026-08-02', endAt: '2026-08-22'
  })
  remote.state.task.descriptionDoc = '平台保留说明'
  remote.state.task.acceptanceDoc = '平台保留验收'
  remote.state.task.customField = 'task-keep'
  remote.state.task.planStartDate = '2026-09-01T00:00:00+08:00'
  remote.state.task.planEndDate = '2026-09-02T00:00:00+08:00'
  remote.state.task.revision = 6
  remote.state.sprint.sprintName = '平台保留名称'
  remote.state.sprint.ownerId = 99
  remote.state.sprint.customField = 'sprint-keep'
  remote.state.sprint.planStartDate = '2026-09-01T00:00:00+08:00'
  remote.state.sprint.planEndDate = '2026-09-02T00:00:00+08:00'
  remote.state.sprint.revision = 7

  const nextPlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping,
    managedFields: ['description', 'title'],
    resolutions: { 'sprint:10': 'restore-local', 'task:20': 'restore-local' }
  })
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan: nextPlan, confirmed: true,
    reason: '恢复本地权威字段', adapter: remote
  })

  const sprintUpdate = remote.calls.filter(([name]) => name === 'saveSprint').at(-1)[1]
  assert.equal(sprintUpdate.sprintName, '迭代一')
  assert.equal(sprintUpdate.sprintGoal, '本地新目标')
  assert.equal(sprintUpdate.ownerId, 99)
  assert.equal(sprintUpdate.customField, 'sprint-keep')
  assert.equal(sprintUpdate.planStartDate, '2026-08-02T00:00:00+08:00')
  assert.equal(sprintUpdate.planEndDate, '2026-08-22T00:00:00+08:00')
  assert.equal(sprintUpdate.revision, 7)

  const taskUpdate = remote.calls.find(([name]) => name === 'updateTask')[1]
  assert.equal(taskUpdate.title, '[REQ-1] 本地新标题')
  assert.equal(taskUpdate.descriptionDoc, '说明\n\n关联原型：\n- orders/v1')
  assert.equal(taskUpdate.acceptanceDoc, '平台保留验收')
  assert.equal(taskUpdate.customField, 'task-keep')
  assert.equal(taskUpdate.planStartDate, '2026-08-02T00:00:00+08:00')
  assert.equal(taskUpdate.planEndDate, '2026-08-20T00:00:00+08:00')
  assert.equal(taskUpdate.revision, 6)
})

test('applies a confirmed active scope draft only after remote verification', async () => {
  const { root, hub, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  milestones.updateMilestone(root, 'S1', { status: 'active' }, { system: true })
  hub.createRequirement({ code: 'REQ-2', title: '新增范围', description: '第二项', priority: 'P1', owner: 'dev' })
  hub.addVersion('orders', { versionNo: 'v2', title: '二版', html: html(), requirements: ['REQ-2'], changes: [{ type: 'ADD', location: '列表', content: '新增范围' }] })
  const scopeItems = [
    { requirement: 'REQ-1', project: 'orders', version: 'v1' },
    { requirement: 'REQ-2', project: 'orders', version: 'v2' }
  ]
  const current = milestones.inspectMilestone(root, 'S1')
  const scopePlan = buildMilestoneSyncPlan({
    milestone: { ...current, items: scopeItems },
    requirements: [
      { ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' },
      { ...requirements.requirementDetail(root, 'REQ-2'), spec: '# 验收' }
    ],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    managedTaskBindings: [{ requirement: 'REQ-1', taskId: 20 }],
    mapping,
    scopeItems,
    scopeChangeReason: '新增第二项范围'
  })
  assert.ok(scopePlan.operations.some((operation) => operation.kind === 'local.scope-change'))
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan: scopePlan, confirmed: true,
    reason: '新增第二项范围', confirmUnfinished: true, adapter: remote
  })
  const stored = milestones.readMilestone(root, 'S1')
  assert.equal(stored.status, 'active')
  assert.deepEqual(stored.items, scopeItems)
  assert.equal(requirements.readRequirement(root, 'REQ-2').externalTasks[0].taskId, 21)
})

test('moves tasks with fresh task revisions and an explicit target sprint', async () => {
  const { root, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  remote.state.task.sprintId = 9
  remote.state.task.revision = 6
  const movePlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping
  })
  await executeMilestoneSync({ root, milestoneName: 'S1', plan: movePlan, confirmed: true, adapter: remote })
  const move = remote.calls.find(([name]) => name === 'moveTasks')
  assert.deepEqual(move[1], {
    reason: '调整迭代范围',
    tasks: [{ taskId: 20, taskRevision: 6 }],
    toSprintId: 10
  })
})

test('ends a sprint with reason, unfinished confirmation and fresh revision', async () => {
  const { root, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  milestones.updateMilestone(root, 'S1', { status: 'active' }, { system: true })
  remote.state.sprint.revision = 8
  const endPlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping,
    action: 'end'
  })
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan: endPlan, confirmed: true,
    reason: '本轮交付完成', confirmUnfinished: true, adapter: remote
  })
  const end = remote.calls.find(([name]) => name === 'endSprint')
  assert.deepEqual(end[1], { sprintId: 10, revision: 8, reason: '本轮交付完成', confirmUnfinished: true })
  assert.equal(milestones.readMilestone(root, 'S1').status, 'delivered')
})

test('cancels a frozen remote sprint with an audited reason', async () => {
  const { root, plan, mapping } = fixture()
  const remote = adapter()
  await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  milestones.updateMilestone(root, 'S1', { status: 'frozen' }, { system: true })
  remote.state.sprint.revision = 5
  const cancelPlan = buildMilestoneSyncPlan({
    milestone: milestones.inspectMilestone(root, 'S1'),
    requirements: [{ ...requirements.requirementDetail(root, 'REQ-1'), spec: '# 验收' }],
    remoteSprint: await remote.getSprint(10),
    remoteTasks: [await remote.getTask(20)],
    mapping,
    action: 'cancel'
  })
  await executeMilestoneSync({
    root, milestoneName: 'S1', plan: cancelPlan, confirmed: true,
    reason: '业务范围取消', confirmUnfinished: true, adapter: remote
  })
  const cancel = remote.calls.find(([name]) => name === 'cancelSprint')
  assert.deepEqual(cancel[1], { sprintId: 10, revision: 5, reason: '业务范围取消', confirmUnfinished: true })
  assert.equal(milestones.readMilestone(root, 'S1').status, 'canceled')
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

test('reads legacy journals but writes new records only to the global queue', () => {
  const { root, plan } = fixture()
  const legacyFile = path.join(root, '.flowlark', 'cache', 'mcp-sync', 'S1.json')
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true })
  fs.writeFileSync(legacyFile, JSON.stringify({ milestone: 'S1', status: 'failed', planHash: plan.hash }))

  assert.equal(readMilestoneSyncJournal(root, 'S1').status, 'failed')
  const written = writeMilestoneSyncJournal(root, 'S1', newMilestoneSyncJournal(plan))
  assert.equal(findSyncRecord(root, 'milestone', 'S1').id, written.id)
  assert.equal(fs.readFileSync(legacyFile, 'utf8').includes('"failed"'), true)
})

test('pauses before a remote operation when the required audit append fails', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  fs.mkdirSync(path.join(root, '.flowlark', 'sync-audit.ndjson'), { recursive: true })

  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'SYNC_AUDIT_WRITE_FAILED'
  )
  const journal = readMilestoneSyncJournal(root, 'S1')
  assert.equal(journal.status, 'paused')
  assert.equal(journal.error.code, 'SYNC_AUDIT_WRITE_FAILED')
  assert.equal(remote.calls.length, 0)
})

test('an audit failure after one remote step prevents the next remote operation', async () => {
  const { root, plan } = fixture()
  const auditFile = path.join(root, '.flowlark', 'sync-audit.ndjson')
  const remote = adapter({
    afterSaveSprint() {
      fs.rmSync(auditFile)
      fs.mkdirSync(auditFile)
    }
  })

  await assert.rejects(
    executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote }),
    (error) => error.code === 'SYNC_AUDIT_WRITE_FAILED'
  )
  const journal = readMilestoneSyncJournal(root, 'S1')
  assert.equal(journal.status, 'paused')
  assert.equal(journal.operations[0].status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 0)

  fs.rmSync(auditFile, { recursive: true })
  const resumed = await resumeMilestoneSync({ root, milestoneName: 'S1', adapter: remote })
  assert.equal(resumed.status, 'completed')
  assert.equal(remote.calls.filter(([name]) => name === 'saveSprint').length, 1)
  assert.equal(remote.calls.filter(([name]) => name === 'createTask').length, 1)
})

test('does not replace a running record with a changed plan hash', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  writeMilestoneSyncJournal(root, 'S1', newMilestoneSyncJournal(plan))

  await assert.rejects(
    executeMilestoneSync({
      root, milestoneName: 'S1', plan: { ...plan, hash: 'sha256:changed' }, confirmed: true, adapter: remote
    }),
    (error) => error.code === 'MCP_SYNC_PLAN_CHANGED'
  )
  assert.equal(readMilestoneSyncJournal(root, 'S1').planHash, plan.hash)
  assert.equal(remote.calls.length, 0)
})

test('returns a matching completed record without another adapter call', async () => {
  const { root, plan } = fixture()
  const remote = adapter()
  const first = await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  remote.calls.length = 0

  const repeated = await executeMilestoneSync({ root, milestoneName: 'S1', plan, confirmed: true, adapter: remote })
  assert.equal(repeated.id, first.id)
  assert.equal(repeated.status, 'completed')
  assert.equal(remote.calls.length, 0)
})
