import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  cancelSyncRecord,
  findSyncRecord,
  listSyncRecords,
  readSyncRecord,
  savePendingSync,
  syncRecordId,
  transitionSyncRecord
} from '../src/core/sync-queue.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-sync-queue-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function syncPlan(hash = 'sha256:plan-1', overrides = {}) {
  return {
    hash,
    generatedAt: '2026-09-04T00:00:00.000Z',
    expiresAt: '2026-09-04T00:15:00.000Z',
    operations: [{ key: 'sprint:S1:update', kind: 'sprint.update', after: { title: 'S1' } }],
    ...overrides
  }
}

function save(root, plan = syncPlan(), now = new Date('2026-09-04T00:01:00Z')) {
  return savePendingSync(root, {
    entityType: 'milestone',
    entityKey: 'S1',
    route: '/milestones/S1',
    mode: 'manual',
    plan
  }, now)
}

function assertTransitionInvalid(fn) {
  assert.throws(fn, (error) => error?.code === 'SYNC_TRANSITION_INVALID')
}

test('saves one deterministic pending record and deduplicates an unchanged plan', (t) => {
  const root = fixture(t)
  const plan = syncPlan()
  const saved = save(root, plan)

  assert.equal(saved.status, 'pending-confirmation')
  assert.equal(saved.planHash, plan.hash)
  assert.equal(saved.id, syncRecordId('milestone', 'S1'))
  assert.equal(saved.operations[0].status, 'pending')
  assert.equal(listSyncRecords(root).length, 1)

  const same = save(root, plan, new Date('2026-09-04T00:02:00Z'))
  assert.equal(same.id, saved.id)
  assert.equal(same.updatedAt, saved.updatedAt)
  assert.equal(listSyncRecords(root).length, 1)
  assert.deepEqual(findSyncRecord(root, 'milestone', 'S1'), saved)
  assert.deepEqual(readSyncRecord(root, saved.id), saved)
})

test('replaces changed or expired plans while preserving record creation time', (t) => {
  const root = fixture(t)
  const first = save(root)
  const changed = save(root, syncPlan('sha256:plan-2', {
    expiresAt: '2026-09-04T00:02:30.000Z'
  }), new Date('2026-09-04T00:02:00Z'))

  assert.equal(changed.id, first.id)
  assert.equal(changed.createdAt, first.createdAt)
  assert.equal(changed.updatedAt, '2026-09-04T00:02:00.000Z')
  assert.equal(changed.planHash, 'sha256:plan-2')

  const refreshed = save(
    root,
    syncPlan('sha256:plan-2', { expiresAt: '2026-09-04T00:20:00.000Z' }),
    new Date('2026-09-04T00:03:00Z')
  )
  assert.equal(refreshed.createdAt, first.createdAt)
  assert.equal(refreshed.updatedAt, '2026-09-04T00:03:00.000Z')
  assert.equal(refreshed.plan.expiresAt, '2026-09-04T00:20:00.000Z')
})

test('supports the fixed run, fail, retry, and completion transitions', (t) => {
  const root = fixture(t)
  const saved = save(root)
  const running = transitionSyncRecord(root, saved.id, 'running', {}, new Date('2026-09-04T00:02:00Z'))
  assert.equal(running.startedAt, '2026-09-04T00:02:00.000Z')

  const failed = transitionSyncRecord(root, saved.id, 'failed', {
    error: { code: 'REMOTE_FAILED', message: 'nope', accessToken: 'private' }
  }, new Date('2026-09-04T00:03:00Z'))
  assert.equal(failed.error.code, 'REMOTE_FAILED')
  assert.equal(failed.error.accessToken, '[REDACTED]')

  transitionSyncRecord(root, saved.id, 'running', {}, new Date('2026-09-04T00:04:00Z'))
  const completed = transitionSyncRecord(root, saved.id, 'completed', {}, new Date('2026-09-04T00:05:00Z'))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.completedAt, '2026-09-04T00:05:00.000Z')
  assertTransitionInvalid(() => transitionSyncRecord(root, saved.id, 'running'))
  assertTransitionInvalid(() => cancelSyncRecord(root, saved.id, 'do not run'))
})

test('allows cancellation only from pending, failed, or paused records', (t) => {
  for (const source of ['pending-confirmation', 'failed', 'paused']) {
    const root = fixture(t)
    const saved = save(root)
    if (source === 'failed') {
      transitionSyncRecord(root, saved.id, 'running')
      transitionSyncRecord(root, saved.id, 'failed')
    }
    if (source === 'paused') {
      transitionSyncRecord(root, saved.id, 'running')
      transitionSyncRecord(root, saved.id, 'paused')
    }
    const canceled = cancelSyncRecord(root, saved.id, `cancel ${source}`, new Date('2026-09-04T00:06:00Z'))
    assert.equal(canceled.status, 'canceled')
    assert.equal(canceled.reason, `cancel ${source}`)
    assert.equal(canceled.canceledAt, '2026-09-04T00:06:00.000Z')
    assertTransitionInvalid(() => transitionSyncRecord(root, saved.id, 'running'))
  }

  const runningRoot = fixture(t)
  const running = save(runningRoot)
  transitionSyncRecord(runningRoot, running.id, 'running')
  assertTransitionInvalid(() => cancelSyncRecord(runningRoot, running.id, 'too late'))
  const pendingRoot = fixture(t)
  const pending = save(pendingRoot)
  assert.throws(
    () => cancelSyncRecord(pendingRoot, pending.id, ' '),
    (error) => error?.code === 'SYNC_CANCEL_REASON_REQUIRED'
  )
})

test('an explicit preview revives a canceled record but preserves completed idempotency', (t) => {
  const canceledRoot = fixture(t)
  const canceled = cancelSyncRecord(canceledRoot, save(canceledRoot).id, 'changed my mind')
  const revived = save(canceledRoot, canceled.plan, new Date('2026-09-04T00:07:00Z'))
  assert.equal(revived.status, 'pending-confirmation')
  assert.equal(revived.planHash, canceled.planHash)
  assert.equal(revived.canceledAt, null)

  const completedRoot = fixture(t)
  const running = transitionSyncRecord(completedRoot, save(completedRoot).id, 'running')
  const completed = transitionSyncRecord(completedRoot, running.id, 'completed')
  const repeated = save(completedRoot, completed.plan, new Date('2026-09-04T00:08:00Z'))
  assert.deepEqual(repeated, completed)
})

test('rejects unknown targets and transitions not present in the fixed graph', (t) => {
  const root = fixture(t)
  const saved = save(root)
  assertTransitionInvalid(() => transitionSyncRecord(root, saved.id, 'completed'))
  assertTransitionInvalid(() => transitionSyncRecord(root, saved.id, 'invented'))
})

test('sanitizes saved plans recursively without mutating the input', (t) => {
  const root = fixture(t)
  const plan = syncPlan('sha256:safe', {
    authorization: 'Bearer private',
    operations: [{
      key: 'task:R1:create',
      kind: 'task.create',
      after: { title: 'kept', nested: { password: 'private' } }
    }]
  })
  const saved = save(root, plan)
  const raw = fs.readFileSync(path.join(root, '.flowlark', 'cache', 'sync-queue', `${saved.id}.json`), 'utf8')

  assert.equal(saved.plan.authorization, '[REDACTED]')
  assert.equal(saved.plan.operations[0].after.nested.password, '[REDACTED]')
  assert.equal(saved.operations[0].operation.after.nested.password, '[REDACTED]')
  assert.doesNotMatch(raw, /Bearer private|"private"/)
  assert.equal(plan.authorization, 'Bearer private')
})

test('uses temporary-file rename and preserves the previous complete record if rename fails', (t) => {
  const root = fixture(t)
  const saved = save(root)
  const renameSync = fs.renameSync
  let temporaryFile = ''

  fs.renameSync = (from) => {
    temporaryFile = from
    assert.equal(JSON.parse(fs.readFileSync(from, 'utf8')).planHash, 'sha256:plan-2')
    assert.equal(readSyncRecord(root, saved.id).planHash, 'sha256:plan-1')
    throw new Error('simulated rename failure')
  }
  try {
    assert.throws(() => save(root, syncPlan('sha256:plan-2')), /simulated rename failure/)
  } finally {
    fs.renameSync = renameSync
  }

  assert.equal(readSyncRecord(root, saved.id).planHash, 'sha256:plan-1')
  assert.equal(fs.existsSync(temporaryFile), false)
})

test('lists newest records first and filters by status', (t) => {
  const root = fixture(t)
  const first = save(root)
  const second = savePendingSync(root, {
    entityType: 'requirement', entityKey: 'R1', route: '/requirements/R1', mode: 'manual', plan: syncPlan('sha256:r1')
  }, new Date('2026-09-04T00:02:00Z'))
  transitionSyncRecord(root, first.id, 'running', {}, new Date('2026-09-04T00:03:00Z'))

  assert.deepEqual(listSyncRecords(root).map((record) => record.id), [first.id, second.id])
  assert.deepEqual(listSyncRecords(root, { status: 'pending-confirmation' }).map((record) => record.id), [second.id])
  assert.equal(listSyncRecords(root, { limit: 1 }).length, 1)
})
