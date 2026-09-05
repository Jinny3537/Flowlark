import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { currentUser } from './repo.js'
import { assertWritable } from './permissions.js'
import { stringify } from './json.js'
import { readDeliverySnapshot } from './delivery-snapshots.js'
import { withMilestoneSyncLock } from './milestone-sync.js'

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SEVERITIES = new Set(['blocker', 'important', 'normal'])

export function listDeliveryFeedback(root, name) {
  const snapshot = readDeliverySnapshot(root, name)
  const directory = feedbackDirectory(root, name, 'feedback')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort().map((file) => {
    const id = file.slice(0, -5)
    assertId(id)
    const item = readRecord(path.join(directory, file))
    assertEvidence(item, snapshot, id)
    if (!SEVERITIES.has(item.severity)) throw err.conflict('DELIVERY_FEEDBACK_INVALID', '反馈严重度不合法')
    const resolutionFile = path.join(feedbackDirectory(root, name, 'feedback-resolutions'), file)
    let resolution = null
    if (fs.existsSync(resolutionFile)) {
      resolution = readRecord(resolutionFile)
      assertEvidence(resolution, snapshot, id)
    }
    return { ...item, status: resolution ? 'resolved' : 'open', resolution }
  })
}

export function createDeliveryFeedback(root, name, input) {
  assertWritable(root, '记录交付反馈')
  if (!object(input) || Object.keys(input).some((key) => !['title', 'description', 'severity', 'requirement'].includes(key))) {
    throw err.bad('DELIVERY_FEEDBACK_INVALID', '反馈请求只能包含标题、说明、严重度和关联需求')
  }
  const title = text(input.title, 200, '反馈标题')
  const description = text(input.description, 10000, '反馈说明')
  if (!SEVERITIES.has(input.severity)) throw err.bad('DELIVERY_FEEDBACK_INVALID', '反馈严重度必须为 blocker、important 或 normal')
  return withMilestoneSyncLock(root, `acceptance:${name}`, () => {
    const snapshot = readDeliverySnapshot(root, name)
    if (input.requirement !== undefined && !snapshot.requirements.some((item) => item.code === input.requirement)) {
      throw err.bad('DELIVERY_FEEDBACK_REQUIREMENT_INVALID', '反馈需求不在该交付快照范围内')
    }
    const record = {
      id: crypto.randomUUID(), snapshot: name, snapshotHash: snapshot.contentHash,
      title, description, severity: input.severity, requirement: input.requirement || null,
      actor: currentUser(), at: new Date().toISOString()
    }
    writeExclusive(path.join(feedbackDirectory(root, name, 'feedback', true), `${record.id}.json`), record)
    return { ...record, status: 'open', resolution: null }
  })
}

export function resolveDeliveryFeedback(root, name, id, input) {
  assertWritable(root, '解决交付反馈')
  assertId(id)
  if (!object(input) || Object.keys(input).some((key) => key !== 'reason')) throw err.bad('DELIVERY_FEEDBACK_INVALID', '解决反馈时只能提交原因')
  const reason = text(input.reason, 10000, '解决原因')
  return withMilestoneSyncLock(root, `acceptance:${name}`, () => {
    const item = listDeliveryFeedback(root, name).find((item) => item.id === id)
    if (!item) throw err.notFound(`交付反馈 ${id}`)
    if (item.resolution) return item
    const resolution = { id, snapshot: name, snapshotHash: item.snapshotHash, reason, actor: currentUser(), at: new Date().toISOString() }
    writeExclusive(path.join(feedbackDirectory(root, name, 'feedback-resolutions', true), `${id}.json`), resolution)
    return { ...item, status: 'resolved', resolution }
  })
}

function feedbackDirectory(root, name, kind, create = false) {
  let directory = root
  for (const segment of ['acceptances', name, kind]) {
    directory = path.join(directory, segment)
    try {
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw err.conflict('DELIVERY_FEEDBACK_PATH_INVALID', '交付反馈必须保存在普通目录中')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (create) fs.mkdirSync(directory)
    }
  }
  return directory
}

function readRecord(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw err.conflict('DELIVERY_FEEDBACK_PATH_INVALID', '交付反馈必须是普通文件')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeExclusive(file, record) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(record), { flag: 'wx', mode: 0o600 })
    fs.linkSync(temporary, file)
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}

function assertEvidence(record, snapshot, id) {
  if (record.id !== id || record.snapshot !== snapshot.name || record.snapshotHash !== snapshot.contentHash) {
    throw err.conflict('DELIVERY_FEEDBACK_EVIDENCE_MISMATCH', '交付反馈与快照证据不匹配')
  }
}

function assertId(id) { if (!ID.test(String(id || ''))) throw err.bad('DELIVERY_FEEDBACK_ID_INVALID', '交付反馈标识不合法') }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw err.bad('DELIVERY_FEEDBACK_INVALID', `${label}必须是非空文本，最多 ${max} 字符`)
  return value.trim()
}
