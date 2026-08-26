import test from 'node:test'
import assert from 'node:assert/strict'
import { operationMeta, statusMeta, VERSION_STATUS, WATCH_STATUS } from './status.js'

test('returns canonical version and watch labels', () => {
  assert.deepEqual(statusMeta(VERSION_STATUS, 'DRAFT'), { label: '编辑中', color: 'gold' })
  assert.deepEqual(statusMeta(WATCH_STATUS, 'failed'), { label: '失败', color: 'red' })
})

test('falls back to readable unknown state', () => {
  assert.deepEqual(statusMeta(VERSION_STATUS, 'CUSTOM'), { label: 'CUSTOM', color: 'default' })
})

test('maps semantic operation log actions', () => {
  assert.deepEqual(operationMeta('BASELINE_ROLLBACK'), { label: '回滚基线', color: 'orange' })
  assert.deepEqual(operationMeta('CUSTOM'), { label: 'CUSTOM', color: 'default' })
})
