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

test('全部项目同步只写需求，保留归属、隔离失败并识别截断提示', async t => {
  let extra = false
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const rpc = JSON.parse(raw)
    const { name, arguments: args } = rpc.params
    let value
    if (name === 'list_projects') value = [{ id: 'a', name: '甲项目', code: 'A' }, { id: 'b', name: '乙项目', code: 'B' }, { id: 'empty', name: '空项目', code: 'EMPTY' }, { id: 'fail', name: '失败项目', code: 'FAIL' }, ...(extra ? [{ id: 'new', name: '新增项目', code: 'NEW' }] : [])]
    if (name === 'list_requirements') value = args.projectId === 'empty' ? [] : [{ id: args.projectId + '-1', code: 'DUPLICATE', name: '需求' }]
    if (name === 'get_requirement_detail') value = { id: args.requirementId, code: 'DUPLICATE', projectId: args.requirementId.split('-')[0], name: '完整需求', businessDescription: '正文' }
    const result = args.projectId === 'fail'
      ? { isError: true, content: [{ type: 'text', text: '项目不可用' }] }
      : { content: [{ type: 'text', text: (args.projectId === 'b' ? '结果已截断\n' : '') + JSON.stringify(value) }] }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.saveMcpServer({ id: 'hubpool', type: 'http', url: `http://127.0.0.1:${server.address().port}`, headers: { 'X-Test': '1' } })
  hub.saveMcpCapability('requirements', { enabled: true, server: 'hubpool', project: '', options: { protocol: 'hubpool', scope: 'all' }, tools: { test: 'list_projects', search: 'list_requirements', get: 'get_requirement_detail' } })
  assert.match((await hub.testRequirementConnection('mcp')).identity, /全部 4 个项目/)
  const preview = await hub.syncExternalRequirements('mcp', {}, { preview: true })
  assert.equal(preview.projects.length, 4)
  assert.equal(preview.changes.length, 2)
  assert.equal(hub.listRequirements().length, 0)
  assert.equal(hub.listProjects().some(p => p.code === 'EMPTY'), false)
  const first = await hub.syncExternalRequirements('mcp')
  assert.equal(first.imported, 2)
  assert.equal(hub.listProjects().length, 0)
  assert.ok(first.warnings.some(w => w.includes('截断')))
  assert.ok(first.warnings.some(w => w.includes('失败项目')))
  assert.equal(hub.getRequirement('a-1').project, '甲项目')
  assert.equal(hub.getRequirement('b-1').projectId, 'b')
  hub.updateRequirement('a-1', { localNotes: '保留本地分析' })
  extra = true
  const next = await hub.syncExternalRequirements('mcp')
  assert.equal(next.imported, 1)
  assert.equal(hub.listProjects().length, 0)
  assert.equal(hub.getRequirement('a-1').localNotes, '保留本地分析')
  assert.equal(hub.getRequirement('new-1').project, '新增项目')
  hub.createProject({ name: '新增项目', code: 'NEW' })
  hub.deleteProject('new')
  await hub.syncExternalRequirements('mcp')
  assert.equal(hub.listProjects().some(p => p.code === 'NEW'), false)
  assert.equal(hub.getRequirement('new-1').project, '新增项目')
  hub.restoreProject('new')
  assert.equal(hub.getProject('new').name, '新增项目')
  const projectBefore = hub.getProject('new')
  await hub.syncExternalRequirements('mcp')
  assert.deepEqual(hub.getProject('new'), projectBefore)
})

test('源回收站仅在详情暴露：搜索和导入排除，同步预览并可恢复清理本地副本', async t => {
  let trashed = false
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const rpc = JSON.parse(raw), { name } = rpc.params
    const value = name === 'list_projects' ? [{ id: 'p', name: '项目' }]
      : name === 'list_requirements' ? [{ id: 'R-trash', name: '需求' }]
      : { id: 'R-trash', name: '需求', projectId: 'p', trashedAt: trashed ? '2026-09-14T00:00:00Z' : '' }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.saveMcpServer({ id: 'pool', type: 'http', url: `http://127.0.0.1:${server.address().port}`, headers: { 'X-Test': '1' } })
  hub.saveMcpCapability('requirements', { enabled: true, server: 'pool', options: { protocol: 'hubpool', scope: 'all' }, tools: { test: 'list_projects', search: 'list_requirements', get: 'get_requirement_detail' } })
  trashed = true
  assert.equal((await hub.syncExternalRequirements('mcp')).imported, 0)
  assert.deepEqual(await hub.searchExternalRequirements('mcp', ''), [])
  await assert.rejects(hub.importExternalRequirement('mcp', 'R-trash'), { code: 'REQUIREMENT_SOURCE_TRASHED' })
  trashed = false
  await hub.syncExternalRequirements('mcp')
  hub.updateRequirement('R-trash', { localNotes: '保留分析' })
  trashed = true
  const preview = await hub.syncExternalRequirements('mcp', {}, { preview: true })
  assert.equal(preview.changes[0].action, 'delete')
  assert.equal(hub.listRequirements().length, 1)
  trashed = false
  const stale = await hub.syncExternalRequirements('mcp', {}, { expected: { 'R-trash': preview.changes[0].token } })
  assert.equal(stale.failed.length, 1)
  assert.equal(hub.listRequirements().length, 1)
  trashed = true
  const result = await hub.syncExternalRequirements('mcp', {}, { expected: { 'R-trash': preview.changes[0].token } })
  assert.equal(result.removed, 1)
  assert.equal(hub.listRequirements().length, 0)
  assert.equal(hub.getRequirement('R-trash').localNotes, '保留分析')
  assert.ok(hub.getRequirement('R-trash').deletedAt)
  assert.equal((await hub.syncExternalRequirements('mcp')).removed, 0)
})
