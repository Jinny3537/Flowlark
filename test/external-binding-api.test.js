import { after, before, test } from 'node:test'
import path from 'node:path'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { findSyncRecord, transitionSyncRecord } from '../src/core/sync-queue.js'
import { listSyncAudit } from '../src/core/sync-audit.js'
import * as requirements from '../src/core/requirements.js'
import * as milestones from '../src/core/milestones.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

let root
let server
let base
let remote
let previousHome

function fakeAdapter() {
  const state = {
    calls: [],
    tasks: new Map([
      [20, { id: 20, projectId: 123, revision: 4, status: 1, title: '任务 20' }],
      [21, { id: 21, projectId: 123, revision: 5, status: 1, title: '任务 21' }],
      [22, { id: 22, projectId: 123, revision: 6, status: 1, title: '任务 22' }],
      [23, { id: 23, projectId: 123, revision: 1, status: 1, title: '并发绑定任务' }],
      [24, { id: 24, projectId: 123, revision: 1, status: 1, title: '重试绑定任务' }],
      [25, { id: 25, projectId: 123, revision: 1, status: 1, title: '预览竞态任务' }],
      [26, { id: 26, projectId: 123, revision: 1, status: 1, title: '取消竞态任务' }],
      [30, { id: 30, projectId: 999, revision: 1, status: 1, title: '错误项目任务' }]
    ]),
    sprints: new Map([
      [50, { id: 50, projectId: 123, revision: 2, status: 0, name: 'Sprint 50' }],
      [51, { id: 51, projectId: 123, revision: 3, status: 0, name: 'Sprint 51' }],
      [52, { id: 52, projectId: 123, revision: 1, status: 0, name: '并发 Sprint' }],
      [60, { id: 60, projectId: 999, revision: 1, status: 0, name: '错误项目 Sprint' }]
    ])
  }
  return {
    state,
    async getTask(id) {
      state.calls.push(['getTask', Number(id)])
      if (state.beforeTaskRead) await state.beforeTaskRead(Number(id))
      return state.tasks.get(Number(id)) || null
    },
    async getSprint(id) {
      state.calls.push(['getSprint', Number(id)])
      if (state.beforeSprintRead) await state.beforeSprintRead(Number(id))
      return state.sprints.get(Number(id)) || null
    }
  }
}

async function call(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

before(async () => {
  const ctx = newHub()
  root = ctx.root
  previousHome = process.env.FLOWLARK_HOME
  process.env.FLOWLARK_HOME = path.join(root, '.test-flowlark-home')
  ctx.hub.createProject({ name: '订单', code: 'orders' })
  ctx.hub.updateProject('orders', {
    sync: { mode: 'manual', server: 'project-task', projectId: '123', managedFields: ['title'] }
  })
  ctx.hub.saveMcpServer({
    id: 'project-task', name: '项目任务服务', type: 'stdio',
    adapter: 'assess-task', runtimeProfile: 'project-task-runtime'
  })
  ctx.hub.saveMcpCapability('milestones', {
    enabled: true,
    server: '',
    project: '999',
    options: { server: 'capability-server', projectId: 999 }
  })
  for (const code of ['REQ-BIND', 'REQ-OTHER', 'REQ-HASH', 'REQ-RACE-PREVIEW', 'REQ-RACE-CANCEL', 'REQ-RETRY']) {
    ctx.hub.createRequirement({ code, title: code })
  }
  ctx.hub.addVersion('orders', {
    versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-BIND']
  })
  ctx.hub.createMilestone({
    name: 'S-BIND', title: '绑定 Sprint',
    items: [{ requirement: 'REQ-BIND', project: 'orders', version: 'v1' }]
  })
  ctx.hub.createMilestone({
    name: 'S-BIND-OTHER', title: '另一个 Sprint 绑定',
    items: [{ requirement: 'REQ-BIND', project: 'orders', version: 'v1' }]
  })
  for (const name of ['S-RACE-A', 'S-RACE-B']) {
    ctx.hub.createMilestone({
      name, title: name,
      items: [{ requirement: 'REQ-BIND', project: 'orders', version: 'v1' }]
    })
  }
  remote = fakeAdapter()
  server = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: unavailableWecomMcp('test'),
    assessAdapter: remote,
    assessConfig: { server: { id: 'ignored-injected' }, project: '999', capability: { options: {} } }
  })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  if (previousHome === undefined) delete process.env.FLOWLARK_HOME
  else process.env.FLOWLARK_HOME = previousHome
  cleanup(root)
})

test('task binding preview ignores browser dispatcher fields and executes a verified first bind', async (t) => {
  remote.state.calls.length = 0
  const preview = await call('POST', '/api/requirements/REQ-BIND/task-binding/plan', {
    project: 'orders', remoteId: 20, expectedTaskId: null, reason: '核对平台任务后绑定',
    server: 'browser-server', tool: 'task_delete', body: { projectId: 999 }, confirmed: false
  })
  t.assert.strictEqual(preview.status, 200)
  t.assert.strictEqual(preview.body.server, 'project-task')
  t.assert.strictEqual(preview.body.projectId, 123)
  t.assert.match(preview.body.hash, /^sha256:/)
  t.assert.deepStrictEqual(remote.state.calls, [['getTask', 20]])
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-BIND').externalTasks.length, 0)
  t.assert.doesNotMatch(JSON.stringify(preview.body), /browser-server|task_delete|999/)

  const record = findSyncRecord(root, 'requirement', 'REQ-BIND')
  const executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true,
    server: 'browser-server', tool: 'task_delete', body: { taskId: 999 }
  })
  t.assert.strictEqual(executed.status, 200)
  t.assert.strictEqual(executed.body.status, 'completed')
  const binding = requirements.readRequirement(root, 'REQ-BIND').externalTasks[0]
  t.assert.deepStrictEqual({ server: binding.server, projectId: binding.projectId, taskId: binding.taskId }, {
    server: 'project-task', projectId: 123, taskId: 20
  })
  t.assert.strictEqual(binding.lastSyncHash, '')
  const actions = listSyncAudit(root, { syncId: record.id, limit: 20 }).map((entry) => entry.action)
  t.assert.ok(actions.includes('sync.previewed'))
  t.assert.ok(actions.includes('binding.replaced'))
  t.assert.ok(actions.includes('sync.completed'))
})

test('task rebind is CAS protected and reverse-unique', async (t) => {
  let preview = await call('POST', '/api/requirements/REQ-BIND/task-binding/plan', {
    project: 'orders', remoteId: 21, expectedTaskId: 20, reason: '改绑到确认后的任务'
  })
  t.assert.strictEqual(preview.status, 200)
  let record = findSyncRecord(root, 'requirement', 'REQ-BIND')
  let executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true
  })
  t.assert.strictEqual(executed.status, 200)
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-BIND').externalTasks[0].taskId, 21)
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-BIND').externalTasks[0].lastSyncHash, '')

  const stale = await call('POST', '/api/requirements/REQ-BIND/task-binding/plan', {
    project: 'orders', remoteId: 22, expectedTaskId: 20, reason: '陈旧改绑'
  })
  t.assert.strictEqual(stale.status, 409)
  t.assert.strictEqual(stale.body.code, 'EXTERNAL_TASK_CAS_MISMATCH')

  const duplicate = await call('POST', '/api/requirements/REQ-OTHER/task-binding/plan', {
    project: 'orders', remoteId: 21, expectedTaskId: null, reason: '重复绑定'
  })
  t.assert.strictEqual(duplicate.status, 409)
  t.assert.strictEqual(duplicate.body.code, 'EXTERNAL_TASK_ALREADY_BOUND')
})

test('binding preview rejects missing and wrong-project remote objects', async (t) => {
  let result = await call('POST', '/api/requirements/REQ-OTHER/task-binding/plan', {
    project: 'orders', remoteId: 404, expectedTaskId: null, reason: '不存在'
  })
  t.assert.strictEqual(result.status, 404)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_TASK_NOT_FOUND')
  result = await call('POST', '/api/requirements/REQ-OTHER/task-binding/plan', {
    project: 'orders', remoteId: 30, expectedTaskId: null, reason: '错误项目'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_TASK_PROJECT_MISMATCH')

  result = await call('POST', '/api/milestones/S-BIND/sprint-binding/plan', {
    project: 'orders', remoteId: 404, expectedSprintId: null, reason: '不存在'
  })
  t.assert.strictEqual(result.status, 404)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_SPRINT_NOT_FOUND')
  result = await call('POST', '/api/milestones/S-BIND/sprint-binding/plan', {
    project: 'orders', remoteId: 60, expectedSprintId: null, reason: '错误项目'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_SPRINT_PROJECT_MISMATCH')
})

test('Sprint binding uses the milestone-binding queue and CAS rebind', async (t) => {
  let preview = await call('POST', '/api/milestones/S-BIND/sprint-binding/plan', {
    project: 'orders', remoteId: 50, expectedSprintId: null, reason: '首次绑定 Sprint'
  })
  t.assert.strictEqual(preview.status, 200)
  let record = findSyncRecord(root, 'milestone-binding', 'S-BIND')
  t.assert.ok(record)
  let executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true
  })
  t.assert.strictEqual(executed.status, 200)
  t.assert.strictEqual(milestones.readMilestone(root, 'S-BIND').external.sprintId, 50)

  preview = await call('POST', '/api/milestones/S-BIND/sprint-binding/plan', {
    project: 'orders', remoteId: 51, expectedSprintId: 50, reason: '改绑 Sprint'
  })
  t.assert.strictEqual(preview.status, 200)
  record = findSyncRecord(root, 'milestone-binding', 'S-BIND')
  executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true
  })
  t.assert.strictEqual(executed.status, 200)
  t.assert.strictEqual(milestones.readMilestone(root, 'S-BIND').external.sprintId, 51)
  t.assert.strictEqual(milestones.readMilestone(root, 'S-BIND').external.lastSyncHash, '')

  const duplicate = await call('POST', '/api/milestones/S-BIND-OTHER/sprint-binding/plan', {
    project: 'orders', remoteId: 51, expectedSprintId: null, reason: '重复 Sprint 绑定'
  })
  t.assert.strictEqual(duplicate.status, 409)
  t.assert.strictEqual(duplicate.body.code, 'EXTERNAL_SPRINT_ALREADY_BOUND')
})

test('binding execution rebuilds the plan under lock and rejects remote revision drift', async (t) => {
  const preview = await call('POST', '/api/requirements/REQ-HASH/task-binding/plan', {
    project: 'orders', remoteId: 22, expectedTaskId: null, reason: '验证计划哈希'
  })
  t.assert.strictEqual(preview.status, 200)
  const record = findSyncRecord(root, 'requirement', 'REQ-HASH')
  remote.state.tasks.set(22, { ...remote.state.tasks.get(22), revision: 7 })

  const executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true
  })

  t.assert.strictEqual(executed.status, 409)
  t.assert.strictEqual(executed.body.code, 'MCP_SYNC_PLAN_CHANGED')
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-HASH').externalTasks.length, 0)
  t.assert.notStrictEqual(findSyncRecord(root, 'requirement', 'REQ-HASH').planHash, preview.body.hash)
})

test('a replacement task binding preview wins while the old execute is reading remote state', async (t) => {
  const oldPreview = await call('POST', '/api/requirements/REQ-RACE-PREVIEW/task-binding/plan', {
    project: 'orders', remoteId: 25, expectedTaskId: null, reason: '旧绑定预览'
  })
  const record = findSyncRecord(root, 'requirement', 'REQ-RACE-PREVIEW')
  let releaseRead
  let markReadStarted
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const readStarted = new Promise((resolve) => { markReadStarted = resolve })
  remote.state.beforeTaskRead = async (id) => {
    if (id !== 25) return
    markReadStarted()
    await readGate
  }

  const executing = call('POST', `/api/sync/${record.id}/execute`, {
    planHash: oldPreview.body.hash, confirmed: true
  })
  await readStarted
  const replacement = await call('POST', '/api/requirements/REQ-RACE-PREVIEW/task-binding/plan', {
    project: 'orders', remoteId: 24, expectedTaskId: null, reason: '替换绑定预览'
  })
  releaseRead()
  const stale = await executing
  remote.state.beforeTaskRead = null

  t.assert.strictEqual(replacement.status, 200)
  t.assert.strictEqual(stale.status, 409)
  t.assert.strictEqual(stale.body.code, 'MCP_SYNC_PLAN_CHANGED')
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-RACE-PREVIEW').externalTasks.length, 0)
  const current = findSyncRecord(root, 'requirement', 'REQ-RACE-PREVIEW')
  t.assert.strictEqual(current.status, 'pending-confirmation')
  t.assert.strictEqual(current.planHash, replacement.body.hash)
})

test('cancel wins while task binding execute is reading remote state', async (t) => {
  const preview = await call('POST', '/api/requirements/REQ-RACE-CANCEL/task-binding/plan', {
    project: 'orders', remoteId: 26, expectedTaskId: null, reason: '等待取消的绑定'
  })
  const record = findSyncRecord(root, 'requirement', 'REQ-RACE-CANCEL')
  let releaseRead
  let markReadStarted
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const readStarted = new Promise((resolve) => { markReadStarted = resolve })
  remote.state.beforeTaskRead = async (id) => {
    if (id !== 26) return
    markReadStarted()
    await readGate
  }

  const executing = call('POST', `/api/sync/${record.id}/execute`, {
    planHash: preview.body.hash, confirmed: true
  })
  await readStarted
  const canceled = await call('POST', `/api/sync/${record.id}/cancel`, { reason: '竞态中取消' })
  releaseRead()
  const stale = await executing
  remote.state.beforeTaskRead = null

  t.assert.strictEqual(canceled.status, 200)
  t.assert.strictEqual(canceled.body.status, 'canceled')
  t.assert.strictEqual(stale.status, 409)
  t.assert.strictEqual(stale.body.code, 'SYNC_TRANSITION_INVALID')
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-RACE-CANCEL').externalTasks.length, 0)
  t.assert.strictEqual(findSyncRecord(root, 'requirement', 'REQ-RACE-CANCEL').status, 'canceled')
})

test('failed binding records retry through the same fixed dispatcher', async (t) => {
  const preview = await call('POST', '/api/requirements/REQ-RETRY/task-binding/plan', {
    project: 'orders', remoteId: 24, expectedTaskId: null, reason: '重试受控绑定'
  })
  const record = findSyncRecord(root, 'requirement', 'REQ-RETRY')
  transitionSyncRecord(root, record.id, 'running')
  transitionSyncRecord(root, record.id, 'failed', { error: { code: 'TEST_FAILURE', message: 'test' } })

  const retried = await call('POST', `/api/sync/${record.id}/retry`, {
    server: 'browser-server', tool: 'delete-task', body: { taskId: 999 }
  })

  t.assert.strictEqual(retried.status, 200)
  t.assert.strictEqual(retried.body.status, 'completed')
  t.assert.strictEqual(requirements.readRequirement(root, 'REQ-RETRY').externalTasks[0].taskId, 24)
})

test('two milestones competing for one Sprint leave exactly one verified binding', async (t) => {
  const previewA = await call('POST', '/api/milestones/S-RACE-A/sprint-binding/plan', {
    project: 'orders', remoteId: 52, expectedSprintId: null, reason: 'Sprint 竞争 A'
  })
  const previewB = await call('POST', '/api/milestones/S-RACE-B/sprint-binding/plan', {
    project: 'orders', remoteId: 52, expectedSprintId: null, reason: 'Sprint 竞争 B'
  })
  const recordA = findSyncRecord(root, 'milestone-binding', 'S-RACE-A')
  const recordB = findSyncRecord(root, 'milestone-binding', 'S-RACE-B')
  let blocked = false
  let releaseRead
  let markReadStarted
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  const readStarted = new Promise((resolve) => { markReadStarted = resolve })
  remote.state.beforeSprintRead = async (id) => {
    if (id !== 52 || blocked) return
    blocked = true
    markReadStarted()
    await readGate
  }

  const first = call('POST', `/api/sync/${recordA.id}/execute`, {
    planHash: previewA.body.hash, confirmed: true
  })
  await readStarted
  const second = await call('POST', `/api/sync/${recordB.id}/execute`, {
    planHash: previewB.body.hash, confirmed: true
  })
  releaseRead()
  const stale = await first
  remote.state.beforeSprintRead = null

  t.assert.strictEqual(second.status, 200)
  t.assert.strictEqual(stale.status, 409)
  t.assert.strictEqual(stale.body.code, 'EXTERNAL_SPRINT_ALREADY_BOUND')
  t.assert.strictEqual(milestones.readMilestone(root, 'S-RACE-A').external, null)
  t.assert.strictEqual(milestones.readMilestone(root, 'S-RACE-B').external.sprintId, 52)
})
