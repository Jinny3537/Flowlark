import test from 'node:test'
import assert from 'node:assert/strict'
import {
  draftCounts, filterDraftItems, filterTrashItems, draftSelection,
  restoreReasonLabel, patchQueueParams, runQueueBatch,
} from './draftTrashModel.js'

const drafts = [
  { id: 'a', project: 'orders', title: '失败原型', filename: 'a.html', status: 'failed', collectedAt: '2026-08-28T10:00:00Z' },
  { id: 'b', project: 'orders', title: '处理中', filename: 'b.html', status: 'pending', collectedAt: '2026-08-28T11:00:00Z' },
  { id: 'c', project: 'users', title: '已完成', filename: 'c.html', status: 'archived', collectedAt: '2026-08-27T10:00:00Z' },
]

test('counts and sorts attention drafts with failures first', () => {
  assert.deepEqual(draftCounts(drafts), { attention: 2, failed: 1, archived: 1 })
  assert.deepEqual(filterDraftItems(drafts, { view: 'attention' }).map((item) => item.id), ['a', 'b'])
})

test('filters both queues by project, query and date', () => {
  assert.deepEqual(filterDraftItems(drafts, { view: 'all', project: 'orders', query: '原型' }).map((item) => item.id), ['a'])
  const trash = [{ id: 't', project: 'orders', versionNo: 'v2', deletedAt: '2026-08-28T09:00:00Z' }]
  assert.equal(filterTrashItems(trash, { query: 'v2', dateFrom: '2026-08-28' }).length, 1)
})

test('splits mixed draft selection into eligible actions', () => {
  assert.deepEqual(draftSelection(drafts, ['a', 'b', 'c']), { failed: ['a'], archived: ['c'] })
  assert.equal(restoreReasonLabel('VERSION_EXISTS'), '版本号已占用')
})

test('patches queue params without dropping unrelated context', () => {
  const params = patchQueueParams(new URLSearchParams('project=orders&view=attention'), { query: 'v2', view: '' })
  assert.equal(params.toString(), 'project=orders&query=v2')
})

test('runs bounded batches and keeps success, skip and failure details', async () => {
  let active = 0
  let maxActive = 0
  const result = await runQueueBatch([1, 2, 3], {
    concurrency: 2,
    skip: (item) => item === 2 ? '冲突' : '',
    run: async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      if (item === 3) throw new Error('网络失败')
      return item
    },
  })
  assert.ok(maxActive <= 2)
  assert.deepEqual(result.succeeded.map((item) => item.item), [1])
  assert.deepEqual(result.skipped.map((item) => item.reason), ['冲突'])
  assert.deepEqual(result.failed.map((item) => item.reason), ['网络失败'])
})
