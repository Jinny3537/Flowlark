import { err } from './errors.js'
import * as store from './store.js'
import * as milestones from './milestones.js'

const running = new Set()
const now = () => new Date().toISOString()

export function onlineScope(root, slug, versionNo, binding) {
  if (!binding?.server || !Number.isSafeInteger(binding.projectId) || binding.projectId <= 0 ||
      !Number.isSafeInteger(binding.versionId) || binding.versionId <= 0) {
    throw err.bad('ONLINE_BINDING_REQUIRED', '请先关联任务平台版本')
  }
  const all = milestones.listMilestones(root)
  const linked = all.filter((m) => m.items.some((item) => item.project === slug && item.version === versionNo))
  if (!linked.length) throw err.bad('ONLINE_SPRINT_REQUIRED', '当前版本没有关联迭代，请先在迭代中关联此版本')
  for (const m of linked) {
    const b = m.external
    if (!b?.sprintId || b.provider !== 'assess-task' || b.server !== binding.server || Number(b.projectId) !== binding.projectId) {
      throw err.conflict('ONLINE_SPRINT_BINDING_INVALID', `迭代 ${m.name} 未关联同一任务平台项目的冲刺`)
    }
    const shared = all.filter((other) => other.external?.server === b.server &&
      Number(other.external?.projectId) === binding.projectId && Number(other.external?.sprintId) === Number(b.sprintId))
    if (shared.some((other) => other.items.some((item) => item.project !== slug || item.version !== versionNo))) {
      throw err.conflict('ONLINE_SHARED_SPRINT', `冲刺 ${b.sprintId} 包含其他版本，请先在迭代中拆分范围，不能随当前版本自动结束`)
    }
    if (!['active', 'delivered', 'archived'].includes(m.status)) {
      throw err.conflict('ONLINE_SPRINT_STATUS_INVALID', `迭代 ${m.name} 尚未开始或已取消，不能自动结束`)
    }
  }
  return [...new Set(linked.map((m) => Number(m.external.sprintId)))].sort((a, b) => a - b)
}

function save(root, slug, versionNo, patch) {
  const version = store.readVersion(root, slug, versionNo)
  Object.assign(version, patch, { updatedAt: now() })
  store.writeVersion(root, slug, version)
  return version
}

export function bindOnlineVersion(root, slug, versionNo, binding) {
  const version = store.readVersion(root, slug, versionNo)
  if (version.status === 'VOID') throw err.conflict('VERSION_VOID', '已废弃版本不能关联上线同步')
  if (version.onlineSync && (version.onlineSync.status !== 'failed' || version.onlineSync.operations.some((step) => step.attemptedAt || step.completedAt))) {
    throw err.conflict('ONLINE_BINDING_LOCKED', '已执行平台操作，不能更换关联对象')
  }
  return save(root, slug, versionNo, { releaseBinding: binding, onlineSync: null })
}

export async function markVersionOnline({ root, slug, versionNo, actor, withAdapter }) {
  const key = `${root}\0${slug}\0${versionNo}`
  if (running.has(key)) throw err.conflict('ONLINE_SYNC_RUNNING', '该版本正在同步，请稍后刷新')
  running.add(key)
  try {
    let version = store.readVersion(root, slug, versionNo)
    if (version.status === 'VOID') throw err.conflict('VERSION_VOID', '已废弃版本不能标记上线')
    const binding = version.releaseBinding
    const sprintIds = onlineScope(root, slug, versionNo, binding)
    let journal = version.onlineSync
    if (journal?.status === 'completed') return version
    const scopeKey = JSON.stringify({ binding, sprintIds })
    if (journal && journal.scopeKey !== scopeKey) throw err.conflict('ONLINE_SCOPE_CHANGED', '上线同步范围已变化，请恢复原有关联后重试')
    journal ||= { scopeKey, status: 'pending', startedAt: now(), actor, operations: [
      ...sprintIds.map((id) => ({ kind: 'sprint.end', id, status: 'pending' })),
      { kind: 'version.close', id: binding.versionId, status: 'pending' }
    ] }
    // The business fact remains true even if the external platform is unavailable.
    save(root, slug, versionNo, { deliveryStatus: 'online', onlineAt: version.onlineAt || now(), onlineSync: journal })
    try {
      await withAdapter(async (adapter, config) => {
        if (config.server?.id !== binding.server || Number(config.project) !== binding.projectId) {
          throw err.conflict('ONLINE_PLATFORM_CHANGED', '任务平台配置与已保存的版本关联不一致')
        }
        const options = config.capability?.options?.releaseClosure || {}
        for (const name of ['sprintEndedStatuses', 'versionClosedStatuses', 'taskCompletedStatuses']) {
          if (!Array.isArray(options[name]) || !options[name].length || options[name].some((value) => !['string', 'number'].includes(typeof value))) {
            throw err.bad('ONLINE_STATUS_MAPPING_REQUIRED', `请在 MCP 迭代设置中配置 releaseClosure.${name}，使用平台实际状态值`)
          }
        }
        const read = async (step) => {
          const item = step.kind === 'sprint.end' ? await adapter.getSprint(step.id) : await adapter.getVersion(step.id)
          if (Number(item?.id) !== step.id || Number(item?.projectId) !== binding.projectId || item?.status == null || item?.revision == null) {
            throw err.conflict('ONLINE_REMOTE_INVALID', `平台对象 ${step.id} 缺少有效的标识、项目、状态或修订号`)
          }
          return item
        }
        const complete = (step, item) => (step.kind === 'sprint.end' ? options.sprintEndedStatuses : options.versionClosedStatuses)
          .some((status) => String(status) === String(item.status))
        // Check access to every object before performing the first external write.
        for (const step of journal.operations) await read(step)
        for (const sprintId of sprintIds) {
          const step = journal.operations.find((item) => item.kind === 'sprint.end' && item.id === sprintId)
          if (complete(step, await read(step))) continue
          // Read every page; never assume the first 500 tasks are the entire sprint.
          for (let pageNum = 1; ; pageNum++) {
            if (pageNum > 100) throw err.conflict('ONLINE_TASK_LIMIT', '冲刺任务数量过多，请先在平台核实并结束冲刺')
            const tasks = await adapter.listTasks({ sprintId, pageNum, pageSize: 500 })
            if (!Array.isArray(tasks)) throw err.conflict('ONLINE_TASKS_INVALID', '无法核实冲刺任务状态')
            if (tasks.some((task) => !options.taskCompletedStatuses.some((status) => String(status) === String(task.status)))) {
              throw err.conflict('ONLINE_UNFINISHED_TASKS', `冲刺 ${sprintId} 有未完成任务，请先在任务平台处理后重试`)
            }
            if (tasks.length < 500) break
          }
        }
        journal.status = 'running'
        journal.error = null
        save(root, slug, versionNo, { onlineSync: journal })
        for (const step of journal.operations) {
          const current = await read(step)
          if (step.status === 'completed' && !complete(step, current)) {
            throw err.conflict('ONLINE_REMOTE_CHANGED', `已完成的平台对象 ${step.id} 状态发生变化，请先核实平台状态`)
          }
          if (!complete(step, current)) {
            step.status = 'running'
            step.attemptedAt = now()
            save(root, slug, versionNo, { onlineSync: journal })
            const body = { revision: current.revision, reason: `Flowlark ${slug}/${versionNo} 已上线`, confirmUnfinished: false }
            if (step.kind === 'sprint.end') await adapter.endSprint({ ...body, sprintId: step.id })
            else await adapter.closeVersion({ ...body, versionId: step.id })
            if (!complete(step, await read(step))) throw err.conflict('ONLINE_REMOTE_NOT_COMPLETE', `平台对象 ${step.id} 尚未进入完成状态，可稍后重试核对`)
          }
          step.status = 'completed'
          step.completedAt ||= now()
          save(root, slug, versionNo, { onlineSync: journal })
          if (step.kind === 'sprint.end') {
            for (const m of milestones.listMilestones(root).filter((item) =>
              item.external?.server === binding.server && Number(item.external.projectId) === binding.projectId && Number(item.external.sprintId) === step.id)) {
              if (m.status === 'active') milestones.updateMilestone(root, m.name, { status: 'delivered' }, { system: true })
            }
          }
        }
        journal.status = 'completed'
        journal.completedAt = now()
      })
    } catch (error) {
      journal.status = 'failed'
      journal.error = { code: error.code || 'ONLINE_SYNC_FAILED', message: error.message || '同步失败' }
      const step = journal.operations.find((item) => item.status === 'running')
      if (step) step.status = 'failed'
    }
    journal.updatedAt = now()
    return save(root, slug, versionNo, { onlineSync: journal })
  } finally {
    running.delete(key)
  }
}
