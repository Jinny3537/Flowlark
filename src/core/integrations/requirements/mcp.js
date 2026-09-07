import { normalizeRequirement } from './client.js'
import { callTool, toolName } from '../mcp-jsonrpc.js'

function itemsFrom(body) {
  if (Array.isArray(body)) return body
  return (body && (body.items || body.data || body.results || body.requirements)) || []
}

function detailFrom(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  return body.requirement || body.item || body.data || body.result || body
}

function identityFrom(body) {
  if (!body || typeof body !== 'object') return null
  return body.identity || body.name || body.login || body.email || body.text || null
}

export async function testConnection(config) {
  const name = toolName(config, 'mePath', 'requirements.test')
  const project = config.project || ''
  const body = await callTool(config, name, {
    project,
    projectId: project,
    limit: 1
  })
  return { provider: 'mcp', ok: true, identity: identityFrom(body) }
}

export async function searchRequirements(config, text) {
  const name = toolName(config, 'searchPath', 'requirements.search')
  const query = text || ''
  const project = config.project || ''
  const body = await callTool(config, name, {
    query,
    q: query,
    text: query,
    keyword: query,
    project,
    projectId: project,
    limit: config.limit || 20
  })
  return itemsFrom(body).map((item) => normalizeRequirement('mcp', item))
}

export async function fetchRequirement(config, key) {
  const name = toolName(config, 'detailPath', 'requirements.get')
  const project = config.project || ''
  const body = await callTool(config, name, {
    key,
    code: key,
    id: key,
    requirementId: key,
    project,
    projectId: project
  })
  return normalizeRequirement('mcp', detailFrom(body))
}

export async function postComment(config, key, body) {
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
