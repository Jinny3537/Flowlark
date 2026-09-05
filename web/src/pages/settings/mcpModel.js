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

export function parseRequirementPoolManifestText(text) {
  const source = String(text || '').trim()
  if (!source) throw new Error('请先粘贴需求池配置 JSON')
  const value = JSON.parse(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需求池配置必须是 JSON 对象')
  return value
}

export const REQUIREMENT_POOL_MANIFEST_MAX_BYTES = 256 * 1024

export function validateRequirementPoolManifestFile(file = {}) {
  const name = String(file.name || '').trim()
  const type = String(file.type || '').trim().toLowerCase()
  const size = Number(file.size || 0)
  if (size > REQUIREMENT_POOL_MANIFEST_MAX_BYTES) throw new Error('需求池配置 JSON 文件不能超过 256KB')
  if (!name.toLowerCase().endsWith('.json') && !type.includes('json')) throw new Error('请选择 JSON 配置文件')
  return true
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
