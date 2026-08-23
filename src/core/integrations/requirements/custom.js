import { cleanBaseUrl, endpoint, fetchJson, headerToken, normalizeRequirement, query } from './client.js'

function base(config) {
  return cleanBaseUrl(config.baseUrl, '')
}

function headers(config) {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...headerToken(config, 'FLOWLARK_CUSTOM_TASK_TOKEN') }
}

export async function testConnection(config) {
  const body = await fetchJson(endpoint(base(config), config.mePath || '/me'), { headers: headers(config) })
  return { provider: 'custom', ok: true, identity: body.name || body.login || body.email || null }
}

export async function searchRequirements(config, text) {
  const defaultPath = `/requirements/search?${query({ q: text || '', project: config.project || '', limit: config.limit || 20 })}`
  const body = await fetchJson(endpoint(base(config), config.searchPath || defaultPath, { q: text || '', project: config.project || '' }), { headers: headers(config) })
  const items = Array.isArray(body) ? body : (body.items || body.data || body.results || [])
  return items.map((item) => normalizeRequirement('custom', item))
}

export async function fetchRequirement(config, key) {
  const body = await fetchJson(endpoint(base(config), config.detailPath || '/requirements/{key}', { key }), { headers: headers(config) })
  return normalizeRequirement('custom', body)
}

export async function postComment(config, key, body) {
  const result = await fetchJson(endpoint(base(config), config.commentPath || '/requirements/{key}/comments', { key }), {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ body, content: body })
  })
  return { provider: 'custom', ok: true, url: result.url || result.web_url || null }
}
