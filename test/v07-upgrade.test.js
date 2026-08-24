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

    if (req.url === '/mcp' && req.method === 'POST') {
      const params = JSON.parse(raw).params || {}
      if (params.name === 'requirements.test') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { name: 'MCP User' } } }))
      }
      if (params.name === 'requirements.search') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { items: [{ code: 'REQ-7', title: '外部需求', status: 'open', owner: 'PM' }] } } }))
      }
      if (params.name === 'requirements.get') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'REQ-7', title: '外部需求', url: 'https://mcp.example/REQ-7' }) }] } }))
      }
      if (params.name === 'requirements.comment') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { url: 'https://mcp.example/REQ-7#comment' } } }))
      }
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

  test('MCP Provider 支持连接、搜索、详情和评论', async (t) => {
    const config = { baseUrl: `${baseUrl}/mcp`, token: 'x' }
    const probe = await testRequirementConnection('mcp', config)
    t.assert.strictEqual(probe.ok, true)
    const found = await searchRequirements('mcp', config, 'REQ')
    t.assert.strictEqual(found[0].code, 'REQ-7')
    const detail = await fetchRequirement('mcp', config, 'REQ-7')
    t.assert.strictEqual(detail.title, '外部需求')
    const comment = await postRequirementComment('mcp', config, 'REQ-7', '新基线已确认')
    t.assert.strictEqual(comment.ok, true)
    t.assert.ok(requests.some((item) => item.url === '/mcp' && item.body.params.name === 'requirements.comment' && item.body.params.arguments.body === '新基线已确认'))
  })
})
