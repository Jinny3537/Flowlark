import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from './json.js'
import { assertMilestoneName } from './milestones.js'

export function readMilestoneSyncJournal(root, name) {
  const file = journalFile(root, name)
  return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), `迭代 ${name} 同步记录`) : null
}

export function writeMilestoneSyncJournal(root, name, input) {
  const file = journalFile(root, name)
  const value = sanitize(input)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, stringify(value), 'utf8')
  fs.renameSync(temporary, file)
  return value
}

export function newMilestoneSyncJournal(plan, reason = '') {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    milestone: plan.milestone,
    planHash: plan.hash,
    status: 'running',
    reason: String(reason || ''),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
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

function journalFile(root, name) {
  const safe = assertMilestoneName(name)
  return path.join(root, '.flowlark', 'cache', 'mcp-sync', `${safe}.json`)
}

function sanitize(value, key = '') {
  if (/password|authorization|token|secret|environment|env$/i.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]))
  }
  return value
}
