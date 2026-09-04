import fs from 'node:fs'
import path from 'node:path'
import { parse } from './json.js'
import { assertMilestoneName } from './milestones.js'
import { findSyncRecord, writeKnownSyncRecord } from './sync-queue.js'

export function readMilestoneSyncJournal(root, name) {
  return findSyncRecord(root, 'milestone', name) || readLegacyJournal(root, name)
}

export function writeMilestoneSyncJournal(root, name, input) {
  return writeKnownSyncRecord(root, {
    ...input,
    entityType: 'milestone',
    entityKey: name,
    route: `/milestones/${encodeURIComponent(name)}`
  })
}

export function newMilestoneSyncJournal(plan, reason = '') {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    milestone: plan.milestone,
    planHash: plan.hash,
    plan,
    mode: 'manual',
    status: 'running',
    reason: String(reason || ''),
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
    operations: plan.operations.map((operation) => ({
      key: operation.key,
      kind: operation.kind,
      status: 'pending',
      operation,
      remoteResult: null,
      error: null,
      updatedAt: now
    }))
  }
}

function readLegacyJournal(root, name) {
  const safe = assertMilestoneName(name)
  const file = path.join(root, '.flowlark', 'cache', 'mcp-sync', `${safe}.json`)
  return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), `迭代 ${name} 同步记录`) : null
}
