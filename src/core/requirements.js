import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { INTERNAL_DIR } from './repo.js'

export const REQUIREMENT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function normalizeDueDate(value) {
  const dueDate = String(value || '').trim()
  if (!dueDate) return ''
  if (!DUE_DATE_RE.test(dueDate)) {
    throw err.bad('REQUIREMENT_DUE_DATE_INVALID', `截止日期「${dueDate}」不合法`, '请使用 YYYY-MM-DD 格式')
  }
  const [year, month, day] = dueDate.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw err.bad('REQUIREMENT_DUE_DATE_INVALID', `截止日期「${dueDate}」不存在`, '请选择有效日历日期')
  }
  return dueDate
}

export function localDate(now = new Date()) {
  const part = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`
}

export function isRequirementOverdue(item, today = localDate()) {
  return Boolean(item && item.dueDate && item.dueDate < today && item.derivedStatus !== 'delivered')
}

export function assertRequirementCode(code) {
  const value = String(code || '').trim()
  if (!REQUIREMENT_CODE_RE.test(value)) {
    throw err.bad('REQUIREMENT_CODE_INVALID', `需求编号「${value}」不合法`, '只允许字母、数字、. _ -，长度不超过 64')
  }
  return value
}

export function requirementExists(root, code) {
  return fs.existsSync(store.paths.requirementFile(root, assertRequirementCode(code)))
}

export function readRequirement(root, code) {
  const safe = assertRequirementCode(code)
  const file = store.paths.requirementFile(root, safe)
  if (!fs.existsSync(file)) throw err.notFound(`需求「${safe}」`)
  return normalizeStoredRequirement(parse(fs.readFileSync(file, 'utf8'), `${safe}/requirement.json`))
}

export function listRequirementCodes(root) {
  const dir = store.paths.requirements(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(store.paths.requirementFile(root, entry.name)))
    .map((entry) => entry.name).sort()
}

export function createRequirement(root, input, now = new Date().toISOString()) {
  const code = assertRequirementCode(input.code)
  if (requirementExists(root, code)) throw err.conflict('REQUIREMENT_EXISTS', `需求「${code}」已存在`)
  const title = String(input.title || '').trim()
  if (!title) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  const item = {
    code,
    title,
    description: String(input.description || ''),
    project: String(input.project || ''),
    module: String(input.module || ''),
    type: String(input.type || ''),
    priority: String(input.priority || ''),
    owner: String(input.owner || ''),
    dueDate: normalizeDueDate(input.dueDate),
    statusOverride: input.statusOverride || null,
    external: input.external || null,
    externalTasks: normalizeExternalTasks(input.externalTasks),
    url: String(input.url || ''),
    createdAt: now,
    updatedAt: now
  }
  const file = store.paths.requirementFile(root, code)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(item, 'requirement'))
  return item
}

export function updateRequirement(root, code, patch) {
  const item = readRequirement(root, code)
  for (const key of ['title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'dueDate', 'statusOverride', 'external', 'url']) {
    if (patch[key] !== undefined) item[key] = patch[key]
  }
  if (!String(item.title || '').trim()) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  item.title = String(item.title).trim()
  item.dueDate = normalizeDueDate(item.dueDate)
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.requirementFile(root, item.code), stringify(item, 'requirement'))
  return item
}

export function upsertExternalTask(root, code, binding) {
  const item = readRequirement(root, code)
  const normalized = normalizeExternalTask(binding)
  const key = externalTaskKey(normalized)
  const existing = item.externalTasks.findIndex((entry) => externalTaskKey(entry) === key)
  if (existing >= 0) item.externalTasks[existing] = normalized
  else item.externalTasks.push(normalized)
  item.externalTasks.sort((a, b) => externalTaskKey(a).localeCompare(externalTaskKey(b)))
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.requirementFile(root, item.code), stringify(item, 'requirement'))
  return item
}

export function ensureRequirement(root, raw) {
  const input = typeof raw === 'string' ? { code: raw, title: raw } : raw
  const code = assertRequirementCode(input && input.code)
  if (!requirementExists(root, code)) createRequirement(root, { ...input, title: input.title || code })
  return code
}

export function resolveRequirementLinks(root, links) {
  return (links || []).map((raw) => {
    const code = typeof raw === 'string' ? raw : raw.code
    if (requirementExists(root, code)) return readRequirement(root, code)
    return typeof raw === 'object' ? raw : { code, title: code, url: '' }
  })
}

function indexFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'requirements-index.json')
}

function sourceFingerprint(root) {
  const rows = []
  for (const slug of store.listProjectSlugs(root)) {
    for (const no of store.listVersionNos(root, slug)) {
      const stat = fs.statSync(store.paths.versionJson(root, slug, no))
      rows.push(`${slug}/${no}:${stat.size}:${stat.mtimeMs}`)
    }
    const baseline = store.readBaseline(root, slug)
    rows.push(`${slug}/BASELINE:${baseline || ''}`)
  }
  return crypto.createHash('sha256').update(rows.sort().join('\n')).digest('hex')
}

export function buildRequirementIndex(root) {
  const byCode = {}
  for (const slug of store.listProjectSlugs(root)) {
    const baseline = store.readBaseline(root, slug)
    for (const no of store.listVersionNos(root, slug)) {
      const version = store.readVersion(root, slug, no)
      for (const raw of version.requirements || []) {
        const code = typeof raw === 'string' ? raw : raw.code
        if (!code) continue
        if (!byCode[code]) byCode[code] = []
        byCode[code].push({ project: slug, versionNo: no, title: version.title, isBaseline: no === baseline, status: version.status, reviewStatus: version.reviewStatus, createdAt: version.createdAt })
      }
    }
  }
  const result = { fingerprint: sourceFingerprint(root), byCode }
  const file = indexFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(result))
  return result
}

export function readRequirementIndex(root) {
  const file = indexFile(root)
  if (fs.existsSync(file)) {
    const cached = parse(fs.readFileSync(file, 'utf8'), '需求索引')
    if (cached.fingerprint === sourceFingerprint(root)) return cached
  }
  return buildRequirementIndex(root)
}

export function linkedVersions(root, code) {
  return (readRequirementIndex(root).byCode[assertRequirementCode(code)] || [])
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export function deriveRequirementStatus(root, code) {
  const versions = linkedVersions(root, code)
  if (!versions.length) return 'not_started'
  if (versions.every((item) => !item.isBaseline)) return 'designing'
  const projects = [...new Set(versions.map((item) => item.project))]
  const delivered = projects.every((project) => versions.some((item) => item.project === project && item.isBaseline && item.reviewStatus === 'confirmed'))
  return delivered ? 'delivered' : 'finalized'
}

export function requirementDetail(root, code) {
  const item = readRequirement(root, code)
  const versions = linkedVersions(root, code)
  const derivedStatus = item.statusOverride || deriveRequirementStatus(root, code)
  const detail = { ...item, dueDate: item.dueDate || '', derivedStatus, manualStatus: !!item.statusOverride, versions }
  return { ...detail, overdue: isRequirementOverdue(detail) }
}

export function listRequirements(root) {
  return listRequirementCodes(root).map((code) => requirementDetail(root, code))
}

function normalizeStoredRequirement(input = {}) {
  return { ...input, external: input.external || null, externalTasks: normalizeExternalTasks(input.externalTasks) }
}

function normalizeExternalTasks(input) {
  return (Array.isArray(input) ? input : []).map(normalizeExternalTask)
    .sort((a, b) => externalTaskKey(a).localeCompare(externalTaskKey(b)))
}

function normalizeExternalTask(input = {}) {
  const provider = String(input.provider || '').trim()
  const server = String(input.server || '').trim()
  const projectId = positiveId(input.projectId, '平台项目 ID')
  const taskId = positiveId(input.taskId, '平台任务 ID')
  if (!provider || !server) throw err.bad('EXTERNAL_TASK_INVALID', '外部任务绑定缺少 Provider 或服务标识')
  return {
    provider,
    server,
    projectId,
    taskId,
    revision: finiteOrNull(input.revision),
    remoteStatus: input.remoteStatus ?? null,
    url: String(input.url || ''),
    lastSyncHash: String(input.lastSyncHash || ''),
    syncedAt: input.syncedAt || null
  }
}

function externalTaskKey(item) {
  return `${item.provider}:${item.server}:${item.projectId}`
}

function positiveId(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw err.bad('EXTERNAL_TASK_INVALID', `${label} 必须是正整数`)
  return number
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
