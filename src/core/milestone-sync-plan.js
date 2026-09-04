import crypto from 'node:crypto'

const PLAN_TTL_MS = 15 * 60 * 1000
const PROVIDER = 'assess-task'
const LEGACY_MANAGED_FIELDS = Object.freeze([
  'title', 'description', 'acceptance', 'priority', 'assignee', 'sprint'
])
const SUPPORTED_MANAGED_FIELDS = new Set([
  ...LEGACY_MANAGED_FIELDS, 'status', 'delivery'
])

export function buildMilestoneSyncPlan({
  milestone,
  requirements = [],
  remoteSprint = null,
  remoteTasks = [],
  managedTaskBindings = [],
  mapping = {},
  managedFields,
  action = null,
  scopeItems = null,
  scopeChangeReason = '',
  resolutions = {},
  now = new Date()
} = {}) {
  const normalizedAction = ['start', 'end', 'cancel'].includes(String(action || '')) ? String(action) : null
  const normalizedResolutions = normalizeResolutions(resolutions)
  const normalizedManagedFields = normalizeManagedFields(managedFields ?? mapping.managedFields)
  const managed = new Set(normalizedManagedFields)
  const blockers = []
  const warnings = []
  const operations = []
  const summary = {
    createSprint: 0,
    updateSprint: 0,
    createTask: 0,
    updateTask: 0,
    moveTask: 0,
    conflict: 0,
    unchanged: 0
  }
  const projectId = positiveId(mapping.projectId)
  const ownerId = positiveId(mapping.ownerId)
  const taskType = positiveId(mapping.taskType)
  if (!projectId) blockers.push(problem('ASSESS_PROJECT_REQUIRED', '尚未选择平台项目', 'mapping.projectId'))
  if (managed.has('delivery')) {
    warnings.push(problem('DELIVERY_SYNC_UNSUPPORTED', 'v0.7.3 暂不回写交付日期', 'mapping.managedFields'))
  }

  const sprintBinding = milestone.external && Number(milestone.external.projectId) === projectId
    ? milestone.external
    : null
  const sprintOwnerId = assigneeIdFor(milestone.owner, mapping) || ownerId
  const sprintAfter = sprintProjection(milestone, { projectId, ownerId: sprintOwnerId, timezoneOffset: mapping.timezoneOffset })
  validateSprintProjection(sprintAfter, blockers, { create: !sprintBinding?.sprintId, managed })
  const sprintHash = hashProjection(sprintAfter, 'sprint', normalizedManagedFields)

  if (!sprintBinding?.sprintId) {
    addOperation(operations, summary, {
      key: `sprint:${milestone.name}:create`,
      kind: 'sprint.create',
      risk: 'normal',
      before: null,
      after: sprintAfter,
      contentHash: sprintHash,
      dependsOn: []
    })
  } else if (!remoteSprint) {
    blockers.push(problem('REMOTE_SPRINT_MISSING', `平台冲刺 ${sprintBinding.sprintId} 不存在或不可访问`, 'milestone.external'))
  } else {
    planOwnedChange({
      entity: 'sprint',
      key: `sprint:${sprintBinding.sprintId}`,
      local: sprintAfter,
      remote: remoteSprint,
      lastSyncHash: sprintBinding.lastSyncHash,
      resolution: normalizedResolutions[`sprint:${sprintBinding.sprintId}`],
      managedFields: normalizedManagedFields,
      operations,
      blockers,
      summary
    })
  }

  const requirementsByCode = new Map(requirements.map((item) => [String(item.code), item]))
  const requirementCodes = [...new Set((milestone.items || []).map((item) => String(item.requirement || '')).filter(Boolean))].sort()
  const remoteTasksById = new Map(remoteTasks.map((item) => [Number(item.id), item]))
  const currentTaskIds = new Set()
  const targetSprintId = positiveId(sprintBinding?.sprintId || remoteSprint?.id)

  for (const code of requirementCodes) {
    const requirement = requirementsByCode.get(code)
    if (!requirement) {
      blockers.push(problem('MILESTONE_REQUIREMENT_MISSING', `需求 ${code} 不存在`, `requirement:${code}`))
      continue
    }
    const binding = (requirement.externalTasks || []).find((item) =>
      item.provider === PROVIDER && item.server === mapping.server && Number(item.projectId) === projectId)
    if (!binding && !taskType) blockers.push(problem('TASK_TYPE_REQUIRED', '尚未配置默认任务类型', 'mapping.taskType'))
    const taskAfter = taskProjection(requirement, milestone, {
      projectId,
      taskType,
      priority: priorityFor(requirement, mapping, blockers, !binding || managed.has('priority')),
      assigneeId: assigneeFor(requirement, mapping, warnings, !binding || managed.has('assignee')),
      status: statusFor(requirement, mapping, blockers, managed.has('status')),
      timezoneOffset: mapping.timezoneOffset
    })
    validateTaskProjection(taskAfter, requirement, blockers, { create: !binding, managed })
    const taskHash = hashProjection(taskAfter, 'task', normalizedManagedFields)

    if (!binding) {
      addOperation(operations, summary, {
        key: `task:${code}:create`,
        kind: 'task.create',
        risk: 'normal',
        requirement: code,
        before: null,
        after: { ...taskAfter, currentSprintId: targetSprintId || '$sprint' },
        contentHash: taskHash,
        dependsOn: operations.some((item) => item.kind === 'sprint.create') ? [`sprint:${milestone.name}:create`] : []
      })
      continue
    }

    const remoteTask = remoteTasksById.get(Number(binding.taskId))
    if (!remoteTask) {
      blockers.push(problem('REMOTE_TASK_MISSING', `平台任务 ${binding.taskId} 不存在或不可访问`, `requirement:${code}`))
      continue
    }
    currentTaskIds.add(Number(binding.taskId))
    planOwnedChange({
      entity: 'task',
      key: `task:${binding.taskId}`,
      requirement: code,
      local: taskAfter,
      remote: remoteTask,
      lastSyncHash: binding.lastSyncHash,
      resolution: normalizedResolutions[`task:${binding.taskId}`],
      managedFields: normalizedManagedFields,
      operations,
      blockers,
      summary
    })
    if (managed.has('sprint') && targetSprintId && Number(remoteTask.sprintId) !== targetSprintId) {
      addOperation(operations, summary, {
        key: `task:${binding.taskId}:move`,
        kind: 'task.move',
        risk: 'normal',
        requirement: code,
        taskId: Number(binding.taskId),
        taskRevision: remoteTask.revision,
        before: { sprintId: remoteTask.sprintId ?? null },
        after: { sprintId: targetSprintId },
        dependsOn: []
      })
    }
  }

  for (const binding of managed.has('sprint') ? managedTaskBindings : []) {
    const taskId = Number(binding.taskId)
    const remoteTask = remoteTasksById.get(taskId)
    if (!remoteTask || currentTaskIds.has(taskId) || Number(remoteTask.sprintId) !== targetSprintId) continue
    addOperation(operations, summary, {
      key: `task:${taskId}:move-out`,
      kind: 'task.move',
      risk: 'high',
      requirement: binding.requirement,
      taskId,
      taskRevision: remoteTask.revision,
      before: { sprintId: targetSprintId },
      after: { sprintId: null },
      dependsOn: []
    })
  }

  if (Array.isArray(scopeItems)) {
    operations.push({
      key: `local:${milestone.name}:scope-change`,
      kind: 'local.scope-change',
      risk: 'high',
      before: null,
      after: scopeItems,
      reason: String(scopeChangeReason || ''),
      dependsOn: operations.filter((item) => item.kind !== 'conflict').map((item) => item.key)
    })
  }

  const lifecycleKind = { start: 'sprint.start', end: 'sprint.end', cancel: 'sprint.cancel' }[normalizedAction]
  if (lifecycleKind) {
    operations.push({
      key: `${lifecycleKind}:${milestone.name}`,
      kind: lifecycleKind,
      risk: 'high',
      sprintId: targetSprintId || '$sprint',
      before: remoteSprint
        ? { status: remoteSprint.status ?? null, revision: remoteSprint.revision ?? null }
        : null,
      dependsOn: operations.filter((item) => item.kind !== 'conflict').map((item) => item.key)
    })
  }

  const generatedAt = new Date(now).toISOString()
  const expiresAt = new Date(new Date(now).getTime() + PLAN_TTL_MS).toISOString()
  const semantic = {
    milestone: milestone.name,
    server: String(mapping.server || ''),
    projectId,
    managedFields: normalizedManagedFields,
    requirementStatuses: requirementCodes.map((code) => ({
      code,
      status: String(requirementsByCode.get(code)?.status || 'draft')
    })),
    remoteObservations: {
      sprint: remoteObservation(remoteSprint),
      tasks: remoteTasks.map(remoteObservation).sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
    },
    action: normalizedAction,
    scopeItems,
    scopeChangeReason: String(scopeChangeReason || ''),
    resolutions: normalizedResolutions,
    operations: operations.map(semanticOperation),
    blockers: blockers.map(({ code, target }) => ({ code, target })),
    warnings: warnings.map(({ code, target }) => ({ code, target }))
  }
  return {
    milestone: milestone.name,
    server: String(mapping.server || ''),
    projectId,
    managedFields: normalizedManagedFields,
    intent: {
      action: normalizedAction,
      scopeItems: Array.isArray(scopeItems) ? scopeItems : null,
      reason: Array.isArray(scopeItems) ? String(scopeChangeReason || '') : '',
      resolutions: normalizedResolutions
    },
    scopeItems: Array.isArray(scopeItems) ? scopeItems : null,
    scopeChangeReason: String(scopeChangeReason || ''),
    generatedAt,
    expiresAt,
    hash: `sha256:${digest(stableStringify(semantic))}`,
    summary,
    blockers,
    warnings,
    operations
  }
}

export function hashProjection(value, type, managedFields) {
  const fields = normalizeManagedFields(managedFields)
  return `sha256:${digest(stableStringify(type === 'sprint'
    ? sprintOwned(value, fields)
    : taskOwned(value, fields)))}`
}

function planOwnedChange({ entity, key, requirement, local, remote, lastSyncHash, resolution, managedFields, operations, blockers, summary }) {
  const localHash = hashProjection(local, entity, managedFields)
  const remoteHash = hashProjection(remote, entity, managedFields)
  if (localHash === remoteHash) {
    summary.unchanged++
    return
  }
  const safeLocalUpdate = lastSyncHash && remoteHash === lastSyncHash
  if (safeLocalUpdate || resolution === 'restore-local') {
    addOperation(operations, summary, {
      key: `${key}:update`,
      kind: `${entity}.update`,
      risk: resolution === 'restore-local' ? 'high' : 'normal',
      requirement,
      before: entity === 'sprint' ? sprintOwned(remote, managedFields) : taskOwned(remote, managedFields),
      after: entity === 'sprint' ? sprintOwned(local, managedFields) : taskOwned(local, managedFields),
      contentHash: localHash,
      revision: remote.revision,
      dependsOn: []
    })
    return
  }
  const conflict = {
    key: `${key}:conflict`,
    kind: 'conflict',
    risk: 'high',
    requirement,
    before: entity === 'sprint' ? sprintOwned(remote, managedFields) : taskOwned(remote, managedFields),
    after: entity === 'sprint' ? sprintOwned(local, managedFields) : taskOwned(local, managedFields),
    dependsOn: []
  }
  operations.push(conflict)
  summary.conflict++
  blockers.push(problem('REMOTE_DRIFT', `${entity === 'sprint' ? '平台冲刺' : '平台任务'}存在未确认的远端修改`, key))
}

function addOperation(operations, summary, operation) {
  operations.push(operation)
  const summaryKey = {
    'sprint.create': 'createSprint',
    'sprint.update': 'updateSprint',
    'task.create': 'createTask',
    'task.update': 'updateTask',
    'task.move': 'moveTask'
  }[operation.kind]
  if (summaryKey) summary[summaryKey]++
}

function sprintProjection(milestone, mapping) {
  return {
    projectId: mapping.projectId,
    ownerId: mapping.ownerId,
    sprintName: String(milestone.title || milestone.name || ''),
    sprintGoal: String(milestone.goal || ''),
    planStartDate: toRemoteDate(milestone.startAt, mapping.timezoneOffset),
    planEndDate: toRemoteDate(milestone.endAt, mapping.timezoneOffset)
  }
}

function taskProjection(requirement, milestone, mapping) {
  const value = {
    projectId: mapping.projectId,
    taskType: mapping.taskType,
    title: `[${requirement.code}] ${requirement.title}`,
    descriptionDoc: renderDescription(requirement, milestone),
    acceptanceDoc: String(requirement.spec || ''),
    priority: mapping.priority,
    assigneeId: mapping.assigneeId,
    planStartDate: toRemoteDate(milestone.startAt, mapping.timezoneOffset),
    planEndDate: toRemoteDate(requirement.dueDate || milestone.endAt, mapping.timezoneOffset)
  }
  if (mapping.status !== undefined) value.status = mapping.status
  return value
}

function sprintOwned(value = {}, managedFields) {
  const managed = new Set(normalizeManagedFields(managedFields))
  return pick({
    sprintName: String(value.sprintName || value.title || value.name || ''),
    sprintGoal: String(value.sprintGoal || value.goal || ''),
    ownerId: positiveId(value.ownerId),
    planStartDate: value.planStartDate || value.startAt || null,
    planEndDate: value.planEndDate || value.endAt || null
  }, [
    ...(managed.has('title') ? ['sprintName'] : []),
    ...(managed.has('description') ? ['sprintGoal'] : []),
    ...(managed.has('assignee') ? ['ownerId'] : []),
    'planStartDate',
    'planEndDate'
  ])
}

function taskOwned(value = {}, managedFields) {
  const managed = new Set(normalizeManagedFields(managedFields))
  return pick({
    title: String(value.title || value.taskName || value.name || ''),
    descriptionDoc: String(value.descriptionDoc || ''),
    acceptanceDoc: String(value.acceptanceDoc || ''),
    priority: value.priority ?? null,
    assigneeId: positiveId(value.assigneeId),
    status: value.status ?? null,
    planStartDate: value.planStartDate || null,
    planEndDate: value.planEndDate || null
  }, [
    ...(managed.has('title') ? ['title'] : []),
    ...(managed.has('description') ? ['descriptionDoc'] : []),
    ...(managed.has('acceptance') ? ['acceptanceDoc'] : []),
    ...(managed.has('priority') ? ['priority'] : []),
    ...(managed.has('assignee') ? ['assigneeId'] : []),
    ...(managed.has('status') ? ['status'] : []),
    'planStartDate',
    'planEndDate'
  ])
}

function validateSprintProjection(value, blockers, { create, managed }) {
  if ((create || managed.has('title')) && !value.sprintName) blockers.push(problem('SPRINT_NAME_REQUIRED', '迭代标题不能为空', 'milestone.title'))
  else if ((create || managed.has('title')) && value.sprintName.length > 64) blockers.push(problem('SPRINT_NAME_TOO_LONG', '平台冲刺名称不能超过 64 字符', 'milestone.title'))
  if (!value.planStartDate || !value.planEndDate) blockers.push(problem('SPRINT_DATES_REQUIRED', '迭代开始和结束日期不能为空', 'milestone.range'))
  if ((create || managed.has('assignee')) && !value.ownerId) blockers.push(problem('SPRINT_OWNER_REQUIRED', '尚未选择冲刺负责人', 'mapping.ownerId'))
}

function validateTaskProjection(value, requirement, blockers, { create, managed }) {
  if ((create || managed.has('title')) && value.title.length > 255) {
    blockers.push(problem('TASK_TITLE_TOO_LONG', `${requirement.code} 的平台任务标题超过 255 字符`, `requirement:${requirement.code}`))
  }
}

function priorityFor(requirement, mapping, blockers, required) {
  if (!required) return null
  const value = String(requirement.priority || '')
  if (!value) return null
  if (mapping.priorities?.[value] === undefined) {
    blockers.push(problem('TASK_PRIORITY_UNMAPPED', `${requirement.code} 的优先级 ${value} 尚未映射`, `requirement:${requirement.code}`))
    return null
  }
  return mapping.priorities[value]
}

function assigneeFor(requirement, mapping, warnings, required) {
  if (!required) return null
  const owner = String(requirement.owner || '')
  if (!owner) return null
  if (mapping.members?.[owner] === undefined) {
    warnings.push(problem('TASK_ASSIGNEE_UNMAPPED', `${requirement.code} 的负责人 ${owner} 尚未映射，任务将保持未分配`, `requirement:${requirement.code}`))
    return null
  }
  return mapping.members[owner]
}

function assigneeIdFor(owner, mapping) {
  const value = String(owner || '')
  return value && mapping.members?.[value] !== undefined ? positiveId(mapping.members[value]) : null
}

function statusFor(requirement, mapping, blockers, required) {
  if (!required) return undefined
  const status = String(requirement.status || 'draft')
  if (mapping.statuses?.[status] === undefined) {
    blockers.push(problem('TASK_STATUS_UNMAPPED', `${requirement.code} 的状态 ${status} 尚未映射`, `requirement:${requirement.code}`))
    return undefined
  }
  return mapping.statuses[status]
}

function renderDescription(requirement, milestone) {
  const references = (milestone.items || [])
    .filter((item) => item.requirement === requirement.code)
    .map((item) => `- ${item.project}/${item.version}`)
    .sort()
  return [String(requirement.description || '').trim(), references.length ? `关联原型：\n${references.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n')
}

function toRemoteDate(value, offset = '+08:00') {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const safeOffset = /^[+-]\d{2}:\d{2}$/.test(String(offset || '')) ? String(offset) : '+08:00'
  return `${date}T00:00:00${safeOffset}`
}

function semanticOperation(operation) {
  return pick(operation, ['key', 'kind', 'risk', 'requirement', 'entity', 'before', 'after', 'reason', 'contentHash', 'taskId', 'taskRevision', 'sprintId', 'revision', 'dependsOn'])
}

function normalizeResolutions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([, resolution]) => resolution === 'restore-local')
    .sort(([left], [right]) => left.localeCompare(right)))
}

function normalizeManagedFields(value) {
  const source = Array.isArray(value) ? value : LEGACY_MANAGED_FIELDS
  return [...new Set(source.map((field) => String(field || '').trim()))]
    .filter((field) => SUPPORTED_MANAGED_FIELDS.has(field))
    .sort()
}

function remoteObservation(value) {
  if (!value) return null
  return {
    id: positiveId(value.id ?? value.sprintId ?? value.taskId),
    status: value.status ?? null,
    revision: value.revision ?? null,
    sprintId: positiveId(value.sprintId ?? value.currentSprintId)
  }
}

function problem(code, message, target) {
  return { code, message, target }
}

function positiveId(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function pick(value, keys) {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
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
