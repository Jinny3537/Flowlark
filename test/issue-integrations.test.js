import { after, before, describe, test } from 'node:test'
import http from 'node:http'
import { createIssue, searchIssues, testIssueConnection } from '../src/core/integrations/issues/index.js'
import { getSecret } from '../src/core/secrets.js'

let server
let baseUrl
const requests = []

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null })
    res.setHeader('Content-Type', 'application/json')

    if (req.url.startsWith('/github/user')) return res.end(JSON.stringify({ login: 'octo' }))
    if (req.url.startsWith('/github/repos/') && req.method === 'POST') return res.end(JSON.stringify({ number: 12, title: '反馈', html_url: 'https://github.test/issues/12' }))
    if (req.url.startsWith('/github/search/issues')) return res.end(JSON.stringify({ items: [{ number: 12, title: '反馈', html_url: 'https://github.test/issues/12', state: 'open' }] }))

    if (req.url.startsWith('/gitlab/user')) return res.end(JSON.stringify({ username: 'fox' }))
    if (req.url.startsWith('/gitlab/projects/') && req.method === 'POST') return res.end(JSON.stringify({ iid: 23, title: '反馈', web_url: 'https://gitlab.test/issues/23' }))
    if (req.url.startsWith('/gitlab/projects/')) return res.end(JSON.stringify([{ iid: 23, title: '反馈', web_url: 'https://gitlab.test/issues/23', state: 'opened' }]))

    if (req.url.startsWith('/gitee/user')) return res.end(JSON.stringify({ login: 'bird' }))
    if (req.url.startsWith('/gitee/repos/') && req.method === 'POST') return res.end(JSON.stringify({ number: 'I24', title: '反馈', html_url: 'https://gitee.test/issues/I24' }))
    if (req.url.startsWith('/gitee/repos/')) return res.end(JSON.stringify([{ number: 'I24', title: '反馈', body: '订单反馈', html_url: 'https://gitee.test/issues/I24', state: 'open' }]))

    res.statusCode = 404
    res.end(JSON.stringify({ message: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

const feedback = {
  title: '确认按钮无响应', description: '点击后没有变化', project: 'orders', version: 'v2.4',
  requirements: ['REQ-27'], anchor: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
}

describe('Issue Provider', () => {
  const cases = [
    ['github', () => ({ baseUrl: `${baseUrl}/github`, owner: 'team', repo: 'app', token: 'x' })],
    ['gitlab', () => ({ baseUrl: `${baseUrl}/gitlab`, projectId: 'team/app', token: 'x' })],
    ['gitee', () => ({ baseUrl: `${baseUrl}/gitee`, owner: 'team', repo: 'app', token: 'x' })]
  ]

  for (const [provider, config] of cases) {
    test(`${provider} 测试连接、创建和搜索`, async (t) => {
      const probe = await testIssueConnection(provider, config())
      t.assert.strictEqual(probe.ok, true)
      const issue = await createIssue(provider, config(), feedback)
      t.assert.strictEqual(issue.provider, provider)
      t.assert.ok(issue.number)
      t.assert.match(issue.url, /^https:/)
      const found = await searchIssues(provider, config(), '反馈')
      t.assert.strictEqual(found.length, 1)
    })
  }

  test('未配置 Token 时给出统一错误', async (t) => {
    await t.assert.rejects(
      () => createIssue('github', { baseUrl: `${baseUrl}/github`, owner: 'team', repo: 'app' }, feedback),
      (e) => e.code === 'INTEGRATION_TOKEN_MISSING'
    )
  })

  test('环境变量优先提供密钥', (t) => {
    process.env.FLOWLARK_TEST_SECRET = 'from-env'
    try { t.assert.strictEqual(getSecret('test', { envKey: 'FLOWLARK_TEST_SECRET' }), 'from-env') }
    finally { delete process.env.FLOWLARK_TEST_SECRET }
  })

  test('请求正文带完整反馈上下文', (t) => {
    const body = requests.find((item) => item.url.startsWith('/github/repos/') && item.method === 'POST').body.body
    t.assert.match(body, /REQ-27/)
    t.assert.match(body, /v2\.4/)
  })
})
