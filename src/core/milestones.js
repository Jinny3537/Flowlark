import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { requirementExists, readRequirement, normalizeDueDate, listRequirements } from './requirements.js'
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
    ...(input.project !== undefined ? { project: String(input.project || '').trim(), versionNo: String(input.versionNo || '').trim(), requirements: normalizeRequirementCodes(input.requirements) } : {}),
    title: String(input.title || name).trim(),
    goal: String(input.goal || ''),
    owner: String(input.owner || ''),
    status: normalizeMilestoneStatus(input.status),
    startAt: input.startAt || null,
    endAt: input.endAt || null,
    items: normalizeMilestoneItems(root, input.items),
    platform: normalizePlatform(input.platform),
    external: input.external || null,
    createdAt: now,
    updatedAt: now
  }
  validateIterationScope(root, item)
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
  const businessFields = ['title', 'goal', 'owner', 'startAt', 'endAt', 'items', 'platform', 'project', 'versionNo', 'requirements']
  if (!system && isLocked(item.status) && businessFields.some((key) => patch[key] !== undefined)) {
    throw err.conflict('MILESTONE_LOCKED', `迭代「${item.name}」处于 ${item.status} 状态，不能直接编辑`)
  }
  if (!system && patch.status !== undefined) throw err.bad('MILESTONE_STATUS_MANAGED', '请通过迭代状态流转操作修改状态')
  if (patch.project !== undefined) {
    if (item.project && patch.project !== item.project) throw err.conflict('MILESTONE_PROJECT_LOCKED', '迭代所属项目不能修改，请新建迭代')
    item.project = String(patch.project || '').trim()
  }
  if (patch.versionNo !== undefined) item.versionNo = String(patch.versionNo || '').trim()
  if (patch.requirements !== undefined) item.requirements = normalizeRequirementCodes(patch.requirements)
  if (patch.title !== undefined) item.title = String(patch.title || '').trim() || item.name
  if (patch.goal !== undefined) item.goal = String(patch.goal || '')
  if (patch.owner !== undefined) item.owner = String(patch.owner || '')
  if (patch.status !== undefined) item.status = normalizeMilestoneStatus(patch.status)
  if (patch.startAt !== undefined) item.startAt = patch.startAt || null
  if (patch.endAt !== undefined) item.endAt = patch.endAt || null
  if (patch.items !== undefined) item.items = normalizeMilestoneItems(root, patch.items)
  if (patch.platform !== undefined) item.platform = normalizePlatform(patch.platform)
  if (patch.external !== undefined) item.external = patch.external || null
  validateIterationScope(root, item)
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
  if (item.project !== undefined && !milestoneRequirementCodes(item).length) warnings.push({ code: 'MILESTONE_SCOPE_EMPTY', message: '尚未关联本轮需求' })
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
    platform: normalizePlatform(input.platform),
    external: input.external || null
  }
}

function isLocked(status) {
  return MILESTONE_STATUSES.has(status) && !['planning', 'reviewing'].includes(status)
}

export function normalizePlatform(value) {
  if (!value || !value.projectId) return null
  const out = {}
  for (const key of ['projectId', 'versionId', 'sprintId', 'ownerId', 'taskType']) {
    if (key === 'taskType' && value[key] == null) continue
    if (value[key] == null || value[key] === '') { out[key] = null; continue }
    const id = Number(value[key])
    if (!Number.isSafeInteger(id) || id <= 0) throw err.bad('MILESTONE_PLATFORM_INVALID', `平台字段 ${key} 必须为正整数`)
    out[key] = id
  }
  for (const key of ['server', 'projectName', 'versionName', 'sprintName', 'ownerName']) out[key] = String(value[key] || '')
  return out
}


export function milestoneRequirementCodes(item) {
  return [...new Set(Array.isArray(item.requirements) ? item.requirements : (item.items || []).map(entry => entry.requirement))]
}

function normalizeRequirementCodes(values = []) {
  if (!Array.isArray(values) || values.some(code => typeof code !== 'string' || !code.trim())) throw err.bad('MILESTONE_REQUIREMENTS_INVALID', '需求范围必须为需求编号数组')
  return [...new Set(values.map(code => code.trim()))]
}

export function validateIterationScope(root, item) {
  if (item.project === undefined) return // Legacy records retain their original scope.
  if (!item.project || !item.versionNo) throw err.bad('MILESTONE_PROJECT_REQUIRED', '请选择所属项目并填写迭代版本号')
  if (Array.isArray(item.requirements)) item.requirements = normalizeRequirementCodes(item.requirements)
  else throw err.bad('MILESTONE_REQUIREMENTS_INVALID', '需求范围必须为数组')
  if (!store.listProjectSlugs(root).includes(item.project) && !listRequirements(root).some(req => req.project === item.project)) throw err.bad('MILESTONE_PROJECT_UNKNOWN', '所属项目不存在，请先创建项目或设置需求所属项目')
  if (item.startAt) normalizeDueDate(item.startAt)
  if (item.endAt) normalizeDueDate(item.endAt)
  if (item.startAt && item.endAt && item.startAt > item.endAt) throw err.bad('MILESTONE_DATES_INVALID', '结束日期不能早于开始日期')
  const codes = milestoneRequirementCodes(item)
  for (const code of codes) {
    const requirement = readRequirement(root, code)
    if (requirement.project !== item.project) throw err.bad('MILESTONE_REQUIREMENT_PROJECT', `需求 ${code} 不属于项目 ${item.project}`)
  }
  for (const entry of item.items || []) {
    if (!codes.includes(entry.requirement)) throw err.bad('MILESTONE_ATTACHMENT_SCOPE', '原型必须关联本轮已选需求')
  }
  const dir = store.paths.milestones(root)
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    const other = readMilestone(root, file.slice(0, -5))
    if (other.name === item.name) continue
    if (other.project === item.project && other.versionNo === item.versionNo) throw err.conflict('MILESTONE_VERSION_EXISTS', '该项目的迭代版本号已存在')
    if (['delivered', 'archived', 'canceled'].includes(item.status) || ['delivered', 'archived', 'canceled'].includes(other.status)) continue
    const overlap = milestoneRequirementCodes(other).filter(code => codes.includes(code))
    if (overlap.length) throw err.conflict('MILESTONE_REQUIREMENT_OCCUPIED', `需求 ${overlap.join('、')} 已在迭代 ${other.title || other.name} 中`)
  }
}
