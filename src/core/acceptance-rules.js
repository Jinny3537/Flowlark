import { err } from './errors.js'

const VERDICTS = new Set(['pending', 'approved', 'rejected', 'conditional', 'waived'])

function object(value) {
  return value !== null && typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

function onlyFields(value, fields) {
  return object(value) && Reflect.ownKeys(value).every((key) => fields.includes(key))
}

export function normalizeAcceptanceRules(input) {
  if (input === undefined) {
    return {
      roles: [
        { id: 'product', name: '产品', required: true },
        { id: 'development', name: '研发', required: true },
        { id: 'qa', name: '测试', required: true }
      ],
      rule: { type: 'all-required' }
    }
  }
  if (!onlyFields(input, ['roles', 'rule']) || !Array.isArray(input.roles) ||
      input.roles.length < 1 || input.roles.length > 20) {
    throw err.bad('ACCEPTANCE_RULES_INVALID', '验收规则必须包含 1 至 20 个角色及通过规则')
  }
  if (!onlyFields(input.rule, ['type']) || input.rule.type !== 'all-required') {
    throw err.bad('ACCEPTANCE_RULE_INVALID', '验收通过规则只支持 all-required')
  }
  const ids = new Set()
  const roles = input.roles.map((role) => {
    if (!onlyFields(role, ['id', 'name', 'required']) ||
        typeof role.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(role.id) ||
        typeof role.name !== 'string' || !role.name.trim() || role.name.trim().length > 80 ||
        typeof role.required !== 'boolean') {
      throw err.bad('ACCEPTANCE_ROLE_INVALID', '验收角色的标识、名称或必选设置不合法')
    }
    if (ids.has(role.id)) throw err.bad('ACCEPTANCE_ROLE_DUPLICATE', `验收角色 ${role.id} 重复`)
    ids.add(role.id)
    return { id: role.id, name: role.name.trim(), required: role.required }
  })
  if (!roles.some((role) => role.required)) {
    throw err.bad('ACCEPTANCE_REQUIRED_ROLE_MISSING', '至少需要一个必选验收角色')
  }
  return { roles, rule: { type: 'all-required' } }
}

function recordTime(record, roleIds) {
  if (!object(record) || typeof record.id !== 'string' || !record.id.trim()) {
    throw err.bad('ACCEPTANCE_RECORD_INVALID', '验收记录必须包含有效标识')
  }
  if (!roleIds.has(record.role)) throw err.bad('ACCEPTANCE_ROLE_UNKNOWN', '验收记录引用了未知角色')
  if (!VERDICTS.has(record.verdict)) throw err.bad('ACCEPTANCE_VERDICT_INVALID', '验收结论不合法')
  const at = record.at
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
  const time = typeof at === 'string' && iso.test(at) ? Date.parse(at) : NaN
  const day = typeof at === 'string' ? Date.parse(`${at.slice(0, 10)}T00:00:00Z`) : NaN
  if (!Number.isFinite(time) || !Number.isFinite(day) ||
      new Date(day).toISOString().slice(0, 10) !== at.slice(0, 10)) {
    throw err.bad('ACCEPTANCE_TIME_INVALID', '验收时间必须是有效的 ISO 时间')
  }
  if (record.verdict === 'waived' && (typeof record.note !== 'string' || !record.note.trim())) {
    throw err.bad('ACCEPTANCE_WAIVER_REASON_REQUIRED', '豁免验收必须填写原因')
  }
  if (record.verdict === 'conditional' && (!Array.isArray(record.conditions) ||
      !record.conditions.length || record.conditions.some((condition) => !object(condition)))) {
    throw err.bad('ACCEPTANCE_CONDITIONS_INVALID', '有条件通过必须包含有效条件项')
  }
  return time
}

function roleStatus(record) {
  if (!record || record.verdict === 'pending') return 'pending'
  if (record.verdict === 'conditional') {
    return record.conditions.every((condition) => condition.closed === true) ? 'approved' : 'pending'
  }
  return record.verdict === 'waived' ? 'approved' : record.verdict
}

export function aggregateAcceptance(rules, records, { blockingFeedback = 0 } = {}) {
  const normalized = normalizeAcceptanceRules(rules)
  if (!Array.isArray(records)) throw err.bad('ACCEPTANCE_RECORDS_INVALID', '验收记录必须是数组')
  if (!Number.isSafeInteger(blockingFeedback) || blockingFeedback < 0) {
    throw err.bad('ACCEPTANCE_FEEDBACK_INVALID', '阻断反馈数量必须是非负整数')
  }
  const roleIds = new Set(normalized.roles.map((role) => role.id))
  const latestByRole = new Map()
  for (const record of records) {
    const time = recordTime(record, roleIds)
    const previous = latestByRole.get(record.role)
    if (!previous || time > previous.time || (time === previous.time && record.id > previous.record.id)) {
      latestByRole.set(record.role, { record, time })
    }
  }
  const roles = normalized.roles.map((role) => {
    const latest = latestByRole.get(role.id)?.record || null
    return { ...role, latest: latest ? structuredClone(latest) : null, status: roleStatus(latest) }
  })
  const blockers = roles.filter((role) => role.required && role.status !== 'approved').map((role) => ({
    code: role.status === 'rejected' ? 'ACCEPTANCE_ROLE_REJECTED' : 'ACCEPTANCE_ROLE_PENDING',
    role: role.id,
    message: role.status === 'rejected' ? `${role.name}已拒绝验收` : `${role.name}尚未通过验收`
  }))
  if (blockingFeedback > 0) {
    blockers.push({ code: 'ACCEPTANCE_BLOCKING_FEEDBACK', count: blockingFeedback, message: `仍有 ${blockingFeedback} 条阻断反馈` })
  }
  const status = roles.some((role) => role.required && role.status === 'rejected')
    ? 'rejected' : blockers.length ? 'pending' : 'approved'
  return { status, ready: status === 'approved', roles, blockers }
}
