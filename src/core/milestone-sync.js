import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
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
    finalizeLocalStatus(root, milestoneName, plan)
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
        root, milestoneName, plan, operation: step.operation, reason, confirmUnfinished, adapter
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

  await verifyFinalState(root, plan, adapter)
  finalizeLocalStatus(root, milestoneName, plan)
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

async function runOperation({ root, milestoneName, plan, operation, reason, confirmUnfinished, adapter }) {
  if (operation.kind === 'sprint.create') return adapter.saveSprint(operation.after)
  if (operation.kind === 'sprint.update') {
    const binding = requiredSprintBinding(root, milestoneName)
    const current = await adapter.getSprint(binding.sprintId)
    return adapter.saveSprint({ ...operation.after, id: binding.sprintId, revision: current.revision })
  }
  if (operation.kind === 'task.create') {
    const sprint = requiredSprintBinding(root, milestoneName)
    return adapter.createTask({ ...operation.after, currentSprintId: sprint.sprintId })
  }
  if (operation.kind === 'task.update') {
    const binding = requiredTaskBinding(root, operation.requirement, plan)
    const current = await adapter.getTask(binding.taskId)
    return adapter.updateTask({ ...operation.after, id: binding.taskId, revision: current.revision })
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
  if (operation.kind === 'local.accept-remote') {
    if (operation.entity === 'sprint') {
      const current = milestones.readMilestone(root, milestoneName)
      milestones.updateMilestone(root, milestoneName, {
        ...operation.localPatch,
        external: {
          ...current.external,
          lastSyncHash: operation.contentHash,
          syncedAt: new Date().toISOString()
        }
      }, { system: true })
      return { local: true, entity: 'sprint' }
    }
    if (operation.entity === 'task') {
      requirements.updateRequirement(root, operation.requirement, operation.localPatch || {})
      const binding = requiredTaskBinding(root, operation.requirement, plan)
      requirements.upsertExternalTask(root, operation.requirement, {
        ...binding,
        lastSyncHash: operation.contentHash,
        syncedAt: new Date().toISOString()
      })
      return { local: true, entity: 'task' }
    }
    throw err.bad('MCP_SYNC_OPERATION_INVALID', '接受平台值缺少对象类型')
  }
  if (operation.kind === 'local.scope-change') return { local: true, entity: 'scope' }
  if (operation.kind === 'conflict') throw err.conflict('MCP_SYNC_CONFLICT', '同步计划包含未解决冲突')
  throw err.bad('MCP_SYNC_OPERATION_INVALID', `不支持的同步操作：${operation.kind}`)
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
  const sprint = requiredSprintBinding(root, plan.milestone)
  await adapter.getSprint(sprint.sprintId)
  const codes = [...new Set(plan.operations.map((operation) => operation.requirement).filter(Boolean))]
  for (const code of codes) {
    const binding = requiredTaskBinding(root, code, plan)
    await adapter.getTask(binding.taskId)
  }
}

function finalizeLocalStatus(root, milestoneName, plan) {
  if (Array.isArray(plan.scopeItems)) {
    milestones.updateMilestone(root, milestoneName, { items: plan.scopeItems }, { system: true })
  }
  const target = { start: 'active', end: 'delivered', cancel: 'canceled' }[
    plan.operations.find((operation) => operation.kind.startsWith('sprint.') && ['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind))?.kind.split('.')[1]
  ]
  if (!target) return
  const item = milestones.readMilestone(root, milestoneName)
  const transition = transitionMilestoneStatus(item.status, target, { remoteExists: true })
  if (transition.changed) milestones.updateMilestone(root, milestoneName, { status: target }, { system: true })
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
