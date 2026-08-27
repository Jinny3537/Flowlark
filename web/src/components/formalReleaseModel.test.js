import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCandidate,
  candidateBlockers,
  initialReleaseRecipients,
  normalizeRecipientNames,
  preflightPayload,
  releaseOutcome,
} from './formalReleaseModel.js'

test('normalizes project defaults and one-off recipient changes', () => {
  assert.deepEqual(normalizeRecipientNames([' 张三 ', '张三', '李四']), ['张三', '李四'])
  assert.deepEqual(initialReleaseRecipients({ releaseMail: { to: ['张三'], cc: ['李四'] } }), {
    to: ['张三'], cc: ['李四'],
  })
  assert.deepEqual(preflightPayload({
    to: [' 张三 '], cc: [], selections: { 张三: 'person-1', empty: '' }, releasedAt: '2026-08-28T10:00:00Z',
  }), {
    to: ['张三'], cc: [], selections: { 张三: 'person-1' }, releasedAt: '2026-08-28T10:00:00Z',
  })
})

test('tracks ambiguity selections and result states', () => {
  assert.deepEqual(applyCandidate({}, '张三', 'person-2'), { 张三: 'person-2' })
  assert.equal(candidateBlockers({ blockers: [
    { code: 'RELEASE_RECIPIENT_AMBIGUOUS', query: '张三' },
    { code: 'GIT_REMOTE_REQUIRED' },
  ] }).length, 1)
  assert.equal(releaseOutcome({ status: 'complete' }).kind, 'complete')
  assert.equal(releaseOutcome({ status: 'mail_pending', mail: { lastError: '失败' } }).kind, 'mail-pending')
  assert.equal(releaseOutcome({ status: 'git_failed' }).kind, 'git-failed')
})
