const REQUIREMENT_STATUS = Object.freeze({
  draft: { label: '草稿', color: 'default' },
  confirmed: { label: '已确认', color: 'blue' },
  developing: { label: '开发中', color: 'processing' },
  'pending-acceptance': { label: '待验收', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  archived: { label: '已归档', color: 'default' },
})

const PROTOTYPE_PROGRESS = Object.freeze({
  not_started: { label: '未开始', color: 'default' },
  designing: { label: '设计中', color: 'gold' },
  finalized: { label: '已定稿', color: 'cyan' },
  delivered: { label: '已交付', color: 'green' },
})

const PRIMARY_ACTION = Object.freeze({
  draft: { key: 'confirm', label: '确认需求', targetStatus: 'confirmed' },
  confirmed: { key: 'join-milestone', label: '加入迭代', targetStatus: null },
  developing: { key: 'view-milestone', label: '查看迭代', targetStatus: null },
})

export const REQUIREMENT_STATUS_OPTIONS = Object.freeze(
  Object.entries(REQUIREMENT_STATUS).map(([value, meta]) => Object.freeze({ value, label: meta.label })),
)

export const PROTOTYPE_PROGRESS_OPTIONS = Object.freeze(
  Object.entries(PROTOTYPE_PROGRESS).map(([value, meta]) => Object.freeze({ value, label: meta.label })),
)

export function requirementStatusMeta(value) {
  const status = String(value || 'draft')
  return { value: status, ...(REQUIREMENT_STATUS[status] || { label: status, color: 'default' }) }
}

export function prototypeProgressMeta(value) {
  const status = String(value || 'not_started')
  return { value: status, ...(PROTOTYPE_PROGRESS[status] || { label: status, color: 'default' }) }
}

export function requirementPrimaryAction(item = {}) {
  const action = PRIMARY_ACTION[item.status || 'draft']
  return action ? { ...action } : null
}

export function externalBindingMeta(item = {}) {
  const binding = Array.isArray(item.externalTasks) ? item.externalTasks[0] || null : null
  if (!binding) {
    return { state: 'unbound', tone: 'default', label: '未关联任务平台', detail: '', binding: null }
  }

  const task = binding.taskCode || (binding.taskId ? `#${binding.taskId}` : '')
  const remoteStatus = String(binding.remoteStatus || '').trim()
  const detail = [task && `平台任务 ${task}`, remoteStatus].filter(Boolean).join(' · ')
  const drifted = binding.drift === true || ['drift', 'drifted', 'conflict'].includes(binding.driftState)
  if (binding.syncStatus === 'failed') {
    return { state: 'failed', tone: 'error', label: '同步失败', detail, binding }
  }
  if (drifted) {
    return { state: 'drift', tone: 'error', label: '同步有差异', detail, binding }
  }
  if (!binding.lastSyncHash || !binding.syncedAt) {
    return { state: 'pending', tone: 'warning', label: '已关联，待同步', detail, binding }
  }
  return { state: 'synced', tone: 'success', label: '已同步', detail, binding }
}

export function writeActionGuard({ canWrite = true, readonlyReason = '', blockers = [] } = {}) {
  if (!canWrite) {
    return {
      allowed: false,
      disabled: true,
      reason: String(readonlyReason || '当前为只读模式，只能查看需求信息。'),
    }
  }
  const first = Array.isArray(blockers) ? blockers[0] : null
  const reason = typeof first === 'string' ? first : String(first?.message || first?.detail || '')
  return { allowed: !reason, disabled: Boolean(reason), reason }
}
