import { after, before, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'
import { err } from '../src/core/errors.js'
import { findSyncRecord } from '../src/core/sync-queue.js'
import { listSyncAudit } from '../src/core/sync-audit.js'
import * as milestones from '../src/core/milestones.js'

let root
let server
let base
let remote
let previousHome
let previousAssessPassword

const mapping = {
  server: 'assess-task-test', projectId: 123, ownerId: 7, taskType: 2,
  priorities: { P1: 1 }, members: { dev: 8 }, timezoneOffset: '+08:00'
}

function fakeAdapter() {
  const state = { sprint: null, task: null, calls: [], failNextSave: false }
  return {
    state,
    async listTasks() { state.calls.push('listTasks'); return state.task ? [state.task] : [] },
    async getSprint() { state.calls.push('getSprint'); return state.sprint },
    async getTask() { state.calls.push('getTask'); return state.task },
    async saveSprint(body) {
      state.calls.push('saveSprint')
      if (state.failNextSave) {
        state.failNextSave = false
        throw err.conflict('REMOTE_VALIDATION_FAILED', 'known validation failure')
      }
      state.sprint = { ...body, id: body.id || 10, revision: Number(body.revision || 0) + 1, status: 0 }
      return state.sprint
    },
    async createTask(body) {
      state.calls.push('createTask')
      state.task = { ...body, id: 20, revision: 1, sprintId: body.currentSprintId, status: 0 }
      return state.task
    },
    async updateTask(body) { state.calls.push('updateTask'); state.task = { ...state.task, ...body, revision: body.revision + 1 }; return state.task },
    async moveTasks(body) { state.calls.push('moveTasks'); state.task.sprintId = body.toSprintId; state.task.revision++; return { ok: true } },
    async startSprint() { state.calls.push('startSprint'); state.sprint.status = 'active'; state.sprint.revision++; return state.sprint },
    async endSprint() { state.calls.push('endSprint'); state.sprint.status = 'ended'; state.sprint.revision++; return state.sprint },
    async cancelSprint() { state.calls.push('cancelSprint'); state.sprint.status = 'canceled'; state.sprint.revision++; return state.sprint }
  }
}

before(async () => {
  const ctx = newHub()
  root = ctx.root
  previousHome = process.env.FLOWLARK_HOME
  previousAssessPassword = process.env.ASSESS_PASSWORD
  process.env.FLOWLARK_HOME = path.join(root, '.test-flowlark-home')
  process.env.ASSESS_PASSWORD = 'test-only-password'
  ctx.hub.createProject({ name: '订单', code: 'orders' })
  ctx.hub.createProject({ name: '库存', code: 'inventory' })
  ctx.hub.createRequirement({ code: 'REQ-1', title: '需求一', description: '说明', priority: 'P1', owner: 'dev' })
  ctx.hub.createRequirement({ code: 'REQ-2', title: '需求二', description: '说明', priority: 'P1', owner: 'dev' })
  ctx.hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-1'] })
  ctx.hub.addVersion('inventory', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-2'] })
  ctx.hub.createMilestone({
    name: 'S1', title: '迭代一', goal: '完成联调', owner: 'pm',
    startAt: '2026-08-01', endAt: '2026-08-21',
    items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  })
  ctx.hub.createMilestone({ name: 'S2', title: '本地迭代', startAt: '2026-09-01', endAt: '2026-09-10' })
  ctx.hub.createMilestone({ name: 'S3', title: '待取消迭代', startAt: '2026-09-11', endAt: '2026-09-20' })
  ctx.hub.createMilestone({ name: 'S5', title: '进行中迭代', goal: '验证范围变更', owner: 'pm', startAt: '2026-09-21', endAt: '2026-09-30', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }] })
  ctx.hub.createMilestone({ name: 'S6', title: '可信策略迭代', startAt: '2026-10-01', endAt: '2026-10-10', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }] })
  ctx.hub.createMilestone({ name: 'S7', title: '跨项目迭代', startAt: '2026-10-11', endAt: '2026-10-20', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }, { requirement: 'REQ-2', project: 'inventory', version: 'v1' }] })
  ctx.hub.createMilestone({ name: 'S8', title: '待开始迭代', startAt: '2026-10-21', endAt: '2026-10-30' })
  ctx.hub.createMilestone({ name: 'S9', title: '旧路由旁路保护', startAt: '2026-11-01', endAt: '2026-11-10' })
  ctx.hub.createMilestone({ name: 'S10', title: '无预览保护', startAt: '2026-11-11', endAt: '2026-11-20' })
  ctx.hub.createMilestone({ name: 'S11', title: '空输入预览', startAt: '2026-11-21', endAt: '2026-11-30' })
  ctx.hub.createMilestone({ name: 'S12', title: '空输入恢复', startAt: '2026-12-01', endAt: '2026-12-10' })
  milestones.updateMilestone(root, 'S5', { status: 'active' }, { system: true })
  milestones.updateMilestone(root, 'S8', { status: 'frozen' }, { system: true })
  remote = fakeAdapter()
  server = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: unavailableWecomMcp('test'),
    assessAdapter: remote,
    assessConfig: { server: { id: 'assess-task-test' }, project: '123', capability: { options: mapping } },
    mcpClientManager: {
      async connect() {
        return {
          listTools: async () => [{ name: 'task_current_user', description: '当前用户', inputSchema: { type: 'object', properties: {} } }],
          close: async () => {}
        }
      }
    }
  })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  if (previousHome === undefined) delete process.env.FLOWLARK_HOME
  else process.env.FLOWLARK_HOME = previousHome
  if (previousAssessPassword === undefined) delete process.env.ASSESS_PASSWORD
  else process.env.ASSESS_PASSWORD = previousAssessPassword
  cleanup(root)
})

async function call(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

test('preflight and plan endpoints expose blockers and deterministic operations', async (t) => {
  const preflight = await call('GET', '/api/milestones/S1/preflight')
  t.assert.strictEqual(preflight.status, 200)
  t.assert.strictEqual(preflight.body.ready, false)
  t.assert.ok(preflight.body.blockers.length > 0)

  const plan = await call('POST', '/api/milestones/S1/sync-plan', {
    resolutions: { 'task:20': 'accept-remote', unsafe: 'delete-remote' }
  })
  t.assert.strictEqual(plan.status, 200)
  t.assert.match(plan.body.hash, /^sha256:/)
  t.assert.ok(plan.body.operations.some((item) => item.kind === 'sprint.create'))
  t.assert.ok(plan.body.operations.some((item) => item.kind === 'task.create'))
  const queued = findSyncRecord(root, 'milestone', 'S1')
  t.assert.deepStrictEqual({
    entityType: queued.entityType,
    entityKey: queued.entityKey,
    route: queued.route,
    status: queued.status,
    planHash: queued.planHash,
    mode: queued.mode
  }, {
    entityType: 'milestone',
    entityKey: 'S1',
    route: '/milestones/S1',
    status: 'pending-confirmation',
    planHash: plan.body.hash,
    mode: 'manual'
  })
  t.assert.strictEqual(plan.body.syncId, queued.id)
  t.assert.strictEqual(plan.body.syncStatus, 'pending-confirmation')
  t.assert.deepStrictEqual(queued.intent, {
    action: null,
    scopeItems: null,
    reason: '',
    resolutions: { 'task:20': 'accept-remote' }
  })
  t.assert.strictEqual(listSyncAudit(root, { syncId: queued.id })[0].action, 'sync.previewed')
})

test('legacy single-milestone sync route only creates a server-owned preview', async (t) => {
  const result = await call('POST', '/api/milestones/S2/sync', {
    provider: 'attacker', config: { projectId: 999 }, tool: 'sprint_delete',
    mapping: { projectId: 999, ownerId: 999, taskType: 999 }
  })
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.syncStatus, 'pending-confirmation')
  t.assert.strictEqual(result.body.projectId, 123)
  t.assert.strictEqual(milestones.readMilestone(root, 'S2').external, null)
})

test('sync center executes the persisted lifecycle intent instead of browser fields', async (t) => {
  const plan = (await call('POST', '/api/milestones/S8/sync-plan', { action: 'start' })).body
  const record = findSyncRecord(root, 'milestone', 'S8')
  t.assert.strictEqual(record.intent.action, 'start')
  remote.state.calls.length = 0
  const result = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: plan.hash,
    action: 'cancel',
    reason: '开始执行',
    confirmUnfinished: true,
    mapping: { projectId: 999 }
  })
  t.assert.strictEqual(result.status, 200)
  t.assert.ok(remote.state.calls.includes('startSprint'))
  t.assert.ok(!remote.state.calls.includes('cancelSprint'))
  t.assert.strictEqual(milestones.readMilestone(root, 'S8').status, 'active')
})

test('legacy execute and resume routes cannot bypass queue lifecycle states', async (t) => {
  const plan = (await call('POST', '/api/milestones/S9/sync-plan', {})).body
  const record = findSyncRecord(root, 'milestone', 'S9')
  await call('POST', `/api/sync/${record.id}/cancel`, { reason: '暂不执行' })
  remote.state.calls.length = 0

  let result = await call('POST', '/api/milestones/S9/sync-execute', {
    confirmed: true,
    planHash: plan.hash
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'SYNC_TRANSITION_INVALID')
  result = await call('POST', '/api/milestones/S9/sync-resume', {})
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'SYNC_TRANSITION_INVALID')
  result = await call('POST', '/api/milestones/S10/sync-execute', {
    confirmed: true,
    planHash: 'sha256:not-previewed'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_PREVIEW_REQUIRED')
  t.assert.strictEqual(remote.state.calls.length, 0)
})

test('plan and resume APIs normalize null bodies without a server error', async (t) => {
  let result = await call('POST', '/api/milestones/S11/sync-plan', null)
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.syncStatus, 'pending-confirmation')

  const preview = (await call('POST', '/api/milestones/S12/sync-plan', null)).body
  remote.state.failNextSave = true
  result = await call('POST', '/api/milestones/S12/sync-execute', {
    confirmed: true,
    planHash: preview.hash
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'S12').status, 'failed')
  result = await call('POST', '/api/milestones/S12/sync-resume', null)
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.status, 'completed')
})

test('execute endpoint requires confirmation and matching plan hash', async (t) => {
  const plan = (await call('POST', '/api/milestones/S1/sync-plan', {})).body
  let result = await call('POST', '/api/milestones/S1/sync-execute', { planHash: plan.hash })
  t.assert.strictEqual(result.status, 400)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_CONFIRMATION_REQUIRED')

  result = await call('POST', '/api/milestones/S1/sync-execute', { planHash: plan.hash, confirmed: true })
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.status, 'completed')
  t.assert.doesNotMatch(JSON.stringify(result.body), /ASSESS_PASSWORD|private-password/)

  const milestone = await call('GET', '/api/milestones/S1')
  t.assert.strictEqual(milestone.body.external.sprintId, 10)
  const journal = await call('GET', '/api/milestones/S1/sync-journal')
  t.assert.strictEqual(journal.body.status, 'completed')
  const execution = await call('GET', '/api/milestones/S1/execution')
  t.assert.strictEqual(execution.status, 200)
  t.assert.strictEqual(execution.body.sprint.id, 10)
  t.assert.strictEqual(execution.body.tasks.total, 1)
})

test('trusted-auto remains descriptive and cross-project previews stay manual', async (t) => {
  await call('PUT', '/api/projects/orders', { sync: { mode: 'trusted-auto' } })
  await call('PUT', '/api/projects/inventory', { sync: { mode: 'trusted-auto' } })

  const trusted = await call('POST', '/api/milestones/S6/sync-plan', {})
  t.assert.strictEqual(trusted.status, 200)
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'S6').mode, 'trusted-auto')
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'S6').status, 'pending-confirmation')
  t.assert.strictEqual(milestones.readMilestone(root, 'S6').external, null)

  const crossProject = await call('POST', '/api/milestones/S7/sync-plan', {})
  t.assert.strictEqual(crossProject.status, 200)
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'S7').mode, 'manual')
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'S7').status, 'pending-confirmation')

  await call('PUT', '/api/projects/orders', { sync: { mode: 'manual' } })
  await call('PUT', '/api/projects/inventory', { sync: { mode: 'manual' } })
})

test('local lifecycle transitions remain explicit', async (t) => {
  const result = await call('POST', '/api/milestones/S2/transition', { target: 'reviewing' })
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.status, 'reviewing')
})

test('runtime profile API stores no password and returns executable diagnostics', async (t) => {
  const command = path.join(root, 'fake-assess-task-mcp')
  fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const saved = await call('PUT', '/api/mcp/runtime/assess-task-local', {
    command,
    args: [],
    baseUrl: 'https://assess.example.com',
    account: 'tester'
  })
  t.assert.strictEqual(saved.status, 200)
  t.assert.doesNotMatch(JSON.stringify(saved.body), /password/i)
  const diagnostic = await call('POST', '/api/mcp/runtime/assess-task-local/diagnose', {})
  t.assert.strictEqual(diagnostic.status, 200)
  t.assert.strictEqual(diagnostic.body.ready, true)
  const logical = await call('PUT', '/api/mcp/servers/assess-task-local', {
    name: '研发任务管理', type: 'stdio', adapter: 'assess-task', runtimeProfile: 'assess-task-local', timeoutMs: 1000
  })
  t.assert.strictEqual(logical.status, 200)
  const discovered = await call('POST', '/api/mcp/servers/assess-task-local/discover', {})
  t.assert.strictEqual(discovered.status, 200)
  t.assert.deepStrictEqual(discovered.body.tools.map((tool) => tool.name), ['task_current_user'])
  const capability = await call('PUT', '/api/mcp/capabilities/milestones', {
    enabled: true,
    server: 'assess-task-local',
    project: '123',
    options: { ownerId: 7, taskType: 2, priorities: { P1: 1 } }
  })
  t.assert.strictEqual(capability.status, 200)
  const freeze = await call('GET', '/api/milestones/S2/preflight')
  t.assert.ok(freeze.body.blockers.some((blocker) => blocker.code === 'MILESTONE_SYNC_REQUIRED'))
})

test('canceling a local iteration requires an audited reason', async (t) => {
  let result = await call('POST', '/api/milestones/S3/transition', { target: 'canceled' })
  t.assert.strictEqual(result.status, 400)
  t.assert.strictEqual(result.body.code, 'MILESTONE_REASON_REQUIRED')
  result = await call('POST', '/api/milestones/S3/transition', { target: 'canceled', reason: '范围调整' })
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.status, 'canceled')
})

test('active scope plans require a reason and carry a local scope operation', async (t) => {
  const scopeItems = [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  let result = await call('POST', '/api/milestones/S5/sync-plan', { scopeItems })
  t.assert.strictEqual(result.status, 400)
  t.assert.strictEqual(result.body.code, 'MILESTONE_REASON_REQUIRED')
  result = await call('POST', '/api/milestones/S5/sync-plan', { scopeItems, reason: '调整进行中范围' })
  t.assert.strictEqual(result.status, 200)
  t.assert.ok(result.body.operations.some((operation) => operation.kind === 'local.scope-change'))
  const record = findSyncRecord(root, 'milestone', 'S5')
  t.assert.deepStrictEqual(record.intent.scopeItems, scopeItems)
  t.assert.strictEqual(record.intent.reason, '调整进行中范围')
  const executed = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: result.body.hash,
    reason: '调整进行中范围',
    confirmUnfinished: true,
    scopeItems: []
  })
  t.assert.strictEqual(executed.status, 200)
  t.assert.deepStrictEqual(milestones.readMilestone(root, 'S5').items, scopeItems)
})
