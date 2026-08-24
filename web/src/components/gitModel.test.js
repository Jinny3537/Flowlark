import test from 'node:test'
import assert from 'node:assert/strict'
import { canWriteGit, gitStage, syncLabel } from './gitModel.js'

test('uses doctor stage and conflict fallback', () => {
  assert.equal(gitStage({ stage: 'no-repo' }, null), 'no-repo')
  assert.equal(gitStage({ stage: 'ready' }, { conflicts: [{}] }), 'conflicted')
})

test('blocks Git writes for app or remote read-only state', () => {
  assert.equal(canWriteGit(false, { mode: 'writable' }), false)
  assert.equal(canWriteGit(true, { mode: 'readonly' }), false)
  assert.equal(canWriteGit(true, null), true)
})

test('describes local, pull, push, and full sync actions', () => {
  assert.equal(syncLabel({ hasRemote: false }), '提交到本地')
  assert.equal(syncLabel({ hasRemote: true, clean: true, behind: 1 }), '拉取更新')
  assert.equal(syncLabel({ hasRemote: true, clean: true, ahead: 1 }), '推送到远端')
  assert.equal(syncLabel({ hasRemote: true, clean: false }), '提交并同步')
})
