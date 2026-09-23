import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { requirementExists, readRequirement } from './requirements.js'
import { MILESTONE_STATUSES, normalizeMilestoneStatus } from './milestone-lifecycle.js'

export const MILESTONE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function assertMilestoneName(name) {
  const value = String(name || '').trim()
  if (!MILESTONE_NAME_RE.test(value)) throw err.bad('MILESTONE_NAME_INVALID', `迭代标识「${value}」不合法`)
  return value
}

export function milestoneExists(root, name) {
  return fs.existsSync(store.paths.milestoneFile(root, assertMilestoneName(name)))
}

export function normalizeMilestoneItems(root, items) {
  const out = []
  const seen = new Set()
  for (const raw of items || []) {
    const item = {
      requirement: String(raw.requirement || '').trim(),
      project: String(raw.project || '').trim(),
      version: String(raw.version || '').trim()
    }
    if (!item.requirement || !requirementExists(root, item.requirement)) throw err.bad('MILESTONE_REQUIREMENT_MISSING', `需求「${item.requirement}」不存在`)
    if (readRequirement(root, item.requirement).deletedAt) throw err.bad('MILESTONE_REQUIREMENT_DELETED', `需求「${item.requirement}」已删除，请先恢复`)
    store.readProject(root, item.project)
    store.readVersion(root, item.project, item.version)
    const key = `${item.requirement}:${item.project}:${item.version}`
    if (!seen.has(key)) { seen.add(key); out.push(item) }
  }
  return out
}

export function createMilestone(root, input) {
  const name = assertMilestoneName(input.name)
  if (milestoneExists(root, name)) throw err.conflict('MILESTONE_EXISTS', `迭代「${name}」已存在`)
  const now = new Date().toISOString()
  const item = {
    name,
    title: String(input.title || name).trim(),
    goal: String(input.goal || ''),
    owner: String(input.owner || ''),
    status: normalizeMilestoneStatus(input.status),
    startAt: input.startAt || null,
    endAt: input.endAt || null,
    items: normalizeMilestoneItems(root, input.items),
    external: input.external || null,
    createdAt: now,
    updatedAt: now
  }
  fs.mkdirSync(store.paths.milestones(root), { recursive: true })
  fs.writeFileSync(store.paths.milestoneFile(root, name), stringify(item, 'milestone'))
  return inspectMilestone(root, item)
}

export function readMilestone(root, name) {
  const safe = assertMilestoneName(name)
  const file = store.paths.milestoneFile(root, safe)
  if (!fs.existsSync(file)) throw err.notFound(`迭代「${safe}」`)
  const text = fs.readFileSync(file, 'utf8')
  return { ...normalizeStoredMilestone(parse(text, `${safe}.json`)), revision: crypto.createHash('sha256').update(text).digest('hex') }
}

export function listMilestones(root) {
  const dir = store.paths.milestones(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => inspectMilestone(root, readMilestone(root, name.slice(0, -5))))
    .sort((a, b) => String(b.endAt || b.updatedAt).localeCompare(String(a.endAt || a.updatedAt)))
}

export function updateMilestone(root, name, patch, { system = false } = {}) {
  return withMilestoneLock(root, name, () => updateUnlocked(root, name, patch, system))
}

function withMilestoneLock(root, name, action) {
  const dir = path.join(root, '.flowlark', 'cache', 'milestone-locks')
  fs.mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, `${assertMilestoneName(name)}.lock`)
  let fd
  try { fd = fs.openSync(lock, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') throw err.conflict('MILESTONE_BUSY', '迭代正在被修改，请稍后重新读取并重试')
    throw error
  }
  try { return action() } finally { fs.closeSync(fd); fs.unlinkSync(lock) }
}

function updateUnlocked(root, name, patch, system = false) {
  const item = readMilestone(root, name)
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== item.revision) {
    throw err.conflict('MILESTONE_STALE', '迭代范围已变化，请重新核对后确认')
  }
  const businessFields = ['title', 'goal', 'owner', 'startAt', 'endAt', 'items']
  if (!system && isLocked(item.status) && businessFields.some((key) => patch[key] !== undefined)) {
    throw err.conflict('MILESTONE_LOCKED', `迭代「${item.name}」处于 ${item.status} 状态，不能直接编辑`)
  }
  if (!system && patch.status !== undefined) throw err.bad('MILESTONE_STATUS_MANAGED', '请通过迭代状态流转操作修改状态')
  if (patch.title !== undefined) item.title = String(patch.title || '').trim() || item.name
  if (patch.goal !== undefined) item.goal = String(patch.goal || '')
  if (patch.owner !== undefined) item.owner = String(patch.owner || '')
  if (patch.status !== undefined) item.status = normalizeMilestoneStatus(patch.status)
  if (patch.startAt !== undefined) item.startAt = patch.startAt || null
  if (patch.endAt !== undefined) item.endAt = patch.endAt || null
  if (patch.items !== undefined) item.items = normalizeMilestoneItems(root, patch.items)
  if (patch.external !== undefined) item.external = patch.external || null
  item.updatedAt = new Date().toISOString()
  delete item.revision
  const file = store.paths.milestoneFile(root, item.name)
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try { fs.writeFileSync(temp, stringify(item, 'milestone')); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  return inspectMilestone(root, name)
}

// Contextual assignment only accepts existing requirement/prototype links.
export function validateAssignment(root, items) {
  if (!Array.isArray(items) || !items.length) throw err.bad('MILESTONE_SCOPE_EMPTY', '请选择需求与原型')
  const selected = normalizeMilestoneItems(root, items)
  for (const entry of selected) {
    const version = store.readVersion(root, entry.project, entry.version)
    if (version.status === 'VOID') throw err.bad('MILESTONE_VERSION_VOID', '废弃版本不能加入候选范围')
    if (!(version.requirements || []).some(r => (typeof r === 'string' ? r : r.code) === entry.requirement)) {
      throw err.bad('MILESTONE_LINK_MISSING', `${entry.requirement} 尚未关联 ${entry.project}/${entry.version}，请先关联归档原型`)
    }
  }
  return selected
}

export function assignMilestone(root, name, input) {
  return withMilestoneLock(root, name, () => {
    const current = readMilestone(root, name)
    if (!input.expectedRevision || input.expectedRevision !== current.revision) throw err.conflict('MILESTONE_STALE', '迭代范围已变化，请重新核对后确认')
    if (!['append', 'replace'].includes(input.mode)) throw err.bad('MILESTONE_ASSIGN_MODE', '请选择保留或替换现有候选版本')
    const selected = validateAssignment(root, input.items)
    const retained = input.mode === 'replace' ? current.items.filter(old => !selected.some(next => next.requirement === old.requirement && next.project === old.project)) : current.items
    return updateUnlocked(root, name, { items: [...retained, ...selected], expectedRevision: input.expectedRevision })
  })
}

export function removeMilestone(root, name) {
  return withMilestoneLock(root, name, () => {
    const item = readMilestone(root, name)
    fs.rmSync(store.paths.milestoneFile(root, item.name))
    return { name: item.name }
  })
}

export function inspectMilestone(root, input) {
  const item = typeof input === 'string' ? readMilestone(root, input) : normalizeStoredMilestone(input)
  const warnings = []
  const details = item.items.map((entry) => {
    let version
    try { version = store.readVersion(root, entry.project, entry.version) }
    catch (error) {
      if (error.code !== 'NOT_FOUND' && error.code !== 'ENOENT') throw error
      warnings.push({ code: 'VERSION_MISSING', ...entry, message: `${entry.project}/${entry.version} 归档缺失，请核对历史范围` })
      return { ...entry, missing: true }
    }
    const baseline = store.readBaseline(root, entry.project)
    if (version.status === 'VOID') warnings.push({ code: 'VERSION_VOID', ...entry, message: `${entry.project}/${entry.version} 已废弃` })
    else if (version.status === 'DRAFT') warnings.push({ code: 'VERSION_DRAFT', ...entry, message: `${entry.project}/${entry.version} 仍是草稿` })
    if (baseline !== entry.version) warnings.push({ code: 'BASELINE_DRIFT', ...entry, baseline, message: `${entry.project} 当前基线已变为 ${baseline || '无'}` })
    const linkMissing = !(version.requirements || []).some(r => (typeof r === 'string' ? r : r.code) === entry.requirement)
    return { ...entry, linkMissing, versionTitle: version.title, versionStatus: version.status, reviewStatus: version.reviewStatus, currentBaseline: baseline }
  })
  return { ...item, items: details, warnings, ready: warnings.length === 0 }
}

function normalizeStoredMilestone(input = {}) {
  return {
    ...input,
    goal: String(input.goal || ''),
    owner: String(input.owner || ''),
    status: normalizeMilestoneStatus(input.status),
    items: Array.isArray(input.items) ? input.items : [],
    external: input.external || null
  }
}

function isLocked(status) {
  return MILESTONE_STATUSES.has(status) && !['planning', 'reviewing'].includes(status)
}
