import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterRequirements,
  projectRequirement,
  requirementPayload,
} from './requirementsModel.js'

test('serializes selected and cleared due dates', () => {
  const dueDate = { format: (pattern) => pattern === 'YYYY-MM-DD' ? '2026-08-31' : '' }
  assert.deepEqual(requirementPayload({ title: '需求', dueDate }), { title: '需求', dueDate: '2026-08-31' })
  assert.deepEqual(requirementPayload({ title: '需求', dueDate: null }), { title: '需求', dueDate: '' })
})

const requirements = [
  {
    code: 'REQ-1', title: '搜索改版', description: '优化搜索', project: 'portal', module: 'search',
    status: 'confirmed', derivedStatus: 'designing', external: { provider: 'mcp' },
    externalTasks: [{ taskId: 21, lastSyncHash: 'sha256:x', syncedAt: '2026-09-04T08:00:00Z' }],
    milestones: [{ name: 'Sprint-8', status: 'planning' }],
  },
  {
    code: 'REQ-2', title: '本地登录', description: '', project: 'account', module: 'auth',
    status: 'draft', derivedStatus: 'not_started', external: null, externalTasks: [], milestones: [],
  },
]

test('filters by lifecycle independently from prototype progress', () => {
  assert.deepEqual(filterRequirements(requirements, { status: 'confirmed' }).map((item) => item.code), ['REQ-1'])
  assert.deepEqual(filterRequirements(requirements, { prototypeProgress: 'designing' }).map((item) => item.code), ['REQ-1'])
  assert.deepEqual(filterRequirements(requirements, { status: 'designing' }), [])
})

test('filters source, project and searchable fields', () => {
  assert.deepEqual(filterRequirements(requirements, { source: 'pool', project: 'portal', query: '搜索' }).map((item) => item.code), ['REQ-1'])
  assert.deepEqual(filterRequirements(requirements, { source: 'local', query: 'AUTH' }).map((item) => item.code), ['REQ-2'])
})

test('projects a list row without conflating lifecycle, prototype, source and binding', () => {
  const row = projectRequirement(requirements[0])
  assert.equal(row.lifecycle.value, 'confirmed')
  assert.equal(row.lifecycle.label, '已确认')
  assert.equal(row.prototypeProgress.value, 'designing')
  assert.equal(row.prototypeProgress.label, '设计中')
  assert.equal(row.source.label, '需求池')
  assert.equal(row.source.tone, 'success')
  assert.equal(row.externalBinding.state, 'synced')
  assert.deepEqual(row.milestoneMembership, { count: 1, names: ['Sprint-8'] })
})

test('projects failed requirement-pool refresh as source warning without changing source filter', () => {
  const row = projectRequirement({
    code: 'REQ-FAIL',
    title: '远端不可访问',
    external: { provider: 'mcp', syncStatus: 'failed' },
    externalTasks: [],
  })
  assert.equal(row.source.value, 'pool')
  assert.equal(row.source.label, '需求池异常')
  assert.equal(row.source.tone, 'error')
})

test('projects missing requirement-pool items as unavailable', () => {
  const row = projectRequirement({
    code: 'REQ-GONE',
    title: '远端已删除',
    external: { provider: 'mcp', syncStatus: 'failed', failure: { code: 'REQUIREMENT_REMOTE_MISSING' } },
    externalTasks: [],
  })
  assert.equal(row.source.value, 'pool')
  assert.equal(row.source.label, '需求池不可访问')
  assert.equal(row.source.tone, 'error')
})
