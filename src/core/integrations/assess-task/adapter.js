import { err } from '../../errors.js'
import { validateAssessContract } from './contract.js'

export function createAssessTaskAdapter({ session, tools = [], mapping = {}, projectId = null, write = false, closure = false } = {}) {
  if (!session || typeof session.callTool !== 'function') throw err.bad('ASSESS_SESSION_REQUIRED', 'Assess Task MCP 会话不可用')
  const parsedProjectId = optionalId(projectId, 'ASSESS_PROJECT_ID_INVALID', '平台项目 ID 必须是数字')
  const contract = validateAssessContract(tools, mapping, { write, closure })
  if (contract.problems.length) {
    throw err.bad('ASSESS_CONTRACT_INVALID', contract.problems[0].message, contract.problems.map((item) => item.message).join('；'))
  }

  const call = (operation, args = {}) => session.callTool(contract.operations[operation], args)
  const listAll = async (operation, args = {}) => {
    const schema = tools.find((tool) => tool.name === contract.operations[operation])?.inputSchema
    if (!schema?.properties?.pageNum || !schema?.properties?.pageSize) return itemsFrom(await call(operation, args))
    const result = []
    for (let pageNum = 1; ; pageNum++) {
      const value = objectFrom(await call(operation, { ...args, pageNum, pageSize: 500 }))
      const items = itemsFrom(value)
      result.push(...items)
      if (!items.length || (Number.isFinite(value.total) ? result.length >= value.total : items.length < 500)) return result
    }
  }
  const selectedProject = () => {
    if (parsedProjectId == null) throw err.bad('ASSESS_PROJECT_REQUIRED', '尚未选择平台项目')
    return parsedProjectId
  }

  return {
    async closeVersion(body) {
      return objectFrom(await call('closeVersion', { body }))
    },

    async probe() {
      const item = objectFrom(await call('currentUser'))
      return {
        account: String(item.account || item.login || item.username || ''),
        name: String(item.name || item.realName || item.userName || item.displayName || ''),
        roles: strings(item.roles || item.roleNames),
        permissions: strings(item.permissions || item.authorities)
      }
    },

    async listProjects(keyword = '') {
      const args = String(keyword || '').trim() ? { keyword: String(keyword).trim() } : {}
      return (await listAll('listProjects', args)).map(normalizeProject)
    },

    async getProjectCapabilities(project = selectedProject()) {
      return objectFrom(await call('projectCapabilities', { projectId: numericId(project) }))
    },

    async listMembers(project = selectedProject()) {
      return (await listAll('listMembers', { projectId: numericId(project) })).map(normalizeMember)
    },

    async listSprints({ statuses = [], pageNum = 1, pageSize = 500 } = {}) {
      const args = { projectId: selectedProject(), pageNum, pageSize }
      if (statuses.length) args.status = statuses
      return itemsFrom(await call('listSprints', args)).map(normalizeSprint)
    },

    async listVersions() {
      if (!contract.operations.listVersions) throw err.bad('ASSESS_VERSION_TOOL_MISSING', '请配置平台版本查询工具')
      return (await listAll('listVersions', { projectId: selectedProject() })).map(normalizeVersion)
    },

    async getVersion(versionId) {
      if (!contract.operations.getVersion) throw err.bad('ASSESS_VERSION_TOOL_MISSING', '请配置平台版本详情工具')
      return normalizeVersion(objectFrom(await call('getVersion', { versionId: numericId(versionId) })))
    },

    async getSprint(sprintId) {
      return normalizeSprint(objectFrom(await call('getSprint', { sprintId: numericId(sprintId) })))
    },

    async listTasks({ sprintId = null, statuses = [], pageNum = 1, pageSize = 500 } = {}) {
      const args = { projectId: selectedProject(), pageNum, pageSize }
      if (sprintId != null) args.sprintIds = [numericId(sprintId)]
      if (statuses.length) args.statuses = statuses
      const result = await call('listTasks', args)
      if (closure && !hasItemArray(result)) throw err.bad('ASSESS_TASKS_INVALID', '平台任务列表响应无效，无法核实未完成任务')
      return itemsFrom(result).map(normalizeTask)
    },

    async getTask(taskId) {
      return normalizeTask(objectFrom(await call('getTask', { taskId: numericId(taskId) })))
    },

    async saveSprint(body) {
      return normalizeSprint(objectFrom(await call('saveSprint', { body })))
    },

    async createTask(body) {
      return normalizeTask(objectFrom(await call('createTask', { body })))
    },

    async updateTask(body) {
      return normalizeTask(objectFrom(await call('updateTask', { body })))
    },

    async moveTasks(body) {
      return objectFrom(await call('moveTasks', { body }))
    },

    async startSprint(body) {
      return objectFrom(await call('startSprint', { body }))
    },

    async endSprint(body) {
      return objectFrom(await call('endSprint', { body }))
    },

    async cancelSprint(body) {
      return objectFrom(await call('cancelSprint', { body }))
    }
  }
}

export async function testConnection(config) {
  const identity = await adapterFromConfig(config).probe()
  return { provider: 'assess-task', ok: true, identity: identity.name || identity.account, account: identity.account }
}

export async function listMilestones(config) {
  return adapterFromConfig(config).listSprints()
}

export async function fetchMilestone(config, key) {
  return adapterFromConfig(config).getSprint(key)
}

export async function upsertMilestone(config, milestone) {
  const projectId = numericId(config.projectId || config.project)
  const ownerId = numericId(milestone.external?.ownerId || config.ownerId)
  return adapterFromConfig(config, true).saveSprint({
    id: milestone.external?.sprintId || undefined,
    revision: milestone.external?.revision || undefined,
    projectId,
    ownerId,
    sprintName: milestone.title || milestone.name,
    sprintGoal: milestone.goal || '',
    planStartDate: milestone.startAt || undefined,
    planEndDate: milestone.endAt || undefined
  })
}

function adapterFromConfig(config, write = false) {
  if (config.adapter) return config.adapter
  return createAssessTaskAdapter({
    session: config.session,
    tools: config.discoveredTools,
    mapping: config.tools,
    projectId: config.projectId || config.project,
    write
  })
}

function normalizeProject(raw) {
  const item = objectFrom(raw)
  return {
    id: numericId(item.id ?? item.projectId),
    name: String(item.name || item.projectName || item.title || ''),
    status: item.status ?? item.state ?? null
  }
}

function normalizeMember(raw) {
  const item = objectFrom(raw)
  return {
    id: numericId(item.userId ?? item.employeeId ?? item.id),
    account: String(item.account || item.login || item.username || ''),
    name: String(item.name || item.realName || item.userName || item.displayName || '')
  }
}

function normalizeSprint(raw) {
  const item = objectFrom(raw)
  return {
    id: numericId(item.id ?? item.sprintId),
    projectId: numberOrNull(item.projectId),
    name: String(item.name || item.sprintName || item.title || ''),
    title: String(item.title || item.sprintName || item.name || ''),
    goal: String(item.goal || item.sprintGoal || ''),
    status: item.status ?? item.state ?? null,
    revision: numberOrNull(item.revision),
    startAt: item.startAt || item.planStartDate || item.startDate || null,
    endAt: item.endAt || item.planEndDate || item.endDate || null,
    ownerId: numberOrNull(item.ownerId)
  }
}

function normalizeTask(raw) {
  const item = objectFrom(raw)
  const id = numericId(item.id ?? item.taskId)
  return {
    id,
    projectId: numberOrNull(item.projectId),
    code: String(item.code || item.taskCode || id),
    title: String(item.title || item.taskName || item.name || ''),
    taskType: numberOrNull(item.taskType),
    ...(item.targetVersionId !== undefined ? { targetVersionId: numberOrNull(item.targetVersionId) } : {}),
    descriptionDoc: String(item.descriptionDoc || ''),
    acceptanceDoc: String(item.acceptanceDoc || ''),
    priority: numberOrNull(item.priority),
    status: item.status ?? item.state ?? null,
    revision: numberOrNull(item.revision),
    sprintId: numberOrNull(item.sprintId ?? item.currentSprintId),
    assigneeId: numberOrNull(item.assigneeId),
    planStartDate: item.planStartDate || null,
    planEndDate: item.planEndDate || null
  }
}

function itemsFrom(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  for (const key of ['items', 'records', 'rows', 'results', 'list', 'data', 'result']) {
    if (value[key] !== undefined) {
      const found = itemsFrom(value[key])
      if (found.length || Array.isArray(value[key])) return found
    }
  }
  return []
}

function objectFrom(value) {
  let item = value
  for (let depth = 0; depth < 5; depth++) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item || {}
    const nested = ['data', 'result', 'item'].find((key) => item[key] && typeof item[key] === 'object' && !Array.isArray(item[key]))
    if (!nested) return item
    item = item[nested]
  }
  return item || {}
}

function optionalId(value, code, message) {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw err.bad(code, message)
  return number
}

function numericId(value) {
  return optionalId(value, 'ASSESS_REMOTE_ID_INVALID', '平台对象 ID 必须是正整数')
}

function numberOrNull(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function strings(value) {
  if (Array.isArray(value)) return value.map(String)
  return value == null || value === '' ? [] : [String(value)]
}

function hasItemArray(value) {
  if (Array.isArray(value)) return true
  if (!value || typeof value !== 'object') return false
  return ['items', 'records', 'rows', 'results', 'list', 'data', 'result'].some((key) => hasItemArray(value[key]))
}

function normalizeVersion(raw) {
  const item = objectFrom(raw)
  return { id: numericId(item.id ?? item.versionId), projectId: numberOrNull(item.projectId),
    name: String(item.versionName || item.name || item.versionNo || item.versionCode || item.id || ''),
    revision: numberOrNull(item.revision), status: item.status ?? item.state ?? null }
}
