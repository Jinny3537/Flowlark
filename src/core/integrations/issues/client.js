import { err } from '../../errors.js'

export function cleanBaseUrl(value, fallback) {
  let url
  try { url = new URL(value || fallback) } catch { throw err.bad('INTEGRATION_URL_INVALID', 'Issue 平台地址不合法') }
  if (!['http:', 'https:'].includes(url.protocol)) throw err.bad('INTEGRATION_URL_INVALID', 'Issue 平台地址必须是 HTTP 或 HTTPS')
  return url.toString().replace(/\/$/, '')
}

export async function fetchJson(url, options = {}) {
  let response
  try {
    response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(10000) })
  } catch (e) {
    const code = e && e.name === 'TimeoutError' ? 'INTEGRATION_TIMEOUT' : 'INTEGRATION_UNAVAILABLE'
    throw err.bad(code, code === 'INTEGRATION_TIMEOUT' ? 'Issue 平台响应超时' : '无法连接 Issue 平台')
  }

  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!response.ok) {
    const detail = body && (body.message || body.error_description || body.error)
    throw err.bad('INTEGRATION_REJECTED', `Issue 平台拒绝请求（HTTP ${response.status}）${detail ? `：${detail}` : ''}`)
  }
  return body
}

export function requireToken(config, envKey) {
  const token = String(config.token || process.env[envKey] || '').trim()
  if (!token) throw err.bad('INTEGRATION_TOKEN_MISSING', '尚未配置 Issue 平台 Token')
  return token
}

export function query(params) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') q.set(key, String(value))
  }
  return q.toString()
}
