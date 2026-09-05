import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANAGED_FIELD_OPTIONS,
  projectSyncChanged,
  projectSyncForm,
  projectSyncPayload,
  projectSyncReadiness,
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

test('keeps trusted-auto visible but never saves it as an operational mode', () => {
  assert.equal(projectSyncForm({ mode: 'trusted-auto' }).mode, 'manual')
  assert.equal(projectSyncPayload({ mode: 'trusted-auto' }).sync.mode, 'manual')
  assert.doesNotMatch(trustedModeMessage({ ready: false }), /v0\.7\.2/)
  assert.doesNotMatch(trustedModeMessage({ ready: false }), /v0\.7\.5/)
  assert.match(trustedModeMessage({ ready: false }), /不可启用|尚未开放/)
})

test('detects target changes that invalidate outstanding previews', () => {
  const saved = { mode: 'manual', server: 'task', projectId: '123', managedFields: ['title', 'status'] }
  assert.equal(projectSyncChanged(saved, { ...saved }), false)
  assert.equal(projectSyncChanged(saved, { ...saved, projectId: '456' }), true)
  assert.equal(projectSyncChanged(saved, { ...saved, managedFields: ['title'] }), true)
})

test('reports configured connection truthfully and leaves permission unverified', () => {
  const readiness = projectSyncReadiness({ server: 'task', projectId: '123' }, {
    problems: [],
    config: {
      servers: [{ id: 'task', name: '研发任务', enabled: true, type: 'stdio', adapter: 'assess-task', runtimeProfile: 'task-local' }],
      capabilities: { milestones: { enabled: true } }
    }
  })
  assert.deepEqual(readiness.connection, {
    state: 'ready', label: '连接配置可用', detail: '研发任务（task）'
  })
  assert.deepEqual(readiness.permission, {
    state: 'unverified', label: '写权限未验证', detail: '连接配置不代表平台写权限，请在 MCP 中心完成验证。'
  })
  assert.equal(projectSyncReadiness({ server: '', projectId: '' }, {}).connection.state, 'missing')
})

test('provides labels for every managed field', () => {
  assert.deepEqual(MANAGED_FIELD_OPTIONS.map((item) => item.value), projectSyncForm({}).managedFields)
  assert.ok(MANAGED_FIELD_OPTIONS.every((item) => item.label))
})

test('explains that trusted mode is not active', () => {
  assert.match(trustedModeMessage({ ready: true }), /后续版本完成资格验证和回读验收/)
  assert.doesNotMatch(trustedModeMessage({ ready: true }), /v0\.7\.5/)
})
