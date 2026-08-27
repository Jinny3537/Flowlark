import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMcpClientManager } from '../src/core/integrations/mcp-client.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.js')

async function open(options = {}) {
  const manager = createMcpClientManager()
  return manager.connect({
    type: 'stdio',
    command: process.execPath,
    args: [FIXTURE],
    env: { FIXTURE_SECRET: 'secret-value' },
    timeoutMs: 500,
    ...options
  })
}

test('stdio MCP discovers tools and normalizes structured results', async () => {
  const session = await open()
  try {
    const tools = await session.listTools()
    assert.ok(tools.some((tool) => tool.name === 'echo'))
    assert.deepEqual(await session.callTool('echo', { value: 'ok' }), { value: 'ok' })
    await assert.rejects(
      session.callTool('fail', {}),
      (error) => error.code === 'MCP_TOOL_ERROR' && /fixture failure/.test(error.message)
    )
  } finally {
    await session.close()
  }
})

test('stdio MCP correlates concurrent requests', async () => {
  const session = await open()
  try {
    const results = await Promise.all([
      session.callTool('echo', { value: 'a' }),
      session.callTool('echo', { value: 'b' }),
      session.callTool('echo', { value: 'c' })
    ])
    assert.deepEqual(results, [{ value: 'a' }, { value: 'b' }, { value: 'c' }])
  } finally {
    await session.close()
  }
})

test('stdio MCP maps timeouts and closes idempotently', async () => {
  const session = await open({ timeoutMs: 250 })
  await assert.rejects(session.callTool('hang', {}), (error) => error.code === 'MCP_TIMEOUT')
  await session.close()
  await session.close()
})

test('stdio MCP redacts child stderr diagnostics', async () => {
  const session = await open()
  try {
    await session.callTool('echo', { value: 'ready' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const diagnostics = session.diagnostics()
    assert.doesNotMatch(diagnostics.stderr, /secret-value/)
    assert.match(diagnostics.stderr, /\[REDACTED\]/)
    assert.equal(typeof diagnostics.pid, 'number')
  } finally {
    await session.close()
  }
})

test('legacy HTTP sessions preserve the existing call path', async () => {
  const calls = []
  const manager = createMcpClientManager({
    legacyHttpCall: async (config, name, args) => {
      calls.push({ config, name, args })
      return { ok: true }
    }
  })
  const session = await manager.connect({ type: 'http', baseUrl: 'http://127.0.0.1/mcp' })
  assert.deepEqual(await session.callTool('requirements.test', { project: 'P1' }), { ok: true })
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: 'requirements.test', args: { project: 'P1' } }
  ])
  assert.deepEqual(await session.listTools(), [])
  await session.close()
})
