import { after, describe, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'

const dirs = []
after(() => dirs.forEach(cleanup))

async function json(base, path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

describe('v0.4 API', () => {
  test('需求、迭代和已存视图走通', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html() })
    const server = await startServer(root, { port: 0, previewPort: 0 })
    const base = `http://127.0.0.1:${server.port}`
    try {
      let result = await json(base, '/api/requirements', 'POST', { code: 'REQ-1', title: '需求一' })
      t.assert.strictEqual(result.status, 201)
      result = await json(base, '/api/requirements/REQ-1/links', 'POST', { project: 'orders', versionNo: 'v1' })
      t.assert.strictEqual(result.body.requirementCount, 1)
      result = await json(base, '/api/milestones', 'POST', { name: 'S1', title: '迭代一', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }] })
      t.assert.strictEqual(result.status, 201)
      result = await json(base, '/api/views/pending', 'PUT', { name: '待评审', scope: 'versions', filters: { reviewStatus: ['pending'] } })
      t.assert.strictEqual(result.body.id, 'pending')
      result = await json(base, '/api/search?requirement=REQ-1')
      t.assert.ok(result.body.results.some((item) => item.project === 'orders' && item.versionNo === 'v1'))
    } finally { await server.close() }
  })

  test('需求确认门禁与规格书 API 使用稳定请求响应', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createRequirement({
      code: 'REQ-AUTHORITY',
      title: '权威需求',
      description: '验证生命周期与规格书接口',
      owner: 'pm'
    })
    const server = await startServer(root, { port: 0, previewPort: 0 })
    const base = `http://127.0.0.1:${server.port}`
    try {
      let result = await json(base, '/api/requirements/REQ-AUTHORITY/confirmation-preflight')
      t.assert.strictEqual(result.status, 200)
      t.assert.strictEqual(result.body.ready, false)
      t.assert.deepStrictEqual(result.body.blockers.map((item) => item.code), ['REQUIREMENT_SPEC_REQUIRED'])

      result = await json(base, '/api/requirements/REQ-AUTHORITY/transition', 'POST', {
        target: 'confirmed', reason: '不应绕过门禁', actor: 'Browser', at: '2000-01-01T00:00:00.000Z'
      })
      t.assert.strictEqual(result.status, 409)
      t.assert.strictEqual(result.body.code, 'REQUIREMENT_CONFIRMATION_BLOCKED')
      t.assert.strictEqual(hub.getRequirement('REQ-AUTHORITY').status, 'draft')

      result = await json(base, '/api/requirements/REQ-AUTHORITY/spec')
      t.assert.deepStrictEqual(result.body, { code: 'REQ-AUTHORITY', markdown: '' })
      result = await json(base, '/api/requirements/REQ-AUTHORITY/spec', 'PUT', null)
      t.assert.strictEqual(result.status, 400)
      t.assert.strictEqual(result.body.code, 'REQUEST_BODY_INVALID')
      result = await json(base, '/api/requirements/REQ-AUTHORITY/spec', 'PUT', {})
      t.assert.strictEqual(result.status, 400)
      t.assert.strictEqual(result.body.code, 'REQUIREMENT_SPEC_MARKDOWN_REQUIRED')
      result = await json(base, '/api/requirements/REQ-AUTHORITY/spec', 'PUT', { markdown: '# 验收标准' })
      t.assert.deepStrictEqual(result.body, { code: 'REQ-AUTHORITY', markdown: '# 验收标准\n' })

      result = await json(base, '/api/requirements/REQ-AUTHORITY/confirmation-preflight')
      t.assert.strictEqual(result.body.ready, true)
      result = await json(base, '/api/requirements/REQ-AUTHORITY/transition', 'POST', null)
      t.assert.strictEqual(result.status, 400)
      t.assert.strictEqual(result.body.code, 'REQUEST_BODY_INVALID')
      result = await json(base, '/api/requirements/REQ-AUTHORITY/transition', 'POST', {})
      t.assert.strictEqual(result.status, 400)
      t.assert.strictEqual(result.body.code, 'REQUIREMENT_TARGET_REQUIRED')

      result = await json(base, '/api/requirements/REQ-AUTHORITY/transition', 'POST', {
        target: 'confirmed', reason: '评审通过', actor: 'Browser', at: '2000-01-01T00:00:00.000Z'
      })
      t.assert.strictEqual(result.status, 200)
      t.assert.strictEqual(result.body.status, 'confirmed')
      t.assert.strictEqual(result.body.statusReason, '评审通过')
      t.assert.notStrictEqual(result.body.statusChangedBy, 'Browser')
      t.assert.notStrictEqual(result.body.statusChangedAt, '2000-01-01T00:00:00.000Z')

      result = await json(base, '/api/requirements/REQ-AUTHORITY/spec', 'PUT', { markdown: '' })
      t.assert.deepStrictEqual(result.body, { code: 'REQ-AUTHORITY', markdown: '' })
    } finally { await server.close() }
  })
})
