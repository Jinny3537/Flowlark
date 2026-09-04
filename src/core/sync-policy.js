import { err } from './errors.js'

export const SYNC_MODES = new Set(['manual', 'trusted-auto'])
export const DEFAULT_MANAGED_FIELDS = Object.freeze([
  'title', 'description', 'acceptance', 'priority', 'assignee', 'sprint', 'status', 'delivery'
])
const MANAGED_FIELDS = new Set(DEFAULT_MANAGED_FIELDS)

export function normalizeSyncPolicy(input = {}) {
  const mode = SYNC_MODES.has(input.mode) ? input.mode : 'manual'
  const source = Array.isArray(input.managedFields) ? input.managedFields : DEFAULT_MANAGED_FIELDS
  const managedFields = [...new Set(source.map((value) => String(value).trim()))]
    .filter((value) => MANAGED_FIELDS.has(value))
  return {
    mode,
    server: String(input.server || '').trim(),
    projectId: String(input.projectId || '').trim(),
    managedFields
  }
}

export function assertSyncPolicy(input) {
  if (input?.mode && !SYNC_MODES.has(input.mode)) {
    throw err.bad('SYNC_MODE_INVALID', '同步模式只支持 manual 或 trusted-auto')
  }
  const value = normalizeSyncPolicy(input)
  if (value.server && !/^[a-z0-9][a-z0-9._-]*$/.test(value.server)) {
    throw err.bad('SYNC_SERVER_INVALID', '同步服务标识不合法')
  }
  return value
}

export function trustedModeReadiness(policy, probes = {}) {
  const value = normalizeSyncPolicy(policy)
  const required = [
    ['connection', 'SYNC_CONNECTION_UNVERIFIED', '尚未验证 MCP 连接'],
    ['permission', 'SYNC_PERMISSION_UNVERIFIED', '尚未验证写权限'],
    ['createUpdate', 'SYNC_CREATE_UPDATE_UNVERIFIED', '尚未验证创建和更新'],
    ['statusWrite', 'SYNC_STATUS_WRITE_UNVERIFIED', '尚未验证状态回写'],
    ['idempotency', 'SYNC_IDEMPOTENCY_UNVERIFIED', '尚未验证幂等行为']
  ]
  const blockers = value.mode === 'trusted-auto'
    ? required.filter(([key]) => probes[key] !== true).map(([, code, message]) => ({ code, message }))
    : []
  return { ready: value.mode === 'trusted-auto' && blockers.length === 0, blockers }
}
