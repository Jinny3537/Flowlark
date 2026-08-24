import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, errorFromResponse, errorText, parsePayload } from './requestModel.js'

test('parses JSON, text, and empty response bodies', () => {
  assert.deepEqual(parsePayload('{"ok":true}'), { ok: true })
  assert.equal(parsePayload('plain failure'), 'plain failure')
  assert.equal(parsePayload(''), null)
})

test('preserves structured business error fields', () => {
  const error = errorFromResponse(409, { code: 'CONFLICT', message: '发生冲突', hint: '先处理文件' })
  assert.equal(error.status, 409)
  assert.equal(error.code, 'CONFLICT')
  assert.equal(error.hint, '先处理文件')
  assert.equal(error.message, '发生冲突（先处理文件）')
})

test('converts text errors without throwing JSON syntax errors', () => {
  const error = errorFromResponse(502, 'Bad Gateway')
  assert.equal(error.message, 'Bad Gateway')
  assert.equal(error.code, 'HTTP_502')
})

test('uses stable read-only and fallback messages', () => {
  assert.equal(errorFromResponse(403, { code: 'READONLY_FROM_LAN' }).message, '这是别人共享出来的只读视图，只能查看不能修改')
  assert.equal(errorFromResponse(403, { code: 'GIT_READONLY' }).message, '当前 Git 身份没有远端写权限，Flowlark 已进入只读模式')
  assert.equal(errorText(new Error('具体错误'), '默认错误'), '具体错误')
  assert.equal(errorText(null, '默认错误'), '默认错误')
})

test('ApiError carries a network cause without leaking it into the message', () => {
  const cause = new Error('socket closed')
  const error = new ApiError('无法连接本地服务，flowlark serve 可能已经停止', { code: 'NETWORK', cause })
  assert.equal(error.code, 'NETWORK')
  assert.equal(error.cause, cause)
})
