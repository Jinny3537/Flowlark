function parseObjectJson(text, label) {
  if (!String(text || '').trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key).trim(), String(item)]).filter(([key]) => key))
}

function parseJsonObject(text, label) {
  if (!String(text || '').trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`)
  return value
}

export function parseHeaders(text) {
  return parseObjectJson(text, '请求头')
}

export function serverForm(server = {}) {
  return {
    id: server.id || '', name: server.name || '', type: server.type || 'http', enabled: server.enabled !== false,
    adapter: server.adapter || 'assess-task', runtimeProfile: server.runtimeProfile || server.id || '',
    url: server.url || '', timeoutMs: Number(server.timeoutMs || 10000),
    headersText: JSON.stringify(server.headers || { Authorization: 'Bearer ${secret}' }, null, 2)
  }
}

export function serverPayload(form) {
  if (form.type === 'stdio') {
    return {
      name: form.name.trim(), type: 'stdio', enabled: form.enabled !== false,
      adapter: form.adapter.trim(), runtimeProfile: form.runtimeProfile.trim(),
      timeoutMs: Number(form.timeoutMs || 10000)
    }
  }
  return {
    name: form.name.trim(), type: form.type || 'http', enabled: form.enabled !== false,
    url: form.url.trim(), timeoutMs: Number(form.timeoutMs || 10000), headers: parseHeaders(form.headersText)
  }
}

export function capabilityPayload(form) {
  const tools = parseObjectJson(form.toolsText, '工具映射')
  return {
    enabled: Boolean(form.enabled), server: form.server || '', label: form.label.trim(),
    category: form.category.trim(), description: form.description.trim(), project: form.project.trim(),
    options: parseJsonObject(form.optionsText, '能力选项'), tools
  }
}

export function runtimeDiagnosticStatus(value = {}) {
  const blockers = Array.isArray(value.blockers) ? value.blockers : []
  const warnings = Array.isArray(value.warnings) ? value.warnings : []
  if (blockers.length) {
    return { tone: 'error', label: '检查未通过', messages: blockers.map((item) => item.message || String(item)) }
  }
  if (warnings.length) {
    return { tone: 'warning', label: '可运行，但有警告', messages: warnings.map((item) => item.message || String(item)) }
  }
  return { tone: value.ready ? 'success' : 'info', label: value.ready ? '检查通过' : '尚未检查', messages: [] }
}
