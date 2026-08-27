import { err } from '../core/errors.js'
import { c, heading, ok, table } from './ui.js'
import { hub } from './commands.js'

export async function milestone(pos, values) {
  const h = hub()
  const sub = pos[0] || 'list'
  if (sub === 'list' || sub === 'ls') {
    const items = h.listMilestones()
    if (values.json) return console.log(JSON.stringify(items, null, 2))
    console.log(heading('迭代'))
    return console.log(table(['标识', '标题', '阶段', '版本', '风险'], items.map((item) => [c.cyan(item.name), item.title, item.status, String(item.items.length), String(item.warnings.length)])))
  }
  if (sub === 'show') {
    const item = h.getMilestone(pos[1])
    return console.log(values.json ? JSON.stringify(item, null, 2) : `${c.bold(item.name)} ${item.title}\n版本：${item.items.length} · 风险：${item.warnings.length}`)
  }
  if (sub === 'new') {
    const name = pos[1]
    if (!name) throw err.bad('MILESTONE_NAME_REQUIRED', '请提供迭代标识')
    const item = h.createMilestone({ name, title: values.title || name, startAt: values.start, endAt: values.end, items: [] })
    return ok(`已创建迭代 ${item.name}`)
  }
  if (sub === 'add') {
    const [name, requirement, project, version] = pos.slice(1)
    const item = h.getMilestone(name)
    h.updateMilestone(name, { items: [...item.items.map(({ requirement, project, version }) => ({ requirement, project, version })), { requirement, project, version }] })
    return ok(`已加入 ${requirement} → ${project}/${version}`)
  }
  if (sub === 'preflight') {
    const result = h.inspectMilestonePreflight(pos[1])
    if (values.json) return console.log(JSON.stringify(result, null, 2))
    console.log(result.ready ? c.green('冻结检查通过') : c.yellow(`冻结检查：${result.blockers.length} 项阻塞`))
    for (const blocker of result.blockers) console.log(`  - ${blocker.message}`)
    return
  }
  if (sub === 'plan') {
    const result = await h.planMilestoneSync(pos[1], { action: values.action || null })
    if (values.json) return console.log(JSON.stringify(result, null, 2))
    console.log(heading(`同步计划 ${result.hash}`))
    console.log(table(['操作', '对象', '风险'], result.operations.map((item) => [item.kind, item.requirement || item.taskId || item.sprintId || result.milestone, item.risk])))
    if (result.blockers.length) console.log(c.red(`${result.blockers.length} 项阻塞，不能执行`))
    return
  }
  if (sub === 'sync') {
    if (!values.confirm) throw err.bad('MCP_SYNC_CONFIRMATION_REQUIRED', '执行同步必须显式传入 --confirm')
    const result = await h.executeMilestoneSync(pos[1], {
      planHash: values['plan-hash'],
      action: values.action || null,
      confirmed: true,
      reason: values.reason || '',
      confirmUnfinished: values.unfinished === true
    })
    return values.json ? console.log(JSON.stringify(result, null, 2)) : ok(`迭代 ${pos[1]} 同步完成`)
  }
  if (sub === 'resume') {
    const result = await h.resumeMilestoneSync(pos[1], { reason: values.reason || '', confirmUnfinished: values.unfinished === true })
    return values.json ? console.log(JSON.stringify(result, null, 2)) : ok(`迭代 ${pos[1]} 同步已恢复`)
  }
  if (sub === 'transition') {
    const target = pos[2]
    if (!target) throw err.bad('MILESTONE_STATUS_REQUIRED', '请提供目标状态')
    if (target === 'canceled' && !values.confirm) throw err.bad('MILESTONE_CONFIRMATION_REQUIRED', '取消迭代必须显式传入 --confirm')
    const result = h.transitionMilestone(pos[1], { target, reason: values.reason || '' })
    return values.json ? console.log(JSON.stringify(result, null, 2)) : ok(`迭代 ${pos[1]} 已进入 ${result.status}`)
  }
  if (sub === 'rm') {
    h.removeMilestone(pos[1])
    return ok(`已删除迭代 ${pos[1]}`)
  }
  throw err.bad('MILESTONE_SUBCOMMAND_INVALID', `未知 milestone 子命令：${sub}`)
}
