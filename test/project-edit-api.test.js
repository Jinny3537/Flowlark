import { after, before, describe, test } from 'node:test'
import { cleanup, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'

let root
let server
let base

before(async () => {
  const context = newHub()
  root = context.root
  context.hub.createProject({ name: '华油中蓝', code: 'HYZL' })
  server = await startServer(root, { port: 0, previewPort: 0 })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  cleanup(root)
})

async function send(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

describe('项目编辑与概览 API', () => {
  test('编辑项目后 slug 稳定且列表返回需求统计', async (t) => {
    let result = await send('POST', '/api/requirements', {
      code: 'REQ-API', title: '逾期需求', project: 'hyzl', dueDate: '2000-01-01'
    })
    t.assert.strictEqual(result.status, 201)

    result = await send('PUT', '/api/projects/hyzl', {
      name: '华油中蓝二期', code: 'HYZL2', description: '二期项目', priority: 'P0', archived: true
    })
    t.assert.strictEqual(result.status, 200)
    t.assert.strictEqual(result.body.slug, 'hyzl')
    t.assert.strictEqual(result.body.code, 'HYZL2')
    t.assert.strictEqual(result.body.priority, 'P0')
    t.assert.strictEqual(result.body.archived, true)
    t.assert.strictEqual(result.body.requirementCount, 1)
    t.assert.strictEqual(result.body.overdueCount, 1)

    result = await send('GET', '/api/projects')
    t.assert.strictEqual(result.status, 200)
    t.assert.strictEqual(result.body[0].slug, 'hyzl')
    t.assert.strictEqual(result.body[0].requirementCount, 1)
  })

  test('非法项目代码和截止日期返回结构化错误', async (t) => {
    let result = await send('PUT', '/api/projects/hyzl', { code: 'bad-code' })
    t.assert.strictEqual(result.status, 400)
    t.assert.strictEqual(result.body.code, 'PROJECT_CODE_INVALID')

    result = await send('POST', '/api/requirements', {
      code: 'REQ-BAD-DATE', title: '非法日期', dueDate: '2026-02-30'
    })
    t.assert.strictEqual(result.status, 400)
    t.assert.strictEqual(result.body.code, 'REQUIREMENT_DUE_DATE_INVALID')
  })
})
