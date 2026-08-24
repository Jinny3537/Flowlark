function parseObjectJson(text, label) {
  if (!String(text || '').trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key).trim(), String(item)]).filter(([key]) => key))
}

export function parseHeaders(text) {
  return parseObjectJson(text, '请求头')
}

export function serverForm(server = {}) {
  return {
    id: server.id || '', name: server.name || '', type: server.type || 'http', enabled: server.enabled !== false,
    url: server.url || '', timeoutMs: Number(server.timeoutMs || 10000),
    headersText: JSON.stringify(server.headers || { Authorization: 'Bearer ${secret}' }, null, 2)
  }
}

export function serverPayload(form) {
  return {
    name: form.name.trim(), type: form.type || 'http', enabled: form.enabled !== false,
    url: form.url.trim(), timeoutMs: Number(form.timeoutMs || 10000), headers: parseHeaders(form.headersText)
  }
}

export function capabilityPayload(form) {
  const tools = parseObjectJson(form.toolsText, '工具映射')
  return {
    enabled: Boolean(form.enabled), server: form.server || '', label: form.label.trim(),
    category: form.category.trim(), description: form.description.trim(), project: form.project.trim(), tools
  }
}
