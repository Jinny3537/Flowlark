import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { currentUser } from './repo.js'
import { paths } from './store.js'

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /password|authorization|token|secret|api[-_]?key|environment|env/i
const ASSIGNMENT = /(["']?)(\b[A-Za-z_][A-Za-z0-9_-]*\b)\1(\s*[:=]\s*)(?:(bearer|basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;)}\]&]+)/gi
const AUTH_SCHEME_TOKEN = /(\b(?:Bearer|Basic)\s+)([A-Za-z0-9][A-Za-z0-9._~+/-]*={0,2})/gi
const AUTH_SCHEME_TERMS = new Set(['auth', 'authentication', 'credential', 'credentials', 'header', 'scheme', 'token'])
const SK_TOKEN = /\bsk-[A-Za-z0-9_-]{8,}/g

export function sanitizeSyncValue(value, key = '') {
  if (SENSITIVE_KEY.test(String(key))) return REDACTED
  if (typeof value === 'string') return sanitizeSyncString(value)
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

function sanitizeSyncString(value) {
  return value
    .replace(ASSIGNMENT, (match, quote, key, separator, scheme) =>
      SENSITIVE_KEY.test(key)
        ? `${quote}${key}${quote}${separator}${scheme ? `${scheme} ` : ''}${REDACTED}`
        : match)
    .replace(AUTH_SCHEME_TOKEN, (match, prefix, token) =>
      AUTH_SCHEME_TERMS.has(token.toLowerCase()) ? match : `${prefix}${REDACTED}`)
    .replace(SK_TOKEN, REDACTED)
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
