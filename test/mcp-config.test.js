import { after, before, describe, test } from 'node:test'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, newHub } from './helpers.js'
import { inspectRequirementPoolManifest, inspectRequirementPoolStatus, requirementPoolManifestTemplate, resolveCapability } from '../src/core/mcp-config.js'

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

  test('需求池配置 JSON 导入为需求 MCP 服务和只读能力', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'demand-pool', name: '需求池平台', type: 'requirement-pool', docsUrl: 'https://docs.example/pool' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, headers: { Authorization: 'Bearer ${secret}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', priority: 'priority', owner: 'owner' },
      statuses: { doing: '开发中' },
      secrets: [{ name: 'secret', label: '访问 Token' }],
      safety: { readOnly: true }
    }

    const preview = inspectRequirementPoolManifest(manifest)
    t.assert.deepStrictEqual(preview.blockers, [])
    t.assert.strictEqual(preview.server.id, 'demand-pool-mcp')
    t.assert.strictEqual(preview.capability.options.platform.name, '需求池平台')

    const info = hub.importRequirementPoolManifest(manifest)
    const server = info.config.servers.find((item) => item.id === 'demand-pool-mcp')
    t.assert.strictEqual(server.url, `${baseUrl}/mcp`)
    t.assert.deepStrictEqual(server.headers, { Authorization: 'Bearer ${secret}' })
    t.assert.strictEqual(info.config.capabilities.requirements.enabled, true)
    t.assert.strictEqual(info.config.capabilities.requirements.server, 'demand-pool-mcp')
    t.assert.strictEqual(info.config.capabilities.requirements.tools.search, 'requirements.search')
    t.assert.strictEqual(info.imported.secrets[0].name, 'secret')
  })

  test('需求池配置模板不含明文密钥且可通过预览校验', (t) => {
    const template = requirementPoolManifestTemplate()
    const preview = inspectRequirementPoolManifest(template)
    t.assert.deepStrictEqual(preview.blockers, [])
    t.assert.deepStrictEqual(preview.warnings, [])
    t.assert.strictEqual(preview.server.headers.Authorization, 'Bearer ${secret:demand-pool-mcp}')
    t.assert.strictEqual(preview.secrets[0].name, 'demand-pool-mcp')
    t.assert.strictEqual(preview.capability.options.safety.readOnly, true)
    t.assert.doesNotMatch(JSON.stringify(template), /real-token|api[_-]?key=|password=/i)
  })

  test('需求池接入诊断区分缺本机密钥和可测试状态', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.importRequirementPoolManifest({
      manifestVersion: '2026-09',
      platform: { id: 'demand-pool', name: '需求池平台' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, headers: { Authorization: 'Bearer ${secret}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title' },
      statuses: { doing: '开发中' }
    })
    const emptyStore = { getSecret: () => null }
    const missing = inspectRequirementPoolStatus(root, { secretStore: emptyStore })
    t.assert.strictEqual(missing.status, 'needs_secret')
    t.assert.strictEqual(missing.canProbe, false)
    t.assert.deepStrictEqual(missing.missingSecrets, [{ kind: 'keychain', name: 'demand-pool-mcp', label: '本机密钥 demand-pool-mcp' }])

    const stored = inspectRequirementPoolStatus(root, { secretStore: { getSecret: () => 'stored-token' } })
    t.assert.strictEqual(stored.status, 'ready_to_test')
    t.assert.strictEqual(stored.canProbe, true)
    t.assert.deepStrictEqual(stored.missingSecrets, [])
    t.assert.doesNotMatch(JSON.stringify(stored), /stored-token/)
  })

  test('需求池接入诊断可执行连接测试', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.saveMcpServer({
      id: 'requirements-mcp',
      name: '需求系统 MCP',
      url: `${baseUrl}/mcp`,
      headers: { 'X-Workspace': 'safe' }
    })
    hub.saveMcpCapability('requirements', {
      enabled: true,
      server: 'requirements-mcp',
      project: 'safe-prod',
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      options: { fields: { title: 'title' }, statuses: { doing: '开发中' } }
    })
    const status = await hub.requirementPoolStatus({ probe: true })
    t.assert.strictEqual(status.status, 'connected')
    t.assert.strictEqual(status.connected, true)
    t.assert.strictEqual(status.connection.identity, 'MCP User')
  })

  test('需求池配置 JSON 拒绝明文密钥和缺少必需工具', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const unsafe = {
      manifestVersion: '2026-09',
      platform: { id: 'demand-pool', name: '需求池平台' },
      transport: { type: 'http', url: 'https://mcp.example/api', headers: { Authorization: 'Bearer real-token-value' } },
      tools: { test: 'requirements.test', search: 'requirements.search' },
      secrets: { token: 'real-token-value' }
    }
    const preview = inspectRequirementPoolManifest(unsafe)
    t.assert.ok(preview.blockers.some((item) => item.code === 'REQUIREMENT_POOL_TOOL_MISSING'))
    t.assert.ok(preview.blockers.some((item) => item.code === 'REQUIREMENT_POOL_SECRET_INLINE'))
    t.assert.throws(
      () => hub.importRequirementPoolManifest(unsafe),
      (error) => error.code === 'REQUIREMENT_POOL_TOOL_MISSING'
    )
  })

  test('需求池配置 JSON 暂不激活本机 stdio 服务包', (t) => {
    const preview = inspectRequirementPoolManifest({
      manifestVersion: '2026-09',
      platform: { id: 'demand-pool', name: '需求池平台' },
      transport: { type: 'stdio', command: '/usr/local/bin/pool-mcp' },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' }
    })
    t.assert.ok(preview.blockers.some((item) => item.code === 'REQUIREMENT_POOL_TRANSPORT_UNSUPPORTED'))
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

  test('迭代能力可拉取，但旧推送入口不再绕过安全预览', async (t) => {
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

    await t.assert.rejects(
      hub.syncMilestoneToExternal('S-MCP', 'mcp'),
      (error) => error.code === 'PROJECT_SYNC_TARGET_REQUIRED'
    )
    t.assert.strictEqual(hub.getMilestone('S-MCP').external.status, 'active')
  })

  test('迭代能力可只配置工具与选项，不要求全局目标', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const info = hub.saveMcpCapability('milestones', {
      enabled: true,
      server: '',
      project: '',
      options: { ownerId: 7, taskType: 2 }
    })
    t.assert.strictEqual(info.config.capabilities.milestones.enabled, true)
  })

  test('迭代能力可由项目目标解析服务和项目，能力只提供工具与选项', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.saveMcpServer({
      id: 'project-task',
      name: '项目任务服务',
      type: 'stdio',
      adapter: 'assess-task',
      runtimeProfile: 'project-task-runtime'
    })
    hub.saveMcpCapability('milestones', {
      enabled: true,
      server: 'capability-only',
      project: '999',
      tools: { test: 'custom.test', get: 'custom.get', upsert: 'custom.save' },
      options: { ownerId: 7, taskType: 2, projectId: 999 }
    })

    const resolved = resolveCapability(root, 'milestones', { server: 'project-task', projectId: '123' })
    t.assert.strictEqual(resolved.server.id, 'project-task')
    t.assert.strictEqual(resolved.runtimeProfile, 'project-task-runtime')
    t.assert.strictEqual(resolved.project, '123')
    t.assert.strictEqual(resolved.tools.get, 'custom.get')
    t.assert.deepStrictEqual(resolved.capability.options, { ownerId: 7, taskType: 2, projectId: 999 })
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
