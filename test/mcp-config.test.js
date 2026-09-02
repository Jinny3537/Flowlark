import { after, before, describe, test } from 'node:test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, newHub } from './helpers.js'

const dirs = []
let server
let baseUrl

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const name = body.params?.name
    res.setHeader('Content-Type', 'application/json')
    if (name === 'requirements.test') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { name: 'MCP User' } } }))
    }
    if (name === 'requirements.search') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { items: [{ code: 'REQ-MCP', title: 'MCP 需求' }] } } }))
    }
    if (name === 'requirements.get') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { code: 'REQ-MCP', title: 'MCP 需求已更新', project: '安全生产', module: '作业票', type: '功能', priority: 'P1', owner: 'PM', status: 'doing' } } }))
    }
    if (name === 'milestones.test') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { name: 'MCP User' } } }))
    }
    if (name === 'milestones.list') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { items: [{ name: 'S-MCP', title: 'MCP 迭代', startAt: '2026-08-01', endAt: '2026-08-15', status: 'active', url: 'https://task.test/S-MCP' }] } } }))
    }
    if (name === 'milestones.upsert') {
      const item = body.params?.arguments?.milestone || {}
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { name: item.name, title: item.title, startAt: item.startAt, endAt: item.endAt, status: 'synced', url: `https://task.test/${item.name}` } } }))
    }
    if (name === 'tickets.test') {
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { identity: 'Tickets MCP' } } }))
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

describe('MCP 配置文件', () => {
  test('schema 2 支持 stdio 服务并保留本机配置引用', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const info = hub.saveMcpServer({
      id: 'assess-task-local',
      name: '研发任务管理',
      type: 'stdio',
      adapter: 'assess-task',
      runtimeProfile: 'assess-task-local',
      timeoutMs: 15000
    })
    t.assert.strictEqual(info.config.schemaVersion, 2)
    t.assert.deepStrictEqual(info.config.servers[0], {
      id: 'assess-task-local',
      name: '研发任务管理',
      type: 'stdio',
      adapter: 'assess-task',
      runtimeProfile: 'assess-task-local',
      enabled: true,
      url: '',
      timeoutMs: 15000,
      headers: {}
    })
    const configured = hub.saveMcpCapability('milestones', {
      enabled: true,
      server: 'assess-task-local',
      project: '123',
      options: { ownerId: 7, taskType: 2, priorities: { P1: 1 }, timezoneOffset: '+08:00' }
    })
    t.assert.deepStrictEqual(configured.config.capabilities.milestones.options, {
      ownerId: 7, taskType: 2, priorities: { P1: 1 }, timezoneOffset: '+08:00'
    })
  })

  test('schema 1 HTTP 服务读取后升级且配置不丢失', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    fs.writeFileSync(path.join(root, 'mcp.json'), JSON.stringify({
      schemaVersion: 1,
      servers: [{ id: 'legacy', name: '旧 MCP', type: 'http', url: 'https://mcp.example/api', headers: { 'X-Test': 'yes' } }],
      capabilities: {}
    }))
    const info = hub.mcpConfig()
    t.assert.strictEqual(info.config.schemaVersion, 2)
    t.assert.strictEqual(info.config.servers[0].url, 'https://mcp.example/api')
    t.assert.deepStrictEqual(info.config.servers[0].headers, { 'X-Test': 'yes' })
  })

  test('stdio 服务缺少适配器或本机配置引用时拒绝保存', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    t.assert.throws(() => hub.saveMcpServer({
      id: 'missing-adapter', type: 'stdio', runtimeProfile: 'profile'
    }), /适配器/)
    t.assert.throws(() => hub.saveMcpServer({
      id: 'missing-profile', type: 'stdio', adapter: 'assess-task'
    }), /本机运行配置/)
  })

  test('保存服务和需求能力会写入 mcp.json，并驱动需求导入', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)

    let info = hub.saveMcpServer({ id: 'requirements-mcp', name: '需求系统 MCP', url: `${baseUrl}/mcp` })
    t.assert.strictEqual(info.exists, true)
    t.assert.ok(fs.existsSync(path.join(root, 'mcp.json')))
    t.assert.strictEqual(info.config.servers[0].headers.Authorization, 'Bearer ${secret}')

    info = hub.saveMcpCapability('requirements', {
      enabled: true,
      server: 'requirements-mcp',
      project: 'safe-prod',
      tools: {
        test: 'requirements.test',
        search: 'requirements.search',
        get: 'requirements.get',
        comment: 'requirements.comment'
      }
    })
    t.assert.strictEqual(info.config.capabilities.requirements.enabled, true)

    const probe = await hub.testRequirementConnection('mcp')
    t.assert.strictEqual(probe.identity, 'MCP User')
    const found = await hub.searchExternalRequirements('mcp', 'REQ')
    t.assert.strictEqual(found[0].code, 'REQ-MCP')
    const item = await hub.importExternalRequirement('mcp', 'REQ-MCP')
    t.assert.strictEqual(item.title, 'MCP 需求已更新')
    t.assert.strictEqual(item.project, '安全生产')
    t.assert.strictEqual(item.module, '作业票')
    t.assert.strictEqual(item.type, '功能')
    t.assert.strictEqual(item.priority, 'P1')
    t.assert.strictEqual(item.external.status, 'doing')

    const synced = await hub.syncExternalRequirements('mcp')
    t.assert.strictEqual(synced.total, 1)
    t.assert.strictEqual(synced.updated, 1)
    t.assert.strictEqual(synced.items[0].external.status, 'doing')
  })

  test('启用需求能力但没有绑定服务会被拦截', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    t.assert.throws(() => hub.saveMcpCapability('requirements', { enabled: true, server: '' }), /需求 MCP 能力已启用/)
  })

  test('迭代能力支持从任务平台拉取和推送本地迭代', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.saveMcpServer({ id: 'planning-mcp', name: '迭代系统 MCP', url: `${baseUrl}/mcp` })
    hub.saveMcpCapability('milestones', {
      enabled: true,
      server: 'planning-mcp',
      project: 'safe-prod',
      tools: {
        test: 'milestones.test',
        list: 'milestones.list',
        get: 'milestones.get',
        upsert: 'milestones.upsert'
      }
    })

    const probe = await hub.testMilestoneConnection('mcp')
    t.assert.strictEqual(probe.identity, 'MCP User')
    const synced = await hub.syncExternalMilestones('mcp')
    t.assert.strictEqual(synced.created, 1)
    t.assert.strictEqual(hub.getMilestone('S-MCP').external.status, 'active')

    const pushed = await hub.syncMilestoneToExternal('S-MCP', 'mcp')
    t.assert.strictEqual(pushed.external.status, 'synced')
    t.assert.strictEqual(pushed.external.url, 'https://task.test/S-MCP')
  })

  test('启用迭代能力但没有绑定服务会被拦截', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    t.assert.throws(() => hub.saveMcpCapability('milestones', { enabled: true, server: '' }), /迭代 MCP 能力已启用/)
  })

  test('支持保存、测试和删除扩展模块 MCP 能力', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)

    hub.saveMcpServer({ id: 'module-hub', name: 'Module Hub MCP', url: `${baseUrl}/mcp` })
    let info = hub.saveMcpCapability('tickets', {
      enabled: true,
      server: 'module-hub',
      label: '工单',
      category: 'support',
      description: '同步服务台工单',
      project: 'ops',
      tools: {
        test: 'tickets.test',
        search: 'tickets.search',
        get: 'tickets.get'
      }
    })

    t.assert.strictEqual(info.config.capabilities.tickets.enabled, true)
    t.assert.strictEqual(info.config.capabilities.tickets.label, '工单')
    t.assert.strictEqual(info.config.capabilities.tickets.tools.search, 'tickets.search')

    const probe = await hub.testMcpCapability('tickets')
    t.assert.strictEqual(probe.identity, 'Tickets MCP')

    info = hub.removeMcpCapability('tickets')
    t.assert.strictEqual(info.config.capabilities.tickets, undefined)
    t.assert.ok(info.config.capabilities.requirements)
    t.assert.throws(() => hub.removeMcpCapability('requirements'), /内置 MCP 能力不能删除/)
  })
})
