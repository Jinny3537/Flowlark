import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { INTERNAL_DIR } from './repo.js'
import { normalizeRequirementStatus, transitionRequirementStatus } from './requirement-lifecycle.js'

export const REQUIREMENT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MANAGED_REQUIREMENT_FIELDS = new Set([
  'status', 'statusReason', 'statusOverride', 'external', 'externalTasks'
])

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
  const closed = ['completed', 'archived'].includes(item?.status) || item?.derivedStatus === 'delivered'
  return Boolean(item && item.dueDate && item.dueDate < today && !closed)
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

export function createRequirement(root, input, metadata = {}) {
  const context = typeof metadata === 'string' ? { now: metadata } : metadata
  assertNoManagedFields(input, { trusted: context.trusted === true })
  const now = context.now || new Date().toISOString()
  const actor = String(context.actor || 'system')
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
    status: 'draft',
    statusChangedAt: now,
    statusChangedBy: actor,
    statusReason: 'created',
    external: context.trusted ? input.external || null : null,
    externalTasks: context.trusted ? normalizeExternalTasks(input.externalTasks) : [],
    url: String(input.url || ''),
    createdAt: now,
    updatedAt: now
  }
  const file = store.paths.requirementFile(root, code)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(item, 'requirement'))
  return item
}

export function updateRequirement(root, code, patch, { trusted = false, now = null } = {}) {
  const item = readRequirement(root, code)
  assertNoManagedFields(patch, { trusted })
  for (const key of ['title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'dueDate', 'url']) {
    if (patch[key] !== undefined) item[key] = patch[key]
  }
  if (trusted && patch.external !== undefined) item.external = patch.external || null
  if (trusted && patch.externalTasks !== undefined) item.externalTasks = normalizeExternalTasks(patch.externalTasks)
  if (!String(item.title || '').trim()) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  item.title = String(item.title).trim()
  item.dueDate = normalizeDueDate(item.dueDate)
  item.updatedAt = now || new Date().toISOString()
  fs.writeFileSync(store.paths.requirementFile(root, item.code), stringify(item, 'requirement'))
  return item
}

export function readRequirementSpec(root, code) {
  const safe = assertRequirementCode(code)
  const file = safeRequirementSpecFile(root, safe)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

export function writeRequirementSpec(root, code, markdown) {
  const safe = assertRequirementCode(code)
  const file = safeRequirementSpecFile(root, safe)
  const content = String(markdown || '')
  if (!content.trim()) {
    if (fs.existsSync(file)) fs.rmSync(file)
    return ''
  }
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, normalized, 'utf8')
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
  return normalized
}

function safeRequirementSpecFile(root, code) {
  const requirementsDir = store.paths.requirements(root)
  const requirementDir = store.paths.requirement(root, code)
  for (const [target, label] of [[requirementsDir, 'requirements/'], [requirementDir, `requirements/${code}/`]]) {
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) throw specSymlinkError(label)
      if (!stat.isDirectory()) throw err.conflict('REQUIREMENT_SPEC_PATH_INVALID', `${label} 必须是普通目录`)
    } catch (error) {
      if (error?.code === 'ENOENT') throw err.notFound(`需求「${code}」`)
      throw error
    }
  }
  const rootReal = fs.realpathSync(requirementsDir)
  const parentReal = fs.realpathSync(requirementDir)
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw specSymlinkError(`requirements/${code}/`)
  }
  if (!requirementExists(root, code)) throw err.notFound(`需求「${code}」`)
  const file = store.paths.requirementSpec(root, code)
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) throw specSymlinkError(`requirements/${code}/spec.md`)
    if (!stat.isFile()) throw err.conflict('REQUIREMENT_SPEC_PATH_INVALID', `requirements/${code}/spec.md 必须是普通文件`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return file
}

function specSymlinkError(relative) {
  return err.conflict('REQUIREMENT_SPEC_SYMLINK', `拒绝通过符号链接读取或写入需求规格书：${relative}`)
}

export function updateRequirementLifecycle(root, code, target, {
  system = false,
  actor = 'system',
  now = new Date().toISOString(),
  reason = ''
} = {}) {
  const item = readRequirement(root, code)
  const transition = transitionRequirementStatus(item.status, target, { system })
  if (!transition.changed) return { item, transition }
  item.status = transition.to
  item.statusChangedAt = now
  item.statusChangedBy = String(actor || 'system')
  item.statusReason = String(reason || '').trim()
  item.updatedAt = now
  writeRequirementFileAtomic(root, item)
  return { item, transition }
}

export function upsertExternalTask(root, code, binding) {
  const item = readRequirement(root, code)
  const normalized = normalizeExternalTask(binding)
  assertExternalTaskAvailable(root, code, normalized)
  const key = externalTaskKey(normalized)
  const existing = item.externalTasks.findIndex((entry) => externalTaskKey(entry) === key)
  if (existing >= 0) item.externalTasks[existing] = normalized
  else item.externalTasks.push(normalized)
  item.externalTasks.sort((a, b) => externalTaskKey(a).localeCompare(externalTaskKey(b)))
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.requirementFile(root, item.code), stringify(item, 'requirement'))
  return item
}

export function assertExternalTaskAvailable(root, code, binding) {
  const normalized = normalizeExternalTask(binding)
  for (const otherCode of listRequirementCodes(root)) {
    if (otherCode === code) continue
    const occupied = readRequirement(root, otherCode).externalTasks.some((item) =>
      item.server === normalized.server &&
      item.projectId === normalized.projectId &&
      item.taskId === normalized.taskId)
    if (occupied) {
      throw err.conflict(
        'EXTERNAL_TASK_ALREADY_BOUND',
        `平台任务 ${normalized.taskId} 已绑定需求 ${otherCode}`
      )
    }
  }
  return normalized
}

export function replaceExternalTask(root, code, binding, { expectedTaskId } = {}) {
  const item = readRequirement(root, code)
  const normalized = normalizeExternalTask({ ...binding, lastSyncHash: '' })
  const key = externalTaskKey(normalized)
  const existing = item.externalTasks.findIndex((entry) => externalTaskKey(entry) === key)
  const currentTaskId = existing >= 0 ? item.externalTasks[existing].taskId : null
  const expected = nullablePositiveId(expectedTaskId, '预期平台任务 ID')
  if (currentTaskId !== expected) {
    throw err.conflict(
      'EXTERNAL_TASK_CAS_MISMATCH',
      `需求 ${item.code} 的平台任务绑定已变化，当前为 ${currentTaskId ?? '未绑定'}`
    )
  }
  assertExternalTaskAvailable(root, item.code, normalized)
  if (existing >= 0) item.externalTasks[existing] = normalized
  else item.externalTasks.push(normalized)
  item.externalTasks.sort((a, b) => externalTaskKey(a).localeCompare(externalTaskKey(b)))
  item.updatedAt = new Date().toISOString()
  writeRequirementFileAtomic(root, item)
  return item
}

export function ensureRequirement(root, raw, metadata = {}) {
  const input = typeof raw === 'string' ? { code: raw, title: raw } : raw
  const code = assertRequirementCode(input && input.code)
  if (!requirementExists(root, code)) createRequirement(root, { ...input, title: input.title || code }, metadata)
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
  return {
    ...input,
    status: normalizeRequirementStatus(input.status),
    statusChangedAt: input.statusChangedAt || input.createdAt || '',
    statusChangedBy: input.statusChangedBy || '',
    statusReason: input.statusReason || '',
    external: input.external || null,
    externalTasks: normalizeExternalTasks(input.externalTasks)
  }
}

function assertNoManagedFields(input = {}, { trusted = false } = {}) {
  const field = Object.keys(input || {}).find((key) =>
    (MANAGED_REQUIREMENT_FIELDS.has(key) && !(trusted && ['external', 'externalTasks'].includes(key))) ||
    key.startsWith('statusChanged'))
  if (field) {
    throw err.bad(
      'REQUIREMENT_MANAGED_FIELD',
      `字段「${field}」由 Flowlark 管理，不能由普通创建或编辑请求设置`
    )
  }
}

function writeRequirementFileAtomic(root, item) {
  const file = store.paths.requirementFile(root, item.code)
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(item, 'requirement'))
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
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

function nullablePositiveId(value, label) {
  if (value == null || value === '') return null
  return positiveId(value, label)
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
