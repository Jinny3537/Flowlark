import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import { INTERNAL_DIR } from './repo.js'

const TEMPLATE_VARIABLES = new Set([
  'project',
  'projectCode',
  'version',
  'title',
  'previousBaseline',
  'releasedAt',
  'releasedBy',
  'changes',
  'requirements'
])

const MAX_RECIPIENTS = 100
const MAX_SUBJECT_TEMPLATE = 500
const MAX_BODY_TEMPLATE = 50000

function uniqueText(values, limit = MAX_RECIPIENTS) {
  const out = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value || '').trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

export function normalizeReleaseMail(input = {}) {
  return {
    enabled: input.enabled === true,
    to: uniqueText(input.to),
    cc: uniqueText(input.cc),
    subjectTemplate: String(input.subjectTemplate || '').slice(0, MAX_SUBJECT_TEMPLATE),
    bodyTemplate: String(input.bodyTemplate || '').slice(0, MAX_BODY_TEMPLATE)
  }
}

export function assertReleaseMailConfig(input = {}) {
  const config = normalizeReleaseMail(input)
  if (!config.enabled) throw err.bad('RELEASE_MAIL_DISABLED', '当前项目尚未启用发版邮件')
  if (!config.to.length) throw err.bad('RELEASE_MAIL_TO_REQUIRED', '请至少配置一位发版邮件收件人')
  if (!config.subjectTemplate.trim()) throw err.bad('RELEASE_MAIL_SUBJECT_REQUIRED', '请配置发版邮件主题模板')
  if (!config.bodyTemplate.trim()) throw err.bad('RELEASE_MAIL_BODY_REQUIRED', '请配置发版邮件正文模板')
  return config
}

function interpolate(template, context) {
  const result = String(template || '').replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (raw, key) => {
    if (!TEMPLATE_VARIABLES.has(key)) {
      throw err.bad('RELEASE_MAIL_VARIABLE_INVALID', `发版邮件模板包含未知变量：${key}`)
    }
    return String(context[key] ?? '')
  })
  if (/\{\{|\}\}/.test(result)) {
    throw err.bad('RELEASE_MAIL_TEMPLATE_INVALID', '发版邮件模板包含未闭合的变量')
  }
  return result
}

export function renderReleaseMail(input, context = {}) {
  const config = normalizeReleaseMail(input)
  const subject = interpolate(config.subjectTemplate, context).trim()
  const markdown = interpolate(config.bodyTemplate, context).trim()
  if (!subject) throw err.bad('RELEASE_MAIL_SUBJECT_EMPTY', '发版邮件主题渲染后为空')
  if (!markdown) throw err.bad('RELEASE_MAIL_BODY_EMPTY', '发版邮件正文渲染后为空')
  return { subject, markdown }
}

function changeType(value) {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'ADD' || key === '新增') return '新增'
  if (key === 'REMOVE' || key === '删除') return '删除'
  return '修改'
}

export function releaseTemplateContext({ project, version, previousBaseline = '', releasedAt, releasedBy }) {
  const changes = Array.isArray(version.changes) && version.changes.length
    ? version.changes.map((item) => {
      const location = String(item.location || '').trim() || '未标注位置'
      const content = String(item.content || item.description || '').trim() || '未填写说明'
      return `- ${changeType(item.type)} · ${location}：${content}`
    }).join('\n')
    : '- 未记录变更'
  const requirements = Array.isArray(version.requirements) && version.requirements.length
    ? version.requirements.map((item) => {
      const code = typeof item === 'string' ? item : item.code
      const title = typeof item === 'string' ? '' : item.title
      return `- ${String(code || '未编号').trim()}${title ? `：${String(title).trim()}` : ''}`
    }).join('\n')
    : '- 未关联需求'
  return {
    project: String(project.name || project.slug || ''),
    projectCode: String(project.code || project.slug || ''),
    version: String(version.versionNo || ''),
    title: String(version.title || ''),
    previousBaseline: String(previousBaseline || ''),
    releasedAt: String(releasedAt || ''),
    releasedBy: String(releasedBy || ''),
    changes,
    requirements
  }
}

function queueFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'release-mails.json')
}

function readQueue(root) {
  const file = queueFile(root)
  if (!fs.existsSync(file)) return { schemaVersion: 1, items: [] }
  const value = parse(fs.readFileSync(file, 'utf8'), '发版邮件任务')
  return {
    schemaVersion: Number(value.schemaVersion || 1),
    items: Array.isArray(value.items) ? value.items : []
  }
}

function writeQueue(root, value) {
  const file = queueFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, stringify(value), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

function recipient(input = {}) {
  const out = {
    key: String(input.key || '').trim(),
    query: String(input.query || input.name || '').trim(),
    name: String(input.name || input.query || '').trim(),
    alias: String(input.alias || '').trim(),
    departments: uniqueText(input.departments, 20),
    position: String(input.position || '').trim()
  }
  const email = String(input.email || '').trim()
  const userid = String(input.userid || '').trim()
  if (email) out.email = email
  if (userid) out.userid = userid
  return out
}

function recipients(values) {
  return (Array.isArray(values) ? values : []).map(recipient).filter((item) => item.name)
}

function publicRecipient(input = {}) {
  return {
    key: String(input.key || ''),
    query: String(input.query || ''),
    name: String(input.name || ''),
    alias: String(input.alias || ''),
    departments: Array.isArray(input.departments) ? input.departments : [],
    position: String(input.position || '')
  }
}

function taskId(project, version, baselineAt) {
  return crypto.createHash('sha256')
    .update(`release-mail:${project}:${version}:${baselineAt}`)
    .digest('hex')
    .slice(0, 24)
}

export function releaseMailIdempotencyKey({ project, version, baselineAt }) {
  return `release-mail:${project}:${version}:${baselineAt}`
}

export function enqueueReleaseMail(root, input) {
  const project = String(input.project || '').trim()
  const version = String(input.version || '').trim()
  const baselineAt = String(input.baselineAt || '').trim()
  if (!project || !version || !baselineAt) {
    throw err.bad('RELEASE_MAIL_TASK_INVALID', '发版邮件任务缺少项目、版本或基线时间')
  }
  const data = readQueue(root)
  const id = taskId(project, version, baselineAt)
  const existing = data.items.find((item) => item.id === id)
  if (existing) return existing
  const now = new Date().toISOString()
  const item = {
    id,
    idempotencyKey: releaseMailIdempotencyKey({ project, version, baselineAt }),
    project,
    version,
    baselineAt,
    subject: String(input.subject || ''),
    markdown: String(input.markdown || ''),
    to: recipients(input.to),
    cc: recipients(input.cc),
    status: 'pending',
    attempts: 0,
    lastError: null,
    lastInstruction: null,
    createdAt: now,
    updatedAt: now,
    sentAt: null
  }
  data.items.push(item)
  writeQueue(root, data)
  return item
}

export function readReleaseMail(root, id) {
  const item = readQueue(root).items.find((row) => row.id === String(id || ''))
  if (!item) throw err.notFound('发版邮件任务')
  return item
}

export function listReleaseMails(root) {
  return readQueue(root).items.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

function updateTask(root, id, mutate) {
  const data = readQueue(root)
  const item = data.items.find((row) => row.id === String(id || ''))
  if (!item) throw err.notFound('发版邮件任务')
  mutate(item)
  item.updatedAt = new Date().toISOString()
  writeQueue(root, data)
  return item
}

export function markReleaseMailSent(root, id) {
  return updateTask(root, id, (item) => {
    item.status = 'sent'
    item.attempts = Number(item.attempts || 0) + 1
    item.lastError = null
    item.lastInstruction = null
    item.sentAt = new Date().toISOString()
  })
}

export function markReleaseMailFailed(root, id, error) {
  return updateTask(root, id, (item) => {
    item.status = 'pending'
    item.attempts = Number(item.attempts || 0) + 1
    item.lastError = String(error?.message || error || '企业微信邮件发送失败')
    item.lastInstruction = error?.hint ? String(error.hint) : null
  })
}

export function publicReleaseMail(item) {
  return {
    id: String(item.id || ''),
    project: String(item.project || ''),
    version: String(item.version || ''),
    baselineAt: String(item.baselineAt || ''),
    subject: String(item.subject || ''),
    markdown: String(item.markdown || ''),
    to: recipients(item.to).map(publicRecipient),
    cc: recipients(item.cc).map(publicRecipient),
    status: item.status === 'sent' ? 'sent' : 'pending',
    attempts: Number(item.attempts || 0),
    lastError: item.lastError ? String(item.lastError) : null,
    lastInstruction: item.lastInstruction ? String(item.lastInstruction) : null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    sentAt: item.sentAt || null
  }
}

