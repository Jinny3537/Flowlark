import { after, before, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

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
  const state = { sprint: null, task: null }
  return {
    async listTasks() { return state.task ? [state.task] : [] },
    async getSprint() { return state.sprint },
    async getTask() { return state.task },
    async saveSprint(body) {
      state.sprint = { ...body, id: body.id || 10, revision: Number(body.revision || 0) + 1, status: 0 }
      return state.sprint
    },
    async createTask(body) {
      state.task = { ...body, id: 20, revision: 1, sprintId: body.currentSprintId, status: 0 }
      return state.task
    },
    async updateTask(body) { state.task = { ...state.task, ...body, revision: body.revision + 1 }; return state.task },
    async moveTasks(body) { state.task.sprintId = body.toSprintId; state.task.revision++; return { ok: true } },
    async startSprint() { state.sprint.status = 'active'; state.sprint.revision++; return state.sprint },
    async endSprint() { state.sprint.status = 'ended'; state.sprint.revision++; return state.sprint },
    async cancelSprint() { state.sprint.status = 'canceled'; state.sprint.revision++; return state.sprint }
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
  ctx.hub.createRequirement({ code: 'REQ-1', title: '需求一', description: '说明', priority: 'P1', owner: 'dev' })
  ctx.hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-1'] })
  ctx.hub.createMilestone({
    name: 'S1', title: '迭代一', goal: '完成联调', owner: 'pm',
    startAt: '2026-08-01', endAt: '2026-08-21',
    items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  })
  ctx.hub.createMilestone({ name: 'S2', title: '本地迭代', startAt: '2026-09-01', endAt: '2026-09-10' })
  ctx.hub.createMilestone({ name: 'S3', title: '待取消迭代', startAt: '2026-09-11', endAt: '2026-09-20' })
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

  const plan = await call('POST', '/api/milestones/S1/sync-plan', {})
  t.assert.strictEqual(plan.status, 200)
  t.assert.match(plan.body.hash, /^sha256:/)
  t.assert.ok(plan.body.operations.some((item) => item.kind === 'sprint.create'))
  t.assert.ok(plan.body.operations.some((item) => item.kind === 'task.create'))
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
