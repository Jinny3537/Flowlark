const STATUS = {
  'pending-confirmation': { label: '待确认', color: 'warning' },
  running: { label: '同步中', color: 'processing' },
  failed: { label: '同步失败', color: 'error' },
  paused: { label: '已暂停', color: 'warning' },
  completed: { label: '同步完成', color: 'success' },
  canceled: { label: '已取消', color: 'default' }
}

const ATTENTION_STATUSES = new Set(['pending-confirmation', 'failed', 'paused'])

export function syncStatusMeta(value) {
  return STATUS[value] || { label: '未知状态', color: 'default' }
}

export function filterSyncRecords(records = [], filter = 'all') {
  const filtered = filter === 'attention'
    ? records.filter((item) => ATTENTION_STATUSES.has(item.status))
    : filter && filter !== 'all'
      ? records.filter((item) => item.status === filter)
      : [...records]

  return filtered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const difference = Date.parse(right.item.updatedAt || '') - Date.parse(left.item.updatedAt || '')
      return Number.isNaN(difference) || difference === 0 ? left.index - right.index : difference
    })
    .map(({ item }) => item)
}

export function countSyncStatuses(records = []) {
  return {
    attention: records.filter((item) => ATTENTION_STATUSES.has(item.status)).length,
    running: records.filter((item) => item.status === 'running').length,
    completed: records.filter((item) => item.status === 'completed').length
  }
}

export function syncPrimaryAction(record = {}) {
  if (linkRequiredStep(record)) return 'link'
  if (record.status === 'pending-confirmation') return 'execute'
  if (record.status === 'failed' || record.status === 'paused') return 'retry'
  return 'open'
}

export function linkRequiredStep(record = {}) {
  if (record.status !== 'paused') return null
  return (record.operations || []).find((step) =>
    ['sprint.create', 'task.create'].includes(step.kind || step.operation?.kind) &&
    step.status === 'paused' &&
    step.error?.code === 'MCP_SYNC_LINK_REQUIRED') || null
}

export function syncEntityMeta(record = {}) {
  const type = String(record.entityType || '')
  const key = encodeURIComponent(String(record.entityKey || ''))
  const definition = {
    milestone: { label: '迭代', route: `/milestones/${key}` },
    requirement: { label: '需求任务绑定', route: `/requirements/${key}` },
    'milestone-binding': { label: '迭代 Sprint 绑定', route: `/milestones/${key}` }
  }[type]
  return definition || { label: '未知对象', route: '' }
}

export function syncRecordBatchEligible(record = {}) {
  if (record.status !== 'pending-confirmation' || linkRequiredStep(record)) return false
  const operations = record.plan?.operations || []
  return operations.length > 0 && operations.every((operation) => operation.risk !== 'high')
}
