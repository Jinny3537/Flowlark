const READONLY_MESSAGES = {
  READONLY_FROM_LAN: '这是别人共享出来的只读视图，只能查看不能修改',
  GIT_READONLY: '当前 Git 身份没有远端写权限，Flowlark 已进入只读模式'
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', hint = '', payload = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.hint = hint
    this.payload = payload
  }
}

export function parsePayload(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

export function errorFromResponse(status, payload) {
  const code = payload && typeof payload === 'object' && payload.code
    ? String(payload.code)
    : `HTTP_${status}`
  const hint = payload && typeof payload === 'object' && payload.hint ? String(payload.hint) : ''
  const base = READONLY_MESSAGES[code]
    || (payload && typeof payload === 'object' && payload.message ? String(payload.message) : '')
    || (typeof payload === 'string' && payload.trim() ? payload.trim() : '请求失败')
  return new ApiError(hint && !READONLY_MESSAGES[code] ? `${base}（${hint}）` : base, {
    status, code, hint, payload
  })
}

export function errorText(error, fallback = '请求失败') {
  return error instanceof Error && error.message ? error.message : fallback
}
