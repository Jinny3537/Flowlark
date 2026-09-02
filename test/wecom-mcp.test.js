import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createWecomTools, WecomToolError } from '../src/mcp/wecom-tools.js'
import { startWecomMcpServer } from '../src/mcp/wecom-server.js'
import { startWecomMcpSidecar } from '../src/core/wecom-mcp-manager.js'

function fakeRunner() {
  const calls = []
  const run = async (command, args) => {
    calls.push({ command, args })
    if (args[0] === '--version') return { stdout: 'wecom-cli 1.1.0 (npm)' }
    if (args[0] === 'auth') return { stdout: 'authorized\n' }
    if (args[0] === 'contact') {
      const query = JSON.parse(args.at(-1)).keywords[0]
      if (query === '张三') return { stdout: JSON.stringify({ users: [{ userid: 'wo1', name: '张三', departments: ['产品部'] }] }) }
      if (query === '李四') return { stdout: JSON.stringify({ users: [
        { userid: 'wo2', name: '李四', departments: ['产品部'] },
        { userid: 'wo3', name: '李四', departments: ['研发部'] }
      ] }) }
      return { stdout: JSON.stringify({ users: [] }) }
    }
    return { stdout: JSON.stringify({ mail_id: 'must-not-leak' }) }
  }
  return { calls, run }
}

test('检查 CLI 版本、授权并区分通讯录唯一/同名/无匹配', async (t) => {
  const runner = fakeRunner()
  const tools = createWecomTools({ run: runner.run })
  assert.deepEqual(await tools.authStatus(), {
    installed: true, version: '1.1.0', versionOk: true, authorized: true,
    message: '企业微信 CLI 已授权', instruction: null
  })
  const resolved = await tools.resolveContacts({ names: ['张三', '李四', '王五'] })
  assert.equal(resolved.results[0].status, 'unique')
  assert.equal(resolved.results[1].status, 'ambiguous')
  assert.equal(resolved.results[2].status, 'missing')
  assert.equal(resolved.results[0].candidate.userid, 'wo1')
  assert.notEqual(resolved.results[0].candidate.key, 'wo1')
  assert.deepEqual(runner.calls.filter((call) => call.args[0] === 'contact').map((call) => JSON.parse(call.args.at(-1)).keywords), [
    ['张三'], ['李四'], ['王五']
  ])
})

test('邮件正文只存在于 0600 临时文件且调用结束即删除', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-wecom-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let bodyPath = null
  let bodyMode = null
  let bodyText = null
  let sentPayload = null
  const tools = createWecomTools({
    tmpRoot: dir,
    run: async (command, args) => {
      if (args[0] === 'mail') {
        sentPayload = JSON.parse(args.at(-1))
        bodyPath = sentPayload.file_path
        bodyMode = fs.statSync(bodyPath).mode & 0o777
        bodyText = fs.readFileSync(bodyPath, 'utf8')
        return { stdout: JSON.stringify({ mail_id: 'hidden' }) }
      }
      return { stdout: '' }
    }
  })
  const result = await tools.sendReleaseMail({
    to: [{ name: '张三', userid: 'wo1' }], cc: [{ name: '李四', email: 'l@example.com' }],
    subject: '订单中心 v2 发版', markdown: '# 发版\n\n完成。'
  })
  assert.deepEqual(result, { ok: true, subject: '订单中心 v2 发版', recipientCount: 1, ccCount: 1 })
  assert.equal(bodyMode, 0o600)
  assert.equal(bodyText, '# 发版\n\n完成。')
  assert.equal(fs.existsSync(bodyPath), false)
  assert.deepEqual(sentPayload.to, { userids: ['wo1'] })
  assert.deepEqual(sentPayload.cc, { emails: ['l@example.com'] })
  assert.equal('mail_id' in result, false)
})

test('CLI 失败只保留可操作信息而不暴露内部错误码', async (t) => {
  const tools = createWecomTools({
    run: async () => {
      const error = new Error('command failed')
      error.stdout = JSON.stringify({ error: { code: 893201, callid: 'secret-call', message: '授权过期', instruction: '重新授权' } })
      throw error
    }
  })
  await assert.rejects(
    tools.resolveContacts({ names: ['张三'] }),
    (error) => error instanceof WecomToolError && error.message === '授权过期' && error.instruction === '重新授权'
  )
})

test('MCP 端点通过官方客户端发现并调用三项工具', async (t) => {
  const token = 'test-token-for-wecom-mcp-server'
  const running = await startWecomMcpServer({
    token,
    tools: {
      authStatus: async () => ({
        installed: true, version: '1.1.0', versionOk: true, authorized: true,
        message: '企业微信 CLI 已授权', instruction: null
      }),
      resolveContacts: async ({ names }) => ({
        results: names.map((name) => ({
          query: name,
          status: 'unique',
          candidate: { key: `key-${name}`, query: name, name, alias: '', departments: ['产品部'], position: '', userid: `wo-${name}` },
          candidates: [{ key: `key-${name}`, query: name, name, alias: '', departments: ['产品部'], position: '', userid: `wo-${name}` }]
        }))
      }),
      sendReleaseMail: async ({ subject, to, cc }) => ({ ok: true, subject, recipientCount: to.length, ccCount: cc.length })
    }
  })
  t.after(() => running.close())

  const client = new Client(
    { name: 'flowlark-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } }
  )
  const transport = new StreamableHTTPClientTransport(new URL(running.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
  await client.connect(transport)
  t.after(() => client.close())
  const listed = await client.listTools()
  assert.deepEqual(listed.tools.map((tool) => tool.name), [
    'wecom_auth_status', 'wecom_contacts_resolve', 'wecom_release_mail_send'
  ])
  const auth = await client.callTool({ name: 'wecom_auth_status', arguments: {} })
  assert.equal(auth.structuredContent.authorized, true)
  const contacts = await client.callTool({ name: 'wecom_contacts_resolve', arguments: { names: ['张三'] } })
  assert.equal(contacts.structuredContent.results[0].candidate.name, '张三')
})

test('MCP 端点拒绝无 Token 和非本机 Host', async (t) => {
  const token = 'test-token-for-wecom-mcp-security'
  const running = await startWecomMcpServer({
    token,
    tools: {
      authStatus: async () => ({ installed: true, version: '1.1.0', versionOk: true, authorized: true, message: 'ok', instruction: null }),
      resolveContacts: async () => ({ results: [] }),
      sendReleaseMail: async () => ({ ok: true, subject: 'x', recipientCount: 1, ccCount: 0 })
    }
  })
  t.after(() => running.close())
  const unauthorized = await fetch(running.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
  })
  assert.equal(unauthorized.status, 401)
  const hostileStatus = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: running.port, path: '/mcp', method: 'POST',
      headers: {
        Host: 'evil.example',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json'
      }
    }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }))
  })
  assert.equal(hostileStatus, 403)
})

test('Sidecar 自动启动、调用并幂等关闭子进程', async (t) => {
  const sidecar = await startWecomMcpSidecar({ command: 'flowlark-test-wecom-cli-missing' })
  assert.equal(sidecar.available, true)
  assert.match(sidecar.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  assert.equal(typeof sidecar.pid, 'number')
  const auth = await sidecar.authStatus()
  assert.equal(auth.installed, false)
  assert.match(auth.instruction, /npm install -g @wecom\/cli/)
  await sidecar.close()
  await sidecar.close()
  assert.equal(sidecar.diagnostics().available, false)
  assert.throws(() => process.kill(sidecar.pid, 0), (error) => error.code === 'ESRCH')
})
