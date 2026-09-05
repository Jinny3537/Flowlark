import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { stringify, parse } from './json.js'
import * as secrets from './secrets.js'

export const MCP_FILE = 'mcp.json'
const MCP_SCHEMA_VERSION = 2

const DEFAULT_REQUIREMENT_TOOLS = {
  test: 'requirements.test',
  search: 'requirements.search',
  get: 'requirements.get',
  comment: 'requirements.comment'
}

const DEFAULT_MILESTONE_TOOLS = {
  test: 'milestones.test',
  list: 'milestones.list',
  get: 'milestones.get',
  upsert: 'milestones.upsert'
}

const REQUIREMENT_POOL_REQUIRED_TOOLS = ['test', 'search', 'get']
const SECRET_KEY_RE = /(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|client[_-]?secret)/i
const SECRET_PLACEHOLDER_RE = /(?:\$\{[^}]+\}|<[^>]+>|\{\{[^}]+\}\}|required|placeholder|your-|填写|占位)/i

const BUILTIN_CAPABILITIES = {
  requirements: {
    label: '需求',
    category: 'product',
    description: '搜索、导入和回写外部需求',
    tools: DEFAULT_REQUIREMENT_TOOLS
  },
  milestones: {
    label: '迭代',
    category: 'delivery',
    description: '拉取和回写任务平台迭代计划',
    tools: DEFAULT_MILESTONE_TOOLS
  }
}

export function defaultMcpConfig() {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    servers: [],
    capabilities: {
      requirements: {
        enabled: false,
        server: '',
        project: '',
        tools: { ...DEFAULT_REQUIREMENT_TOOLS }
      },
      milestones: {
        enabled: false,
        server: '',
        project: '',
        tools: { ...DEFAULT_MILESTONE_TOOLS }
      }
    }
  }
}

export function readMcpConfig(root) {
  const file = path.join(root, MCP_FILE)
  if (!fs.existsSync(file)) return defaultMcpConfig()
  return normalize(parse(fs.readFileSync(file, 'utf8'), MCP_FILE))
}

export function writeMcpConfig(root, config) {
  fs.writeFileSync(path.join(root, MCP_FILE), stringify(normalize(config), 'mcp'), 'utf8')
}

export function inspectRequirementPoolManifest(input = {}) {
  const manifest = normalizeRequirementPoolManifest(input)
  return {
    manifestVersion: manifest.manifestVersion,
    platform: manifest.platform,
    transport: manifest.transport,
    server: manifest.server,
    capability: manifest.capability,
    secrets: manifest.secrets,
    safety: manifest.safety,
    warnings: manifest.warnings,
    blockers: manifest.blockers
  }
}

export function importRequirementPoolManifest(root, input = {}) {
  const draft = inspectRequirementPoolManifest(input)
  if (draft.blockers.length) {
    const first = draft.blockers[0]
    throw err.bad(first.code, first.message, first.hint)
  }
  const config = readMcpConfig(root)
  const existingServer = config.servers.findIndex((item) => item.id === draft.server.id)
  if (existingServer >= 0) config.servers[existingServer] = draft.server
  else config.servers.push(draft.server)
  config.capabilities.requirements = draft.capability
  writeMcpConfig(root, config)
  return { ...inspect(root), imported: draft }
}

export function normalize(raw = {}) {
  const base = defaultMcpConfig()
  const servers = Array.isArray(raw.servers) ? raw.servers.map(normalizeServer) : []
  const source = { ...base.capabilities, ...(raw.capabilities || {}) }
  const capabilities = {}
  for (const [name, value] of Object.entries(source)) {
    if (!validId(name)) continue
    capabilities[name] = normalizeCapability(name, value)
  }
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    servers,
    capabilities
  }
}

function normalizeServer(input = {}) {
  const id = String(input.id || '').trim()
  const type = ['http', 'sse', 'stdio'].includes(input.type) ? input.type : 'http'
  return {
    id,
    name: String(input.name || id || 'MCP Server').trim(),
    type,
    ...(type === 'stdio' ? {
      adapter: String(input.adapter || '').trim(),
      runtimeProfile: String(input.runtimeProfile || '').trim()
    } : {}),
    enabled: input.enabled !== false,
    url: type === 'stdio' ? '' : String(input.url || '').trim(),
    timeoutMs: Number(input.timeoutMs || 10000),
    headers: type === 'stdio' ? {} : normalizeHeaders(input.headers)
  }
}

function normalizeHeaders(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    const k = String(key || '').trim()
    if (k) out[k] = String(value || '')
  }
  return out
}

function normalizeRequirementCapability(input = {}) {
  return normalizeCapability('requirements', input)
}

function normalizeMilestoneCapability(input = {}) {
  return normalizeCapability('milestones', input)
}

function normalizeCapability(name, input = {}) {
  const meta = BUILTIN_CAPABILITIES[name] || {}
  const tools = normalizeTools({ ...(meta.tools || {}), ...(input.tools || {}) })
  return {
    enabled: input.enabled === true,
    server: String(input.server || '').trim(),
    label: String(input.label || meta.label || name).trim(),
    category: String(input.category || meta.category || 'extension').trim(),
    description: String(input.description || meta.description || '').trim(),
    project: String(input.project || '').trim(),
    options: normalizeOptions(input.options),
    tools
  }
}

function normalizeTools(input) {
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [key, value] of Object.entries(input)) {
    const k = String(key || '').trim()
    const v = String(value || '').trim()
    if (k && v) out[k] = v
  }
  return out
}

function normalizeOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return JSON.parse(JSON.stringify(input))
}

function normalizeRequirementPoolManifest(input = {}) {
  const manifestVersion = String(input.manifestVersion || input.version || '').trim()
  const platformInput = objectValue(input.platform)
  const transportInput = objectValue(input.transport)
  const toolsInput = objectValue(input.tools)
  const fields = normalizeOptions(input.fields)
  const statuses = normalizeOptions(input.statuses)
  const safetyInput = objectValue(input.safety)
  const platform = {
    id: slugId(platformInput.id || input.id || platformInput.type || platformInput.name || ''),
    name: String(platformInput.name || platformInput.id || input.name || '').trim(),
    type: String(platformInput.type || 'requirement-pool').trim(),
    docsUrl: String(platformInput.docsUrl || platformInput.documentationUrl || platformInput.url || '').trim(),
    icon: String(platformInput.icon || '').trim()
  }
  const transportType = String(transportInput.type || input.transportType || 'http').trim().toLowerCase()
  const baseUrl = String(transportInput.url || transportInput.baseUrl || input.url || input.baseUrl || '').trim()
  const serverId = slugId(input.serverId || input.server?.id || `${platform.id || 'requirement-pool'}-mcp`)
  const server = {
    id: serverId,
    name: String(input.server?.name || platform.name || serverId).trim(),
    type: ['http', 'sse'].includes(transportType) ? transportType : transportType,
    enabled: true,
    url: baseUrl,
    timeoutMs: Number(transportInput.timeoutMs || input.timeoutMs || 10000),
    headers: normalizeHeaders(transportInput.headers || input.headers || {})
  }
  if (!Object.keys(server.headers).length) server.headers = { Authorization: 'Bearer ${secret}' }
  const project = String(input.project?.id || input.projectId || transportInput.project || '').trim()
  const tools = normalizeTools({
    test: toolsInput.test || toolsInput.connectionTest || toolsInput.ping,
    search: toolsInput.search || toolsInput.list || toolsInput.query,
    get: toolsInput.get || toolsInput.detail || toolsInput.fetch,
    comment: toolsInput.comment
  })
  const safety = {
    readOnly: safetyInput.readOnly !== false,
    writes: Array.isArray(safetyInput.writes) ? safetyInput.writes.map((item) => String(item || '').trim()).filter(Boolean) : [],
    dangerous: Array.isArray(safetyInput.dangerous) ? safetyInput.dangerous.map((item) => String(item || '').trim()).filter(Boolean) : []
  }
  const secrets = normalizeSecretDeclarations(input.secrets)
  const blockers = []
  const warnings = []

  if (!manifestVersion) {
    blockers.push(problem('REQUIREMENT_POOL_MANIFEST_VERSION_REQUIRED', '配置 JSON 缺少 manifestVersion'))
  }
  if (!validId(platform.id)) {
    blockers.push(problem('REQUIREMENT_POOL_PLATFORM_INVALID', '需求池平台标识不合法'))
  }
  if (!validId(server.id)) {
    blockers.push(problem('MCP_SERVER_ID_INVALID', 'MCP 服务标识只能包含小写字母、数字、点、下划线和连字符'))
  }
  if (!['http', 'sse'].includes(server.type)) {
    blockers.push(problem('REQUIREMENT_POOL_TRANSPORT_UNSUPPORTED', 'v0.7.5 配置导入只激活 HTTP/SSE MCP 服务；本机 stdio 服务包留到后续版本'))
  } else if (!server.url) {
    blockers.push(problem('MCP_SERVER_URL_REQUIRED', '配置 JSON 缺少 MCP 服务 URL'))
  } else {
    try {
      const url = new URL(server.url)
      if (!['http:', 'https:'].includes(url.protocol)) blockers.push(problem('MCP_SERVER_URL_INVALID', 'MCP 服务 URL 必须是 HTTP 或 HTTPS'))
      if (url.username || url.password) blockers.push(problem('REQUIREMENT_POOL_SECRET_INLINE', '配置 JSON 的 MCP 服务 URL 不允许包含账号或密码', '请改为占位符，并由用户在本机单独保存密钥'))
    } catch {
      blockers.push(problem('MCP_SERVER_URL_INVALID', 'MCP 服务 URL 不合法'))
    }
  }
  for (const name of REQUIREMENT_POOL_REQUIRED_TOOLS) {
    if (!tools[name]) blockers.push(problem('REQUIREMENT_POOL_TOOL_MISSING', `配置 JSON 缺少需求池 ${name} 工具映射`))
  }
  const secretFindings = findPlaintextSecrets(input)
  if (secretFindings.length) {
    blockers.push(problem('REQUIREMENT_POOL_SECRET_INLINE', `配置 JSON 疑似包含明文密钥：${secretFindings.slice(0, 3).join('、')}`, '请改为占位符，并由用户在本机单独保存密钥'))
  }
  if (safety.readOnly === false || safety.writes.length || safety.dangerous.length) {
    warnings.push(problem('REQUIREMENT_POOL_WRITE_DECLARED', '配置 JSON 声明了写能力；v0.7.5 导入仅启用需求读取，写回需后续版本单独验收'))
  }
  if (!Object.keys(fields).length) warnings.push(problem('REQUIREMENT_POOL_FIELDS_EMPTY', '配置 JSON 未声明字段映射，导入后只能显示原始引用'))
  if (!Object.keys(statuses).length) warnings.push(problem('REQUIREMENT_POOL_STATUSES_EMPTY', '配置 JSON 未声明状态映射，导入后不会自动判断需求池状态'))

  return {
    manifestVersion,
    platform,
    transport: {
      type: server.type,
      url: server.url ? redactUrl(server.url) : '',
      timeoutMs: server.timeoutMs
    },
    server,
    capability: {
      enabled: true,
      server: server.id,
      label: platform.name || '需求',
      category: 'product',
      description: `${platform.name || '需求池'}需求读取与只读引用`,
      project,
      options: {
        source: 'requirement-pool-manifest',
        manifestVersion,
        platform,
        fields,
        statuses,
        safety
      },
      tools
    },
    secrets,
    safety,
    warnings,
    blockers
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function problem(code, message, hint = null) {
  return { code, message, ...(hint ? { hint } : {}) }
}

function slugId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function normalizeSecretDeclarations(input) {
  if (Array.isArray(input)) {
    return input.map((item) => {
      const value = objectValue(item)
      return {
        name: String(value.name || value.key || '').trim(),
        label: String(value.label || value.name || value.key || '').trim(),
        required: value.required !== false
      }
    }).filter((item) => item.name)
  }
  const value = objectValue(input)
  return Object.entries(value).map(([name, detail]) => ({
    name,
    label: typeof detail === 'object' && detail ? String(detail.label || name).trim() : name,
    required: typeof detail === 'object' && detail ? detail.required !== false : true
  }))
}

function findPlaintextSecrets(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPlaintextSecrets(item, `${prefix}[${index}]`))
  }
  if (!value || typeof value !== 'object') return []
  const out = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (entry && typeof entry === 'object') {
      out.push(...findPlaintextSecrets(entry, path))
      continue
    }
    const text = String(entry || '').trim()
    if (key.toLowerCase() === 'authorization' && text && !SECRET_PLACEHOLDER_RE.test(text)) {
      out.push(path)
      continue
    }
    if (!SECRET_KEY_RE.test(key)) continue
    if (!text || SECRET_PLACEHOLDER_RE.test(text)) continue
    out.push(path)
  }
  return out
}

function redactUrl(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = url.username ? '***' : ''
      url.password = url.password ? '***' : ''
    }
    return url.toString()
  } catch {
    return ''
  }
}

export function validate(config) {
  const problems = []
  const ids = new Set()
  for (const server of config.servers) {
    if (!validId(server.id)) problems.push(`MCP 服务标识不合法：${server.id || '（空）'}`)
    if (ids.has(server.id)) problems.push(`MCP 服务标识重复：${server.id}`)
    ids.add(server.id)
    if (server.type === 'stdio') {
      if (!validId(server.adapter)) problems.push(`MCP 服务 ${server.id || server.name} 缺少有效适配器`)
      if (!validId(server.runtimeProfile)) problems.push(`MCP 服务 ${server.id || server.name} 缺少有效本机运行配置`)
    } else if (!server.url) problems.push(`MCP 服务 ${server.id || server.name} 缺少 URL`)
    else {
      try {
        const url = new URL(server.url)
        if (!['http:', 'https:'].includes(url.protocol)) problems.push(`MCP 服务 ${server.id} 只支持 HTTP/HTTPS URL`)
      } catch {
        problems.push(`MCP 服务 ${server.id || server.name} 的 URL 不合法`)
      }
    }
  }
  for (const [name, capability] of Object.entries(config.capabilities)) {
    const label = capability.label || BUILTIN_CAPABILITIES[name]?.label || name
    if (capability.enabled && name !== 'milestones' && !ids.has(capability.server)) {
      problems.push(`${label} MCP 能力已启用，但没有绑定可用服务`)
    }
    if (capability.enabled && !capability.tools.test) problems.push(`${label} MCP 能力已启用，但没有配置连接测试工具`)
  }
  return problems
}

export function saveServer(root, input) {
  const server = normalizeServer(input)
  if (!validId(server.id)) throw err.bad('MCP_SERVER_ID_INVALID', 'MCP 服务标识只能包含小写字母、数字、点、下划线和连字符')
  if (server.type === 'stdio') {
    if (!validId(server.adapter)) throw err.bad('MCP_SERVER_ADAPTER_REQUIRED', '请填写 MCP 服务适配器')
    if (!validId(server.runtimeProfile)) throw err.bad('MCP_RUNTIME_PROFILE_REQUIRED', '请填写 MCP 本机运行配置')
  } else if (!server.url) throw err.bad('MCP_SERVER_URL_REQUIRED', '请填写 MCP 服务 URL')
  if (server.type !== 'stdio' && !Object.keys(server.headers).length) {
    server.headers = { Authorization: 'Bearer ${secret}' }
  }
  const config = readMcpConfig(root)
  const idx = config.servers.findIndex((item) => item.id === server.id)
  if (idx >= 0) config.servers[idx] = server
  else config.servers.push(server)
  writeMcpConfig(root, config)
  return inspect(root)
}

export function removeServer(root, id) {
  const config = readMcpConfig(root)
  config.servers = config.servers.filter((server) => server.id !== id)
  for (const cap of Object.values(config.capabilities)) {
    if (cap && cap.server === id) {
      cap.enabled = false
      cap.server = ''
    }
  }
  writeMcpConfig(root, config)
  return inspect(root)
}

export function saveCapability(root, name, input) {
  if (!validId(name)) throw err.bad('MCP_CAPABILITY_INVALID', 'MCP 能力标识只能包含小写字母、数字、点、下划线和连字符')
  const config = readMcpConfig(root)
  config.capabilities[name] = normalizeCapability(name, input)
  const problems = validate(config)
  if (problems.length) throw err.bad('MCP_CONFIG_INVALID', problems[0], problems.join('；'))
  writeMcpConfig(root, config)
  return inspect(root)
}

export function removeCapability(root, name) {
  if (BUILTIN_CAPABILITIES[name]) throw err.bad('MCP_CAPABILITY_BUILTIN', `内置 MCP 能力不能删除：${name}`)
  const config = readMcpConfig(root)
  delete config.capabilities[name]
  writeMcpConfig(root, config)
  return inspect(root)
}

export function resolveCapability(root, name, target = {}) {
  if (!validId(name)) throw err.bad('MCP_CAPABILITY_INVALID', `不支持的 MCP 能力：${name}`)
  const config = readMcpConfig(root)
  const capability = config.capabilities[name]
  const label = capability?.label || BUILTIN_CAPABILITIES[name]?.label || name
  if (!capability) throw err.bad('MCP_CAPABILITY_MISSING', `${label} MCP 能力不存在`)
  if (!capability.enabled) throw err.bad('MCP_CAPABILITY_DISABLED', `${label} MCP 能力尚未启用`)
  const serverId = target.server === undefined ? capability.server : String(target.server || '').trim()
  const projectTarget = target.projectId === undefined ? target.project : target.projectId
  const project = projectTarget === undefined ? capability.project : String(projectTarget || '').trim()
  const server = config.servers.find((item) => item.id === serverId)
  if (!server) throw err.bad('MCP_SERVER_MISSING', `${label} MCP 能力绑定的服务不存在`)
  if (!server.enabled) throw err.bad('MCP_SERVER_DISABLED', `MCP 服务 ${server.name} 已停用`)
  const result = {
    provider: 'mcp',
    transport: server.type,
    adapter: server.adapter,
    runtimeProfile: server.runtimeProfile,
    baseUrl: server.url,
    server,
    capability,
    project,
    mePath: capability.tools.test,
    timeoutMs: server.timeoutMs,
    headers: resolveHeaders(server),
    tools: capability.tools
  }
  if (name === 'requirements') {
    return {
      ...result,
      searchPath: capability.tools.search,
      detailPath: capability.tools.get,
      commentPath: capability.tools.comment
    }
  }
  return {
    ...result,
    listPath: capability.tools.list,
    detailPath: capability.tools.get,
    upsertPath: capability.tools.upsert
  }
}

export function inspect(root) {
  const config = readMcpConfig(root)
  return {
    file: MCP_FILE,
    exists: fs.existsSync(path.join(root, MCP_FILE)),
    config,
    problems: validate(config)
  }
}

export function setServerSecret(id, value) {
  return secrets.setSecret('mcp-server', value, { name: id })
}

export function deleteServerSecret(id) {
  return secrets.deleteSecret('mcp-server', { name: id })
}

function resolveHeaders(server) {
  const out = {}
  for (const [key, value] of Object.entries(server.headers || {})) {
    const resolved = String(value).replace(/\$\{([^}]+)\}/g, (_, expr) => resolvePlaceholder(server, expr))
    if (resolved) out[key] = resolved
  }
  return out
}

function resolvePlaceholder(server, expr) {
  const value = String(expr || '').trim()
  if (value === 'secret') return secrets.getSecret('mcp-server', { name: server.id }) || ''
  if (value.startsWith('secret:')) return secrets.getSecret('mcp-server', { name: value.slice(7) }) || ''
  if (value.startsWith('env:')) return process.env[value.slice(4)] || ''
  return ''
}

function validId(value) {
  return /^[a-z0-9._-]{1,64}$/.test(String(value || ''))
}
