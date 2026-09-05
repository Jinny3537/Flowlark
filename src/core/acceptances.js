import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { currentUser } from './repo.js'
import { assertWritable } from './permissions.js'
import { stringify } from './json.js'
import { aggregateAcceptance } from './acceptance-rules.js'
import { readDeliverySnapshot } from './delivery-snapshots.js'
import { withMilestoneSyncLock } from './milestone-sync.js'

const RECORD_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

export function listAcceptances(root, snapshotName) {
  const snapshot = readDeliverySnapshot(root, snapshotName)
  const directory = acceptanceDirectory(root, snapshotName)
  if (!fs.existsSync(directory)) return []
  const records = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => {
    const id = name.slice(0, -5)
    if (!RECORD_ID.test(id)) throw err.conflict('ACCEPTANCE_RECORD_INVALID', '验收记录文件名不合法')
    const file = path.join(directory, name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw err.conflict('ACCEPTANCE_PATH_INVALID', '验收记录必须是普通文件')
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (record.id !== id || record.snapshot !== snapshotName || record.snapshotHash !== snapshot.contentHash) {
      throw err.conflict('ACCEPTANCE_EVIDENCE_MISMATCH', '验收记录与交付证据不匹配')
    }
    return record
  })
  aggregateAcceptance(snapshot.acceptance, records)
  return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
}

export function appendAcceptance(root, snapshotName, input) {
  assertWritable(root, '提交验收结论')
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['role', 'verdict', 'note', 'conditions', 'expectedSnapshotHash'].includes(key))) {
    throw err.bad('ACCEPTANCE_INPUT_INVALID', '验收请求只能包含角色、结论、备注、条件和预期快照摘要')
  }
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 10000)) {
    throw err.bad('ACCEPTANCE_NOTE_INVALID', '验收备注必须是最多 10000 字符的文本')
  }
  return withMilestoneSyncLock(root, `acceptance:${snapshotName}`, () => {
    const snapshot = readDeliverySnapshot(root, snapshotName)
    if (input.expectedSnapshotHash !== undefined && input.expectedSnapshotHash !== snapshot.contentHash) {
      throw err.conflict('ACCEPTANCE_EVIDENCE_MISMATCH', '待验收的交付快照已变化')
    }
    const records = listAcceptances(root, snapshotName)
    const conditions = normalizeConditions(input.conditions)
    const previousAt = records.length ? Date.parse(records.at(-1).at) : 0
    const record = {
      id: crypto.randomUUID(), snapshot: snapshotName, snapshotHash: snapshot.contentHash,
      role: input.role, verdict: input.verdict, note: (input.note || '').trim(), conditions,
      actor: currentUser(), at: new Date(Math.max(Date.now(), previousAt + 1)).toISOString()
    }
    aggregateAcceptance(snapshot.acceptance, [...records, record])
    const directory = acceptanceDirectory(root, snapshotName, true)
    const file = path.join(directory, `${record.id}.json`)
    const temporary = `${file}.tmp`
    try {
      fs.writeFileSync(temporary, stringify(record), { flag: 'wx', mode: 0o600 })
      fs.linkSync(temporary, file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    return record
  })
}

function normalizeConditions(input) {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 100) throw err.bad('ACCEPTANCE_CONDITIONS_INVALID', '验收条件必须是最多 100 项的列表')
  const ids = new Set()
  return input.map((condition) => {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition) ||
        Object.keys(condition).some((key) => !['id', 'text', 'closed'].includes(key)) ||
        typeof condition.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(condition.id) || ids.has(condition.id) ||
        typeof condition.text !== 'string' || !condition.text.trim() || condition.text.length > 2000 ||
        typeof condition.closed !== 'boolean') {
      throw err.bad('ACCEPTANCE_CONDITIONS_INVALID', '每个验收条件必须有唯一标识、说明和关闭状态')
    }
    ids.add(condition.id)
    return { id: condition.id, text: condition.text.trim(), closed: condition.closed }
  })
}

function acceptanceDirectory(root, snapshot, create = false) {
  // snapshot names have already been checked by readDeliverySnapshot.
  const base = path.join(root, 'acceptances')
  const directory = path.join(base, snapshot)
  for (const target of [base, directory]) {
    try {
      const stat = fs.lstatSync(target)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw err.conflict('ACCEPTANCE_PATH_INVALID', '验收记录目录必须是普通目录')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (create) fs.mkdirSync(target)
    }
  }
  return directory
}
