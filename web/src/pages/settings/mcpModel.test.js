import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityPayload, parseHeaders, serverForm, serverPayload } from './mcpModel.js'

test('round-trips server fields and headers', () => {
  const form = serverForm({ id: 'req', name: '需求', url: 'https://mcp.test', enabled: false, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret}' } })
  assert.equal(form.headersText, '{\n  "Authorization": "Bearer ${secret}"\n}')
  assert.deepEqual(serverPayload(form), {
    name: '需求', type: 'http', enabled: false, url: 'https://mcp.test', timeoutMs: 5000,
    headers: { Authorization: 'Bearer ${secret}' }
  })
})

test('rejects non-object header JSON', () => {
  assert.throws(() => parseHeaders('[]'), /请求头必须是 JSON 对象/)
})

test('normalizes capability tools', () => {
  assert.deepEqual(capabilityPayload({ enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe', toolsText: '{"test":"requirements.test"}' }), {
    enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe', tools: { test: 'requirements.test' }
  })
})
