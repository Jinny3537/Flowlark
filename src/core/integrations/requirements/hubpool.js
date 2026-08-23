import { cleanBaseUrl, endpoint, fetchJson, headerToken, normalizeRequirement, query } from './client.js'

function base(config) {
  return cleanBaseUrl(config.baseUrl, 'https://api.hubpool.io')
}

function headers(config) {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...headerToken(config, 'FLOWLARK_HUBPOOL_TOKEN') }
}

function project(config) {
  return config.project || config.projectId || config.space || ''
}

export async function testConnection(config) {
  const body = await fetchJson(endpoint(base(config), config.mePath || '/v1/me'), { headers: headers(config) })
  return { provider: 'hubpool', ok: true, identity: body.name || body.login || body.email || null }
}

export async function searchRequirements(config, text) {
  const q = query({ q: text || '', project: project(config), limit: config.limit || 20 })
  const body = await fetchJson(endpoint(base(config), config.searchPath || `/v1/requirements/search?${q}`, { q: text || '', project: project(config) }), { headers: headers(config) })
  const items = Array.isArray(body) ? body : (body.items || body.data || body.results || [])
  return items.map((item) => normalizeRequirement('hubpool', item))
}

export async function fetchRequirement(config, key) {
  const body = await fetchJson(endpoint(base(config), config.detailPath || '/v1/requirements/{key}', { key }), { headers: headers(config) })
  return normalizeRequirement('hubpool', body)
}

export async function postComment(config, key, body) {
  const result = await fetchJson(endpoint(base(config), config.commentPath || '/v1/requirements/{key}/comments', { key }), {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ body, content: body })
  })
  return { provider: 'hubpool', ok: true, url: result.url || result.web_url || null }
}
