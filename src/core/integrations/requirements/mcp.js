import { normalizeRequirement } from './client.js'
import { callTool, toolName } from '../mcp-jsonrpc.js'
import { err } from '../../errors.js'
import { requirementDetailFields } from '../../requirement-fields.js'

function isHubpool(config) {
  return config.capability?.options?.protocol === 'hubpool'
}

function normalizeRemote(config, item) {
  if (!isHubpool(config)) return normalizeRequirement('mcp', item)
  return normalizeRequirement('mcp', {
    ...item,
    ...requirementDetailFields(item, { defaults: true }),
    description: item.businessDescription || item.rawDescription || '',
    project: item.projectName || item.projectId || config.project || '',
    sourceUpdatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : ''
  })
}

function itemsFrom(body) {
  if (Array.isArray(body)) return body
  return (body && (body.items || body.data || body.results || body.requirements)) || []
}

function identityFrom(body) {
  if (!body || typeof body !== 'object') return null
  return body.identity || body.name || body.login || body.email || body.text || null
}

export async function testConnection(config) {
  const name = toolName(config, 'mePath', 'requirements.test')
  const body = await callTool(config, name, isHubpool(config) ? {} : { project: config.project || '' })
  if (isHubpool(config)) {
    const project = itemsFrom(body).find((item) => item.id === config.project)
    if (!project) throw err.bad('REQUIREMENT_PROJECT_INVALID', 'HubPooL 中未找到绑定项目，请检查项目 ID')
    return { provider: 'mcp', ok: true, identity: `HubPooL · ${project.name}` }
  }
  return { provider: 'mcp', ok: true, identity: identityFrom(body) }
}

export async function searchRequirements(config, text) {
  const name = toolName(config, 'searchPath', 'requirements.search')
  const body = await callTool(config, name, isHubpool(config) ? {
    projectId: config.project,
    keyword: text || '',
    limit: config.limit || 20
  } : {
    query: text || '',
    q: text || '',
    text: text || '',
    project: config.project || '',
    limit: config.limit || 20
  })
  return itemsFrom(body).map((item) => normalizeRemote(config, item))
}

export async function fetchRequirement(config, key) {
  const name = toolName(config, 'detailPath', 'requirements.get')
  const body = await callTool(config, name, isHubpool(config)
    ? { requirementId: key }
    : { key, code: key, project: config.project || '' })
  if (isHubpool(config)) {
    const [projects, versions] = await Promise.all([
      callTool(config, 'list_projects', {}),
      body.versionId ? callTool(config, 'list_versions', { projectId: body.projectId || config.project }) : []
    ])
    return normalizeRemote(config, {
      ...body,
      projectName: itemsFrom(projects).find((project) => project.id === body.projectId)?.name,
      versionName: itemsFrom(versions).find((version) => version.id === body.versionId)?.name || ''
    })
  }
  return normalizeRemote(config, body)
}

export async function postComment(config, key, body) {
  if (isHubpool(config)) throw err.bad('REQUIREMENT_COMMENT_UNSUPPORTED', 'HubPooL 协议不支持直接回写评论，请在需求池中处理修改提案')
  const name = toolName(config, 'commentPath', 'requirements.comment')
  const result = await callTool(config, name, {
    key,
    code: key,
    body,
    content: body,
    project: config.project || ''
  })
  return { provider: 'mcp', ok: true, url: result && (result.url || result.web_url || result.html_url) || null }
}
