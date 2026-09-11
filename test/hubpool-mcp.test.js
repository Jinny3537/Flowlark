import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { newHub, cleanup } from './helpers.js'
import { fetchRequirement, postComment } from '../src/core/integrations/requirements/mcp.js'

test('HubPooL SSE 协议：连接、关键词查询、详情导入、错误和只读边界', async (t) => {
  const calls = []
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const rpc = JSON.parse(raw)
    const { name, arguments: args } = rpc.params
    calls.push({ name, args })
    let value
    if (name === 'list_projects') value = [{ id: 'proj-test', name: '测试项目' }]
    if (name === 'list_requirements') value = [{ id: 'REQ-001', name: '登录需求', priority: 'P1' }]
    if (name === 'get_requirement_detail') value = { id: 'REQ-001', name: '登录需求', projectId: 'proj-test', businessDescription: '支持手机登录', acceptanceCriteria: '- [ ] 验证码有效', businessValue: '减少登录失败', businessRule: '验证码五分钟有效', functionPoints: '手机登录', impactScope: '用户中心', stage: '需求分析', analysisStatus: '待分析', expectedOnlineDate: 'TBD', targetDeliveryDate: 'TBD', versionId: 'ver-test', updatedAt: 1789035796413 }
    if (name === 'list_versions') value = [{ id: 'ver-test', name: '九月发布' }]
    const result = args.requirementId === 'missing'
      ? { isError: true, content: [{ type: 'text', text: '需求不存在' }] }
      : { content: [{ type: 'text', text: JSON.stringify(value) }] }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  hub.saveMcpServer({ id: 'hubpool', type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { 'X-Test': 'test' } })
  hub.saveMcpCapability('requirements', { enabled: true, server: 'hubpool', project: 'proj-test', options: { protocol: 'hubpool' }, tools: { test: 'list_projects', search: 'list_requirements', get: 'get_requirement_detail' } })
  assert.equal((await hub.testRequirementConnection('mcp')).identity, 'HubPooL · 测试项目')
  assert.equal((await hub.searchExternalRequirements('mcp', '登录'))[0].code, 'REQ-001')
  const config = hub.requirementConfig('mcp')
  const detail = await fetchRequirement(config, 'REQ-001')
  assert.equal(detail.description, '支持手机登录')
  assert.equal(detail.project, '测试项目')
  assert.equal(detail.projectId, 'proj-test')
  assert.equal(detail.raw.acceptanceCriteria, '- [ ] 验证码有效')
  await hub.importExternalRequirement('mcp', 'REQ-001')
  const stored = hub.getRequirement('REQ-001')
  assert.equal(stored.businessValue, '减少登录失败')
  assert.equal(stored.businessRule, '验证码五分钟有效')
  assert.equal(stored.acceptanceCriteria, '- [ ] 验证码有效')
  assert.equal(stored.versionName, '九月发布')
  assert.equal(stored.stage, '需求分析')
  assert.equal(stored.expectedOnlineDate, 'TBD')
  assert.equal(stored.targetDeliveryDate, 'TBD')
  assert.equal(stored.sourceUpdatedAt, new Date(1789035796413).toISOString())
  assert.deepEqual(calls.slice(0, 3), [
    { name: 'list_projects', args: {} },
    { name: 'list_requirements', args: { projectId: 'proj-test', keyword: '登录', limit: 20 } },
    { name: 'get_requirement_detail', args: { requirementId: 'REQ-001' } }
  ])
  await assert.rejects(fetchRequirement(config, 'missing'), { code: 'MCP_TOOL_ERROR', message: '需求不存在' })
  await assert.rejects(hub.testRequirementConnection('mcp', { project: 'missing' }), { code: 'REQUIREMENT_PROJECT_INVALID' })
  const before = calls.length
  await assert.rejects(postComment(config, 'REQ-001', '回写'), { code: 'REQUIREMENT_COMMENT_UNSUPPORTED' })
  assert.equal(calls.length, before)
})

test('需求池同步会首次导入、更新、发现新增，并报告冲突与单条失败', async (t) => {
  let title = '首版标题'
  let extra = false
  let fail = false
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const rpc = JSON.parse(raw)
    const { name, arguments: args } = rpc.params
    let value
    if (name === 'list_requirements') {
      assert.equal(args.projectId, 'proj-test')
      assert.equal(args.keyword, '')
      assert.equal(args.limit, 500)
      value = Array.from({ length: 21 }, (_, i) => ({ id: `REQ-${i}`, name: title }))
      if (extra) value.push({ id: 'REQ-new', name: '新增' }, { id: 'LOCAL', name: '冲突' })
    } else {
      value = { id: args.requirementId, name: title, businessDescription: '完整业务描述', projectId: 'proj-test' }
    }
    const result = fail && args.requirementId === 'REQ-0'
      ? { isError: true, content: [{ type: 'text', text: '读取失败' }] }
      : { content: [{ type: 'text', text: JSON.stringify(value) }] }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  hub.saveMcpServer({ id: 'hubpool', type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { 'X-Test': 'test' } })
  hub.saveMcpCapability('requirements', { enabled: true, server: 'hubpool', project: 'proj-test', options: { protocol: 'hubpool' }, tools: { test: 'list_projects', search: 'list_requirements', get: 'get_requirement_detail' } })
  const first = await hub.syncExternalRequirements('mcp')
  assert.equal(first.total, 21)
  assert.equal(first.imported, 21)
  assert.equal(first.updated, 21)
  assert.deepEqual(first.failed, [])
  assert.equal(hub.getRequirement('REQ-0').description, '完整业务描述')
  title = '更新标题'
  const second = await hub.syncExternalRequirements('mcp')
  assert.equal(second.imported, 0)
  assert.equal(second.items.length, 21)
  assert.equal(hub.getRequirement('REQ-0').title, title)
  hub.createRequirement({ code: 'LOCAL', title: '本地需求' })
  extra = true
  fail = true
  const third = await hub.syncExternalRequirements('mcp')
  assert.equal(third.total, 23)
  assert.equal(third.updated, 21)
  assert.equal(third.imported, 1)
  assert.equal(third.failed.length, 2)
  assert.equal(hub.getRequirement('LOCAL').title, '本地需求')
  assert.equal(hub.getRequirement('REQ-new').external.provider, 'mcp')
})
