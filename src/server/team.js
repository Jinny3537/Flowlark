import { isLocalRequest, isWrite } from '../core/net.js'
import * as team from '../core/team.js'
import { err } from '../core/errors.js'
import { readJson, sendJson } from './router.js'
import { SLUG_RE, assertVersionNo } from '../core/store.js'

const COOKIE = 'flowlark_visitor'
const versionRecords = /^\/api\/team\/records\/([^/]+)\/([^/]+)$/
const publicReads = [
  /^\/api\/snapshots\/[^/]+\/(?:download|file)$/,
  /^\/api\/projects(?:\/[^/]+(?:\/(?:versions|planning|cumulative|since-read|baseline-history|contributors))?)?$/,
  /^\/api\/versions\/[^/]+\/[^/]+(?:\/(?:download|history|spec-history|spec-at|attachments\/[^/]+))?$/,
  /^\/api\/(?:requirements|milestones|snapshots)(?:\/[^/]+)?$/,
  /^\/api\/(?:search|tags|views)$/,
  /^\/api\/feedback\/drafts(?:\/[^/]+(?:\/(?:markdown|screenshot))?)?$/,
]

export function localTeamHost(req) {
  return isLocalRequest(req) && !req.headers.forwarded && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host']
}

function tokenOf(req) {
  return String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ''
}

async function readTeamBody(req, limit = 1024) {
  const body = await readJson(req, limit)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw err.bad('TEAM_BODY_INVALID', '请求内容必须是 JSON 对象')
  return body
}

export function teamContext(root, req) {
  const enabled = team.teamEnabled(root)
  const host = localTeamHost(req)
  const item = enabled && !host ? team.visitor(root, tokenOf(req)) : null
  return { enabled, host, role: host ? 'product' : enabled ? item?.role || null : 'guest', id: host ? 'host' : item?.id || null }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)) {
    throw err.forbidden('TEAM_ORIGIN_FORBIDDEN', '请从工作台页面执行操作')
  }
  if (isWrite(req.method) && req.url.startsWith('/api/team/') && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw err.forbidden('TEAM_JSON_REQUIRED', '团队操作需要 JSON 请求')
  }
}

export function authorizeTeamRequest(context, method, pathname) {
  if (context.host) return
  if (method === 'GET' && pathname === '/api/health') return
  if (!context.role) throw err.forbidden('TEAM_ROLE_REQUIRED', '请先选择协作角色')
  if (method === 'GET' && publicReads.some((rule) => rule.test(pathname))) return
  throw err.forbidden('TEAM_ACTION_FORBIDDEN', '当前角色不能执行此操作，请联系主机')
}

// Returns true when the request is handled. Otherwise the regular API follows.
export async function handleTeamRequest(hub, req, res, url, { mirror }) {
  const pathname = url.pathname
  let context = teamContext(hub.root, req)
  req.team = context
  if (context.enabled || pathname.startsWith('/api/team/')) {
    if (isWrite(req.method) || pathname === '/api/team/session') assertSameOrigin(req)
  }
  if (!pathname.startsWith('/api/team/')) {
    if (pathname.startsWith('/api/')) authorizeTeamRequest(context, req.method, pathname)
    return false
  }
  res.setHeader('Cache-Control', 'no-store')
  if (pathname === '/api/team/session' && req.method === 'GET') {
    if (context.enabled && !context.host && !context.id) {
      const { token } = team.createVisitor(hub.root, req.socket.remoteAddress)
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=31536000`)
      // Role remains unselected until the explicit selection request.
    }
    sendJson(res, 200, { ...context, kinds: (!context.enabled && !context.host) || mirror || !hub.writePermission().canWrite ? [] : team.recordKinds(context.role) })
    return true
  }
  if (pathname === '/api/team/config' && req.method === 'PUT') {
    if (!context.host || mirror) throw err.forbidden('TEAM_HOST_REQUIRED', '仅主机可配置团队模式')
    const body = await readTeamBody(req)
    team.setTeamEnabled(hub.root, body.enabled)
    sendJson(res, 200, { enabled: body.enabled })
    return true
  }
  if (!context.enabled && !(versionRecords.test(pathname) && (context.host || req.method === 'GET'))) throw err.forbidden('TEAM_DISABLED', '当前为只读分享，不能执行协作操作')
  if (pathname === '/api/team/role' && req.method === 'POST') {
    const body = await readTeamBody(req)
    if (!context.id || context.host) throw err.forbidden('TEAM_SESSION_REQUIRED', '请重新打开角色选择页面')
    team.assignRole(hub.root, context.id, body.role, { first: true })
    sendJson(res, 200, { role: body.role })
    return true
  }
  if (pathname === '/api/team/visitors' && req.method === 'GET') {
    if (!context.host) throw err.forbidden('TEAM_HOST_REQUIRED', '仅主机可管理角色')
    sendJson(res, 200, team.listVisitors(hub.root))
    return true
  }
  const visitor = /^\/api\/team\/visitors\/([a-f0-9-]+)$/.exec(pathname)
  if (visitor && req.method === 'PUT') {
    if (!context.host || mirror) throw err.forbidden('TEAM_HOST_REQUIRED', '仅主机可管理角色')
    const body = await readTeamBody(req)
    team.assignRole(hub.root, visitor[1], body.role)
    sendJson(res, 200, { role: body.role })
    return true
  }
  const match = versionRecords.exec(pathname)
  if (match && ['GET', 'POST'].includes(req.method)) {
    if (!context.role) throw err.forbidden('TEAM_ROLE_REQUIRED', '请先选择协作角色')
    const project = decodeURIComponent(match[1]), versionNo = decodeURIComponent(match[2])
    if (!SLUG_RE.test(project)) throw err.bad('TEAM_PROJECT_INVALID', '项目标识不合法')
    assertVersionNo(versionNo)
    hub.getVersion(project, versionNo)
    if (req.method === 'GET') sendJson(res, 200, team.listRecords(hub.root, project, versionNo))
    else {
      if (mirror || !hub.writePermission().canWrite) throw err.forbidden('TEAM_READONLY', '当前仓库只读，不能提交记录')
      const body = await readTeamBody(req, 48 * 1024)
      // Re-read after awaiting the body: host reassignment must take effect now.
      context = teamContext(hub.root, req)
      if (!context.enabled && !context.host) throw err.forbidden('TEAM_DISABLED', '团队模式已关闭')
      sendJson(res, 201, team.addRecord(hub.root, context, project, versionNo, body))
    }
    return true
  }
  throw err.notFound('团队接口')
}
