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
    mode: 'manual',
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
  const readiness = ready ? '当前连接条件已满足。' : '仍需验证连接与平台写权限。'
  return `${readiness} trusted-auto 尚未开放，当前版本不可启用或保存；自动执行最早在 v0.7.5 激活。`
}

export function projectSyncChanged(saved = {}, draft = {}) {
  return JSON.stringify(comparableSync(saved)) !== JSON.stringify(comparableSync(draft))
}

export function projectSyncReadiness(sync = {}, mcpInfo = {}) {
  const value = projectSyncForm(sync)
  const servers = mcpInfo?.config?.servers || []
  const server = servers.find((item) => item.id === value.server)
  const capability = mcpInfo?.config?.capabilities?.milestones
  let connection
  if (!value.server || !value.projectId) {
    connection = { state: 'missing', label: '同步目标未配置', detail: '请选择 MCP 服务并填写外部项目 ID。' }
  } else if (!server || server.enabled === false) {
    connection = { state: 'blocked', label: 'MCP 服务不可用', detail: '所选服务不存在或已停用。' }
  } else if (server.type !== 'stdio' || server.adapter !== 'assess-task' || !server.runtimeProfile) {
    connection = { state: 'blocked', label: '连接配置不完整', detail: '项目同步需要 Assess Task stdio 服务和本机运行配置。' }
  } else if (capability?.enabled !== true) {
    connection = { state: 'blocked', label: '迭代能力未启用', detail: '请在 MCP 中心启用迭代能力及工具映射。' }
  } else {
    connection = {
      state: 'ready',
      label: '连接配置可用',
      detail: server.name ? `${server.name}（${server.id}）` : server.id
    }
  }
  return {
    connection,
    permission: connection.state === 'ready'
      ? { state: 'unverified', label: '写权限未验证', detail: '连接配置不代表平台写权限，请在 MCP 中心完成验证。' }
      : { state: 'blocked', label: '写权限尚不可验证', detail: '先完成连接配置，再验证平台写权限。' }
  }
}

function comparableSync(value) {
  const normalized = projectSyncForm(value)
  return {
    server: normalized.server,
    projectId: normalized.projectId,
    managedFields: [...normalized.managedFields].sort()
  }
}
