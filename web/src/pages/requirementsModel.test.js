import test from 'node:test'
import assert from 'node:assert/strict'
import { requirementPayload } from './requirementsModel.js'

test('serializes selected and cleared due dates', () => {
  const dueDate = { format: (pattern) => pattern === 'YYYY-MM-DD' ? '2026-08-31' : '' }
  assert.deepEqual(requirementPayload({ title: '需求', dueDate }), { title: '需求', dueDate: '2026-08-31' })
  assert.deepEqual(requirementPayload({ title: '需求', dueDate: null }), { title: '需求', dueDate: '' })
})
