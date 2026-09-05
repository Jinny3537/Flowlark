import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { requirementExists } from './requirements.js'
import { MILESTONE_STATUSES, normalizeMilestoneStatus, transitionMilestoneStatus } from './milestone-lifecycle.js'

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
    store.readProject(root, item.project)
    store.readVersion(root, item.project, item.version)
    const key = `${item.requirement}:${item.project}:${item.version}`
    if (!seen.has(key)) { seen.add(key); out.push(item) }
  }
  return out
}

export function createMilestone(root, input, { system = false } = {}) {
  if (!system && Object.hasOwn(input || {}, 'external')) {
    throw err.bad('MILESTONE_MANAGED_FIELD', '字段「external」由 Flowlark 管理，不能由普通创建请求设置')
  }
  const name = assertMilestoneName(input.name)
  if (milestoneExists(root, name)) throw err.conflict('MILESTONE_EXISTS', `迭代「${name}」已存在`)
  if (system && input.external?.sprintId) assertExternalSprintAvailable(root, name, input.external)
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
    deliveries: [],
    external: system ? input.external || null : null,
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
  return normalizeStoredMilestone(parse(fs.readFileSync(file, 'utf8'), `${safe}.json`))
}

export function listMilestones(root) {
  const dir = store.paths.milestones(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => inspectMilestone(root, readMilestone(root, name.slice(0, -5))))
    .sort((a, b) => String(b.endAt || b.updatedAt).localeCompare(String(a.endAt || a.updatedAt)))
}

export function updateMilestone(root, name, patch, { system = false } = {}) {
  const item = readMilestone(root, name)
  const businessFields = ['title', 'goal', 'owner', 'startAt', 'endAt', 'items']
  if (!system && Object.hasOwn(patch || {}, 'external')) {
    throw err.bad('MILESTONE_MANAGED_FIELD', '字段「external」由 Flowlark 管理，不能由普通编辑请求设置')
  }
  if (system && patch.external?.sprintId) assertExternalSprintAvailable(root, item.name, patch.external)
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
  if (system && patch.deliveries !== undefined) item.deliveries = normalizeMilestoneDeliveries(root, item, patch.deliveries)
  if (patch.external !== undefined) item.external = patch.external || null
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.milestoneFile(root, item.name), stringify(item, 'milestone'))
  return inspectMilestone(root, item)
}

export function recordMilestoneDelivery(root, name, input) {
  const item = readMilestone(root, name)
  const next = normalizeMilestoneDeliveries(root, item, [
    ...item.deliveries.filter((entry) => !(entry.project === input.project && entry.version === input.version)),
    input
  ])
  item.deliveries = next
  if (item.status === 'active' && allScopedProjectVersionsDelivered(item)) {
    transitionMilestoneStatus(item.status, 'delivered', { remoteExists: false })
    item.status = 'delivered'
  }
  item.updatedAt = new Date().toISOString()
  writeMilestoneFileAtomic(root, item)
  return inspectMilestone(root, item)
}

export function replaceExternalSprint(root, milestoneName, binding, { expectedSprintId } = {}) {
  const item = readMilestone(root, milestoneName)
  const expected = nullablePositiveId(expectedSprintId, '预期平台 Sprint ID')
  const currentSprintId = item.external?.sprintId ? positiveId(item.external.sprintId, '当前平台 Sprint ID') : null
  if (currentSprintId !== expected) {
    throw err.conflict(
      'EXTERNAL_SPRINT_CAS_MISMATCH',
      `迭代 ${item.name} 的平台 Sprint 绑定已变化，当前为 ${currentSprintId ?? '未绑定'}`
    )
  }
  const server = String(binding?.server || '').trim()
  const projectId = positiveId(binding?.projectId, '平台项目 ID')
  const sprintId = positiveId(binding?.sprintId, '平台 Sprint ID')
  if (!server) throw err.bad('EXTERNAL_SPRINT_INVALID', '平台 Sprint 绑定缺少服务标识')
  assertExternalSprintAvailable(root, item.name, { server, projectId, sprintId })
  item.external = {
    provider: String(binding?.provider || 'assess-task'),
    server,
    projectId,
    sprintId,
    revision: finiteOrNull(binding?.revision),
    remoteStatus: binding?.remoteStatus ?? null,
    url: String(binding?.url || ''),
    lastSyncHash: '',
    syncedAt: binding?.syncedAt || null
  }
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.milestoneFile(root, item.name), stringify(item, 'milestone'))
  return inspectMilestone(root, item)
}

export function markMilestoneFrozen(root, name, { scopeHash, verifiedAt = new Date().toISOString() } = {}) {
  const item = readMilestone(root, name)
  transitionMilestoneStatus(item.status, 'frozen', { remoteExists: true, verifiedFreeze: true })
  if (!item.external?.sprintId) throw err.bad('MCP_SYNC_SPRINT_BINDING_MISSING', '迭代缺少平台 Sprint 绑定')
  const hash = String(scopeHash || '').trim()
  if (!hash) throw err.bad('MILESTONE_SOURCE_HASH_REQUIRED', '冻结迭代缺少来源哈希')
  item.status = 'frozen'
  item.external = { ...item.external, scopeHash: hash, verifiedAt }
  item.updatedAt = verifiedAt
  writeMilestoneFileAtomic(root, item)
  return inspectMilestone(root, item)
}

export function assertExternalSprintAvailable(root, milestoneName, binding) {
  const server = String(binding?.server || '').trim()
  const projectId = positiveId(binding?.projectId, '平台项目 ID')
  const sprintId = positiveId(binding?.sprintId, '平台 Sprint ID')
  if (!server) throw err.bad('EXTERNAL_SPRINT_INVALID', '平台 Sprint 绑定缺少服务标识')
  const dir = store.paths.milestones(root)
  if (!fs.existsSync(dir)) return { server, projectId, sprintId }
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const otherName = file.slice(0, -5)
    if (otherName === milestoneName) continue
    const external = readMilestone(root, otherName).external
    if (external?.server === server && Number(external.projectId) === projectId && Number(external.sprintId) === sprintId) {
      throw err.conflict(
        'EXTERNAL_SPRINT_ALREADY_BOUND',
        `平台 Sprint ${sprintId} 已绑定迭代 ${otherName}`
      )
    }
  }
  return { server, projectId, sprintId }
}

export function removeMilestone(root, name) {
  const item = readMilestone(root, name)
  fs.rmSync(store.paths.milestoneFile(root, item.name))
  return { name: item.name }
}

export function inspectMilestone(root, input) {
  const item = typeof input === 'string' ? readMilestone(root, input) : normalizeStoredMilestone(input)
  const warnings = []
  const details = item.items.map((entry) => {
    const version = store.readVersion(root, entry.project, entry.version)
    const baseline = store.readBaseline(root, entry.project)
    if (version.status === 'VOID') warnings.push({ code: 'VERSION_VOID', ...entry, message: `${entry.project}/${entry.version} 已废弃` })
    else if (version.status === 'DRAFT') warnings.push({ code: 'VERSION_DRAFT', ...entry, message: `${entry.project}/${entry.version} 仍是草稿` })
    if (baseline !== entry.version) warnings.push({ code: 'BASELINE_DRIFT', ...entry, baseline, message: `${entry.project} 当前基线已变为 ${baseline || '无'}` })
    return { ...entry, versionTitle: version.title, versionStatus: version.status, reviewStatus: version.reviewStatus, currentBaseline: baseline }
  })
  return { ...item, items: details, warnings, ready: warnings.length === 0 }
}

function normalizeStoredMilestone(input = {}) {
  return {
    ...input,
    deliveries: input.deliveries || [],
    goal: String(input.goal || ''),
    owner: String(input.owner || ''),
    status: normalizeMilestoneStatus(input.status),
    items: Array.isArray(input.items) ? input.items : [],
    external: input.external || null
  }
}

function normalizeMilestoneDeliveries(root, milestone, deliveries) {
  if (!Array.isArray(deliveries)) throw err.bad('MILESTONE_DELIVERIES_INVALID', '迭代交付记录必须是数组')
  const scoped = new Set((milestone.items || []).map((item) => `${item.project}:${item.version}`))
  const seen = new Set()
  const out = []
  for (const raw of deliveries) {
    const item = {
      project: String(raw?.project || '').trim(),
      version: String(raw?.version || '').trim(),
      snapshot: String(raw?.snapshot || '').trim(),
      releaseRunId: String(raw?.releaseRunId || '').trim()
    }
    const key = `${item.project}:${item.version}`
    if (!scoped.has(key)) throw err.bad('MILESTONE_DELIVERY_OUT_OF_SCOPE', '交付记录不在迭代范围内')
    if (seen.has(key)) throw err.bad('MILESTONE_DELIVERY_DUPLICATE', '同一项目版本不能重复交付')
    store.readProject(root, item.project)
    store.readVersion(root, item.project, item.version)
    if (!/^delivery-[a-f0-9]{48}$/.test(item.snapshot)) {
      throw err.bad('MILESTONE_DELIVERY_SNAPSHOT_INVALID', '交付快照标识无效')
    }
    seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => `${a.project}:${a.version}`.localeCompare(`${b.project}:${b.version}`))
}

function allScopedProjectVersionsDelivered(milestone) {
  const required = new Set((milestone.items || []).map((item) => `${item.project}:${item.version}`))
  for (const delivery of milestone.deliveries || []) required.delete(`${delivery.project}:${delivery.version}`)
  return required.size === 0
}

function isLocked(status) {
  return MILESTONE_STATUSES.has(status) && !['planning', 'reviewing'].includes(status)
}

function positiveId(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw err.bad('EXTERNAL_SPRINT_INVALID', `${label} 必须是正整数`)
  return number
}

function nullablePositiveId(value, label) {
  if (value == null || value === '') return null
  return positiveId(value, label)
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function writeMilestoneFileAtomic(root, item) {
  const file = store.paths.milestoneFile(root, item.name)
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(item, 'milestone'))
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
}
