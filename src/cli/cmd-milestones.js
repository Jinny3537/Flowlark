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
    return console.log(table(['标识', '标题', '版本', '风险'], items.map((item) => [c.cyan(item.name), item.title, String(item.items.length), String(item.warnings.length)])))
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
  if (sub === 'rm') {
    h.removeMilestone(pos[1])
    return ok(`已删除迭代 ${pos[1]}`)
  }
  throw err.bad('MILESTONE_SUBCOMMAND_INVALID', `未知 milestone 子命令：${sub}`)
}
