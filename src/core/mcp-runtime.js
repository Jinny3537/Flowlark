import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as secrets from './secrets.js'
import { workspaceHome } from './workspaces.js'

const FILE_NAME = 'mcp-runtime.json'
const ID_RE = /^[a-z0-9._-]{1,64}$/
const SHA256_RE = /^[a-f0-9]{64}$/

export function getRuntimeProfile(root, id, { home = workspaceHome() } = {}) {
  const safe = runtimeId(id)
  const data = readData(home)
  return data.workspaces[canonical(root)]?.[safe] || null
}

export function saveRuntimeProfile(root, id, input, { home = workspaceHome() } = {}) {
  const safe = runtimeId(id)
  const profile = normalizeProfile(input)
  const data = readData(home)
  const key = canonical(root)
  if (!data.workspaces[key]) data.workspaces[key] = {}
  data.workspaces[key][safe] = profile
  writeData(home, data)
  return profile
}

export function removeRuntimeProfile(root, id, { home = workspaceHome() } = {}) {
  const safe = runtimeId(id)
  const data = readData(home)
  const key = canonical(root)
  const removed = Boolean(data.workspaces[key]?.[safe])
  if (data.workspaces[key]) {
    delete data.workspaces[key][safe]
    if (!Object.keys(data.workspaces[key]).length) delete data.workspaces[key]
  }
  if (removed) writeData(home, data)
  return { id: safe, removed }
}

export function inspectRuntimeProfile(root, id, { home = workspaceHome(), secretStore = secrets } = {}) {
  const profile = getRuntimeProfile(root, id, { home })
  if (!profile) return null
  return {
    ...profile,
    passwordStored: Boolean(secretStore.getSecret('mcp-runtime-password', {
      name: runtimeSecretName(root, id), envKey: 'ASSESS_PASSWORD'
    }))
  }
}

export function setRuntimePassword(root, id, password, { secretStore = secrets } = {}) {
  return secretStore.setSecret('mcp-runtime-password', password, { name: runtimeSecretName(root, id) })
}

export function deleteRuntimePassword(root, id, { secretStore = secrets } = {}) {
  return secretStore.deleteSecret('mcp-runtime-password', { name: runtimeSecretName(root, id) })
}

export function runtimeEnvironment(root, id, { home = workspaceHome(), secretStore = secrets } = {}) {
  const profile = getRuntimeProfile(root, id, { home })
  if (!profile) throw err.notFound(`MCP 本机配置「${id}」`)
  const password = secretStore.getSecret('mcp-runtime-password', {
    name: runtimeSecretName(root, id), envKey: 'ASSESS_PASSWORD'
  })
  if (!password) throw err.bad('MCP_PASSWORD_MISSING', '尚未保存平台密码')
  return {
    ASSESS_BASE_URL: profile.baseUrl,
    ASSESS_ACCOUNT: profile.account,
    ASSESS_PASSWORD: password
  }
}

export function diagnoseExecutable(profile, {
  platform = process.platform,
  arch = process.arch,
  runner = execFileSync
} = {}) {
  const command = String(profile?.command || '')
  const expectedSha256 = String(profile?.expectedSha256 || '').toLowerCase()
  const blockers = []
  const warnings = []
  const result = {
    command,
    exists: false,
    regularFile: false,
    executable: false,
    architecture: 'unknown',
    hostArchitecture: normalizeArchitecture(arch),
    signature: platform === 'darwin' ? 'unknown' : 'not-applicable',
    actualSha256: '',
    expectedSha256,
    size: 0,
    modifiedAt: null,
    blockers,
    warnings,
    ready: false
  }

  if (!command || !fs.existsSync(command)) {
    blockers.push(problem('MCP_EXECUTABLE_MISSING', 'MCP 可执行文件不存在'))
    return result
  }
  result.exists = true
  const stat = fs.statSync(command)
  result.regularFile = stat.isFile()
  result.executable = Boolean(stat.mode & 0o111)
  result.size = stat.size
  result.modifiedAt = stat.mtime.toISOString()
  if (!result.regularFile) blockers.push(problem('MCP_EXECUTABLE_NOT_FILE', 'MCP 路径不是普通文件'))
  if (!result.executable) blockers.push(problem('MCP_EXECUTABLE_NOT_EXECUTABLE', 'MCP 文件没有执行权限'))
  if (!result.regularFile) return result

  result.actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(command)).digest('hex')
  if (expectedSha256 && result.actualSha256 !== expectedSha256) {
    blockers.push(problem('MCP_EXECUTABLE_SHA_MISMATCH', 'MCP 文件 SHA-256 与期望值不一致'))
  }

  try {
    result.architecture = parseArchitecture(String(runner('file', [command], { encoding: 'utf8' })))
  } catch {
    warnings.push(problem('MCP_EXECUTABLE_ARCH_UNKNOWN', '无法识别 MCP 文件架构'))
  }
  if (result.architecture !== 'unknown' && result.architecture !== 'universal' && result.architecture !== result.hostArchitecture) {
    blockers.push(problem('MCP_EXECUTABLE_ARCH_MISMATCH', `MCP 文件架构 ${result.architecture} 与本机 ${result.hostArchitecture} 不兼容`))
  }

  if (platform === 'darwin') {
    try {
      runner('codesign', ['-dv', '--verbose=2', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      result.signature = 'signed'
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '')
      result.signature = /not signed/i.test(detail) ? 'unsigned' : 'unverifiable'
      warnings.push(problem('MCP_EXECUTABLE_UNSIGNED', result.signature === 'unsigned' ? 'MCP 文件未签名' : '无法验证 MCP 文件签名'))
    }
  }

  result.ready = blockers.length === 0
  return result
}

function normalizeProfile(input = {}) {
  const command = String(input.command || '').trim()
  if (!path.isAbsolute(command)) throw err.bad('MCP_COMMAND_INVALID', 'MCP 可执行文件必须使用绝对路径')
  const baseUrl = String(input.baseUrl || '').trim()
  let url
  try { url = new URL(baseUrl) } catch { throw err.bad('MCP_BASE_URL_INVALID', '平台地址不合法') }
  if (!['http:', 'https:'].includes(url.protocol)) throw err.bad('MCP_BASE_URL_INVALID', '平台地址必须是 HTTP 或 HTTPS')
  const account = String(input.account || '').trim()
  if (!account) throw err.bad('MCP_ACCOUNT_REQUIRED', '请填写平台账号')
  const expectedSha256 = String(input.expectedSha256 || '').trim().toLowerCase()
  if (expectedSha256 && !SHA256_RE.test(expectedSha256)) throw err.bad('MCP_SHA256_INVALID', 'SHA-256 必须是 64 位十六进制')
  return {
    command,
    args: Array.isArray(input.args) ? input.args.map(String) : [],
    baseUrl: url.toString().replace(/\/$/, ''),
    account,
    expectedSha256,
    updatedAt: new Date().toISOString()
  }
}

function readData(home) {
  const file = path.join(home, FILE_NAME)
  if (!fs.existsSync(file)) return { schemaVersion: 1, workspaces: {} }
  const value = parse(fs.readFileSync(file, 'utf8'), FILE_NAME)
  return {
    schemaVersion: 1,
    workspaces: value.workspaces && typeof value.workspaces === 'object' ? value.workspaces : {}
  }
}

function writeData(home, data) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const file = path.join(home, FILE_NAME)
  const temporary = path.join(home, `${FILE_NAME}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(temporary, stringify(data), { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}

function runtimeSecretName(root, id) {
  const hash = crypto.createHash('sha256').update(canonical(root)).digest('hex').slice(0, 24)
  return `${hash}:${runtimeId(id)}`
}

function runtimeId(value) {
  const id = String(value || '').trim()
  if (!ID_RE.test(id)) throw err.bad('MCP_RUNTIME_ID_INVALID', 'MCP 本机配置标识不合法')
  return id
}

function canonical(value) {
  const absolute = path.resolve(value)
  return fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute
}

function normalizeArchitecture(value) {
  const arch = String(value || '').toLowerCase()
  if (arch === 'x64' || arch === 'amd64' || arch === 'x86_64') return 'x86_64'
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  return arch || 'unknown'
}

function parseArchitecture(output) {
  const text = String(output || '').toLowerCase()
  if (/universal binary|universal/.test(text)) return 'universal'
  if (/arm64|aarch64/.test(text)) return 'arm64'
  if (/x86_64|amd64/.test(text)) return 'x86_64'
  return 'unknown'
}

function problem(code, message) {
  return { code, message }
}
