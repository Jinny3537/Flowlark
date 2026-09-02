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
    if (capability.enabled && !ids.has(capability.server)) problems.push(`${label} MCP 能力已启用，但没有绑定可用服务`)
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

export function resolveCapability(root, name) {
  if (!validId(name)) throw err.bad('MCP_CAPABILITY_INVALID', `不支持的 MCP 能力：${name}`)
  const config = readMcpConfig(root)
  const capability = config.capabilities[name]
  const label = capability?.label || BUILTIN_CAPABILITIES[name]?.label || name
  if (!capability) throw err.bad('MCP_CAPABILITY_MISSING', `${label} MCP 能力不存在`)
  if (!capability.enabled) throw err.bad('MCP_CAPABILITY_DISABLED', `${label} MCP 能力尚未启用`)
  const server = config.servers.find((item) => item.id === capability.server)
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
    project: capability.project,
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
