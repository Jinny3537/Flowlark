import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MANAGED_FIELDS,
  normalizeSyncPolicy,
  trustedModeReadiness
} from '../src/core/sync-policy.js'

test('defaults every project to manual synchronization', () => {
  assert.deepEqual(normalizeSyncPolicy(), {
    mode: 'manual',
    server: '',
    projectId: '',
    managedFields: [...DEFAULT_MANAGED_FIELDS]
  })
})

test('normalizes identifiers and drops unknown managed fields', () => {
  assert.deepEqual(normalizeSyncPolicy({
    mode: 'trusted-auto', server: ' assess-task-local ', projectId: 42,
    managedFields: ['title', 'status', 'title', 'unknown']
  }), {
    mode: 'trusted-auto', server: 'assess-task-local', projectId: '42',
    managedFields: ['title', 'status']
  })
})

test('trusted mode remains ineligible until every required probe passes', () => {
  const result = trustedModeReadiness(normalizeSyncPolicy({ mode: 'trusted-auto' }), {
    connection: true, permission: true, createUpdate: false, statusWrite: true, idempotency: true
  })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((item) => item.code === 'SYNC_CREATE_UPDATE_UNVERIFIED'))
})
