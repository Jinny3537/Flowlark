import { err } from '../core/errors.js'
import { c, fmtTime, heading, ok, table } from './ui.js'
import { hub } from './commands.js'

export async function feedback(pos, values) {
  const h = hub()
  const sub = pos[0] || 'list'

  if (sub === 'list' || sub === 'ls') {
    const items = h.listFeedbackDrafts()
    if (values.json) return console.log(JSON.stringify(items, null, 2))
    console.log(heading('反馈草稿'))
    if (!items.length) return console.log(c.dim('  暂无本机反馈草稿'))
    return console.log(table(
      ['编号', '项目', '版本', '标题', '时间'],
      items.map((item) => [item.id.slice(0, 8), item.project, item.version, item.title, fmtTime(item.createdAt)])
    ))
  }

  const id = pos[1]
  if (!id) throw err.bad('FEEDBACK_ID_REQUIRED', `feedback ${sub} 需要草稿编号`)
  if (sub === 'export') return console.log(h.feedbackMarkdown(id))
  if (sub === 'submit') {
    const result = await h.submitFeedback(id, { provider: values.provider })
    if (values.json) return console.log(JSON.stringify(result, null, 2))
    if (result.fallback) console.log(result.markdown)
    else ok(`已创建 ${result.provider} Issue：${result.url}`)
    return
  }
  if (sub === 'rm' || sub === 'remove') {
    h.removeFeedbackDraft(id)
    return ok('反馈草稿已删除')
  }
  throw err.bad('FEEDBACK_SUBCOMMAND_INVALID', `未知 feedback 子命令：${sub}`, '可用：list / export / submit / rm')
}
