import { after, before, describe, test } from 'node:test'
import http from 'node:http'
import { cleanup, html, newHub } from './helpers.js'
import { fetchRequirement, postRequirementComment, searchRequirements, testRequirementConnection } from '../src/core/integrations/requirements/index.js'

const dirs = []
let server
let baseUrl
const requests = []

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
    res.setHeader('Content-Type', 'application/json')

    if (req.url === '/hubpool/v1/me') return res.end(JSON.stringify({ name: 'Hubpool User' }))
    if (req.url.startsWith('/hubpool/v1/requirements/search')) {
      return res.end(JSON.stringify({ items: [{ code: 'REQ-7', title: 'Hubpool 需求', status: 'open', owner: 'PM' }] }))
    }
    if (req.url === '/hubpool/v1/requirements/REQ-7') {
      return res.end(JSON.stringify({ code: 'REQ-7', title: 'Hubpool 需求', url: 'https://hubpool.test/REQ-7' }))
    }
    if (req.url === '/hubpool/v1/requirements/REQ-7/comments' && req.method === 'POST') {
      return res.end(JSON.stringify({ url: 'https://hubpool.test/REQ-7#comment' }))
    }

    if (req.url === '/custom/me') return res.end(JSON.stringify({ login: 'task-user' }))
    if (req.url.startsWith('/custom/tasks/search')) {
      return res.end(JSON.stringify({ data: [{ key: 'TASK-9', name: '自建任务', state: 'doing' }] }))
    }
    if (req.url === '/custom/tasks/TASK-9') {
      return res.end(JSON.stringify({ key: 'TASK-9', name: '自建任务' }))
    }

    res.statusCode = 404
    res.end(JSON.stringify({ message: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  dirs.forEach(cleanup)
  return new Promise((resolve) => server.close(resolve))
})

describe('v0.7 升级能力', () => {
  test('从新旧 HTML 生成变更和规格草稿', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'orders' })
    hub.createRequirement({ code: 'REQ-7', title: '批量关闭' })
    hub.addVersion('orders', {
      versionNo: 'v1.0',
      title: '首版',
      html: html('<button>保存</button><div>订单列表</div>'),
      changes: [{ type: 'ADD', location: '页面', content: '首版', requirement: 'REQ-7' }],
      requirements: ['REQ-7']
    })
    hub.setBaseline('orders', 'v1.0')
    const draft = hub.draftVersionFromHtml('orders', 'v1.0', {
      title: '批量操作',
      html: html('<button>保存</button><button>批量关闭</button><div>订单列表</div>')
    })
    t.assert.ok(draft.changes.some((item) => /批量关闭/.test(item.content)))
    t.assert.match(draft.spec, /REQ-7/)
  })

  test('Hubpool Provider 支持连接、搜索、详情和评论', async (t) => {
    const config = { baseUrl: `${baseUrl}/hubpool`, token: 'x' }
    const probe = await testRequirementConnection('hubpool', config)
    t.assert.strictEqual(probe.ok, true)
    const found = await searchRequirements('hubpool', config, 'REQ')
    t.assert.strictEqual(found[0].code, 'REQ-7')
    const detail = await fetchRequirement('hubpool', config, 'REQ-7')
    t.assert.strictEqual(detail.title, 'Hubpool 需求')
    const comment = await postRequirementComment('hubpool', config, 'REQ-7', '新基线已确认')
    t.assert.strictEqual(comment.ok, true)
    t.assert.ok(requests.some((item) => item.url === '/hubpool/v1/requirements/REQ-7/comments' && item.body.body === '新基线已确认'))
  })

  test('自建任务平台 Provider 支持可配置路径', async (t) => {
    const config = {
      baseUrl: `${baseUrl}/custom`,
      token: 'x',
      searchPath: '/tasks/search?q={q}',
      detailPath: '/tasks/{key}'
    }
    const probe = await testRequirementConnection('custom', config)
    t.assert.strictEqual(probe.identity, 'task-user')
    const found = await searchRequirements('custom', config, 'TASK')
    t.assert.strictEqual(found[0].code, 'TASK-9')
    const detail = await fetchRequirement('custom', config, 'TASK-9')
    t.assert.strictEqual(detail.title, '自建任务')
  })
})
