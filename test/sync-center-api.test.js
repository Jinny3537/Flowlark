import { after, before, test } from 'node:test'
import http from 'node:http'
import os from 'node:os'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { err } from '../src/core/errors.js'
import { appendSyncAudit } from '../src/core/sync-audit.js'
import { findSyncRecord, savePendingSync, writeKnownSyncRecord } from '../src/core/sync-queue.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'
import * as milestones from '../src/core/milestones.js'
import * as requirements from '../src/core/requirements.js'

let root
let server
let base
let remote
let hub
let sharedScope

function configureSyncScope(targetHub, {
  slug = 'orders', code = 'REQ-SYNC-SCOPE', projectId = '123'
} = {}) {
  if (!targetHub.listProjects().some((project) => project.slug === slug)) {
    targetHub.createProject({ name: slug, code: slug })
  }
  targetHub.updateProject(slug, {
    sync: {
      mode: 'manual', server: 'project-task', projectId,
      managedFields: ['title', 'description', 'acceptance', 'priority', 'assignee', 'sprint']
    }
  })
  targetHub.saveMcpServer({
    id: 'project-task', name: 'project-task', type: 'stdio',
    adapter: 'assess-task', runtimeProfile: 'project-task-runtime'
  })
  targetHub.saveMcpCapability('milestones', {
    enabled: true,
    server: '',
    options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' }
  })
  if (!targetHub.listRequirements().some((requirement) => requirement.code === code)) {
    targetHub.createRequirement({ code, title: code, description: 'scope' })
  }
  if (!targetHub.listVersions(slug).some((version) => version.versionNo === 'v1')) {
    targetHub.addVersion(slug, { versionNo: 'v1', title: 'v1', html: html(), requirements: [code] })
  } else {
    targetHub.setRequirements(slug, 'v1', [code])
  }
  return [{ requirement: code, project: slug, version: 'v1' }]
}

function fakeAdapter() {
  const state = {
    sprints: new Map(), tasks: new Map(), calls: [], failNextSave: false,
    unknownNextSave: false, unknownNextTaskCreate: false,
    protocolErrorAfterSave: false, beforeNextGetSprint: null
  }
  return {
    state,
    async listTasks({ sprintId } = {}) {
      state.calls.push(['listTasks'])
      return [...state.tasks.values()].filter((task) => !sprintId || Number(task.sprintId) === Number(sprintId))
    },
    async getSprint(id) {
      state.calls.push(['getSprint', id])
      const beforeRead = state.beforeNextGetSprint
      state.beforeNextGetSprint = null
      if (beforeRead) await beforeRead()
      return state.sprints.get(Number(id)) || null
    },
    async getTask(id) { state.calls.push(['getTask', id]); return state.tasks.get(Number(id)) || null },
    async saveSprint(body) {
      state.calls.push(['saveSprint', body])
      if (state.failNextSave) {
        state.failNextSave = false
        throw err.conflict('REMOTE_TEMPORARY_FAILURE', 'temporary remote failure')
      }
      if (state.unknownNextSave) {
        state.unknownNextSave = false
        throw Object.assign(new Error('connection timed out after send'), { code: 'ETIMEDOUT' })
      }
      const sprint = { ...body, id: body.id || state.sprints.size + 10, revision: Number(body.revision || 0) + 1, status: 0 }
      state.sprints.set(Number(sprint.id), sprint)
      if (state.protocolErrorAfterSave) {
        state.protocolErrorAfterSave = false
        throw Object.assign(new Error('response was not valid MCP JSON'), { code: 'MCP_PROTOCOL_ERROR' })
      }
      return sprint
    },
    async createTask(body) {
      state.calls.push(['createTask', body])
      const task = { ...body, id: 20 + state.tasks.size, revision: 1, sprintId: body.currentSprintId, status: 0 }
      state.tasks.set(task.id, task)
      if (state.unknownNextTaskCreate) {
        state.unknownNextTaskCreate = false
        throw Object.assign(new Error('connection timed out after task send'), { code: 'ETIMEDOUT' })
      }
      return task
    },
    async updateTask(body) {
      state.calls.push(['updateTask', body])
      const task = { ...state.tasks.get(Number(body.id)), ...body, revision: body.revision + 1 }
      state.tasks.set(Number(task.id), task)
      return task
    },
    async moveTasks(body) {
      state.calls.push(['moveTasks', body])
      for (const item of body.tasks || []) {
        const task = state.tasks.get(Number(item.taskId))
        if (task) state.tasks.set(Number(item.taskId), { ...task, sprintId: body.toSprintId, revision: task.revision + 1 })
      }
      return { ok: true }
    },
    async startSprint(body) { state.calls.push(['startSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'active' } },
    async endSprint(body) { state.calls.push(['endSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'ended' } },
    async cancelSprint(body) { state.calls.push(['cancelSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'canceled' } }
  }
}

async function isolatedPendingUpdate(t, name) {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  const items = configureSyncScope(ctx.hub, { slug: `scope-${name.toLowerCase()}`, code: `REQ-${name}` })
  ctx.hub.createMilestone({ name, title: name, startAt: '2026-09-01', endAt: '2026-09-10', items })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  let preview = await isolatedHub.planMilestoneSync(name)
  await isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash })
  ctx.hub.updateMilestone(name, { goal: 'pending update' })
  preview = await isolatedHub.planMilestoneSync(name)
  return { ctx, isolatedRoot, isolatedRemote, isolatedHub, preview }
}

async function call(method, pathname, body, origin = base) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    // Synchronous Git fixtures share the server event loop. Do not reuse an
    // idle socket whose expiry can race the next POST after those fixtures.
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).catch((error) => {
    error.message += ` (${method} ${pathname}: ${error.cause?.code || ''} ${error.cause?.message || ''})`
    throw error
  })
  return { status: response.status, body: await response.json() }
}

function callFromAddress(port, address, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const request = http.request({
      host: '127.0.0.1',
      port,
      localAddress: address,
      method,
      path: pathname,
      headers: payload === null ? {} : {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }))
    })
    request.on('error', reject)
    if (payload !== null) request.write(payload)
    request.end()
  })
}

before(async () => {
  const ctx = newHub()
  root = ctx.root
  hub = ctx.hub
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html() })
  sharedScope = configureSyncScope(hub)
  for (const name of ['SYNC-EXECUTE', 'SYNC-RETRY']) {
    ctx.hub.createMilestone({ name, title: name, startAt: '2026-09-01', endAt: '2026-09-10', items: sharedScope })
  }
  remote = fakeAdapter()
  remote.state.tasks.set(20, {
    id: 20,
    projectId: 123,
    taskType: 2,
    title: '[REQ-SYNC-SCOPE] REQ-SYNC-SCOPE',
    descriptionDoc: 'scope\n\n关联原型：\n- orders/v1',
    acceptanceDoc: '',
    priority: null,
    assigneeId: null,
    planStartDate: '2026-09-01T00:00:00+08:00',
    planEndDate: '2026-09-10T00:00:00+08:00',
    revision: 1,
    sprintId: null,
    status: 0
  })
  requirements.upsertExternalTask(root, 'REQ-SYNC-SCOPE', {
    provider: 'assess-task', server: 'project-task', projectId: 123,
    taskId: 20, revision: 1, remoteStatus: 0, lastSyncHash: '', syncedAt: null
  })
  server = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: unavailableWecomMcp('test'),
    assessAdapter: remote,
    assessConfig: {
      server: { id: 'assess-task-test' },
      project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  cleanup(root)
})

test('list, audit, and detail endpoints expose stable safe shapes', async (t) => {
  const older = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'LIST-OLDER', route: '/milestones/LIST-OLDER',
    plan: { hash: 'sha256:list-older', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  }, new Date('2026-09-04T00:00:00.000Z'))
  const newer = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'LIST-NEWER', route: '/milestones/LIST-NEWER',
    plan: { hash: 'sha256:list-newer', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  }, new Date('2026-09-04T00:01:00.000Z'))
  appendSyncAudit(root, {
    syncId: newer.id, action: 'sync.previewed', status: 'pending-confirmation',
    entityType: 'milestone', entityKey: 'LIST-NEWER', after: { token: 'private-token', title: 'safe' }
  })

  const list = await call('GET', '/api/sync')
  t.assert.strictEqual(list.status, 200)
  t.assert.deepStrictEqual(list.body.items.slice(0, 2).map((item) => item.id), [newer.id, older.id])
  t.assert.deepStrictEqual(list.body.counts, { attention: 2, running: 0, completed: 0 })

  const filtered = await call('GET', '/api/sync?status=pending-confirmation')
  t.assert.strictEqual(filtered.body.items.length, 2)

  const audit = await call('GET', `/api/sync/audit?limit=20&syncId=${newer.id}`)
  t.assert.strictEqual(audit.status, 200)
  t.assert.strictEqual(audit.body.length, 1)
  t.assert.strictEqual(audit.body[0].after.token, '[REDACTED]')
  t.assert.strictEqual(audit.body[0].after.title, 'safe')

  const detail = await call('GET', `/api/sync/${newer.id}`)
  t.assert.strictEqual(detail.status, 200)
  t.assert.strictEqual(detail.body.entityKey, 'LIST-NEWER')
  const missing = await call('GET', `/api/sync/${'0'.repeat(64)}`)
  t.assert.strictEqual(missing.status, 404)
  t.assert.strictEqual(missing.body.code, 'NOT_FOUND')
})

test('execute accepts only pending milestone records and ignores browser-selected tools', async (t) => {
  const plan = (await call('POST', '/api/milestones/SYNC-EXECUTE/sync-plan', {})).body
  const record = findSyncRecord(root, 'milestone', 'SYNC-EXECUTE')
  remote.state.calls.length = 0
  const result = await call('POST', `/api/sync/${record.id}/execute`, {
    planHash: record.planHash,
    reason: '确认同步迭代范围',
    confirmUnfinished: false,
    tool: 'sprint_delete',
    toolName: 'admin_shell',
    server: 'browser-selected-server',
    operation: { kind: 'sprint.cancel' },
    command: 'delete everything'
  })
  t.assert.strictEqual(result.status, 200)
  t.assert.strictEqual(result.body.status, 'completed')
  t.assert.strictEqual(result.body.planHash, plan.hash)
  t.assert.deepStrictEqual(remote.state.calls.map(([name]) => name), [
    'getTask', 'saveSprint', 'getTask', 'moveTasks', 'getTask', 'getSprint', 'getTask'
  ])
  t.assert.doesNotMatch(JSON.stringify(remote.state.calls), /sprint_delete|admin_shell|browser-selected|delete everything/)

  const repeated = await call('POST', `/api/sync/${record.id}/execute`, { planHash: record.planHash })
  t.assert.strictEqual(repeated.status, 409)
  t.assert.strictEqual(repeated.body.code, 'SYNC_TRANSITION_INVALID')
})

test('execute rejects a stale client hash before remote execution', async (t) => {
  const pending = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'HASH-CHECK', route: '/milestones/HASH-CHECK',
    plan: { hash: 'sha256:server-owned', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  })
  remote.state.calls.length = 0
  const result = await call('POST', `/api/sync/${pending.id}/execute`, { planHash: 'sha256:browser-stale' })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_PLAN_CHANGED')
  t.assert.strictEqual(remote.state.calls.length, 0)

  const missing = await call('POST', `/api/sync/${pending.id}/execute`, null)
  t.assert.strictEqual(missing.status, 400)
  t.assert.strictEqual(missing.body.code, 'MCP_SYNC_PLAN_HASH_REQUIRED')
  const arrayBody = await call('POST', `/api/sync/${pending.id}/execute`, [{ planHash: pending.planHash }])
  t.assert.strictEqual(arrayBody.status, 400)
  t.assert.strictEqual(arrayBody.body.code, 'MCP_SYNC_PLAN_HASH_REQUIRED')
  t.assert.strictEqual(remote.state.calls.length, 0)
})

test('retry dispatches only failed or paused milestone records', async (t) => {
  await call('POST', '/api/milestones/SYNC-RETRY/sync-plan', {})
  const record = findSyncRecord(root, 'milestone', 'SYNC-RETRY')
  remote.state.failNextSave = true
  const failed = await call('POST', `/api/sync/${record.id}/execute`, { planHash: record.planHash })
  t.assert.strictEqual(failed.status, 409)
  t.assert.strictEqual(findSyncRecord(root, 'milestone', 'SYNC-RETRY').status, 'failed')

  const retried = await call('POST', `/api/sync/${record.id}/retry`, {
    reason: '远端恢复后重试', toolName: 'browser-tool', server: 'browser-server', operation: { kind: 'sprint.cancel' }
  })
  t.assert.strictEqual(retried.status, 200)
  t.assert.strictEqual(retried.body.status, 'completed')
  t.assert.doesNotMatch(JSON.stringify(remote.state.calls), /browser-tool|browser-server|sprint.cancel/)

  const pending = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'RETRY-PENDING', route: '/milestones/RETRY-PENDING',
    plan: { hash: 'sha256:retry-pending', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  })
  const rejected = await call('POST', `/api/sync/${pending.id}/retry`, {})
  t.assert.strictEqual(rejected.status, 409)
  t.assert.strictEqual(rejected.body.code, 'SYNC_TRANSITION_INVALID')
})

test('retry replaces a stale failed plan with a fresh pending preview', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  const items = configureSyncScope(ctx.hub, { slug: 'retry-stale', code: 'REQ-RETRY-STALE' })
  ctx.hub.createMilestone({ name: 'RETRY-STALE', title: 'Before', startAt: '2026-09-01', endAt: '2026-09-10', items })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  const preview = await isolatedHub.planMilestoneSync('RETRY-STALE')
  isolatedRemote.state.failNextSave = true
  await t.assert.rejects(
    isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash }),
    (error) => error.code === 'REMOTE_TEMPORARY_FAILURE'
  )
  ctx.hub.updateMilestone('RETRY-STALE', { title: 'After' })
  await t.assert.rejects(
    isolatedHub.retrySyncRecord(preview.syncId, {}),
    (error) => error.code === 'MCP_SYNC_PLAN_CHANGED'
  )
  const refreshed = findSyncRecord(isolatedRoot, 'milestone', 'RETRY-STALE')
  t.assert.strictEqual(refreshed.status, 'pending-confirmation')
  t.assert.notStrictEqual(refreshed.planHash, preview.hash)
  t.assert.strictEqual(isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length, 1)
})

test('retry refuses an uncertain sprint create until a remote link is supplied', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  const items = configureSyncScope(ctx.hub, { slug: 'retry-link', code: 'REQ-RETRY-LINK' })
  ctx.hub.createMilestone({ name: 'RETRY-LINK', title: 'Retry link', startAt: '2026-09-01', endAt: '2026-09-10', items })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  const preview = await isolatedHub.planMilestoneSync('RETRY-LINK')
  isolatedRemote.state.unknownNextSave = true
  await t.assert.rejects(
    isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'ETIMEDOUT'
  )
  await t.assert.rejects(
    isolatedHub.retrySyncRecord(preview.syncId, {}),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'ETIMEDOUT'
  )
  t.assert.strictEqual(findSyncRecord(isolatedRoot, 'milestone', 'RETRY-LINK').status, 'paused')
  t.assert.strictEqual(isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length, 1)
})

test('link-result verifies a Sprint and retry never replays create', async (t) => {
  const name = 'LINK-SPRINT'
  const items = configureSyncScope(hub, { slug: 'link-sprint', code: 'REQ-LINK-SPRINT', projectId: '223' })
  hub.createMilestone({ name, title: 'Link Sprint', startAt: '2026-12-01', endAt: '2026-12-10', items })
  const preview = (await call('POST', `/api/milestones/${name}/sync-plan`, {})).body
  remote.state.protocolErrorAfterSave = true
  const failed = await call('POST', `/api/sync/${preview.syncId}/execute`, { planHash: preview.hash })
  t.assert.strictEqual(failed.status, 409)
  t.assert.strictEqual(failed.body.code, 'MCP_SYNC_LINK_REQUIRED')
  const record = findSyncRecord(root, 'milestone', name)
  const step = record.operations.find((item) => item.kind === 'sprint.create')
  const remoteId = [...remote.state.sprints.keys()].at(-1)
  const createCount = remote.state.calls.filter(([operation]) => operation === 'saveSprint').length

  const linked = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key,
    remoteId,
    reason: '人工核对平台冲刺',
    server: 'browser-server',
    projectId: 999,
    tool: 'sprint.delete'
  })
  t.assert.strictEqual(linked.status, 200)
  t.assert.strictEqual(linked.body.status, 'paused')
  t.assert.strictEqual(linked.body.operations.find((item) => item.key === step.key).status, 'remote-complete')
  t.assert.strictEqual(linked.body.operations.find((item) => item.key === step.key).remoteResult.id, remoteId)

  const repeated = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId, reason: '重复关联'
  })
  t.assert.strictEqual(repeated.status, 409)
  t.assert.strictEqual(repeated.body.code, 'MCP_SYNC_LINK_NOT_REQUIRED')

  const retried = await call('POST', `/api/sync/${record.id}/retry`, {})
  t.assert.strictEqual(retried.status, 200)
  t.assert.strictEqual(retried.body.status, 'completed')
  t.assert.strictEqual(remote.state.calls.filter(([operation]) => operation === 'saveSprint').length, createCount)
  const afterRetry = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId, reason: '完成后再次关联'
  })
  t.assert.strictEqual(afterRetry.status, 409)
  t.assert.strictEqual(afterRetry.body.code, 'SYNC_TRANSITION_INVALID')
  const audit = (await call('GET', `/api/sync/audit?syncId=${record.id}&limit=50`)).body
  const linkedAudit = audit.find((item) => item.action === 'step.linked')
  t.assert.strictEqual(linkedAudit.before.error.code, 'MCP_SYNC_LINK_REQUIRED')
  t.assert.strictEqual(linkedAudit.after.status, 'remote-complete')
  t.assert.strictEqual(linkedAudit.after.remoteResult.id, remoteId)
  t.assert.strictEqual(linkedAudit.after.reason, '人工核对平台冲刺')
})

test('link-result verifies a task and retry never replays create', async (t) => {
  const code = 'REQ-LINK-TASK'
  const name = 'LINK-TASK'
  hub.createRequirement({ code, title: 'Link task', description: 'Task body' })
  hub.setRequirements('orders', 'v1', [code])
  hub.createMilestone({
    name, title: 'Link Task', startAt: '2026-12-11', endAt: '2026-12-20',
    items: [{ requirement: code, project: 'orders', version: 'v1' }]
  })
  const preview = (await call('POST', `/api/milestones/${name}/sync-plan`, {})).body
  remote.state.unknownNextTaskCreate = true
  const failed = await call('POST', `/api/sync/${preview.syncId}/execute`, { planHash: preview.hash })
  t.assert.strictEqual(failed.status, 409)
  t.assert.strictEqual(failed.body.code, 'MCP_SYNC_LINK_REQUIRED')
  const record = findSyncRecord(root, 'milestone', name)
  const step = record.operations.find((item) => item.kind === 'task.create')
  const remoteId = [...remote.state.tasks.keys()].at(-1)
  const createCount = remote.state.calls.filter(([operation]) => operation === 'createTask').length

  const linked = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId, reason: '人工核对平台任务'
  })
  t.assert.strictEqual(linked.status, 200)
  t.assert.strictEqual(linked.body.operations.find((item) => item.key === step.key).status, 'remote-complete')
  const retried = await call('POST', `/api/sync/${record.id}/retry`, {})
  t.assert.strictEqual(retried.status, 200)
  t.assert.strictEqual(remote.state.calls.filter(([operation]) => operation === 'createTask').length, createCount)
})

test('linked retry rejects a changed resolved target before any remote call', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  ctx.hub.createProject({ name: '订单', code: 'link-orders' })
  ctx.hub.updateProject('link-orders', {
    sync: {
      mode: 'manual', server: 'project-task', projectId: '123',
      managedFields: ['title', 'description', 'acceptance', 'priority', 'assignee', 'sprint']
    }
  })
  for (const id of ['project-task', 'changed-task']) {
    ctx.hub.saveMcpServer({
      id, name: id, type: 'stdio', adapter: 'assess-task', runtimeProfile: `${id}-runtime`
    })
  }
  ctx.hub.saveMcpCapability('milestones', {
    enabled: true,
    server: '',
    options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' }
  })
  ctx.hub.createRequirement({ code: 'REQ-LINK-TARGET', title: 'Link target requirement' })
  ctx.hub.addVersion('link-orders', {
    versionNo: 'v1', title: 'v1', html: html(), requirements: ['REQ-LINK-TARGET']
  })
  ctx.hub.createMilestone({
    name: 'LINK-TARGET-CHANGED', title: 'Link target changed', startAt: '2027-03-01', endAt: '2027-03-10',
    items: [{ requirement: 'REQ-LINK-TARGET', project: 'link-orders', version: 'v1' }]
  })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  const preview = await isolatedHub.planMilestoneSync('LINK-TARGET-CHANGED')
  isolatedRemote.state.protocolErrorAfterSave = true
  await t.assert.rejects(
    isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED'
  )
  const record = findSyncRecord(isolatedRoot, 'milestone', 'LINK-TARGET-CHANGED')
  const step = record.operations.find((item) => item.kind === 'sprint.create')
  const remoteId = [...isolatedRemote.state.sprints.keys()][0]
  await isolatedHub.linkSyncResult(record.id, {
    operationKey: step.key, remoteId, reason: '人工核对平台冲刺'
  })
  ctx.hub.updateProject('link-orders', {
    sync: {
      mode: 'manual', server: 'changed-task', projectId: '456',
      managedFields: ['title', 'description', 'acceptance', 'priority', 'assignee', 'sprint']
    }
  })
  isolatedRemote.state.calls.length = 0

  await t.assert.rejects(
    isolatedHub.retrySyncRecord(record.id, {}),
    (error) => error.code === 'MCP_SYNC_PLAN_CHANGED'
  )
  t.assert.strictEqual(isolatedRemote.state.calls.length, 0)
  t.assert.strictEqual(findSyncRecord(isolatedRoot, 'milestone', 'LINK-TARGET-CHANGED').status, 'paused')
})

test('link-result rejects invalid, wrong-project, mismatched, and occupied Sprint candidates', async (t) => {
  async function pausedSprint(name) {
    const slug = `scope-${name.toLowerCase()}`
    const items = configureSyncScope(hub, { slug, code: `REQ-${name}` })
    hub.createMilestone({ name, title: name, startAt: '2027-01-01', endAt: '2027-01-10', items })
    const preview = (await call('POST', `/api/milestones/${name}/sync-plan`, {})).body
    remote.state.protocolErrorAfterSave = true
    await call('POST', `/api/sync/${preview.syncId}/execute`, { planHash: preview.hash })
    const record = findSyncRecord(root, 'milestone', name)
    return { record, step: record.operations.find((item) => item.kind === 'sprint.create') }
  }

  const missing = await pausedSprint('LINK-MISSING')
  let result = await call('POST', `/api/sync/${missing.record.id}/link-result`, {
    operationKey: missing.step.key, remoteId: 99901, reason: '核对不存在对象'
  })
  t.assert.strictEqual(result.status, 404)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_RESULT_NOT_FOUND')

  const wrongProject = await pausedSprint('LINK-WRONG-PROJECT')
  remote.state.sprints.set(99902, {
    ...wrongProject.step.operation.after, id: 99902, projectId: 999, revision: 1, status: 0
  })
  result = await call('POST', `/api/sync/${wrongProject.record.id}/link-result`, {
    operationKey: wrongProject.step.key, remoteId: 99902, reason: '核对错误项目'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_PROJECT_MISMATCH')

  const mismatch = await pausedSprint('LINK-MISMATCH')
  remote.state.sprints.set(99903, {
    ...mismatch.step.operation.after, sprintName: '另一个冲刺', id: 99903, projectId: 123, revision: 1, status: 0
  })
  result = await call('POST', `/api/sync/${mismatch.record.id}/link-result`, {
    operationKey: mismatch.step.key, remoteId: 99903, reason: '核对错误对象'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_IDENTITY_MISMATCH')

  const occupied = await pausedSprint('LINK-OCCUPIED')
  remote.state.sprints.set(99904, {
    ...occupied.step.operation.after, id: 99904, projectId: 123, revision: 1, status: 0
  })
  hub.createMilestone({ name: 'LINK-OCCUPIER', title: '占用者' })
  milestones.updateMilestone(root, 'LINK-OCCUPIER', {
    external: { provider: 'assess-task', server: occupied.record.plan.server, projectId: 123, sprintId: 99904 }
  }, { system: true })
  result = await call('POST', `/api/sync/${occupied.record.id}/link-result`, {
    operationKey: occupied.step.key, remoteId: 99904, reason: '核对已占用对象'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_SPRINT_ALREADY_BOUND')
})

test('link-result rejects invalid, wrong-project, mismatched, wrong-Sprint, and occupied task candidates', async (t) => {
  const code = 'REQ-LINK-TASK-INVALID'
  const name = 'LINK-TASK-INVALID'
  hub.createRequirement({ code, title: 'Link task validation', description: 'Task body' })
  hub.setRequirements('orders', 'v1', [code])
  hub.createMilestone({
    name, title: 'Link Task Validation', startAt: '2027-02-01', endAt: '2027-02-10',
    items: [{ requirement: code, project: 'orders', version: 'v1' }]
  })
  const preview = (await call('POST', `/api/milestones/${name}/sync-plan`, {})).body
  remote.state.unknownNextTaskCreate = true
  await call('POST', `/api/sync/${preview.syncId}/execute`, { planHash: preview.hash })
  const record = findSyncRecord(root, 'milestone', name)
  const step = record.operations.find((item) => item.kind === 'task.create')
  const sprintId = milestones.readMilestone(root, name).external.sprintId
  const candidate = (id, patch = {}) => ({
    ...step.operation.after,
    id,
    projectId: record.plan.projectId,
    sprintId,
    revision: 1,
    status: 0,
    ...patch
  })

  let result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 0, reason: '非法 ID'
  })
  t.assert.strictEqual(result.status, 400)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_REMOTE_ID_INVALID')

  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: 'task:missing:create', remoteId: 91990, reason: '错误步骤'
  })
  t.assert.strictEqual(result.status, 404)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_OPERATION_NOT_FOUND')

  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 91991, reason: '不存在任务'
  })
  t.assert.strictEqual(result.status, 404)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_RESULT_NOT_FOUND')

  remote.state.tasks.set(91992, candidate(91992, { projectId: 999 }))
  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 91992, reason: '错误项目'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_PROJECT_MISMATCH')

  remote.state.tasks.set(91993, candidate(91993, { title: '另一项任务' }))
  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 91993, reason: '字段不一致'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_IDENTITY_MISMATCH')

  remote.state.tasks.set(91996, candidate(91996, { taskType: Number(step.operation.after.taskType) + 1 }))
  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 91996, reason: '任务类型不一致'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_IDENTITY_MISMATCH')

  remote.state.tasks.set(91994, candidate(91994, { sprintId: Number(sprintId) + 1 }))
  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: 91994, reason: '冲刺不一致'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'MCP_SYNC_LINK_SPRINT_MISMATCH')

  const occupiedCode = 'REQ-LINK-TASK-OCCUPIER'
  hub.createRequirement({ code: occupiedCode, title: '占用任务' })
  const occupied = candidate(91995)
  remote.state.tasks.set(occupied.id, occupied)
  requirements.upsertExternalTask(root, occupiedCode, {
    provider: 'assess-task',
    server: record.plan.server,
    projectId: record.plan.projectId,
    taskId: occupied.id
  })
  result = await call('POST', `/api/sync/${record.id}/link-result`, {
    operationKey: step.key, remoteId: occupied.id, reason: '任务已占用'
  })
  t.assert.strictEqual(result.status, 409)
  t.assert.strictEqual(result.body.code, 'EXTERNAL_TASK_ALREADY_BOUND')
})

test('a cancel during execute plan rebuild wins before any stale remote write', async (t) => {
  const { isolatedRoot, isolatedRemote, isolatedHub, preview } = await isolatedPendingUpdate(t, 'RACE-CANCEL')
  const record = findSyncRecord(isolatedRoot, 'milestone', 'RACE-CANCEL')
  let releaseRead
  let markReadStarted
  const readStarted = new Promise((resolve) => { markReadStarted = resolve })
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  isolatedRemote.state.beforeNextGetSprint = async () => { markReadStarted(); await readGate }
  const saveCount = isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length

  const executing = isolatedHub.executeSyncRecord(record.id, { planHash: preview.hash })
  await readStarted
  const canceled = isolatedHub.cancelSyncRecord(record.id, 'cancel while rebuilding')
  releaseRead()

  await t.assert.rejects(executing, (error) => error.code === 'SYNC_TRANSITION_INVALID')
  t.assert.strictEqual(canceled.status, 'canceled')
  t.assert.strictEqual(findSyncRecord(isolatedRoot, 'milestone', 'RACE-CANCEL').status, 'canceled')
  t.assert.strictEqual(isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length, saveCount)
})

test('a replacement preview during execute plan rebuild wins before any stale remote write', async (t) => {
  const { ctx, isolatedRoot, isolatedRemote, isolatedHub, preview } = await isolatedPendingUpdate(t, 'RACE-PREVIEW')
  const record = findSyncRecord(isolatedRoot, 'milestone', 'RACE-PREVIEW')
  let releaseRead
  let markReadStarted
  const readStarted = new Promise((resolve) => { markReadStarted = resolve })
  const readGate = new Promise((resolve) => { releaseRead = resolve })
  isolatedRemote.state.beforeNextGetSprint = async () => { markReadStarted(); await readGate }
  const saveCount = isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length

  const executing = isolatedHub.executeSyncRecord(record.id, { planHash: preview.hash })
  await readStarted
  ctx.hub.updateMilestone('RACE-PREVIEW', { goal: 'new replacement preview' })
  const replacement = await isolatedHub.planMilestoneSync('RACE-PREVIEW')
  releaseRead()

  await t.assert.rejects(executing, (error) => error.code === 'MCP_SYNC_PLAN_CHANGED')
  const current = findSyncRecord(isolatedRoot, 'milestone', 'RACE-PREVIEW')
  t.assert.strictEqual(current.status, 'pending-confirmation')
  t.assert.strictEqual(current.planHash, replacement.hash)
  t.assert.notStrictEqual(current.planHash, preview.hash)
  t.assert.strictEqual(isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length, saveCount)
})

test('retry never repeats a create whose remote response failed MCP protocol parsing', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  const items = configureSyncScope(ctx.hub, { slug: 'protocol-create', code: 'REQ-PROTOCOL-CREATE' })
  ctx.hub.createMilestone({ name: 'PROTOCOL-CREATE', title: 'Protocol create', startAt: '2026-09-01', endAt: '2026-09-10', items })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  const preview = await isolatedHub.planMilestoneSync('PROTOCOL-CREATE')
  isolatedRemote.state.protocolErrorAfterSave = true
  await t.assert.rejects(
    isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash }),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'MCP_PROTOCOL_ERROR'
  )
  await t.assert.rejects(
    isolatedHub.retrySyncRecord(preview.syncId, {}),
    (error) => error.code === 'MCP_SYNC_LINK_REQUIRED' && error.causeCode === 'MCP_PROTOCOL_ERROR'
  )
  t.assert.strictEqual(isolatedRemote.state.sprints.size, 1)
  t.assert.strictEqual(isolatedRemote.state.calls.filter(([name]) => name === 'saveSprint').length, 1)
})

test('sync center keeps Flowlark authoritative and ignores browser resolution pollution', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  ctx.hub.createProject({ name: 'Drift', code: 'drift' })
  ctx.hub.createRequirement({ code: 'REQ-DRIFT', title: 'Local title', description: 'Local body' })
  ctx.hub.addVersion('drift', { versionNo: 'v1', title: 'v1', html: html(), requirements: ['REQ-DRIFT'] })
  configureSyncScope(ctx.hub, { slug: 'drift', code: 'REQ-DRIFT' })
  ctx.hub.createMilestone({
    name: 'DRIFT', title: 'Drift', startAt: '2026-09-01', endAt: '2026-09-10',
    items: [{ requirement: 'REQ-DRIFT', project: 'drift', version: 'v1' }]
  })
  const isolatedRemote = fakeAdapter()
  const isolatedHub = new ctx.hub.constructor(isolatedRoot, {
    assessAdapter: isolatedRemote,
    assessConfig: {
      server: { id: 'assess-task-test' }, project: '123',
      capability: { options: { ownerId: 7, taskType: 2, timezoneOffset: '+08:00' } }
    }
  })
  let preview = await isolatedHub.planMilestoneSync('DRIFT')
  await isolatedHub.executeSyncRecord(preview.syncId, { planHash: preview.hash })

  const remoteTask = isolatedRemote.state.tasks.get(20)
  isolatedRemote.state.tasks.set(20, { ...remoteTask, title: '[REQ-DRIFT] Remote drift', revision: 2 })
  preview = await isolatedHub.planMilestoneSync('DRIFT', {
    resolutions: { 'task:20': 'accept-remote' }
  })
  let record = findSyncRecord(isolatedRoot, 'milestone', 'DRIFT')
  t.assert.deepStrictEqual(record.intent.resolutions, {})
  t.assert.ok(preview.blockers.some((item) => item.code === 'REMOTE_DRIFT'))

  preview = await isolatedHub.planMilestoneSync('DRIFT', {
    resolutions: { 'task:20': 'restore-local' }
  })
  record = findSyncRecord(isolatedRoot, 'milestone', 'DRIFT')
  isolatedRemote.state.calls.length = 0
  await isolatedHub.executeSyncRecord(record.id, {
    planHash: preview.hash,
    reason: 'restore reviewed local value',
    resolutions: { 'task:20': 'accept-remote' }
  })
  t.assert.ok(isolatedRemote.state.calls.some(([name]) => name === 'updateTask'))
  t.assert.strictEqual(isolatedRemote.state.tasks.get(20).title, '[REQ-DRIFT] Local title')
  t.assert.strictEqual(ctx.hub.getRequirement('REQ-DRIFT').title, 'Local title')
})

test('cancel requires a reason and only cancels an eligible record', async (t) => {
  const record = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'CANCEL', route: '/milestones/CANCEL',
    plan: { hash: 'sha256:cancel', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  })
  const nullBody = await call('POST', `/api/sync/${record.id}/cancel`, null)
  t.assert.strictEqual(nullBody.status, 400)
  t.assert.strictEqual(nullBody.body.code, 'SYNC_CANCEL_REASON_REQUIRED')
  const missing = await call('POST', `/api/sync/${record.id}/cancel`, { reason: '  ' })
  t.assert.strictEqual(missing.status, 400)
  t.assert.strictEqual(missing.body.code, 'SYNC_CANCEL_REASON_REQUIRED')
  const canceled = await call('POST', `/api/sync/${record.id}/cancel`, { reason: '范围取消' })
  t.assert.strictEqual(canceled.status, 200)
  t.assert.strictEqual(canceled.body.status, 'canceled')
  t.assert.strictEqual(canceled.body.reason, '范围取消')
  const actions = (await call('GET', `/api/sync/audit?limit=20&syncId=${record.id}`)).body
    .map((entry) => entry.action)
    .reverse()
  t.assert.deepStrictEqual(actions.slice(-2), ['sync.cancel-requested', 'sync.canceled'])
})

test('unknown entity types are rejected before resolving an adapter', async (t) => {
  const record = writeKnownSyncRecord(root, {
    entityType: 'requirement', entityKey: 'REQ-UNKNOWN', route: '/requirements/REQ-UNKNOWN',
    status: 'pending-confirmation', planHash: 'sha256:unknown', plan: { hash: 'sha256:unknown', operations: [] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), operations: []
  })
  remote.state.calls.length = 0
  const result = await call('POST', `/api/sync/${record.id}/execute`, { planHash: record.planHash })
  t.assert.strictEqual(result.status, 400)
  t.assert.strictEqual(result.body.code, 'SYNC_ENTITY_UNSUPPORTED')
  t.assert.strictEqual(remote.state.calls.length, 0)
})

test('read-only LAN mode blocks Sync Center writes while preserving reads', async (t) => {
  const address = Object.values(os.networkInterfaces()).flat()
    .find((item) => item && !item.internal && (item.family === 'IPv4' || item.family === 4))?.address
  if (!address) return t.skip('no non-loopback IPv4 address available')
  const record = savePendingSync(root, {
    entityType: 'milestone', entityKey: 'LAN-READONLY', route: '/milestones/LAN-READONLY',
    plan: { hash: 'sha256:lan-readonly', expiresAt: '2026-12-01T00:00:00.000Z', operations: [] }
  })
  const lanServer = await startServer(root, {
    port: 0, previewPort: 0, lan: true, assessAdapter: remote, wecomMcp: unavailableWecomMcp('test')
  })
  try {
    const read = await callFromAddress(lanServer.port, address, 'GET', '/api/sync')
    t.assert.strictEqual(read.status, 200)
    const write = await callFromAddress(
      lanServer.port, address, 'POST', `/api/sync/${record.id}/cancel`, { reason: 'remote user' }
    )
    t.assert.strictEqual(write.status, 403)
    t.assert.strictEqual(write.body.code, 'READONLY_FROM_LAN')
  } finally {
    await lanServer.close()
  }
})
