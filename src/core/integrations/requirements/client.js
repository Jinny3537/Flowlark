import { err } from '../../errors.js'

export function normalizeRequirement(provider, item) {
  const code = String(item.code || item.key || item.id || item.number || '').trim()
  if (!code) throw err.bad('REQUIREMENT_REMOTE_INVALID', '外部需求缺少编号')
  return {
    provider,
    code,
    title: String(item.title || item.name || item.summary || code),
    description: String(item.description || item.body || ''),
    project: String(item.project || item.projectKey || item.projectName || item.space || ''),
    module: String(item.module || item.component || item.componentName || item.category || ''),
    type: String(item.type || item.issueType || item.requirementType || ''),
    priority: String(item.priority || item.severity || item.level || ''),
    owner: String(item.owner || item.assignee || item.assigneeName || ''),
    status: String(item.status || item.state || ''),
    url: String(item.url || item.web_url || item.html_url || ''),
    raw: item
  }
}
