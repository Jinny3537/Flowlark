const FIELD_LABELS = {
  sprintName: '冲刺名称',
  sprintGoal: '冲刺目标',
  ownerId: '负责人',
  title: '标题',
  descriptionDoc: '描述',
  acceptanceDoc: '验收标准',
  priority: '优先级',
  assigneeId: '负责人',
  status: '状态',
  sprintId: '冲刺',
  projectId: '项目'
}

const KNOWN_KINDS = new Set([
  'sprint.create', 'sprint.update', 'task.create', 'task.update', 'task.move',
  'conflict', 'milestone.freeze', 'sprint.start', 'sprint.end', 'sprint.cancel',
  'local.scope-change', 'task.binding.replace', 'sprint.binding.replace'
])

export function presentSyncOperation(input = {}) {
  const operation = unwrap(input)
  const kind = String(operation.kind || '')
  const error = input?.error || operation.error || null
  if (error?.code === 'MCP_SYNC_LINK_REQUIRED') {
    return presentation({
      kind,
      title: '需要关联远端对象',
      subject: subjectOf(operation),
      summary: error.message || '创建结果不明确，请先关联已创建的远端对象',
      tone: 'warning',
      highRisk: operation.risk === 'high',
      recovery: 'link-required'
    })
  }

  if (!KNOWN_KINDS.has(kind)) {
    return presentation({
      kind,
      title: '未知同步操作',
      subject: '同步对象',
      summary: '无法识别该操作；请仅查看详情并核对服务端计划',
      tone: 'default',
      highRisk: operation.risk === 'high',
      recovery: 'inspect'
    })
  }

  if (kind === 'sprint.create') {
    const name = sprintName(operation)
    const project = operation.after?.projectId
    return presentation({
      kind,
      title: '创建平台冲刺',
      subject: name,
      summary: project == null
        ? `创建平台冲刺「${name}」`
        : `在平台项目 ${project} 中创建冲刺「${name}」`,
      tone: 'processing',
      highRisk: false,
      recovery: null
    })
  }

  if (kind === 'task.create') {
    const requirement = String(operation.requirement || '').trim()
    const title = String(operation.after?.title || '').trim() || '未命名任务'
    return presentation({
      kind,
      title: '创建平台任务',
      subject: requirement || title,
      summary: requirement
        ? `为需求 ${requirement} 创建平台任务「${title}」`
        : `创建平台任务「${title}」`,
      tone: 'processing',
      highRisk: false,
      recovery: null
    })
  }

  if (kind === 'task.move') {
    const task = operation.taskId ?? operation.requirement ?? '未知'
    const movesOut = operation.after?.sprintId == null
    return presentation({
      kind,
      title: movesOut ? '移出冲刺' : '移入冲刺',
      subject: `任务 ${task}`,
      summary: movesOut
        ? `将平台任务 ${task} 移出当前冲刺，不删除平台任务`
        : `将平台任务 ${task} 移入冲刺 ${operation.after.sprintId}，不删除平台任务`,
      tone: operation.risk === 'high' ? 'warning' : 'processing',
      highRisk: operation.risk === 'high',
      recovery: null
    })
  }

  if (kind === 'conflict') {
    return presentation({
      kind,
      title: '远端修改冲突',
      subject: subjectOf(operation),
      summary: '远端值已变化；确认“保留 Flowlark”后才会覆盖托管字段',
      tone: 'error',
      highRisk: true,
      recovery: 'restore-local'
    })
  }

  if (kind === 'milestone.freeze') {
    const keyMilestone = String(operation.key || '').match(/^milestone:(.+):freeze$/)?.[1]
    const milestone = String(operation.milestone || operation.after?.name || keyMilestone || '').trim() || '当前迭代'
    return presentation({
      kind,
      title: '冻结本地迭代',
      subject: milestone,
      summary: `远端范围验证完成后冻结迭代 ${milestone}`,
      tone: 'warning',
      highRisk: true,
      recovery: null
    })
  }

  if (kind === 'local.scope-change') {
    const count = Array.isArray(operation.after) ? operation.after.length : 0
    return presentation({
      kind,
      title: '更新迭代范围',
      subject: operation.milestone || '当前迭代',
      summary: `更新迭代范围，共 ${count} 项`,
      tone: 'warning',
      highRisk: true,
      recovery: null
    })
  }

  const lifecycleTitle = {
    'sprint.start': '开始平台冲刺',
    'sprint.end': '结束平台冲刺',
    'sprint.cancel': '取消平台冲刺'
  }[kind]
  if (lifecycleTitle) {
    return presentation({
      kind,
      title: lifecycleTitle,
      subject: `冲刺 ${operation.sprintId ?? '当前'}`,
      summary: `${lifecycleTitle} ${operation.sprintId ?? '当前冲刺'}`,
      tone: kind === 'sprint.cancel' ? 'error' : 'warning',
      highRisk: true,
      recovery: null
    })
  }

  if (kind === 'task.binding.replace' || kind === 'sprint.binding.replace') {
    const task = kind.startsWith('task.')
    const replacing = operation.before != null
    const noun = task ? '平台任务' : '平台 Sprint'
    const remoteId = task ? operation.after?.taskId : operation.after?.sprintId
    return presentation({
      kind,
      title: `${replacing ? '改绑' : '绑定'}${noun}`,
      subject: operation.requirement || operation.milestone || '当前对象',
      summary: `${replacing ? '改绑到' : '绑定'}${noun} ${remoteId ?? '待确认'}`,
      tone: 'warning',
      highRisk: true,
      recovery: null
    })
  }

  const changes = changedFields(operation)
  const entity = kind === 'sprint.update' ? '冲刺' : '任务'
  const fieldText = changes.length
    ? `${changes.length} 个${operation.risk === 'high' ? '远端' : ''}托管字段：${changes.map((item) => item.label).join('、')}`
    : '托管字段值无变化'
  return presentation({
    kind,
    title: `更新平台${entity}`,
    subject: subjectOf(operation),
    summary: operation.risk === 'high'
      ? `使用 Flowlark 值覆盖 ${fieldText}`
      : changes.length ? `同步 ${fieldText}` : fieldText,
    tone: operation.risk === 'high' ? 'warning' : 'processing',
    highRisk: operation.risk === 'high',
    recovery: operation.risk === 'high' ? 'restore-local' : null
  })
}

export function syncOperationDiff(input = {}) {
  const operation = unwrap(input)
  const error = input?.error || operation.error || null
  if (error?.code === 'MCP_SYNC_LINK_REQUIRED') {
    return { summary: '创建结果不明确，需先关联已创建的远端对象', sections: [], changes: [] }
  }

  const kind = String(operation.kind || '')
  const beforePresent = hasOwn(operation, 'before')
  const afterPresent = hasOwn(operation, 'after')
  const changes = changedFields(operation)
  if (!beforePresent && !afterPresent) return { summary: '无字段差异', sections: [], changes }

  if (!KNOWN_KINDS.has(kind)) {
    return {
      summary: '未知操作，字段仅供核对',
      sections: beforeAfterSections(operation, '记录值（前）', '记录值（后）'),
      changes
    }
  }
  if (kind.endsWith('.create')) {
    return {
      summary: '将创建新的平台对象',
      sections: [{ label: '将创建', value: operation.after, present: afterPresent, emptyText: '无目标值' }],
      changes
    }
  }
  if (kind === 'task.move') {
    return {
      summary: '冲刺归属变化；平台任务会保留',
      sections: beforeAfterSections(operation, '当前冲刺', '目标冲刺'),
      changes
    }
  }
  if (kind === 'local.scope-change') {
    return {
      summary: '目标迭代范围',
      sections: [{ label: '目标范围', value: operation.after, present: afterPresent, emptyText: '无目标范围' }],
      changes
    }
  }
  if (kind === 'milestone.freeze') {
    return {
      summary: '远端验证完成后更新本地迭代状态',
      sections: beforeAfterSections(operation, '冻结前', '冻结后'),
      changes
    }
  }
  return {
    summary: '平台当前值 → Flowlark 权威值',
    sections: beforeAfterSections(operation, '平台当前值', 'Flowlark 权威值'),
    changes
  }
}

function unwrap(input) {
  return input?.operation && typeof input.operation === 'object' ? input.operation : input || {}
}

function presentation(value) {
  return {
    kind: value.kind,
    title: value.title,
    subject: value.subject,
    summary: value.summary,
    tone: value.tone,
    highRisk: value.highRisk,
    recovery: value.recovery
  }
}

function subjectOf(operation) {
  if (operation.requirement) return String(operation.requirement)
  if (operation.taskId != null) return `任务 ${operation.taskId}`
  if (String(operation.kind || '').startsWith('sprint.')) return sprintName(operation)
  return '同步对象'
}

function sprintName(operation) {
  return String(operation.after?.sprintName || operation.after?.title || operation.milestone || '').trim() || '未命名冲刺'
}

function changedFields(operation) {
  const before = record(operation.before)
  const after = record(operation.after)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return keys
    .filter((field) => !sameValue(before[field], after[field]))
    .map((field) => ({
      field,
      label: FIELD_LABELS[field] || field,
      before: before[field],
      after: after[field]
    }))
}

function beforeAfterSections(operation, beforeLabel, afterLabel) {
  return [
    { label: beforeLabel, value: operation.before, present: hasOwn(operation, 'before'), emptyText: '无当前值' },
    { label: afterLabel, value: operation.after, present: hasOwn(operation, 'after'), emptyText: '无目标值' }
  ]
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}
