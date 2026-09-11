import { err } from '../core/errors.js'
import { c, heading, ok, table } from './ui.js'
import { hub } from './commands.js'

export async function requirement(pos, values) {
  const h = hub()
  const sub = pos[0] || 'list'
  if (sub === 'list' || sub === 'ls' || sub === 'trash' || sub === 'archived') {
    const items = h.listRequirements({ includeDeleted: sub === 'trash' }).filter(item => sub === 'trash' ? item.deletedAt : sub === 'archived' ? item.archivedAt : !item.archivedAt)
    if (values.json) return console.log(JSON.stringify(items, null, 2))
    console.log(heading('需求'))
    return console.log(table(['编号', '标题', '状态', '版本'], items.map((item) => [c.cyan(item.code), item.title, item.derivedStatus, String(item.versions.length)])))
  }
  if (sub === 'show') {
    const item = h.getRequirement(pos[1])
    return console.log(values.json ? JSON.stringify(item, null, 2) : `${c.bold(item.code)} ${item.title}\n${item.description || ''}\n关联版本：${item.versions.length}`)
  }
  if (sub === 'new') {
    const code = pos[1]
    if (!code || !values.title) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '请提供需求编号和 --title')
    const item = h.createRequirement({ code, title: values.title, description: values.desc || '', owner: values.owner || '' })
    return ok(`已创建需求 ${item.code}`)
  }
  if (['archive', 'unarchive', 'delete', 'restore'].includes(sub)) {
    if (!pos[1]) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '请提供需求编号')
    const item = h.requirementLifecycle(pos[1], sub)
    return values.json ? console.log(JSON.stringify(item, null, 2)) : ok(`${sub} ${item.code}`)
  }
  if (sub === 'impact') return console.log(JSON.stringify(h.requirementImpact(pos[1]), null, 2))
  if (sub === 'notes') {
    if (!pos[1] || values.desc === undefined) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '用法：flowlark req notes <编号> --desc "本地分析"')
    h.updateRequirement(pos[1], { localNotes: values.desc })
    return ok('已保存本地分析')
  }
  if (sub === 'sync') {
    const item = await h.syncExternalRequirements(null, {}, { preview: pos[1] !== 'apply' })
    return console.log(JSON.stringify(item, null, 2))
  }
  if (sub === 'link') {
    const [code, project, versionNo] = pos.slice(1)
    if (!code || !project || !versionNo) throw err.bad('REQUIREMENT_LINK_INPUT', '用法：flowlark req link <编号> <项目> <版本>')
    h.linkRequirement(code, project, versionNo, { location: pos[4] || '', scope: values.desc || '' })
    return ok(`已关联 ${code} → ${project}/${versionNo}`)
  }
  if (sub === 'unlink') {
    const [code, project, versionNo] = pos.slice(1)
    h.unlinkRequirement(code, project, versionNo)
    return ok(`已取消关联 ${code} → ${project}/${versionNo}`)
  }
  throw err.bad('REQUIREMENT_SUBCOMMAND_INVALID', `未知 req 子命令：${sub}`)
}
