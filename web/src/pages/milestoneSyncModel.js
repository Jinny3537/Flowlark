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

export function milestonePrimaryAction(item = {}) {
  return item.status === 'reviewing'
    ? { key: 'freeze', label: '预览并冻结', planAction: 'freeze' }
    : null
}

export function isHighRiskAction(action) {
  return ['freeze', 'start', 'end', 'cancel'].includes(action)
}

export function groupPlanOperations(plan = {}) {
  const groups = { create: [], update: [], move: [], conflict: [], lifecycle: [], other: [] }
  for (const operation of plan.operations || []) {
    if (operation.kind === 'conflict') groups.conflict.push(operation)
    else if (/\.create$/.test(operation.kind)) groups.create.push(operation)
    else if (/\.update$/.test(operation.kind)) groups.update.push(operation)
    else if (/\.move/.test(operation.kind)) groups.move.push(operation)
    else if (['sprint.start', 'sprint.end', 'sprint.cancel', 'milestone.freeze'].includes(operation.kind)) groups.lifecycle.push(operation)
    else groups.other.push(operation)
  }
  return groups
}

export function groupFreezeBlockers(blockers = []) {
  const definitions = [
    { key: 'requirement', label: '需求完整性' },
    { key: 'version', label: '版本交付' },
    { key: 'project', label: '项目同步目标' },
    { key: 'remote', label: '远端同步验证' }
  ]
  const groups = Object.fromEntries(definitions.map((item) => [item.key, { ...item, items: [] }]))
  for (const blocker of blockers || []) groups[blockerCategory(blocker)].items.push(blocker)
  return definitions.map(({ key }) => groups[key]).filter((group) => group.items.length)
}

function blockerCategory(blocker = {}) {
  const code = String(blocker.code || '')
  if (code.startsWith('PROJECT_SYNC_') || code.startsWith('MCP_SERVER_') || code.startsWith('MCP_RUNTIME_') || code.startsWith('MCP_CAPABILITY_')) return 'project'
  if (blocker.version || ['REVIEW_NOT_CONFIRMED', 'SPEC_MISSING', 'CHANGELOG_MISSING', 'BASELINE_DRIFT', 'VERSION_VOID', 'VERSION_DRAFT', 'MILESTONE_SCOPE_EMPTY'].includes(code)) return 'version'
  if (blocker.requirement || code.startsWith('REQUIREMENT_')) return 'requirement'
  return 'remote'
}

export function syncHealth({ external = null, journal = null } = {}) {
  if (journal?.status === 'failed') return { tone: 'error', label: '同步失败', detail: '可查看失败步骤并重试' }
  if (journal?.status === 'running') return { tone: 'processing', label: '同步进行中', detail: '正在执行已确认的同步计划' }
  if (journal?.status === 'completed') return { tone: 'success', label: '同步完成', detail: journal.completedAt || journal.updatedAt || '' }
  if (external?.sprintId) return { tone: 'warning', label: '已关联，待核对', detail: external.syncedAt || '' }
  return { tone: 'default', label: '未连接平台', detail: '本地迭代功能不受影响' }
}
