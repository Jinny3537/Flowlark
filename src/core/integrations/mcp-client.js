import { Client, SdkErrorCode } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { err } from '../errors.js'
import { callTool as callLegacyHttpTool } from './mcp-jsonrpc.js'

const STDERR_LIMIT = 64 * 1024

export function createMcpClientManager({ legacyHttpCall = callLegacyHttpTool } = {}) {
  return {
    async connect(config = {}) {
      if (config.type === 'stdio') return connectStdio(config)
      return connectLegacyHttp(config, legacyHttpCall)
    }
  }
}

async function connectStdio(config) {
  const command = String(config.command || '').trim()
  if (!command) throw err.bad('MCP_COMMAND_REQUIRED', '请配置 MCP 可执行文件')

  const timeoutMs = positiveNumber(config.timeoutMs, 10_000)
  const secretValues = Object.values(config.env || {}).filter((value) => String(value || '').length >= 4).map(String)
  let stderr = ''
  let closed = false
  let closePromise = null
  const transport = new StdioClientTransport({
    command,
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: { ...getDefaultEnvironment(), ...stringEnvironment(config.env) },
    cwd: config.cwd || undefined,
    stderr: 'pipe',
    maxBufferSize: positiveNumber(config.maxBufferSize, 10 * 1024 * 1024)
  })
  transport.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT)
  })

  const client = new Client(
    { name: 'flowlark', version: '0.7.0' },
    { versionNegotiation: { mode: 'legacy' }, inputRequired: { autoFulfill: false } }
  )

  try {
    await client.connect(transport, { timeout: timeoutMs, maxTotalTimeout: timeoutMs })
  } catch (error) {
    await client.close().catch(() => {})
    throw mapClientError(error, secretValues, 'MCP 服务连接失败')
  }

  async function close() {
    if (closed) return closePromise
    closed = true
    closePromise = client.close().catch(() => {})
    return closePromise
  }

  return {
    serverInfo: client.getServerVersion() || null,
    async listTools() {
      try {
        const result = await client.listTools(undefined, { timeout: timeoutMs, maxTotalTimeout: timeoutMs })
        return result.tools || []
      } catch (error) {
        throw mapClientError(error, secretValues, '无法读取 MCP 工具列表')
      }
    },
    async callTool(name, args = {}) {
      try {
        const result = await client.callTool(
          { name: String(name || ''), arguments: args || {} },
          { timeout: timeoutMs, maxTotalTimeout: timeoutMs }
        )
        return normalizeCallResult(result, name)
      } catch (error) {
        throw mapClientError(error, secretValues, `MCP 工具 ${name} 调用失败`)
      }
    },
    diagnostics() {
      return { pid: transport.pid, stderr: redact(stderr, secretValues), truncated: stderr.length >= STDERR_LIMIT }
    },
    close
  }
}

function connectLegacyHttp(config, legacyHttpCall) {
  return {
    serverInfo: null,
    listTools: async () => [],
    callTool: (name, args = {}) => legacyHttpCall(config, name, args),
    diagnostics: () => ({ pid: null, stderr: '', truncated: false }),
    close: async () => {}
  }
}

function normalizeCallResult(result, name) {
  if (result && result.isError) {
    const detail = (result.content || [])
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text)
      .filter(Boolean)
      .join('；')
    throw err.bad('MCP_TOOL_ERROR', detail || `MCP 工具 ${name} 返回失败`)
  }
  if (result && result.structuredContent !== undefined) return result.structuredContent
  const text = result && Array.isArray(result.content)
    ? result.content.find((item) => item && item.type === 'text')?.text
    : null
  if (looksJson(text)) return JSON.parse(text)
  return text == null ? result : { text }
}

function mapClientError(error, secretValues, fallback) {
  if (error && typeof error.code === 'string' && error.code.startsWith('MCP_')) return error
  if (error && error.code === SdkErrorCode.RequestTimeout) {
    return err.bad('MCP_TIMEOUT', 'MCP 服务响应超时')
  }
  if (error && [SdkErrorCode.ConnectionClosed, SdkErrorCode.NotConnected, SdkErrorCode.SendFailed].includes(error.code)) {
    return err.bad('MCP_UNAVAILABLE', 'MCP 服务连接已断开')
  }
  const detail = redact(error && error.message, secretValues)
  return err.bad('MCP_PROTOCOL_ERROR', detail ? `${fallback}：${detail}` : fallback)
}

function redact(value, secrets) {
  let text = String(value || '')
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]')
  return text
}

function stringEnvironment(input) {
  const out = {}
  for (const [key, value] of Object.entries(input || {})) out[String(key)] = String(value)
  return out
}

function looksJson(value) {
  const text = String(value || '').trim()
  return text.startsWith('{') || text.startsWith('[')
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}
