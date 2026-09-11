import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import * as milestones from '../src/core/milestones.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))
function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-1', title: '需求' })
  hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html() })
  hub.createMilestone({ name: 'S1', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }],
    external: { provider: 'assess-task', server: 'platform', projectId: 1, sprintId: 10 } })
  milestones.updateMilestone(root, 'S1', { status: 'active' }, { system: true })
  const remote = { sprint: { id: 10, projectId: 1, revision: 1, status: 'active' }, version: { id: 20, projectId: 1, revision: 1, status: 'active' } }
  const calls = []
  hub.assessConfig = { server: { id: 'platform' }, project: '1', capability: { options: { releaseClosure: {
    sprintEndedStatuses: ['ended'], versionClosedStatuses: ['closed'], taskCompletedStatuses: ['done']
  } } } }
  hub.assessAdapter = {
    async getSprint() { return { ...remote.sprint } },
    async getVersion() { return { ...remote.version } },
    async listTasks() { return [{ status: 'done' }] },
    async endSprint(body) { calls.push(['end', body]); remote.sprint.status = 'ended' },
    async closeVersion(body) { calls.push(['close', body]); remote.version.status = 'closed' }
  }
  hub.bindVersionRelease('orders', 'v1', { versionId: 20 })
  return { root, hub, remote, calls }
}

test('one online action ends sprint and closes version without completing tasks', async () => {
  const { root, hub, calls } = fixture()
  const v = await hub.markVersionOnline('orders', 'v1')
  assert.equal(v.deliveryStatus, 'online')
  assert.equal(v.onlineSync.status, 'completed')
  assert.deepEqual(calls.map((c) => c[0]), ['end', 'close'])
  assert.equal(calls[0][1].confirmUnfinished, false)
  assert.equal(milestones.readMilestone(root, 'S1').status, 'delivered')
  await hub.markVersionOnline('orders', 'v1')
  assert.equal(calls.length, 2)
})

test('partial failure keeps online fact and retries only unfinished operation', async () => {
  const { hub, calls, remote } = fixture()
  hub.assessAdapter.closeVersion = async () => { calls.push(['failed-close']); throw new Error('offline') }
  const first = await hub.markVersionOnline('orders', 'v1')
  assert.equal(first.deliveryStatus, 'online')
  assert.equal(first.onlineSync.status, 'failed')
  assert.equal(first.onlineSync.operations[0].status, 'completed')
  hub.assessAdapter.closeVersion = async () => { calls.push(['close']); remote.version.status = 'closed' }
  const next = await hub.markVersionOnline('orders', 'v1')
  assert.equal(next.onlineSync.status, 'completed')
  assert.equal(next.onlineAt, first.onlineAt)
  assert.equal(calls.filter((c) => c[0] === 'end').length, 1)
})

test('lost response reconciles remote success instead of repeating end', async () => {
  const { hub, calls, remote } = fixture()
  hub.assessAdapter.endSprint = async () => { calls.push(['end']); remote.sprint.status = 'ended'; throw new Error('timeout') }
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.status, 'failed')
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.status, 'completed')
  assert.equal(calls.filter((c) => c[0] === 'end').length, 1)
})

test('shared sprint blocks writes including duplicate local bindings', async () => {
  const { root, hub, calls } = fixture()
  hub.addVersion('orders', { versionNo: 'v2', title: '二版', html: html() })
  hub.createMilestone({ name: 'S2', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v2' }],
    external: { provider: 'assess-task', server: 'platform', projectId: 1, sprintId: 10 } })
  await assert.rejects(hub.markVersionOnline('orders', 'v1'), { code: 'ONLINE_SHARED_SPRINT' })
  assert.equal(calls.length, 0)
  assert.equal(store.readVersion(root, 'orders', 'v1').deliveryStatus, undefined)
})

test('unfinished tasks block all external writes and remain unchanged', async () => {
  const { hub, calls } = fixture()
  hub.assessAdapter.listTasks = async () => [{ status: 'active' }]
  const result = await hub.markVersionOnline('orders', 'v1')
  assert.equal(result.onlineSync.error.code, 'ONLINE_UNFINISHED_TASKS')
  assert.equal(calls.length, 0)
})

test('missing state mapping and wrong remote project fail safely', async () => {
  const { hub, calls, remote } = fixture()
  remote.version.projectId = 99
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.error.code, 'ONLINE_REMOTE_INVALID')
  delete hub.assessConfig.capability.options.releaseClosure.taskCompletedStatuses
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.error.code, 'ONLINE_STATUS_MAPPING_REQUIRED')
  assert.equal(calls.length, 0)
})

test('concurrent clicks are rejected and only one closure runs', async () => {
  const { hub, calls } = fixture()
  const results = await Promise.allSettled([hub.markVersionOnline('orders', 'v1'), hub.markVersionOnline('orders', 'v1')])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'ONLINE_SYNC_RUNNING')
  assert.equal(calls.length, 2)
})

test('binding cannot change after a partially completed run', async () => {
  const { hub } = fixture()
  hub.assessAdapter.closeVersion = async () => { throw new Error('offline') }
  await hub.markVersionOnline('orders', 'v1')
  assert.throws(() => hub.bindVersionRelease('orders', 'v1', { versionId: 21 }), { code: 'ONLINE_BINDING_LOCKED' })
})

test('an invalid binding can be corrected when no remote write was attempted', async () => {
  const { hub, remote, calls } = fixture()
  remote.version.id = 21
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.error.code, 'ONLINE_REMOTE_INVALID')
  hub.bindVersionRelease('orders', 'v1', { versionId: 21 })
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.status, 'completed')
  assert.equal(calls.length, 2)
})

test('unfinished tasks on later pages prevent closure', async () => {
  const { hub, calls } = fixture()
  hub.assessAdapter.listTasks = async ({ pageNum }) => pageNum === 1 ? Array.from({ length: 500 }, () => ({ status: 'done' })) : [{ status: 'active' }]
  assert.equal((await hub.markVersionOnline('orders', 'v1')).onlineSync.error.code, 'ONLINE_UNFINISHED_TASKS')
  assert.equal(calls.length, 0)
})
