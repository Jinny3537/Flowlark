import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilityPayload, parseHeaders, parseRequirementPoolManifestText, runtimeDiagnosticStatus, serverForm, serverPayload, validateRequirementPoolManifestFile } from './mcpModel.js'

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
  assert.deepEqual(capabilityPayload({ enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe', toolsText: '{"test":"requirements.test"}', optionsText: '{"ownerId":7,"priorities":{"P1":1}}' }), {
    enabled: true, server: 'req', label: '需求', category: 'product', description: '', project: 'safe',
    options: { ownerId: 7, priorities: { P1: 1 } }, tools: { test: 'requirements.test' }
  })
})

test('parses requirement pool manifest text as an object', () => {
  assert.deepEqual(parseRequirementPoolManifestText('{"manifestVersion":"2026-09"}'), { manifestVersion: '2026-09' })
  assert.throws(() => parseRequirementPoolManifestText(''), /请先粘贴/)
  assert.throws(() => parseRequirementPoolManifestText('[]'), /JSON 对象/)
})

test('validates requirement pool manifest upload files', () => {
  assert.equal(validateRequirementPoolManifestFile({ name: 'pool.json', type: '', size: 120 }), true)
  assert.equal(validateRequirementPoolManifestFile({ name: 'pool.txt', type: 'application/json', size: 120 }), true)
  assert.throws(() => validateRequirementPoolManifestFile({ name: 'pool.txt', type: 'text/plain', size: 120 }), /JSON 配置文件/)
  assert.throws(() => validateRequirementPoolManifestFile({ name: 'pool.json', type: 'application/json', size: 300 * 1024 }), /不能超过 256KB/)
})

test('round-trips stdio logical server fields without URL or headers', () => {
  const form = serverForm({
    id: 'assess-task-local', name: '研发任务管理', type: 'stdio', adapter: 'assess-task',
    runtimeProfile: 'assess-task-local', enabled: true, timeoutMs: 15000
  })
  assert.deepEqual(serverPayload(form), {
    name: '研发任务管理', type: 'stdio', enabled: true, adapter: 'assess-task',
    runtimeProfile: 'assess-task-local', timeoutMs: 15000
  })
})

test('summarizes runtime diagnostics without relying on color alone', () => {
  assert.deepEqual(runtimeDiagnosticStatus({ ready: false, blockers: [{ code: 'NO_EXEC', message: '没有执行权限' }], warnings: [] }), {
    tone: 'error', label: '检查未通过', messages: ['没有执行权限']
  })
  assert.deepEqual(runtimeDiagnosticStatus({ ready: true, blockers: [], warnings: [{ code: 'UNSIGNED', message: '文件未签名' }] }), {
    tone: 'warning', label: '可运行，但有警告', messages: ['文件未签名']
  })
})
