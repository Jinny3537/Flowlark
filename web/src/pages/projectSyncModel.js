export const MANAGED_FIELD_OPTIONS = Object.freeze([
  { value: 'title', label: '标题' },
  { value: 'description', label: '描述' },
  { value: 'acceptance', label: '验收标准' },
  { value: 'priority', label: '优先级' },
  { value: 'assignee', label: '负责人' },
  { value: 'sprint', label: '迭代' },
  { value: 'status', label: '状态' },
  { value: 'delivery', label: '交付信息' }
])

const MANAGED_FIELDS = new Set(MANAGED_FIELD_OPTIONS.map((item) => item.value))
const DEFAULT_MANAGED_FIELDS = MANAGED_FIELD_OPTIONS.map((item) => item.value)

export function projectSyncForm(input = {}) {
  const source = Array.isArray(input.managedFields) ? input.managedFields : DEFAULT_MANAGED_FIELDS
  return {
    mode: input.mode === 'trusted-auto' ? 'trusted-auto' : 'manual',
    server: String(input.server || '').trim(),
    projectId: String(input.projectId || '').trim(),
    managedFields: [...new Set(source.map((value) => String(value || '').trim()))]
      .filter((value) => MANAGED_FIELDS.has(value))
  }
}

export function projectSyncPayload(values = {}) {
  return { sync: projectSyncForm(values) }
}

export function trustedModeMessage({ ready = false } = {}) {
  const readiness = ready
    ? '当前准备检查已满足，但不会触发自动同步。'
    : '需先验证连接、写权限、创建与更新、状态回写和幂等行为。'
  return `${readiness} v0.7.2 只保存 trusted-auto 准备配置，自动执行最早在 v0.7.5 激活。`
}
