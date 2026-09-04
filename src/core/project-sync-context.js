import * as store from './store.js'
import { normalizeSyncPolicy } from './sync-policy.js'

export function resolveProjectSyncContext(root, milestone, mcpInfo = {}) {
  const projects = milestoneProjects(milestone)
  if (!projects.length) {
    return blocked({
      code: 'PROJECT_SYNC_TARGET_REQUIRED',
      message: `迭代 ${milestone?.name || ''} 尚未关联项目`,
      repairTo: milestoneRoute(milestone?.name)
    })
  }

  const contexts = projects.map((project) => ({
    project,
    policy: normalizedPolicy(store.readProject(root, project).sync)
  }))
  const missingTargets = contexts.flatMap(({ project, policy }) => {
    if (!policy.server) {
      return [projectBlocker('PROJECT_SYNC_TARGET_REQUIRED', project, `${project} 尚未选择同步 MCP 服务`)]
    }
    if (!policy.projectId) {
      return [projectBlocker('PROJECT_SYNC_TARGET_REQUIRED', project, `${project} 尚未填写外部项目 ID`)]
    }
    return []
  })
  if (missingTargets.length) return blocked(missingTargets)

  const selected = contexts[0]
  const targetMismatches = contexts.slice(1)
    .filter(({ policy }) => policy.server !== selected.policy.server || policy.projectId !== selected.policy.projectId)
    .map(({ project }) => projectBlocker(
      'PROJECT_SYNC_TARGET_MISMATCH',
      project,
      `${project} 的同步目标与 ${selected.project} 不一致`
    ))
  if (targetMismatches.length) return blocked(targetMismatches)

  const fieldsKey = selected.policy.managedFields.join('\u0000')
  const fieldMismatches = contexts.slice(1)
    .filter(({ policy }) => policy.managedFields.join('\u0000') !== fieldsKey)
    .map(({ project }) => projectBlocker(
      'PROJECT_SYNC_MANAGED_FIELDS_MISMATCH',
      project,
      `${project} 的托管字段与 ${selected.project} 不一致`
    ))
  if (fieldMismatches.length) return blocked(fieldMismatches)

  const external = milestone?.external
  if (external?.sprintId && (
    String(external.server || '').trim() !== selected.policy.server ||
    String(external.projectId || '').trim() !== selected.policy.projectId
  )) {
    return blocked({
      code: 'MILESTONE_EXTERNAL_TARGET_MISMATCH',
      message: `迭代 ${milestone.name} 已绑定到另一同步目标`,
      repairTo: milestoneRoute(milestone.name)
    })
  }

  const config = mcpInfo?.config || mcpInfo || {}
  const capability = config.capabilities?.milestones
  if (!capability) {
    return blocked({
      code: 'MCP_CAPABILITY_MISSING',
      message: '迭代 MCP 能力不存在',
      repairTo: '/settings/mcp'
    })
  }
  if (capability.enabled !== true) {
    return blocked({
      code: 'MCP_CAPABILITY_DISABLED',
      message: '迭代 MCP 能力尚未启用',
      repairTo: '/settings/mcp'
    })
  }

  const serverConfig = (config.servers || []).find((server) => server.id === selected.policy.server)
  if (!serverConfig) {
    return blocked(mcpBlocker(
      'MCP_SERVER_MISSING',
      selected.project,
      `项目 ${selected.project} 选择的 MCP 服务 ${selected.policy.server} 不存在`
    ))
  }
  if (serverConfig.enabled === false) {
    return blocked(mcpBlocker(
      'MCP_SERVER_DISABLED',
      selected.project,
      `MCP 服务 ${selected.policy.server} 已停用`
    ))
  }
  if (serverConfig.type !== 'stdio') {
    return blocked(mcpBlocker(
      'MCP_SERVER_TRANSPORT_INVALID',
      selected.project,
      `MCP 服务 ${selected.policy.server} 不是 stdio 服务`
    ))
  }
  if (serverConfig.adapter !== 'assess-task') {
    return blocked(mcpBlocker(
      'MCP_SERVER_ADAPTER_INVALID',
      selected.project,
      `MCP 服务 ${selected.policy.server} 未使用 assess-task 适配器`
    ))
  }
  if (!String(serverConfig.runtimeProfile || '').trim()) {
    return blocked(mcpBlocker(
      'MCP_RUNTIME_PROFILE_REQUIRED',
      selected.project,
      `MCP 服务 ${selected.policy.server} 缺少本机运行配置`
    ))
  }

  return {
    ready: true,
    blockers: [],
    server: selected.policy.server,
    projectId: selected.policy.projectId,
    managedFields: selected.policy.managedFields,
    capability,
    serverConfig
  }
}

function milestoneProjects(milestone) {
  return [...new Set((milestone?.items || [])
    .map((item) => String(item?.project || '').trim())
    .filter(Boolean))]
}

function normalizedPolicy(input) {
  const policy = normalizeSyncPolicy(input)
  return { ...policy, managedFields: [...policy.managedFields].sort() }
}

function projectBlocker(code, project, message) {
  return { code, project, message, repairTo: `/projects/${encodeURIComponent(project)}/sync` }
}

function mcpBlocker(code, project, message) {
  return { code, message, project, repairTo: '/settings/mcp' }
}

function milestoneRoute(name) {
  return `/milestones/${encodeURIComponent(String(name || ''))}`
}

function blocked(input) {
  return { ready: false, blockers: Array.isArray(input) ? input : [input] }
}
