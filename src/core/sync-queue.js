import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import { sanitizeSyncValue } from './sync-audit.js'
import { paths } from './store.js'

export const SYNC_STATUSES = new Set([
  'pending-confirmation', 'running', 'failed', 'paused', 'completed', 'canceled'
])

const TRANSITIONS = {
  'pending-confirmation': new Set(['running', 'canceled']),
  running: new Set(['failed', 'paused', 'completed']),
  failed: new Set(['running', 'canceled']),
  paused: new Set(['running', 'canceled']),
  completed: new Set(),
  canceled: new Set()
}
const RECORD_ID_RE = /^[a-f0-9]{64}$/

export function syncRecordId(entityType, entityKey) {
  const type = requiredText(entityType, 'SYNC_ENTITY_TYPE_REQUIRED', '同步对象类型不能为空')
  const key = requiredText(entityKey, 'SYNC_ENTITY_KEY_REQUIRED', '同步对象标识不能为空')
  return crypto.createHash('sha256').update(`${type}:${key}`).digest('hex')
}

export function savePendingSync(root, input, now = new Date()) {
  const plan = input?.plan
  if (!plan || !String(plan.hash || '').trim()) {
    throw err.bad('SYNC_PLAN_INVALID', '同步计划缺少哈希')
  }
  const entityType = requiredText(input?.entityType, 'SYNC_ENTITY_TYPE_REQUIRED', '同步对象类型不能为空')
  const entityKey = requiredText(input?.entityKey, 'SYNC_ENTITY_KEY_REQUIRED', '同步对象标识不能为空')
  const id = syncRecordId(entityType, entityKey)
  const existing = readSyncRecord(root, id)
  const at = new Date(now).toISOString()

  if (existing?.planHash === plan.hash) {
    const expired = existing.status === 'pending-confirmation' &&
      Number.isFinite(Date.parse(existing.plan?.expiresAt)) &&
      Date.parse(existing.plan.expiresAt) <= new Date(now).getTime()
    if (!expired) return existing
  }
  if (existing?.status === 'running') {
    throw transitionError(existing.status, 'pending-confirmation')
  }

  const safePlan = sanitizeSyncValue(plan)
  return writeRecord(root, {
    schemaVersion: 1,
    id,
    entityType,
    entityKey,
    route: String(input?.route || ''),
    mode: String(input?.mode || 'manual'),
    planHash: String(plan.hash),
    plan: safePlan,
    status: 'pending-confirmation',
    reason: '',
    createdAt: existing?.createdAt || at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    operations: (safePlan.operations || []).map((operation) => ({
      key: operation.key,
      kind: operation.kind,
      status: 'pending',
      operation,
      remoteResult: null,
      error: null,
      updatedAt: at
    })),
    error: null
  })
}

export function writeKnownSyncRecord(root, input) {
  const entityType = requiredText(input?.entityType, 'SYNC_ENTITY_TYPE_REQUIRED', '同步对象类型不能为空')
  const entityKey = requiredText(input?.entityKey, 'SYNC_ENTITY_KEY_REQUIRED', '同步对象标识不能为空')
  if (!SYNC_STATUSES.has(input?.status)) {
    throw transitionError(input?.status, input?.status)
  }
  return writeRecord(root, {
    ...sanitizeSyncValue(input),
    schemaVersion: input?.schemaVersion || 1,
    id: syncRecordId(entityType, entityKey),
    entityType,
    entityKey
  })
}

export function readSyncRecord(root, id) {
  if (!RECORD_ID_RE.test(String(id || ''))) return null
  const file = paths.syncRecord(root, id)
  return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), `同步记录 ${id}`) : null
}

export function findSyncRecord(root, entityType, entityKey) {
  return readSyncRecord(root, syncRecordId(entityType, entityKey))
}

export function listSyncRecords(root, { status = '', limit = 200 } = {}) {
  const dir = paths.syncQueue(root)
  if (!fs.existsSync(dir)) return []
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 200
  const cappedLimit = Math.max(0, Math.min(500, requestedLimit))
  if (cappedLimit === 0) return []

  return fs.readdirSync(dir)
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map((name) => parse(fs.readFileSync(path.join(dir, name), 'utf8'), `同步记录 ${name}`))
    .filter((record) => !status || record.status === status)
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(
      String(left.updatedAt || left.createdAt || '')
    ))
    .slice(0, cappedLimit)
}

export function transitionSyncRecord(root, id, target, patch = {}, now = new Date()) {
  const record = readSyncRecord(root, id)
  if (!record) throw err.notFound(`同步记录「${id}」`)
  if (!SYNC_STATUSES.has(target) || !TRANSITIONS[record.status]?.has(target)) {
    throw transitionError(record.status, target)
  }
  const at = new Date(now).toISOString()
  const safePatch = sanitizeSyncValue(patch || {})
  const next = {
    ...record,
    ...safePatch,
    schemaVersion: record.schemaVersion,
    id: record.id,
    entityType: record.entityType,
    entityKey: record.entityKey,
    status: target,
    createdAt: record.createdAt,
    updatedAt: at
  }
  if (target === 'running') next.startedAt = record.startedAt || at
  if (target === 'completed') next.completedAt = at
  if (target === 'canceled') next.canceledAt = at
  return writeRecord(root, next)
}

export function cancelSyncRecord(root, id, reason, now = new Date()) {
  const value = String(reason || '').trim()
  if (!value) throw err.bad('SYNC_CANCEL_REASON_REQUIRED', '取消同步必须填写原因')
  return transitionSyncRecord(root, id, 'canceled', { reason: value }, now)
}

function writeRecord(root, record) {
  const file = paths.syncRecord(root, record.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(sanitizeSyncValue(record)), 'utf8')
    fs.renameSync(temporary, file)
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary)
    throw error
  }
  return readSyncRecord(root, record.id)
}

function transitionError(source, target) {
  return err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${source || 'unknown'} 变更为 ${target || 'unknown'}`)
}

function requiredText(value, code, message) {
  const text = String(value || '').trim()
  if (!text) throw err.bad(code, message)
  return text
}
