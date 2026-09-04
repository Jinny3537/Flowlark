import { after, before, test } from 'node:test'
import http from 'node:http'
import os from 'node:os'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { err } from '../src/core/errors.js'
import { appendSyncAudit } from '../src/core/sync-audit.js'
import { findSyncRecord, savePendingSync, writeKnownSyncRecord } from '../src/core/sync-queue.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

let root
let server
let base
let remote

function fakeAdapter() {
  const state = {
    sprints: new Map(), tasks: new Map(), calls: [], failNextSave: false,
    unknownNextSave: false, protocolErrorAfterSave: false, beforeNextGetSprint: null
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
      const task = { ...body, id: 20, revision: 1, sprintId: body.currentSprintId, status: 0 }
      state.tasks.set(task.id, task)
      return task
    },
    async updateTask(body) {
      state.calls.push(['updateTask', body])
      const task = { ...state.tasks.get(Number(body.id)), ...body, revision: body.revision + 1 }
      state.tasks.set(Number(task.id), task)
      return task
    },
    async moveTasks(body) { state.calls.push(['moveTasks', body]); return { ok: true } },
    async startSprint(body) { state.calls.push(['startSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'active' } },
    async endSprint(body) { state.calls.push(['endSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'ended' } },
    async cancelSprint(body) { state.calls.push(['cancelSprint', body]); return { id: body.sprintId, revision: body.revision + 1, status: 'canceled' } }
  }
}

async function isolatedPendingUpdate(t, name) {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  ctx.hub.createMilestone({ name, title: name, startAt: '2026-09-01', endAt: '2026-09-10' })
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
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
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
  ctx.hub.createProject({ name: '订单', code: 'orders' })
  ctx.hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html() })
  for (const name of ['SYNC-EXECUTE', 'SYNC-RETRY']) {
    ctx.hub.createMilestone({ name, title: name, startAt: '2026-09-01', endAt: '2026-09-10' })
  }
  remote = fakeAdapter()
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
  t.assert.deepStrictEqual(remote.state.calls.map(([name]) => name), ['saveSprint', 'getSprint'])
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
  ctx.hub.createMilestone({ name: 'RETRY-STALE', title: 'Before', startAt: '2026-09-01', endAt: '2026-09-10' })
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
  ctx.hub.createMilestone({ name: 'RETRY-LINK', title: 'Retry link', startAt: '2026-09-01', endAt: '2026-09-10' })
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
  ctx.hub.createMilestone({ name: 'PROTOCOL-CREATE', title: 'Protocol create', startAt: '2026-09-01', endAt: '2026-09-10' })
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

test('sync center applies persisted drift resolutions and ignores browser resolution pollution', async (t) => {
  const ctx = newHub()
  const isolatedRoot = ctx.root
  t.after(() => cleanup(isolatedRoot))
  ctx.hub.createProject({ name: 'Drift', code: 'drift' })
  ctx.hub.createRequirement({ code: 'REQ-DRIFT', title: 'Local title', description: 'Local body' })
  ctx.hub.addVersion('drift', { versionNo: 'v1', title: 'v1', html: html(), requirements: ['REQ-DRIFT'] })
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
  isolatedRemote.state.tasks.set(20, { ...remoteTask, title: '[REQ-DRIFT] Remote accepted', revision: 2 })
  preview = await isolatedHub.planMilestoneSync('DRIFT', {
    resolutions: { 'task:20': 'accept-remote' }
  })
  let record = findSyncRecord(isolatedRoot, 'milestone', 'DRIFT')
  t.assert.deepStrictEqual(record.intent.resolutions, { 'task:20': 'accept-remote' })
  isolatedRemote.state.calls.length = 0
  await isolatedHub.executeSyncRecord(record.id, {
    planHash: preview.hash,
    resolutions: { 'task:20': 'restore-local' }
  })
  t.assert.strictEqual(ctx.hub.getRequirement('REQ-DRIFT').title, 'Remote accepted')
  t.assert.strictEqual(isolatedRemote.state.calls.some(([name]) => name === 'updateTask'), false)

  const accepted = isolatedRemote.state.tasks.get(20)
  isolatedRemote.state.tasks.set(20, { ...accepted, title: '[REQ-DRIFT] Remote rejected', revision: 3 })
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
  t.assert.strictEqual(isolatedRemote.state.tasks.get(20).title, '[REQ-DRIFT] Remote accepted')
  t.assert.strictEqual(ctx.hub.getRequirement('REQ-DRIFT').title, 'Remote accepted')
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
