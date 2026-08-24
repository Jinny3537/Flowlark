import { err } from '../../errors.js'
import { callTool, toolName } from '../mcp-jsonrpc.js'

function itemsFrom(body) {
  if (Array.isArray(body)) return body
  return (body && (body.items || body.data || body.results || body.milestones || body.iterations || body.sprints)) || []
}

function identityFrom(body) {
  if (!body || typeof body !== 'object') return null
  return body.identity || body.name || body.login || body.email || body.text || null
}

export function normalizeMilestone(provider, item) {
  const name = String(item.name || item.key || item.id || item.code || item.sprintId || '').trim()
  if (!name) throw err.bad('MILESTONE_REMOTE_INVALID', '外部迭代缺少标识')
  return {
    provider,
    name,
    title: String(item.title || item.name || item.summary || name).trim() || name,
    startAt: item.startAt || item.start_at || item.startDate || item.start_date || null,
    endAt: item.endAt || item.end_at || item.endDate || item.end_date || null,
    status: String(item.status || item.state || ''),
    url: String(item.url || item.web_url || item.html_url || ''),
    raw: item
  }
}

export async function testConnection(config) {
  const name = toolName(config, 'mePath', 'milestones.test')
  const body = await callTool(config, name, { project: config.project || '' })
  return { provider: 'mcp', ok: true, identity: identityFrom(body) }
}

export async function listMilestones(config) {
  const name = toolName(config, 'listPath', 'milestones.list')
  const body = await callTool(config, name, {
    project: config.project || '',
    limit: config.limit || 50
  })
  return itemsFrom(body).map((item) => normalizeMilestone('mcp', item))
}

export async function fetchMilestone(config, key) {
  const name = toolName(config, 'detailPath', 'milestones.get')
  const body = await callTool(config, name, { key, name: key, project: config.project || '' })
  return normalizeMilestone('mcp', body)
}

export async function upsertMilestone(config, milestone) {
  const name = toolName(config, 'upsertPath', 'milestones.upsert')
  const result = await callTool(config, name, {
    project: config.project || '',
    milestone,
    iteration: milestone,
    name: milestone.name,
    key: milestone.external?.key || milestone.name,
    title: milestone.title,
    startAt: milestone.startAt,
    endAt: milestone.endAt,
    items: (milestone.items || []).map(({ requirement, project, version }) => ({ requirement, project, version }))
  })
  return normalizeMilestone('mcp', result && typeof result === 'object' ? { ...milestone, ...result } : milestone)
}
