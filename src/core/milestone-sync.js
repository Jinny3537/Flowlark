import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PhError, err } from './errors.js'
import { hashProjection } from './milestone-sync-plan.js'
import { transitionMilestoneStatus } from './milestone-lifecycle.js'
import { appendSyncAudit } from './sync-audit.js'
import {
  newMilestoneSyncJournal,
  readMilestoneSyncJournal,
  writeMilestoneSyncJournal
} from './milestone-sync-journal.js'
import * as milestones from './milestones.js'
import * as requirements from './requirements.js'

export async function executeMilestoneSync(options = {}) {
  if (options.lockHeld) return executeMilestoneSyncUnlocked(options)
  return withMilestoneSyncLock(options.root, options.milestoneName, () => executeMilestoneSyncUnlocked(options))
}

export function withMilestoneSyncLock(root, milestoneName, fn) {
  const release = acquireExecutionLock(root, milestoneName)
  try {
    const result = fn()
    if (result && typeof result.then === 'function') return Promise.resolve(result).finally(release)
    release()
    return result
  } catch (error) {
    release()
    throw error
  }
}

async function executeMilestoneSyncUnlocked({
  root,
  milestoneName,
  plan,
  confirmed = false,
  reason = '',
  confirmUnfinished = false,
  adapter,
  now = new Date(),
  actor = 'milestone-sync',
  assertCurrentSource = () => {},
  resume = false
} = {}) {
  if (!confirmed) throw err.bad('MCP_SYNC_CONFIRMATION_REQUIRED', '请先确认同步计划')
  if (!plan || plan.milestone !== milestoneName) throw err.bad('MCP_SYNC_PLAN_INVALID', '同步计划与迭代不匹配')
  if (!resume && new Date(plan.expiresAt).getTime() <= new Date(now).getTime()) throw err.conflict('MCP_SYNC_PLAN_EXPIRED', '同步计划已过期，请重新生成')
  if ((plan.blockers || []).length) throw err.conflict('MCP_SYNC_BLOCKED', `同步计划仍有 ${plan.blockers.length} 个阻塞项`)
  if ((plan.operations || []).some((operation) => operation.risk === 'high') && !String(reason || '').trim()) {
    throw err.bad('MCP_SYNC_REASON_REQUIRED', '高风险同步操作必须填写原因')
  }
  const requiresImpactConfirmation = (plan.operations || []).some((operation) =>
    ['sprint.start', 'sprint.end', 'sprint.cancel', 'local.scope-change'].includes(operation.kind) ||
    (operation.kind === 'task.move' && operation.risk === 'high'))
  if (requiresImpactConfirmation && !confirmUnfinished) {
    throw err.bad('MCP_SYNC_IMPACT_CONFIRMATION_REQUIRED', '请确认未完成任务和范围变化的影响')
  }
  if (!adapter) throw err.bad('MCP_SYNC_ADAPTER_REQUIRED', '同步适配器不可用')

  let journal = readMilestoneSyncJournal(root, milestoneName)
  if (journal && journal.planHash !== plan.hash && journal.status === 'running') {
    throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
  }
  if (!journal || journal.planHash !== plan.hash) journal = newMilestoneSyncJournal(plan, reason)
  if (journal.status === 'completed') {
    const item = milestones.readMilestone(root, milestoneName)
    if ((plan.operations || []).some((operation) => operation.kind === 'milestone.freeze')) {
      if (item.status !== 'frozen' || item.external?.scopeHash !== plan.sourceHash) {
        await verifyFinalState(root, plan, adapter)
        assertCurrentSource()
        milestones.markMilestoneFrozen(root, milestoneName, { scopeHash: plan.sourceHash, verifiedAt: new Date(now).toISOString() })
      }
    } else {
      const target = plannedLocalStatus(plan)
      if (target && item.status !== target) {
        await verifyFinalState(root, plan, adapter)
        assertCurrentSource()
        finalizeLocalStatus(root, milestoneName, plan, { actor, at: new Date(now).toISOString() })
      }
    }
    return journal
  }
  const unresolvedCreate = journal.operations.find((step) =>
    ['sprint.create', 'task.create'].includes(step.kind) &&
    (step.status === 'executing' || (step.status === 'paused' && step.error?.code === 'MCP_SYNC_LINK_REQUIRED')))
  if (unresolvedCreate) {
    const causeCode = unresolvedCreate.error?.causeCode || 'PROCESS_INTERRUPTED'
    if (unresolvedCreate.status === 'executing') {
      const failure = createLinkFailure(unresolvedCreate.kind, causeCode)
      unresolvedCreate.status = 'paused'
      unresolvedCreate.error = failure
      unresolvedCreate.updatedAt = new Date().toISOString()
      journal.status = 'paused'
      journal.error = failure
      journal.updatedAt = unresolvedCreate.updatedAt
      persistAuditTransition(root, milestoneName, journal, {
        action: 'step.paused',
        status: 'paused',
        operationKey: unresolvedCreate.key,
        before: unresolvedCreate.operation.before ?? null,
        after: null,
        error: failure
      })
    }
    throw linkRequiredError(unresolvedCreate.kind, causeCode)
  }
  journal.status = 'running'
  journal.reason = String(reason || journal.reason || '')
  journal.error = null
  journal.startedAt ||= new Date().toISOString()
  journal.updatedAt = new Date().toISOString()
  persistAuditTransition(root, milestoneName, journal, {
    action: 'sync.running',
    status: 'running'
  })

  for (const step of journal.operations) {
    if (step.status === 'remote-complete') {
      if (['sprint.create', 'task.create'].includes(step.kind) && !positiveId(step.remoteResult?.id)) {
        const failure = createLinkFailure(step.kind, 'REMOTE_ID_MISSING')
        step.status = 'paused'
        step.error = failure
        step.updatedAt = new Date().toISOString()
        journal.status = 'paused'
        journal.error = failure
        journal.updatedAt = step.updatedAt
        persistAuditTransition(root, milestoneName, journal, {
          action: 'step.paused',
          status: 'paused',
          operationKey: step.key,
          before: step.operation.before ?? null,
          after: step.remoteResult ?? null,
          error: failure
        })
        throw linkRequiredError(step.kind, failure.causeCode)
      }
      try {
        await persistOperationResult({
          root, milestoneName, plan, operation: step.operation, result: step.remoteResult, adapter
        })
        step.status = 'completed'
        step.error = null
        step.updatedAt = new Date().toISOString()
        journal.updatedAt = step.updatedAt
        persistAuditTransition(root, milestoneName, journal, {
          action: 'step.completed',
          status: 'completed',
          operationKey: step.key,
          before: step.operation.before ?? null,
          after: step.remoteResult ?? null
        })
        continue
      } catch (error) {
        if (error?.code === 'SYNC_AUDIT_WRITE_FAILED') throw error
        step.status = 'failed'
        step.error = { code: error?.code || 'MCP_SYNC_STEP_FAILED', message: String(error?.message || error) }
        step.updatedAt = new Date().toISOString()
        journal.status = 'failed'
        journal.error = step.error
        journal.updatedAt = step.updatedAt
        persistAuditTransition(root, milestoneName, journal, {
          action: 'step.failed',
          status: 'failed',
          operationKey: step.key,
          before: step.operation.before ?? null,
          after: step.remoteResult ?? null,
          error: step.error
        })
        throw error
      }
    }
    if (step.status === 'completed') {
      if (await verifyCompletedStep(root, plan, step, adapter)) continue
      step.status = 'pending'
    }
    step.status = 'executing'
    step.error = null
    step.updatedAt = new Date().toISOString()
    journal.updatedAt = step.updatedAt
    persistAuditTransition(root, milestoneName, journal, {
      action: 'step.executing',
      status: 'executing',
      operationKey: step.key,
      before: step.operation.before ?? null,
      after: step.operation.after ?? null
    })

    try {
      const result = await runOperation({
        root, milestoneName, plan, operation: step.operation, reason, confirmUnfinished, adapter,
        assertCurrentSource
      })
      step.status = 'remote-complete'
      step.remoteResult = safeRemoteResult(result)
      step.updatedAt = new Date().toISOString()
      journal.updatedAt = step.updatedAt
      writeMilestoneSyncJournal(root, milestoneName, journal)

      await persistOperationResult({ root, milestoneName, plan, operation: step.operation, result, adapter })
      step.status = 'completed'
      step.updatedAt = new Date().toISOString()
      journal.updatedAt = step.updatedAt
      persistAuditTransition(root, milestoneName, journal, {
        action: 'step.completed',
        status: 'completed',
        operationKey: step.key,
        before: step.operation.before ?? null,
        after: step.operation.after ?? step.remoteResult ?? null
      })
    } catch (error) {
      if (error?.code === 'SYNC_AUDIT_WRITE_FAILED') throw error
      if (['sprint.create', 'task.create'].includes(step.kind) && isUnknownCreateResult(error)) {
        const failure = createLinkFailure(step.kind, error.code)
        step.status = 'paused'
        step.error = failure
        step.updatedAt = new Date().toISOString()
        journal.status = 'paused'
        journal.error = failure
        journal.updatedAt = step.updatedAt
        persistAuditTransition(root, milestoneName, journal, {
          action: 'step.paused',
          status: 'paused',
          operationKey: step.key,
          before: step.operation.before ?? null,
          after: step.remoteResult ?? null,
          error: failure
        })
        throw linkRequiredError(step.kind, error.code)
      }
      step.status = 'failed'
      step.error = { code: error?.code || 'MCP_SYNC_STEP_FAILED', message: String(error?.message || error) }
      step.updatedAt = new Date().toISOString()
      journal.status = 'failed'
      journal.error = step.error
      journal.updatedAt = step.updatedAt
      persistAuditTransition(root, milestoneName, journal, {
        action: 'step.failed',
        status: 'failed',
        operationKey: step.key,
        before: step.operation.before ?? null,
        after: step.remoteResult ?? null,
        error: step.error
      })
      throw error
    }
  }

  try {
    if (!(plan.operations || []).some((operation) => operation.kind === 'milestone.freeze')) {
      await verifyFinalState(root, plan, adapter)
      assertCurrentSource()
      finalizeLocalStatus(root, milestoneName, plan, { actor, at: new Date(now).toISOString() })
    }
  } catch (error) {
    journal.status = 'failed'
    journal.error = { code: error?.code || 'MCP_SYNC_VERIFICATION_FAILED', message: String(error?.message || error) }
    journal.updatedAt = new Date().toISOString()
    persistAuditTransition(root, milestoneName, journal, {
      action: 'sync.failed', status: 'failed', error: journal.error
    })
    throw error
  }
  journal.status = 'completed'
  journal.error = null
  journal.completedAt = new Date().toISOString()
  journal.updatedAt = journal.completedAt
  return persistAuditTransition(root, milestoneName, journal, {
    action: 'sync.completed',
    status: 'completed'
  })
}

export async function resumeMilestoneSync(options = {}) {
  const journal = readMilestoneSyncJournal(options.root, options.milestoneName)
  if (!journal) throw err.notFound(`迭代「${options.milestoneName}」的同步记录`)
  const plan = options.plan || journal.plan
  if (!plan || plan.hash !== journal.planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
  return executeMilestoneSync({ ...options, plan, confirmed: true, reason: options.reason || journal.reason, resume: true })
}

export function getLinkableCreateStep(record, operationKey) {
  if (record?.entityType !== 'milestone') {
    throw err.bad('SYNC_ENTITY_UNSUPPORTED', `不支持的同步对象类型：${record?.entityType || 'unknown'}`)
  }
  if (record.status !== 'paused') {
    throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 关联远端结果`)
  }
  const key = String(operationKey || '').trim()
  const matches = (record.operations || []).filter((step) => step.key === key)
  if (matches.length !== 1) {
    throw new PhError('MCP_SYNC_LINK_OPERATION_NOT_FOUND', `同步步骤「${key || '（空）'}」不存在`, { status: 404 })
  }
  const step = matches[0]
  if (!['sprint.create', 'task.create'].includes(step.kind) ||
      step.status !== 'paused' || step.error?.code !== 'MCP_SYNC_LINK_REQUIRED') {
    throw err.conflict('MCP_SYNC_LINK_NOT_REQUIRED', '该同步步骤不需要关联远端创建结果')
  }
  return step
}

export function hasLinkedCreateResult(record) {
  return (record?.operations || []).some((step) =>
    ['sprint.create', 'task.create'].includes(step.kind) &&
    step.status === 'remote-complete' &&
    positiveId(step.remoteResult?.id))
}

export async function linkMilestoneCreateResult({
  root,
  milestoneName,
  operationKey,
  remoteId,
  remote,
  reason,
  now = new Date(),
  lockHeld = false
} = {}) {
  if (!lockHeld) {
    const journal = readMilestoneSyncJournal(root, milestoneName)
    if (!journal) throw err.notFound(`迭代「${milestoneName}」的同步记录`)
    const step = getLinkableCreateStep(journal, operationKey)
    const bindingLock = step.kind === 'task.create' ? 'binding:external-tasks' : 'binding:external-sprints'
    return withMilestoneSyncLock(root, bindingLock, () =>
      withMilestoneSyncLock(root, milestoneName, () => linkMilestoneCreateResult({
        root, milestoneName, operationKey, remoteId, remote, reason, now, lockHeld: true
      })))
  }
  const journal = readMilestoneSyncJournal(root, milestoneName)
  if (!journal) throw err.notFound(`迭代「${milestoneName}」的同步记录`)
  if (!journal.plan || journal.plan.hash !== journal.planHash) {
    throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
  }
  const linkReason = String(reason || '').trim()
  if (!linkReason) throw err.bad('MCP_SYNC_REASON_REQUIRED', '关联远端创建结果必须填写原因')
  const step = getLinkableCreateStep(journal, operationKey)
  const result = validateLinkedCreateResult(root, journal.plan, step, remoteId, remote)
  assertLinkBindingAvailable(root, milestoneName, journal.plan, step, result.id)

  const before = {
    status: step.status,
    remoteResult: step.remoteResult ?? null,
    error: step.error ?? null
  }
  // Binding 先落盘；即使随后审计失败，remote-complete 也会阻止 retry 重放 create。
  await persistOperationResult({
    root,
    milestoneName,
    plan: journal.plan,
    operation: step.operation,
    result,
    adapter: null
  })
  const at = new Date(now).toISOString()
  step.status = 'remote-complete'
  step.remoteResult = result
  step.error = null
  step.linkReason = linkReason
  step.updatedAt = at
  journal.status = 'paused'
  journal.error = null
  journal.updatedAt = at
  return persistAuditTransition(root, milestoneName, journal, {
    action: 'step.linked',
    status: 'paused',
    operationKey: step.key,
    before,
    after: {
      status: step.status,
      remoteResult: result,
      reason: step.linkReason
    }
  })
}

async function runOperation({ root, milestoneName, plan, operation, reason, confirmUnfinished, adapter, assertCurrentSource }) {
  if (operation.kind === 'sprint.create') return adapter.saveSprint(operation.after)
  if (operation.kind === 'sprint.update') {
    const binding = requiredSprintBinding(root, milestoneName)
    const current = await adapter.getSprint(binding.sprintId)
    return adapter.saveSprint({
      ...sprintUpdateBase(current),
      ...operation.after,
      id: binding.sprintId,
      revision: current.revision
    })
  }
  if (operation.kind === 'task.create') {
    const sprint = requiredSprintBinding(root, milestoneName)
    return adapter.createTask({ ...operation.after, currentSprintId: sprint.sprintId })
  }
  if (operation.kind === 'task.update') {
    const binding = requiredTaskBinding(root, operation.requirement, plan)
    const current = await adapter.getTask(binding.taskId)
    return adapter.updateTask({
      ...taskUpdateBase(current),
      ...operation.after,
      id: binding.taskId,
      revision: current.revision
    })
  }
  if (operation.kind === 'task.move') {
    const current = await adapter.getTask(operation.taskId)
    const target = operation.after.sprintId === '$sprint'
      ? requiredSprintBinding(root, milestoneName).sprintId
      : operation.after.sprintId
    await adapter.moveTasks({
      reason: String(reason || '调整迭代范围'),
      tasks: [{ taskId: operation.taskId, taskRevision: current.revision }],
      toSprintId: target
    })
    return adapter.getTask(operation.taskId)
  }
  if (['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind)) {
    const binding = requiredSprintBinding(root, milestoneName)
    const current = await adapter.getSprint(binding.sprintId)
    const body = {
      sprintId: binding.sprintId,
      revision: current.revision,
      reason: String(reason || ''),
      confirmUnfinished: Boolean(confirmUnfinished)
    }
    if (operation.kind === 'sprint.start') await adapter.startSprint(body)
    if (operation.kind === 'sprint.end') await adapter.endSprint(body)
    if (operation.kind === 'sprint.cancel') await adapter.cancelSprint(body)
    return adapter.getSprint(binding.sprintId)
  }
  if (operation.kind === 'milestone.freeze') {
    await verifyFinalState(root, plan, adapter)
    assertCurrentSource()
    return milestones.markMilestoneFrozen(root, milestoneName, {
      scopeHash: plan.sourceHash,
      verifiedAt: new Date().toISOString()
    })
  }
  if (operation.kind === 'local.scope-change') return { local: true, entity: 'scope' }
  if (operation.kind === 'conflict') throw err.conflict('MCP_SYNC_CONFLICT', '同步计划包含未解决冲突')
  throw err.bad('MCP_SYNC_OPERATION_INVALID', `不支持的同步操作：${operation.kind}`)
}

function sprintUpdateBase(current = {}) {
  const { raw, ...normalized } = current
  return raw && typeof raw === 'object' ? { ...raw } : normalized
}

function taskUpdateBase(current = {}) {
  const { raw, ...normalized } = current
  return raw && typeof raw === 'object' ? { ...raw } : normalized
}

async function persistOperationResult({ root, milestoneName, plan, operation, result, adapter }) {
  if (operation.kind.startsWith('sprint.')) {
    persistSprint(root, milestoneName, plan, operation, result)
    return
  }
  if (operation.kind === 'task.create' || operation.kind === 'task.update') {
    persistTask(root, operation.requirement, plan, operation, result)
    return
  }
  if (operation.kind === 'task.move') {
    const current = result?.id ? result : await adapter.getTask(operation.taskId)
    const requirement = operation.requirement
    const existing = requiredTaskBinding(root, requirement, plan)
    persistTask(root, requirement, plan, { contentHash: existing.lastSyncHash }, current)
  }
}

function persistSprint(root, milestoneName, plan, operation, result = {}) {
  const item = milestones.readMilestone(root, milestoneName)
  const previous = item.external || {}
  const sprintId = positiveId(result.id ?? result.sprintId ?? previous.sprintId)
  if (!sprintId) throw err.bad('MCP_SYNC_REMOTE_ID_MISSING', '平台冲刺返回缺少 ID')
  milestones.updateMilestone(root, milestoneName, {
    external: {
      ...previous,
      provider: 'assess-task',
      server: plan.server,
      projectId: plan.projectId,
      sprintId,
      revision: result.revision ?? previous.revision ?? null,
      remoteStatus: result.status ?? previous.remoteStatus ?? null,
      url: result.url || previous.url || '',
      lastSyncHash: operation.contentHash || previous.lastSyncHash || '',
      syncedAt: new Date().toISOString()
    }
  }, { system: true })
}

function persistTask(root, code, plan, operation, result = {}) {
  const taskId = positiveId(result.id ?? result.taskId)
  if (!taskId) throw err.bad('MCP_SYNC_REMOTE_ID_MISSING', `需求 ${code} 的平台任务返回缺少 ID`)
  requirements.upsertExternalTask(root, code, {
    provider: 'assess-task',
    server: plan.server,
    projectId: plan.projectId,
    taskId,
    revision: result.revision ?? null,
    remoteStatus: result.status ?? null,
    url: result.url || '',
    lastSyncHash: operation.contentHash || '',
    syncedAt: new Date().toISOString()
  })
}

async function verifyCompletedStep(root, plan, step, adapter) {
  try {
    if (step.kind === 'sprint.create' || step.kind === 'sprint.update') {
      const binding = requiredSprintBinding(root, plan.milestone)
      return Boolean(await adapter.getSprint(binding.sprintId))
    }
    if (['task.create', 'task.update', 'task.move'].includes(step.kind)) {
      const binding = requiredTaskBinding(root, step.operation.requirement, plan)
      return Boolean(await adapter.getTask(binding.taskId))
    }
    return true
  } catch {
    return false
  }
}

async function verifyFinalState(root, plan, adapter) {
  const binding = requiredSprintBinding(root, plan.milestone)
  const remoteSprint = await adapter.getSprint(binding.sprintId)
  if (!remoteSprint) throw err.conflict('MCP_SYNC_READBACK_MISSING', '平台 Sprint 回读结果为空')
  if (Number(remoteSprint.id) !== Number(binding.sprintId) || Number(remoteSprint.projectId) !== Number(plan.projectId)) {
    throw err.conflict('MCP_SYNC_READBACK_MISMATCH', '平台 Sprint 回读对象不属于计划目标')
  }
  const expectedSprint = plan.verification?.sprint
  const strict = (plan.operations || []).some((operation) => operation.kind === 'milestone.freeze')
  if (strict && expectedSprint?.contentHash && hashProjection(remoteSprint, 'sprint', plan.managedFields) !== expectedSprint.contentHash) {
    throw err.conflict('MCP_SYNC_READBACK_MISMATCH', '平台 Sprint 回读结果与同步计划不一致')
  }
  const lifecycle = (plan.operations || []).find((operation) =>
    ['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind))
  if (lifecycle) {
    const before = lifecycle.before || {}
    const unchangedStatus = before.status == null
      ? remoteSprint.status == null
      : String(remoteSprint.status) === String(before.status)
    const beforeRevision = Number(before.revision)
    const remoteRevision = Number(remoteSprint.revision)
    const revisionRegressed = Number.isFinite(beforeRevision) &&
      (!Number.isFinite(remoteRevision) || remoteRevision < beforeRevision)
    if (unchangedStatus || revisionRegressed) {
      throw err.conflict('MCP_SYNC_READBACK_MISMATCH', '平台 Sprint 状态流转未通过回读验证')
    }
  }
  const expectedTasks = plan.verification?.tasks || []
  for (const expected of expectedTasks) {
    const taskBinding = requiredTaskBinding(root, expected.requirement, plan)
    const remoteTask = await adapter.getTask(taskBinding.taskId)
    if (!remoteTask || Number(remoteTask.id) !== Number(taskBinding.taskId) ||
        (expected.taskId && Number(remoteTask.id) !== Number(expected.taskId)) || Number(remoteTask.projectId) !== Number(plan.projectId) ||
        (strict && hashProjection(remoteTask, 'task', plan.managedFields) !== expected.contentHash)) {
      throw err.conflict('MCP_SYNC_READBACK_MISMATCH', `需求 ${expected.requirement} 的平台任务回读结果不一致`)
    }
    const expectedTaskSprint = expected.sprintId === '$sprint' ? binding.sprintId : expected.sprintId
    if (expectedTaskSprint && Number(remoteTask.sprintId) !== Number(expectedTaskSprint)) {
      throw err.conflict('MCP_SYNC_SCOPE_MISMATCH', `需求 ${expected.requirement} 的平台任务不在目标 Sprint 中`)
    }
  }
}

function finalizeLocalStatus(root, milestoneName, plan, { actor = 'milestone-sync', at = new Date().toISOString() } = {}) {
  if (Array.isArray(plan.scopeItems)) {
    milestones.updateMilestone(root, milestoneName, { items: plan.scopeItems }, { system: true })
  }
  const target = plannedLocalStatus(plan)
  if (!target) return
  const item = milestones.readMilestone(root, milestoneName)
  const transition = transitionMilestoneStatus(item.status, target, { remoteExists: true })
  if (transition.changed) milestones.updateMilestone(root, milestoneName, { status: target }, { system: true })
  if (target === 'active') {
    for (const code of new Set(item.items.map((entry) => entry.requirement))) {
      const requirement = requirements.readRequirement(root, code)
      if (requirement.status !== 'confirmed') continue
      requirements.updateRequirementLifecycle(root, code, 'developing', {
        system: true,
        actor,
        now: at,
        reason: `Sprint ${milestoneName} 已验证启动`
      })
    }
  }
}

function plannedLocalStatus(plan) {
  return { start: 'active', end: 'delivered', cancel: 'canceled' }[
    (plan.operations || []).find((operation) =>
      ['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind))?.kind.split('.')[1]
  ] || null
}

function requiredSprintBinding(root, milestoneName) {
  const binding = milestones.readMilestone(root, milestoneName).external
  if (!positiveId(binding?.sprintId)) throw err.bad('MCP_SYNC_SPRINT_BINDING_MISSING', '迭代缺少平台冲刺绑定')
  return binding
}

function requiredTaskBinding(root, code, plan) {
  const item = requirements.readRequirement(root, code)
  const binding = (item.externalTasks || []).find((entry) =>
    entry.provider === 'assess-task' && entry.server === plan.server && Number(entry.projectId) === Number(plan.projectId))
  if (!positiveId(binding?.taskId)) throw err.bad('MCP_SYNC_TASK_BINDING_MISSING', `需求 ${code} 缺少平台任务绑定`)
  return binding
}

function validateLinkedCreateResult(root, plan, step, remoteId, remote) {
  const id = positiveId(remoteId)
  if (!id) throw err.bad('MCP_SYNC_LINK_REMOTE_ID_INVALID', '远端对象 ID 必须是正整数')
  if (!remote) {
    throw new PhError('MCP_SYNC_LINK_RESULT_NOT_FOUND', `远端对象 ${id} 不存在`, { status: 404 })
  }
  const result = safeRemoteResult(remote)
  if (result.id !== id) throw err.conflict('MCP_SYNC_LINK_ID_MISMATCH', '读取到的远端对象 ID 与请求不一致')
  if (Number(remote.projectId) !== Number(plan.projectId)) {
    throw err.conflict('MCP_SYNC_LINK_PROJECT_MISMATCH', `远端对象 ${id} 不属于项目 ${plan.projectId}`)
  }
  const entity = step.kind === 'sprint.create' ? 'sprint' : 'task'
  if (!step.operation?.contentHash ||
      hashProjection(remote, entity, plan.managedFields) !== step.operation.contentHash) {
    throw err.conflict('MCP_SYNC_LINK_IDENTITY_MISMATCH', '远端对象与待创建对象的托管字段不一致')
  }
  if (entity === 'task') {
    if (Number(remote.taskType) !== Number(step.operation.after?.taskType)) {
      throw err.conflict('MCP_SYNC_LINK_IDENTITY_MISMATCH', '远端任务类型与待创建任务不一致')
    }
    const sprintId = requiredSprintBinding(root, plan.milestone).sprintId
    if (Number(remote.sprintId) !== Number(sprintId)) {
      throw err.conflict('MCP_SYNC_LINK_SPRINT_MISMATCH', `远端任务 ${id} 不属于当前冲刺 ${sprintId}`)
    }
  }
  return result
}

function assertLinkBindingAvailable(root, milestoneName, plan, step, remoteId) {
  if (step.kind === 'sprint.create') {
    const current = milestones.readMilestone(root, milestoneName).external
    if (current?.sprintId && Number(current.sprintId) !== remoteId) {
      throw err.conflict('EXTERNAL_SPRINT_CAS_MISMATCH', `迭代 ${milestoneName} 的平台 Sprint 绑定已变化`)
    }
    milestones.assertExternalSprintAvailable(root, milestoneName, {
      server: plan.server,
      projectId: plan.projectId,
      sprintId: remoteId
    })
    return
  }
  const code = step.operation?.requirement
  const current = requirements.readRequirement(root, code).externalTasks.find((binding) =>
    binding.provider === 'assess-task' &&
    binding.server === plan.server &&
    Number(binding.projectId) === Number(plan.projectId))
  if (current?.taskId && Number(current.taskId) !== remoteId) {
    throw err.conflict('EXTERNAL_TASK_CAS_MISMATCH', `需求 ${code} 的平台任务绑定已变化`)
  }
  requirements.assertExternalTaskAvailable(root, code, {
    provider: 'assess-task',
    server: plan.server,
    projectId: plan.projectId,
    taskId: remoteId
  })
}

function positiveId(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function safeRemoteResult(value = {}) {
  return {
    id: positiveId(value.id ?? value.sprintId ?? value.taskId),
    revision: value.revision ?? null,
    status: value.status ?? null,
    url: value.url || ''
  }
}

function isUnknownCreateResult(error) {
  return new Set([
    'MCP_UNAVAILABLE', 'MCP_TIMEOUT', 'MCP_PROTOCOL_ERROR', 'NETWORK', 'ETIMEDOUT', 'ECONNRESET',
    'ECONNABORTED', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
  ]).has(String(error?.code || '').toUpperCase())
}

function createLinkFailure(kind, causeCode) {
  return {
    code: 'MCP_SYNC_LINK_REQUIRED',
    causeCode: String(causeCode || 'UNKNOWN'),
    message: `${kind === 'sprint.create' ? '冲刺' : '任务'}创建结果不明确，请先关联远端对象`
  }
}

function linkRequiredError(kind, causeCode) {
  const failure = createLinkFailure(kind, causeCode)
  const error = err.conflict(failure.code, failure.message)
  error.causeCode = failure.causeCode
  return error
}

function persistAuditTransition(root, milestoneName, journal, audit) {
  const persisted = writeMilestoneSyncJournal(root, milestoneName, journal)
  journal.id = persisted.id
  try {
    appendSyncAudit(root, {
      syncId: persisted.id,
      entityType: 'milestone',
      entityKey: milestoneName,
      ...audit
    })
  } catch {
    const failure = {
      code: 'SYNC_AUDIT_WRITE_FAILED',
      message: '同步审计写入失败，已暂停同步'
    }
    journal.status = 'paused'
    journal.error = failure
    journal.updatedAt = new Date().toISOString()
    writeMilestoneSyncJournal(root, milestoneName, journal)
    throw err.conflict(failure.code, failure.message)
  }
  return persisted
}

function acquireExecutionLock(root, milestoneName) {
  const parent = path.join(String(root || ''), '.flowlark', 'cache', 'sync-locks')
  const key = crypto.createHash('sha256').update(`milestone:${String(milestoneName || '')}`).digest('hex')
  const lock = path.join(parent, key)
  const token = crypto.randomUUID()
  fs.mkdirSync(parent, { recursive: true })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lock)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (attempt === 0 && reclaimOrphanedLock(lock)) continue
      throw err.conflict('MCP_SYNC_EXECUTION_CONFLICT', `迭代「${milestoneName}」已有同步正在执行`)
    }
    try {
      fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), 'utf8')
      return () => releaseExecutionLock(lock, token)
    } catch (error) {
      fs.rmSync(lock, { recursive: true, force: true })
      throw error
    }
  }
  throw err.conflict('MCP_SYNC_EXECUTION_CONFLICT', `迭代「${milestoneName}」已有同步正在执行`)
}

function reclaimOrphanedLock(lock) {
  let owner = null
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'))
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs < 30_000) return false
    } catch {
      return true
    }
  }
  if (owner?.pid && processIsAlive(owner.pid)) return false
  const stale = `${lock}.stale.${crypto.randomUUID()}`
  try {
    fs.renameSync(lock, stale)
  } catch (error) {
    return error?.code === 'ENOENT'
  }
  fs.rmSync(stale, { recursive: true, force: true })
  return true
}

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function releaseExecutionLock(lock, token) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'))
    if (owner.token === token) fs.rmSync(lock, { recursive: true, force: true })
  } catch {
    // 只有仍由本次调用持有时才释放；丢失或已被回收的锁不触碰。
  }
}
