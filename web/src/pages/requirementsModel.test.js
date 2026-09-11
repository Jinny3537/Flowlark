import test from 'node:test'
import assert from 'node:assert/strict'
import { requirementPayload } from './requirementsModel.js'

test('serializes selected and cleared due dates', () => {
  const dueDate = { format: (pattern) => pattern === 'YYYY-MM-DD' ? '2026-08-31' : '' }
  assert.deepEqual(requirementPayload({ title: '需求', dueDate }), { title: '需求', dueDate: '2026-08-31' })
  assert.deepEqual(requirementPayload({ title: '需求', dueDate: null }), { title: '需求', dueDate: '' })
})

test('preserves structured requirement fields and TBD delivery values', () => {
  const values = { businessValue: '背景', businessRule: '规则', acceptanceCriteria: '- [ ] 验收', targetDeliveryDate: 'TBD', expectedOnlineDate: '待确认' }
  assert.deepEqual(requirementPayload(values), { ...values, dueDate: '' })
})

test('only opens HTTP(S) requirement links', async () => {
  const { safeRequirementUrl } = await import('./requirementsModel.js')
  assert.equal(safeRequirementUrl('javascript:alert(1)'), undefined)
  assert.equal(safeRequirementUrl('data:text/html,test'), undefined)
  assert.equal(safeRequirementUrl('暂无'), undefined)
  assert.equal(safeRequirementUrl('https://example.com/doc'), 'https://example.com/doc')
})
