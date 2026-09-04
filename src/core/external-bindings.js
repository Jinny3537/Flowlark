import crypto from 'node:crypto'
import { PhError, err } from './errors.js'
import * as requirements from './requirements.js'
import * as milestones from './milestones.js'

const PLAN_TTL_MS = 10 * 60 * 1000

export function normalizeTaskBindingInput(input = {}) {
  const value = objectInput(input)
  return {
    project: requiredText(value.project, 'EXTERNAL_BINDING_PROJECT_REQUIRED', '请选择绑定所属项目'),
    remoteId: positiveId(value.remoteId, 'EXTERNAL_TASK_ID_INVALID', '平台任务 ID'),
    expectedTaskId: nullableId(value.expectedTaskId, 'EXTERNAL_TASK_ID_INVALID', '预期平台任务 ID'),
    reason: requiredText(value.reason, 'MCP_SYNC_REASON_REQUIRED', '绑定或改绑必须填写原因'),
    confirmed: value.confirmed === true
  }
}

export function normalizeSprintBindingInput(input = {}) {
  const value = objectInput(input)
  return {
    project: requiredText(value.project, 'EXTERNAL_BINDING_PROJECT_REQUIRED', '请选择绑定所属项目'),
    remoteId: positiveId(value.remoteId, 'EXTERNAL_SPRINT_ID_INVALID', '平台 Sprint ID'),
    expectedSprintId: nullableId(value.expectedSprintId, 'EXTERNAL_SPRINT_ID_INVALID', '预期平台 Sprint ID'),
    reason: requiredText(value.reason, 'MCP_SYNC_REASON_REQUIRED', '绑定或改绑必须填写原因'),
    confirmed: value.confirmed === true
  }
}

export function buildTaskBindingPlan(root, {
  code,
  project,
  server,
  projectId,
  remote,
  expectedTaskId,
  reason,
  now = new Date()
} = {}) {
  const targetProjectId = positiveId(projectId, 'EXTERNAL_TASK_PROJECT_INVALID', '平台项目 ID')
  const { item, current, expected } = assertTaskBindingCas(root, code, {
    server, projectId: targetProjectId, expectedTaskId
  })
  const task = verifiedRemote(remote, 'task', targetProjectId)
  const after = {
    provider: 'assess-task',
    server: String(server),
    projectId: targetProjectId,
    taskId: task.id,
    revision: finiteOrNull(task.revision),
    remoteStatus: task.status ?? null,
    url: String(task.url || ''),
    lastSyncHash: '',
    syncedAt: null
  }
  requirements.assertExternalTaskAvailable(root, item.code, after)
  return bindingPlan({
    entityType: 'requirement',
    entityKey: item.code,
    route: `/requirements/${encodeURIComponent(item.code)}`,
    project,
    server,
    projectId: targetProjectId,
    remote: task,
    expectedId: expected,
    expectedField: 'expectedTaskId',
    remoteId: task.id,
    operation: {
      key: `task.binding.replace:${item.code}`,
      kind: 'task.binding.replace',
      risk: 'high',
      before: current,
      after
    },
    reason,
    now
  })
}

export function buildSprintBindingPlan(root, {
  milestoneName,
  project,
  server,
  projectId,
  remote,
  expectedSprintId,
  reason,
  now = new Date()
} = {}) {
  const targetProjectId = positiveId(projectId, 'EXTERNAL_SPRINT_PROJECT_INVALID', '平台项目 ID')
  const { item, expected } = assertSprintBindingCas(root, milestoneName, { expectedSprintId })
  const sprint = verifiedRemote(remote, 'sprint', targetProjectId)
  const after = {
    provider: 'assess-task',
    server: String(server),
    projectId: targetProjectId,
    sprintId: sprint.id,
    revision: finiteOrNull(sprint.revision),
    remoteStatus: sprint.status ?? null,
    url: String(sprint.url || ''),
    lastSyncHash: '',
    syncedAt: null
  }
  milestones.assertExternalSprintAvailable(root, item.name, after)
  return bindingPlan({
    entityType: 'milestone-binding',
    entityKey: item.name,
    route: `/milestones/${encodeURIComponent(item.name)}`,
    project,
    server,
    projectId: targetProjectId,
    remote: sprint,
    expectedId: expected,
    expectedField: 'expectedSprintId',
    remoteId: sprint.id,
    operation: {
      key: `sprint.binding.replace:${item.name}`,
      kind: 'sprint.binding.replace',
      risk: 'high',
      before: item.external,
      after
    },
    reason,
    now
  })
}

export function assertTaskBindingCas(root, code, { server, projectId, expectedTaskId } = {}) {
  const item = requirements.readRequirement(root, code)
  const targetProjectId = positiveId(projectId, 'EXTERNAL_TASK_PROJECT_INVALID', '平台项目 ID')
  const current = item.externalTasks.find((binding) =>
    binding.provider === 'assess-task' && binding.server === server && binding.projectId === targetProjectId) || null
  const expected = nullableId(expectedTaskId, 'EXTERNAL_TASK_ID_INVALID', '预期平台任务 ID')
  if ((current?.taskId || null) !== expected) {
    throw err.conflict(
      'EXTERNAL_TASK_CAS_MISMATCH',
      `需求 ${item.code} 的平台任务绑定已变化，当前为 ${current?.taskId ?? '未绑定'}`
    )
  }
  return { item, current, expected }
}

export function assertSprintBindingCas(root, milestoneName, { expectedSprintId } = {}) {
  const item = milestones.readMilestone(root, milestoneName)
  const expected = nullableId(expectedSprintId, 'EXTERNAL_SPRINT_ID_INVALID', '预期平台 Sprint ID')
  const currentSprintId = nullableId(item.external?.sprintId, 'EXTERNAL_SPRINT_ID_INVALID', '当前平台 Sprint ID')
  if (currentSprintId !== expected) {
    throw err.conflict(
      'EXTERNAL_SPRINT_CAS_MISMATCH',
      `迭代 ${item.name} 的平台 Sprint 绑定已变化，当前为 ${currentSprintId ?? '未绑定'}`
    )
  }
  return { item, expected }
}

export function executeBindingPlan(root, plan) {
  const operation = Array.isArray(plan?.operations) && plan.operations.length === 1
    ? plan.operations[0]
    : null
  if (plan?.entityType === 'requirement' && operation?.kind === 'task.binding.replace') {
    return requirements.replaceExternalTask(root, plan.entityKey, operation.after, {
      expectedTaskId: plan.intent.expectedTaskId
    })
  }
  if (plan?.entityType === 'milestone-binding' && operation?.kind === 'sprint.binding.replace') {
    return milestones.replaceExternalSprint(root, plan.entityKey, operation.after, {
      expectedSprintId: plan.intent.expectedSprintId
    })
  }
  throw err.bad('SYNC_ENTITY_UNSUPPORTED', `不支持的绑定同步对象类型：${plan?.entityType || 'unknown'}`)
}

export function isBindingPlan(plan, entityType, entityKey) {
  if (plan?.entityType !== entityType || plan?.entityKey !== entityKey) return false
  if (!Array.isArray(plan.operations) || plan.operations.length !== 1) return false
  const kind = plan.operations[0]?.kind
  return (entityType === 'requirement' && kind === 'task.binding.replace') ||
    (entityType === 'milestone-binding' && kind === 'sprint.binding.replace')
}

function bindingPlan({
  entityType,
  entityKey,
  route,
  project,
  server,
  projectId,
  remote,
  expectedId,
  expectedField,
  remoteId,
  operation,
  reason,
  now
}) {
  const generatedAt = new Date(now).toISOString()
  const intent = {
    project: String(project),
    remoteId,
    [expectedField]: expectedId,
    reason: String(reason)
  }
  const semantic = {
    entityType,
    entityKey,
    server: String(server),
    projectId,
    intent,
    remote: remoteObservation(remote),
    operation
  }
  return {
    entityType,
    entityKey,
    route,
    project: String(project),
    server: String(server),
    projectId,
    intent,
    generatedAt,
    expiresAt: new Date(new Date(now).getTime() + PLAN_TTL_MS).toISOString(),
    hash: `sha256:${digest(stableStringify(semantic))}`,
    summary: { total: 1, highRisk: 1 },
    blockers: [],
    warnings: [],
    operations: [operation]
  }
}

function verifiedRemote(remote, kind, projectId) {
  const label = kind === 'task' ? '任务' : 'Sprint'
  const code = kind === 'task' ? 'EXTERNAL_TASK' : 'EXTERNAL_SPRINT'
  if (!remote) throw new PhError(`${code}_NOT_FOUND`, `平台${label}不存在`, { status: 404 })
  const id = positiveId(remote.id ?? remote[`${kind}Id`], `${code}_ID_INVALID`, `平台${label} ID`)
  if (Number(remote.projectId) !== projectId) {
    throw err.conflict(`${code}_PROJECT_MISMATCH`, `平台${label} ${id} 不属于项目 ${projectId}`)
  }
  return { ...remote, id, projectId }
}

function remoteObservation(remote) {
  return {
    id: remote.id,
    projectId: Number(remote.projectId),
    revision: finiteOrNull(remote.revision),
    status: remote.status ?? null
  }
}

function objectInput(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
}

function requiredText(value, code, message) {
  const text = String(value || '').trim()
  if (!text) throw err.bad(code, message)
  return text
}

function positiveId(value, code, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw err.bad(code, `${label} 必须是正整数`)
  return number
}

function nullableId(value, code, label) {
  if (value == null || value === '') return null
  return positiveId(value, code, label)
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
