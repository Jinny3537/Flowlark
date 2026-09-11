import * as store from './store.js'
import { readRequirement } from './requirements.js'
import { readFeedbackDraft } from './feedback.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { err } from './errors.js'
import { INTERNAL_DIR } from './repo.js'

export const TEAM_ROLES = ['guest', 'developer', 'tester']
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')
const statePath = (root) => path.join(root, INTERNAL_DIR, 'cache', 'team.json')

function read(root) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(root), 'utf8'))
    if (typeof state?.enabled !== 'boolean' || !Array.isArray(state.visitors) || state.visitors.some((item) =>
      !item || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.tokenHash || '') || (item.role !== null && !TEAM_ROLES.includes(item.role)))) {
      throw err.bad('TEAM_STORAGE_INVALID', '团队角色存储损坏，请在主机恢复本机配置')
    }
    return state
  }
  catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, visitors: [] }
    throw error // Corrupt role storage must never silently reset role assignments.
  }
}

function write(root, value) {
  const file = statePath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, file)
  } finally { fs.rmSync(tmp, { force: true }) }
}

export function teamEnabled(root) { return read(root).enabled === true }
export function setTeamEnabled(root, enabled) {
  if (typeof enabled !== 'boolean') throw err.bad('TEAM_CONFIG_INVALID', '团队模式必须为布尔值')
  const state = read(root)
  state.enabled = enabled
  write(root, state)
}

export function visitor(root, token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null
  return read(root).visitors.find((item) => item.tokenHash === digest(token)) || null
}

export function createVisitor(root, ip) {
  const token = crypto.randomBytes(32).toString('hex')
  const state = read(root)
  const item = { id: crypto.randomUUID(), tokenHash: digest(token), role: null, ip: String(ip || ''), createdAt: new Date().toISOString() }
  state.visitors.push(item)
  write(root, state)
  return { token, item }
}

export function assignRole(root, id, role, { first = false } = {}) {
  if (!TEAM_ROLES.includes(role)) throw err.bad('TEAM_ROLE_INVALID', '远程角色只支持游客、研发、测试')
  const state = read(root)
  const item = state.visitors.find((entry) => entry.id === id)
  if (!item) throw err.notFound('访客')
  if (first && item.role) throw err.conflict('TEAM_ROLE_LOCKED', '角色已确定，请联系主机调整')
  item.role = role
  item.updatedAt = new Date().toISOString()
  write(root, state)
  return item
}

export function listVisitors(root) {
  return read(root).visitors.map(({ tokenHash, ...item }) => item)
}

export function recordKinds(role) {
  if (role === 'product') return ['comment']
  if (role === 'developer') return ['comment', 'progress']
  if (role === 'tester') return ['comment', 'issue', 'acceptance']
  return role === 'guest' ? ['comment'] : []
}

export function listAllRecords(root) {
  const dir = path.join(root, INTERNAL_DIR, 'collaboration')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => /^[a-f0-9-]+\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

export function listRecords(root, project, versionNo) {
  return listAllRecords(root).filter(item => item.project === project && item.versionNo === versionNo)
}

export function addRecord(root, actor, project, versionNo, body) {
  if (!recordKinds(actor.role).includes(body.kind)) throw err.forbidden('TEAM_ACTION_FORBIDDEN', '当前角色不能提交此类记录')
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 10000) {
    throw err.bad('TEAM_CONTENT_INVALID', '请填写 1–10000 字的记录')
  }
  const requirement = String(body.requirement || '').trim()
  const version = requirement ? store.readVersion(root, project, versionNo) : { requirements: [] }
  const codes = (version.requirements || []).map(item => typeof item === 'string' ? item : item.code)
  if (requirement) {
    const req = readRequirement(root, requirement)
    if (req.deletedAt) throw err.conflict('REQUIREMENT_DELETED', '请先恢复需求')
    if (!codes.includes(requirement)) throw err.bad('TEAM_REQUIREMENT_UNLINKED', '此版本未关联该需求')
  }
  const outcome = String(body.outcome || '')
  const allowed = body.kind === 'progress' ? ['in_progress', 'completed', 'acknowledged']
    : body.kind === 'acceptance' ? ['passed', 'failed']
      : actor.role === 'product' ? ['open', 'resolved', 'reopened']
        : ['developer', 'tester'].includes(actor.role) ? ['open', 'confirmed', 'reopened'] : ['open']
  if (outcome && !allowed.includes(outcome)) throw err.forbidden('TEAM_OUTCOME_FORBIDDEN', '当前角色或记录类型不能提交该结果')
  const replyTo = String(body.replyTo || '')
  const all = listAllRecords(root)
  const parent = replyTo ? all.find(item => item.id === replyTo) : null
  if (replyTo && (!parent || parent.replyTo || parent.project !== project || parent.requirement !== requirement)) throw err.bad('TEAM_REPLY_INVALID', '回复必须关联同项目、同需求的原始问题')
  if (['resolved', 'confirmed', 'reopened'].includes(outcome) && !parent) throw err.bad('TEAM_REPLY_REQUIRED', '请先选择要处理的问题')
  const resolutionVersion = String(body.resolutionVersion || '')
  if (outcome === 'resolved' && !resolutionVersion) throw err.bad('TEAM_RESOLUTION_REQUIRED', '请指定外部修改后归档的处理版本')
  if (resolutionVersion) {
    const target = store.readVersion(root, project, resolutionVersion)
    if (target.status === 'VOID' || !(target.requirements || []).some(item => (typeof item === 'string' ? item : item.code) === requirement)) throw err.bad('TEAM_RESOLUTION_INVALID', '处理版本必须有效并关联该需求')
  }
  const lastDecision = all.filter(item => item.replyTo === replyTo && ['resolved', 'confirmed', 'reopened'].includes(item.outcome)).at(-1)
  if (outcome === 'confirmed' && lastDecision?.outcome !== 'resolved') throw err.conflict('TEAM_RESOLUTION_MISSING', '请等待产品重新记录处理版本后确认')
  if (outcome === 'confirmed' && versionNo !== lastDecision.resolutionVersion) throw err.conflict('TEAM_CONFIRM_VERSION', '请切换到产品指定的处理版本后确认')
  const draft = body.feedbackId ? readFeedbackDraft(root, body.feedbackId) : null
  if (draft && (draft.project !== project || draft.version !== versionNo || !draft.requirements.includes(requirement))) throw err.bad('TEAM_FEEDBACK_MISMATCH', '标注反馈不属于此需求和版本')
  if (draft && all.some(item => item.sourceFeedback?.id === draft.id)) throw err.conflict('TEAM_FEEDBACK_EXISTS', '此标注已转为协作问题')
  const record = {
    requirement, replyTo: replyTo || null, outcome: outcome || null, resolutionVersion: resolutionVersion || null,
    ...(draft ? { sourceFeedback: { id: draft.id, title: draft.title, description: draft.description, anchor: draft.anchor } } : {}),
    id: crypto.randomUUID(), project, versionNo, kind: body.kind,
    content: body.content.trim(), role: actor.role, visitorId: actor.id,
    createdAt: new Date().toISOString()
  }
  // One immutable file per submission: independent additions merge through Git.
  // Browser credentials and IP addresses stay in the ignored local cache.
  const dir = path.join(root, INTERNAL_DIR, 'collaboration')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return record
}
