import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSiderCollapsed } from './appShellModel.js'

test('parses the persisted collapsed preference', () => {
  assert.equal(parseSiderCollapsed('true'), true)
  assert.equal(parseSiderCollapsed('false'), false)
})

test('defaults missing or invalid collapsed preferences to expanded', () => {
  assert.equal(parseSiderCollapsed(null), false)
  assert.equal(parseSiderCollapsed('collapsed'), false)
  assert.equal(parseSiderCollapsed('1'), false)
})
