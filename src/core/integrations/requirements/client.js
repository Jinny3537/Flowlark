import { err } from '../../errors.js'
import { cleanBaseUrl, fetchJson, query, requireToken } from '../issues/client.js'

export { cleanBaseUrl, fetchJson, query, requireToken }

export function headerToken(config, envKey) {
  const token = requireToken(config, envKey)
  return config.tokenHeader
    ? { [String(config.tokenHeader)]: token }
    : { Authorization: `Bearer ${token}` }
}

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

export function endpoint(base, template, params = {}) {
  let path = String(template || '')
  for (const [key, value] of Object.entries(params)) {
    path = path.replaceAll(`{${key}}`, encodeURIComponent(String(value)))
  }
  return `${base}${path.startsWith('/') ? path : '/' + path}`
}
