import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANAGED_FIELD_OPTIONS,
  projectSyncForm,
  projectSyncPayload,
  trustedModeMessage
} from './projectSyncModel.js'

test('uses manual defaults for old projects', () => {
  assert.deepEqual(projectSyncForm({}), {
    mode: 'manual', server: '', projectId: '', managedFields: [
      'title', 'description', 'acceptance', 'priority', 'assignee', 'sprint', 'status', 'delivery'
    ]
  })
})

test('builds a nested project update payload', () => {
  assert.deepEqual(projectSyncPayload({ mode: 'manual', server: 'local', projectId: '42', managedFields: ['title'] }), {
    sync: { mode: 'manual', server: 'local', projectId: '42', managedFields: ['title'] }
  })
})

test('provides labels for every managed field', () => {
  assert.deepEqual(MANAGED_FIELD_OPTIONS.map((item) => item.value), projectSyncForm({}).managedFields)
  assert.ok(MANAGED_FIELD_OPTIONS.every((item) => item.label))
})

test('explains that trusted mode is not active in v0.7.2', () => {
  assert.match(trustedModeMessage({ ready: true }), /v0\.7\.5/)
})
