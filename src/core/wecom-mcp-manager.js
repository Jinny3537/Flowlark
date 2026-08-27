import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { err } from './errors.js'
import { callTool } from './integrations/mcp-jsonrpc.js'

const DEFAULT_SERVER_FILE = fileURLToPath(new URL('../mcp/wecom-server.js', import.meta.url))
const STDERR_LIMIT = 64 * 1024

function unavailableError(reason) {
  const message = String(reason?.message || reason || '企业微信 MCP Sidecar 未启动')
  return err.bad('WECOM_MCP_UNAVAILABLE', message, '重启 Flowlark；若问题持续，请检查运行终端中的 Sidecar 错误')
}

export function unavailableWecomMcp(reason) {
  const error = unavailableError(reason)
  const reject = async () => { throw error }
  return {
    available: false,
    reason: error.message,
    pid: null,
    baseUrl: null,
    authStatus: reject,
    resolveContacts: reject,
    sendReleaseMail: reject,
    diagnostics: () => ({ available: false, pid: null, stderr: '', reason: error.message }),
    close: async () => {}
  }
}

function toolError(value) {
  if (!value || value.ok !== false) return null
  return err.bad(
    'WECOM_MCP_REJECTED',
    String(value.message || '企业微信 MCP 工具调用失败'),
    value.instruction ? String(value.instruction) : null
  )
}

function waitForReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      fn(value)
    }
    const onData = (chunk) => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      const line = stdout.slice(0, newline).trim()
      try {
        const body = JSON.parse(line)
        if (!body.ready || !body.url || !body.port) throw new Error('Sidecar 就绪消息缺少 URL 或端口')
        finish(resolve, body)
      } catch (error) {
        finish(reject, new Error(`企业微信 MCP Sidecar 就绪消息无效：${error.message}`))
      }
    }
    const onError = (error) => finish(reject, error)
    const onExit = (code) => finish(reject, new Error(`企业微信 MCP Sidecar 启动前退出（${code ?? 'unknown'}）`))
    const timer = setTimeout(() => finish(reject, new Error('企业微信 MCP Sidecar 启动超时')), timeoutMs)
    child.stdout?.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function waitForExit(child, timeoutMs = 2000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 子进程已退出 */ }
      resolve()
    }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export async function startWecomMcpSidecar({
  command = 'wecom-cli',
  timeoutMs = 5000,
  spawnProcess = spawn,
  serverFile = DEFAULT_SERVER_FILE
} = {}) {
  const token = crypto.randomBytes(32).toString('base64url')
  const child = spawnProcess(process.execPath, [serverFile], {
    env: {
      ...process.env,
      FLOWLARK_WECOM_MCP_TOKEN: token,
      FLOWLARK_WECOM_MCP_PORT: '0',
      FLOWLARK_WECOM_CLI_COMMAND: String(command || 'wecom-cli')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT)
  })
  let ready
  try {
    ready = await waitForReady(child, Number(timeoutMs) || 5000)
  } catch (error) {
    try { child.kill('SIGTERM') } catch { /* 子进程已退出 */ }
    await waitForExit(child)
    throw new Error(stderr.trim() || error.message)
  }

  const config = {
    baseUrl: ready.url,
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30000
  }
  let closed = false

  async function invoke(name, args = {}) {
    const value = await callTool(config, name, args)
    const error = toolError(value)
    if (error) throw error
    return value
  }

  return {
    available: true,
    reason: null,
    pid: child.pid,
    baseUrl: ready.url,
    authStatus: () => invoke('wecom_auth_status'),
    resolveContacts: (input) => invoke('wecom_contacts_resolve', input),
    sendReleaseMail: (input) => invoke('wecom_release_mail_send', input),
    diagnostics: () => ({
      available: !closed && child.exitCode === null,
      pid: child.pid,
      stderr,
      reason: closed ? 'Sidecar 已关闭' : null
    }),
    async close() {
      if (closed) return
      closed = true
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await waitForExit(child)
    }
  }
}

