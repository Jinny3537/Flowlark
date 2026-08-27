import assert from 'node:assert/strict'
import test from 'node:test'
import { filterWatchItems } from './watchInboxModel.js'

const items = [
  { id: 'orders-1', project: 'orders' },
  { id: 'marketing-1', project: 'marketing' },
]

test('filters watch items by project while an empty scope keeps all items', () => {
  assert.deepEqual(filterWatchItems(items, 'orders').map((item) => item.id), ['orders-1'])
  assert.deepEqual(filterWatchItems(items, '').map((item) => item.id), ['orders-1', 'marketing-1'])
  assert.notStrictEqual(filterWatchItems(items, ''), items)
})
