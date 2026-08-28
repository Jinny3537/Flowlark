import test from 'node:test'
import assert from 'node:assert/strict'
import {
  milestoneItemAction,
  milestoneItems,
  milestoneReleaseState,
  withoutMilestoneItem
} from './milestoneModel.js'

const source = [
  { requirement: 'REQ-1', project: 'orders', version: 'v1', title: 'ignored' },
  { requirement: 'REQ-2', project: 'orders', versionNo: 'v2' }
]

test('keeps only persisted milestone item fields', () => {
  assert.deepEqual(milestoneItems(source), [
    { requirement: 'REQ-1', project: 'orders', version: 'v1' },
    { requirement: 'REQ-2', project: 'orders', version: 'v2' }
  ])
})

test('removes one exact scope item', () => {
  assert.deepEqual(withoutMilestoneItem(source, source[0]), [{ requirement: 'REQ-2', project: 'orders', version: 'v2' }])
})

test('maps milestone lifecycle to one row action', () => {
  assert.equal(milestoneItemAction('planning'), 'remove')
  assert.equal(milestoneItemAction('reviewing'), 'remove')
  assert.equal(milestoneItemAction('active'), 'release')
  for (const status of ['frozen', 'delivered', 'archived', 'canceled']) {
    assert.equal(milestoneItemAction(status), null)
  }
})

test('shows the newest matching formal release mail state', () => {
  const entry = { project: 'orders', version: 'v2' }
  assert.deepEqual(milestoneReleaseState(entry, []), {
    key: 'none', label: '未发版', color: 'default'
  })

  const mails = [
    { project: 'orders', version: 'v2', status: 'sent', updatedAt: '2026-08-28T09:00:00Z' },
    { project: 'other', version: 'v2', status: 'sent', updatedAt: '2026-08-28T12:00:00Z' },
    { project: 'orders', version: 'v2', status: 'pending', updatedAt: '2026-08-28T10:00:00Z' }
  ]
  assert.deepEqual(milestoneReleaseState(entry, mails), {
    key: 'pending', label: '邮件待重试', color: 'warning'
  })

  mails.unshift({
    project: 'orders', version: 'v2', status: 'sent', updatedAt: '2026-08-28T11:00:00Z'
  })
  assert.deepEqual(milestoneReleaseState(entry, mails), {
    key: 'sent', label: '已发版', color: 'success'
  })
})

test('keeps API order when matching mail timestamps tie', () => {
  const at = '2026-08-28T10:00:00Z'
  const state = milestoneReleaseState(
    { project: 'orders', version: 'v2' },
    [
      { project: 'orders', version: 'v2', status: 'pending', updatedAt: at },
      { project: 'orders', version: 'v2', status: 'sent', updatedAt: at }
    ]
  )
  assert.equal(state.key, 'pending')
})
