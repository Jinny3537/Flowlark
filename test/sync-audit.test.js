import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appendSyncAudit,
  listSyncAudit,
  sanitizeSyncValue
} from '../src/core/sync-audit.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-sync-audit-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('redacts secrets before appending audit data', (t) => {
  const root = fixture(t)
  const entry = appendSyncAudit(root, {
    syncId: 'sync-1', action: 'step.failed', entityType: 'milestone', entityKey: 'S1',
    before: { title: 'before', Authorization: 'Bearer private' },
    after: { title: 'after', nested: { password: 'private' } },
    error: { message: 'failed', accessToken: 'private' },
    environment: { ASSESS_PASSWORD: 'private' },
    ignored: 'not part of the audit contract'
  }, new Date('2026-09-04T00:00:00Z'))

  const file = path.join(root, '.flowlark', 'sync-audit.ndjson')
  const raw = fs.readFileSync(file, 'utf8')
  assert.doesNotMatch(raw, /Bearer private|ASSESS_PASSWORD|"private"/)
  assert.deepEqual(Object.keys(entry), [
    'schemaVersion', 'id', 'at', 'actor', 'syncId', 'action', 'status',
    'entityType', 'entityKey', 'operationKey', 'before', 'after', 'error'
  ])
  assert.equal(entry.at, '2026-09-04T00:00:00.000Z')
  assert.equal(entry.before.Authorization, '[REDACTED]')
  assert.equal(entry.after.nested.password, '[REDACTED]')
  assert.equal(entry.error.accessToken, '[REDACTED]')
  assert.equal(Object.hasOwn(entry, 'environment'), false)
  assert.equal(Object.hasOwn(entry, 'ignored'), false)
  assert.equal(raw.endsWith('\n'), true)
  assert.equal(raw.trim().split('\n').length, 1)
  assert.equal(listSyncAudit(root, { limit: 10 })[0].syncId, 'sync-1')
})

test('sanitizes nested arrays without mutating the input', () => {
  const input = {
    items: [{ token: 'one', safe: 'kept' }],
    ENV: { PASSWORD: 'two' }
  }
  const sanitized = sanitizeSyncValue(input)

  assert.deepEqual(sanitized, {
    items: [{ token: '[REDACTED]', safe: 'kept' }],
    ENV: '[REDACTED]'
  })
  assert.equal(input.items[0].token, 'one')
})

test('lists newest matching entries first and applies the requested limit', (t) => {
  const root = fixture(t)
  appendSyncAudit(root, { syncId: 'sync-1', action: 'queued' }, new Date('2026-09-04T00:00:00Z'))
  appendSyncAudit(root, { syncId: 'sync-2', action: 'running' }, new Date('2026-09-04T00:01:00Z'))
  appendSyncAudit(root, { syncId: 'sync-1', action: 'completed' }, new Date('2026-09-04T00:02:00Z'))

  assert.deepEqual(listSyncAudit(root, { limit: 2 }).map((entry) => entry.action), [
    'completed', 'running'
  ])
  assert.deepEqual(listSyncAudit(root, { syncId: 'sync-1', limit: 1 }).map((entry) => entry.action), [
    'completed'
  ])
  assert.deepEqual(listSyncAudit(root, { limit: 0 }), [])
})

test('caps audit reads at 500 entries', (t) => {
  const root = fixture(t)
  const file = path.join(root, '.flowlark', 'sync-audit.ndjson')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const lines = Array.from({ length: 510 }, (_, index) =>
    JSON.stringify({ syncId: 'sync-1', action: `step-${index}` }))
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')

  const entries = listSyncAudit(root, { limit: 10_000 })
  assert.equal(entries.length, 500)
  assert.equal(entries[0].action, 'step-509')
  assert.equal(entries.at(-1).action, 'step-10')
})

test('ignores one malformed final audit line', (t) => {
  const root = fixture(t)
  appendSyncAudit(root, { syncId: 'sync-1', action: 'queued' })
  fs.appendFileSync(path.join(root, '.flowlark', 'sync-audit.ndjson'), '{unfinished\n')

  assert.deepEqual(listSyncAudit(root).map((entry) => entry.action), ['queued'])
})

test('rejects malformed audit entries before the final line', (t) => {
  const root = fixture(t)
  const file = path.join(root, '.flowlark', 'sync-audit.ndjson')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{bad}\n{"action":"valid"}\n', 'utf8')

  assert.throws(() => listSyncAudit(root), SyntaxError)
})
