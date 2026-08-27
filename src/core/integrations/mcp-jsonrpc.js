import { err } from '../errors.js'

let rpcId = 0

function endpoint(config) {
  let url
  try { url = new URL(config.baseUrl || '') } catch { throw err.bad('INTEGRATION_URL_INVALID', 'MCP 地址不合法') }
  if (!['http:', 'https:'].includes(url.protocol)) throw err.bad('INTEGRATION_URL_INVALID', 'MCP 地址必须是 HTTP 或 HTTPS')
  return url.toString().replace(/\/$/, '')
}

function tokenHeaders(config) {
  if (config.headers && typeof config.headers === 'object') return config.headers
  const token = String(config.token || process.env.FLOWLARK_REQUIREMENT_MCP_TOKEN || '').trim()
  if (!token) return {}
  return config.tokenHeader
    ? { [String(config.tokenHeader)]: token }
    : { Authorization: `Bearer ${token}` }
}

export function toolName(config, key, fallback) {
  return String(config[key] || '').trim() || fallback
}

export async function callTool(config, name, args = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/call',
    params: { name, arguments: args }
  }

  let response
  try {
    response = await fetch(endpoint(config), {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...tokenHeaders(config)
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(config.timeoutMs || 10000))
    })
  } catch (e) {
    const code = e && e.name === 'TimeoutError' ? 'INTEGRATION_TIMEOUT' : 'INTEGRATION_UNAVAILABLE'
    throw err.bad(code, code === 'INTEGRATION_TIMEOUT' ? 'MCP 服务响应超时' : '无法连接 MCP 服务')
  }

  const text = await response.text()
  const body = parseResponseText(text)
  if (!response.ok) {
    const detail = body && (body.message || body.error_description || body.error)
    throw err.bad('INTEGRATION_REJECTED', `MCP 服务拒绝请求（HTTP ${response.status}）${detail ? `：${detail}` : ''}`)
  }
  if (body && body.error) {
    const detail = body.error.message || body.error.code || '工具调用失败'
    throw err.bad('INTEGRATION_REJECTED', `MCP 工具调用失败：${detail}`)
  }
  return unwrapToolResult(body && body.result !== undefined ? body.result : body)
}

function parseResponseText(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:') || /(^|\n)data:/.test(trimmed)) {
    const line = trimmed.split(/\r?\n/).find((item) => item.startsWith('data:') && item.slice(5).trim() !== '[DONE]')
    return line ? JSON.parse(line.slice(5).trim()) : null
  }
  return JSON.parse(trimmed)
}

function unwrapToolResult(value) {
  if (!value || typeof value !== 'object') return value
  if (value.structuredContent !== undefined) return value.structuredContent
  if (value.content && Array.isArray(value.content)) {
    const json = value.content.find((item) => item && item.type === 'text' && looksJson(item.text))
    if (json) return JSON.parse(json.text)
    const text = value.content.find((item) => item && item.type === 'text')
    if (text) return { text: text.text }
  }
  return value
}

function looksJson(value) {
  const text = String(value || '').trim()
  return text.startsWith('{') || text.startsWith('[')
}
