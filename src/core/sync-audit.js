import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { currentUser } from './repo.js'
import { paths } from './store.js'

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /password|authorization|token|secret|environment|env/i

export function sanitizeSyncValue(value, key = '') {
  if (SENSITIVE_KEY.test(String(key))) return REDACTED
  if (Array.isArray(value)) return value.map((item) => sanitizeSyncValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeSyncValue(childValue, childKey)
      ])
    )
  }
  return value
}

export function appendSyncAudit(root, input, now = new Date()) {
  const entry = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: new Date(now).toISOString(),
    actor: currentUser(),
    syncId: input?.syncId ?? null,
    action: input?.action ?? null,
    status: input?.status ?? null,
    entityType: input?.entityType ?? null,
    entityKey: input?.entityKey ?? null,
    operationKey: input?.operationKey ?? null,
    before: sanitizeSyncValue(input?.before ?? null),
    after: sanitizeSyncValue(input?.after ?? null),
    error: sanitizeSyncValue(input?.error ?? null)
  }
  const file = paths.syncAudit(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

export function listSyncAudit(root, { limit = 100, syncId = '' } = {}) {
  const file = paths.syncAudit(root)
  if (!fs.existsSync(file)) return []

  const lines = fs.readFileSync(file, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const entries = []
  for (let index = 0; index < lines.length; index++) {
    try {
      entries.push(JSON.parse(lines[index]))
    } catch (error) {
      if (index !== lines.length - 1) throw error
    }
  }

  const requestedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 100
  const cappedLimit = Math.max(0, Math.min(500, requestedLimit))
  if (cappedLimit === 0) return []
  return entries
    .filter((entry) => !syncId || entry.syncId === syncId)
    .slice(-cappedLimit)
    .reverse()
}
