import { err } from './errors.js'
import * as store from './store.js'
import * as requirements from './requirements.js'

export const MILESTONE_STATUSES = new Set([
  'planning', 'reviewing', 'frozen', 'active', 'delivered', 'archived', 'canceled'
])

const TERMINAL = new Set(['archived', 'canceled'])
const TRANSITIONS = {
  planning: new Set(['reviewing', 'canceled']),
  reviewing: new Set(['planning', 'frozen', 'canceled']),
  frozen: new Set(['reviewing', 'active', 'canceled']),
  active: new Set(['delivered', 'canceled']),
  delivered: new Set(['archived']),
  archived: new Set(),
  canceled: new Set()
}

export function normalizeMilestoneStatus(value) {
  const status = String(value || 'planning').trim().toLowerCase()
  if (!MILESTONE_STATUSES.has(status)) throw err.bad('MILESTONE_STATUS_INVALID', `迭代状态「${status}」不合法`)
  return status
}

export function transitionMilestoneStatus(current, target, { remoteExists = false, verifiedFreeze = false } = {}) {
  const from = normalizeMilestoneStatus(current)
  const to = normalizeMilestoneStatus(target)
  if (from === to) return { from, to, changed: false, highRisk: false, requiresRemote: false }
  if (TERMINAL.has(from)) throw err.conflict('MILESTONE_TERMINAL', `迭代已处于终态 ${from}`)
  if (from === 'reviewing' && to === 'frozen' && !verifiedFreeze) {
    throw err.conflict('MILESTONE_FREEZE_REQUIRES_SYNC_PLAN', '冻结迭代必须生成并执行已验证的同步计划')
  }
  if (!TRANSITIONS[from].has(to)) throw err.conflict('MILESTONE_TRANSITION_INVALID', `迭代不能从 ${from} 转为 ${to}`)
  const highRisk = ['active', 'delivered', 'canceled'].includes(to)
  return { from, to, changed: true, highRisk, requiresRemote: highRisk && remoteExists }
}

export function freezePreflight(root, milestone, {
  integrationProblems = [],
  syncContext = null,
  currentSourceHash = '',
  verifiedSourceHash = ''
} = {}) {
  const blockers = []
  const warnings = []
  const versionsByRequirementProject = new Map()
  const requirementCodes = new Set()

  if (!(milestone.items || []).length) {
    blockers.push({
      code: 'MILESTONE_SCOPE_EMPTY',
      message: '迭代至少需要包含一个需求版本',
      repairTo: `/milestones/${encodeURIComponent(milestone.name)}`
    })
  }
  if (milestone.status !== 'reviewing') {
    blockers.push({
      code: 'MILESTONE_FREEZE_STATUS_INVALID',
      message: '只有评审中的迭代可以冻结',
      repairTo: `/milestones/${encodeURIComponent(milestone.name)}`
    })
  }

  for (const warning of milestone.warnings || []) {
    blockers.push({ ...warning, repairTo: versionRoute(warning.project, warning.version) })
  }
  for (const entry of milestone.items || []) {
    requirementCodes.add(entry.requirement)
    const version = store.readVersion(root, entry.project, entry.version)
    const repairTo = versionRoute(entry.project, entry.version)
    if (version.reviewStatus !== 'confirmed') {
      blockers.push({ code: 'REVIEW_NOT_CONFIRMED', ...scope(entry), message: `${entry.project}/${entry.version} 尚未确认`, repairTo })
    }
    if (!store.readSpec(root, entry.project, entry.version).trim()) {
      blockers.push({ code: 'SPEC_MISSING', ...scope(entry), message: `${entry.project}/${entry.version} 缺少规格书`, repairTo })
    }
    if (!(version.changes || []).length && store.listVersionNos(root, entry.project).length > 1) {
      blockers.push({ code: 'CHANGELOG_MISSING', ...scope(entry), message: `${entry.project}/${entry.version} 缺少变更说明`, repairTo })
    }
    const key = `${entry.requirement}:${entry.project}`
    if (!versionsByRequirementProject.has(key)) versionsByRequirementProject.set(key, new Set())
    versionsByRequirementProject.get(key).add(entry.version)
  }
  for (const code of requirementCodes) {
    const requirement = requirements.readRequirement(root, code)
    const repairTo = `/requirements/${encodeURIComponent(code)}`
    if (requirement.status !== 'confirmed') {
      blockers.push({ code: 'REQUIREMENT_NOT_CONFIRMED', requirement: code, message: `${code} 尚未确认`, repairTo })
    }
    if (!requirements.readRequirementSpec(root, code).trim()) {
      blockers.push({ code: 'REQUIREMENT_SPEC_REQUIRED', requirement: code, message: `${code} 缺少规格书`, repairTo })
    }
    if (syncContext?.ready) {
      const binding = (requirement.externalTasks || []).find((item) =>
        item.provider === 'assess-task' && item.server === syncContext.server &&
        Number(item.projectId) === Number(syncContext.projectId))
      if (!binding?.taskId) {
        blockers.push({ code: 'REQUIREMENT_TASK_BINDING_REQUIRED', requirement: code, message: `${code} 尚未绑定平台任务`, repairTo })
      }
    }
  }
  if (syncContext?.ready && !milestone.external?.sprintId) {
    blockers.push({
      code: 'MILESTONE_SPRINT_BINDING_REQUIRED',
      message: '冻结前必须先绑定平台 Sprint',
      repairTo: `/milestones/${encodeURIComponent(milestone.name)}`
    })
  }
  for (const [key, versions] of versionsByRequirementProject) {
    if (versions.size < 2) continue
    const [requirement, project] = key.split(':')
    blockers.push({
      code: 'REQUIREMENT_VERSION_CONFLICT', requirement, project,
      message: `${requirement} 在 ${project} 中关联了多个版本：${[...versions].join('、')}`,
      repairTo: `/milestones/${encodeURIComponent(milestone.name)}`
    })
  }
  for (const problem of integrationProblems || []) {
    blockers.push({
      code: problem.code || 'MCP_CONFIGURATION_INVALID',
      message: problem.message || String(problem),
      repairTo: problem.repairTo || '/settings/mcp'
    })
  }
  if (currentSourceHash && verifiedSourceHash !== currentSourceHash) {
    blockers.push({
      code: 'MILESTONE_SYNC_REQUIRED',
      message: '当前迭代内容尚未完成匹配版本的平台同步',
      repairTo: '/sync'
    })
  }
  return { ready: blockers.length === 0, blockers, warnings }
}

function scope(entry) {
  return { requirement: entry.requirement, project: entry.project, version: entry.version }
}

function versionRoute(project, version) {
  return `/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(version)}`
}
