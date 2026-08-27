const STATUS = {
  planning: { label: '计划中', color: 'default' },
  reviewing: { label: '评审中', color: 'processing' },
  frozen: { label: '已冻结', color: 'cyan' },
  active: { label: '进行中', color: 'blue' },
  delivered: { label: '已交付', color: 'success' },
  archived: { label: '已归档', color: 'default' },
  canceled: { label: '已取消', color: 'error' }
}

const ACTIONS = {
  planning: ['review', 'cancel'],
  reviewing: ['back', 'freeze', 'cancel'],
  frozen: ['start', 'unfreeze', 'cancel'],
  active: ['end', 'cancel'],
  delivered: ['archive'],
  archived: [],
  canceled: []
}

export function milestoneStatusMeta(value) {
  return STATUS[value] || { label: value || '计划中', color: 'default' }
}

export function allowedMilestoneActions(item = {}) {
  return [...(ACTIONS[item.status || 'planning'] || [])]
}

export function isHighRiskAction(action) {
  return ['start', 'end', 'cancel'].includes(action)
}

export function groupPlanOperations(plan = {}) {
  const groups = { create: [], update: [], move: [], conflict: [], lifecycle: [], other: [] }
  for (const operation of plan.operations || []) {
    if (operation.kind === 'conflict') groups.conflict.push(operation)
    else if (/\.create$/.test(operation.kind)) groups.create.push(operation)
    else if (/\.update$/.test(operation.kind)) groups.update.push(operation)
    else if (/\.move/.test(operation.kind)) groups.move.push(operation)
    else if (['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind)) groups.lifecycle.push(operation)
    else groups.other.push(operation)
  }
  return groups
}

export function syncHealth({ external = null, journal = null } = {}) {
  if (journal?.status === 'failed') return { tone: 'error', label: '同步失败', detail: '可查看失败步骤并重试' }
  if (journal?.status === 'running') return { tone: 'processing', label: '同步进行中', detail: '正在执行已确认的同步计划' }
  if (journal?.status === 'completed') return { tone: 'success', label: '同步完成', detail: journal.completedAt || journal.updatedAt || '' }
  if (external?.sprintId) return { tone: 'warning', label: '已关联，待核对', detail: external.syncedAt || '' }
  return { tone: 'default', label: '未连接平台', detail: '本地迭代功能不受影响' }
}
