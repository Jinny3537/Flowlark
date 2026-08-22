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
})
