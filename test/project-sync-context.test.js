import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, tmpRepo } from './helpers.js'
import * as store from '../src/core/store.js'
import { resolveProjectSyncContext } from '../src/core/project-sync-context.js'

const roots = []
const managedFields = ['description', 'status', 'title']

afterEach(() => {
  roots.splice(0).forEach(cleanup)
})

function fixture({ projects, servers, capability = {} } = {}) {
  const root = tmpRepo()
  roots.push(root)
  for (const [slug, sync] of Object.entries(projects || {})) {
    store.writeProject(root, slug, {
      slug,
      name: slug,
      code: slug.toUpperCase(),
      sync: { mode: 'manual', managedFields, ...sync }
    })
  }
  return {
    root,
    mcpInfo: {
      config: {
        servers: servers || [assessServer('project-server')],
        capabilities: {
          milestones: {
            enabled: true,
            server: 'capability-server',
            project: '999',
            tools: { get: 'sprints.get', upsert: 'sprints.save' },
            options: { ownerId: 7, taskType: 2 },
            ...capability
          }
        }
      }
    }
  }
}

function assessServer(id, patch = {}) {
  return {
    id,
    name: id,
    type: 'stdio',
    adapter: 'assess-task',
    runtimeProfile: `${id}-runtime`,
    enabled: true,
    ...patch
  }
}

function milestone(name, projects, external = null) {
  return {
    name,
    items: projects.map((project, index) => ({
      requirement: `REQ-${index + 1}`,
      project,
      version: 'v1'
    })),
    external
  }
}

function onlyBlocker(result, expected) {
  assert.equal(result.ready, false)
  assert.equal(result.blockers.length, 1)
  assert.deepEqual(result.blockers[0], expected)
}

describe('project synchronization context', () => {
  test('resolves one project from its selected server and ignores the capability target', () => {
    const { root, mcpInfo } = fixture({
      projects: {
        orders: {
          server: 'project-server',
          projectId: '123',
          managedFields: ['status', 'title', 'description', 'title']
        }
      },
      servers: [assessServer('capability-server'), assessServer('project-server')]
    })

    assert.deepEqual(resolveProjectSyncContext(root, milestone('S1', ['orders']), mcpInfo), {
      ready: true,
      blockers: [],
      server: 'project-server',
      projectId: '123',
      managedFields,
      capability: mcpInfo.config.capabilities.milestones,
      serverConfig: mcpInfo.config.servers[1]
    })
  })

  test('allows multiple projects that resolve to the same normalized target', () => {
    const { root, mcpInfo } = fixture({
      projects: {
        orders: { server: 'project-server', projectId: '123', managedFields: ['status', 'title', 'description'] },
        inventory: { server: 'project-server', projectId: 123, managedFields: ['description', 'status', 'title'] }
      }
    })

    const result = resolveProjectSyncContext(root, milestone('S2', ['orders', 'inventory']), mcpInfo)
    assert.equal(result.ready, true)
    assert.equal(result.server, 'project-server')
    assert.equal(result.projectId, '123')
    assert.deepEqual(result.managedFields, managedFields)
  })

  test('blocks a project with no selected server or external project ID', async (t) => {
    await t.test('server', () => {
      const { root, mcpInfo } = fixture({
        projects: { orders: { server: '', projectId: '123' } }
      })
      onlyBlocker(resolveProjectSyncContext(root, milestone('S3', ['orders']), mcpInfo), {
        code: 'PROJECT_SYNC_TARGET_REQUIRED',
        project: 'orders',
        message: 'orders 尚未选择同步 MCP 服务',
        repairTo: '/projects/orders/sync'
      })
    })

    await t.test('projectId', () => {
      const { root, mcpInfo } = fixture({
        projects: { orders: { server: 'project-server', projectId: '' } }
      })
      onlyBlocker(resolveProjectSyncContext(root, milestone('S3', ['orders']), mcpInfo), {
        code: 'PROJECT_SYNC_TARGET_REQUIRED',
        project: 'orders',
        message: 'orders 尚未填写外部项目 ID',
        repairTo: '/projects/orders/sync'
      })
    })
  })

  test('blocks projects that select different servers or project IDs', async (t) => {
    await t.test('server', () => {
      const { root, mcpInfo } = fixture({
        projects: {
          orders: { server: 'project-server', projectId: '123' },
          inventory: { server: 'other-server', projectId: '123' }
        },
        servers: [assessServer('project-server'), assessServer('other-server')]
      })
      onlyBlocker(resolveProjectSyncContext(root, milestone('S4', ['orders', 'inventory']), mcpInfo), {
        code: 'PROJECT_SYNC_TARGET_MISMATCH',
        project: 'inventory',
        message: 'inventory 的同步目标与 orders 不一致',
        repairTo: '/projects/inventory/sync'
      })
    })

    await t.test('projectId', () => {
      const { root, mcpInfo } = fixture({
        projects: {
          orders: { server: 'project-server', projectId: '123' },
          inventory: { server: 'project-server', projectId: '456' }
        }
      })
      onlyBlocker(resolveProjectSyncContext(root, milestone('S4', ['orders', 'inventory']), mcpInfo), {
        code: 'PROJECT_SYNC_TARGET_MISMATCH',
        project: 'inventory',
        message: 'inventory 的同步目标与 orders 不一致',
        repairTo: '/projects/inventory/sync'
      })
    })
  })

  test('blocks projects with different normalized managed fields', () => {
    const { root, mcpInfo } = fixture({
      projects: {
        orders: { server: 'project-server', projectId: '123' },
        inventory: { server: 'project-server', projectId: '123', managedFields: ['title', 'status'] }
      }
    })
    onlyBlocker(resolveProjectSyncContext(root, milestone('S5', ['orders', 'inventory']), mcpInfo), {
      code: 'PROJECT_SYNC_MANAGED_FIELDS_MISMATCH',
      project: 'inventory',
      message: 'inventory 的托管字段与 orders 不一致',
      repairTo: '/projects/inventory/sync'
    })
  })

  test('requires an enabled milestones capability for tool names and mapping options', async (t) => {
    await t.test('missing', () => {
      const { root, mcpInfo } = fixture({
        projects: { orders: { server: 'project-server', projectId: '123' } }
      })
      delete mcpInfo.config.capabilities.milestones
      onlyBlocker(resolveProjectSyncContext(root, milestone('S6', ['orders']), mcpInfo), {
        code: 'MCP_CAPABILITY_MISSING',
        message: '迭代 MCP 能力不存在',
        repairTo: '/settings/mcp'
      })
    })

    await t.test('disabled', () => {
      const { root, mcpInfo } = fixture({
        projects: { orders: { server: 'project-server', projectId: '123' } },
        capability: { enabled: false }
      })
      onlyBlocker(resolveProjectSyncContext(root, milestone('S6', ['orders']), mcpInfo), {
        code: 'MCP_CAPABILITY_DISABLED',
        message: '迭代 MCP 能力尚未启用',
        repairTo: '/settings/mcp'
      })
    })
  })

  test('validates the selected project server without falling back to the capability server', async (t) => {
    const cases = [
      {
        name: 'missing',
        servers: [assessServer('capability-server')],
        expected: {
          code: 'MCP_SERVER_MISSING',
          message: '项目 orders 选择的 MCP 服务 project-server 不存在'
        }
      },
      {
        name: 'disabled',
        servers: [assessServer('project-server', { enabled: false })],
        expected: {
          code: 'MCP_SERVER_DISABLED',
          message: 'MCP 服务 project-server 已停用'
        }
      },
      {
        name: 'non-stdio',
        servers: [assessServer('project-server', { type: 'http', adapter: undefined })],
        expected: {
          code: 'MCP_SERVER_TRANSPORT_INVALID',
          message: 'MCP 服务 project-server 不是 stdio 服务'
        }
      },
      {
        name: 'non-assess',
        servers: [assessServer('project-server', { adapter: 'other-adapter' })],
        expected: {
          code: 'MCP_SERVER_ADAPTER_INVALID',
          message: 'MCP 服务 project-server 未使用 assess-task 适配器'
        }
      },
      {
        name: 'missing-runtime-profile',
        servers: [assessServer('project-server', { runtimeProfile: '' })],
        expected: {
          code: 'MCP_RUNTIME_PROFILE_REQUIRED',
          message: 'MCP 服务 project-server 缺少本机运行配置'
        }
      }
    ]

    for (const entry of cases) {
      await t.test(entry.name, () => {
        const { root, mcpInfo } = fixture({
          projects: { orders: { server: 'project-server', projectId: '123' } },
          servers: entry.servers
        })
        onlyBlocker(resolveProjectSyncContext(root, milestone('S6', ['orders']), mcpInfo), {
          ...entry.expected,
          project: 'orders',
          repairTo: '/settings/mcp'
        })
      })
    }
  })

  test('blocks an existing Sprint bound to a different server or project', () => {
    const { root, mcpInfo } = fixture({
      projects: { orders: { server: 'project-server', projectId: '123' } }
    })
    const item = milestone('S7', ['orders'], {
      provider: 'assess-task',
      server: 'other-server',
      projectId: '456',
      sprintId: 10
    })
    onlyBlocker(resolveProjectSyncContext(root, item, mcpInfo), {
      code: 'MILESTONE_EXTERNAL_TARGET_MISMATCH',
      message: '迭代 S7 已绑定到另一同步目标',
      repairTo: '/milestones/S7'
    })
  })
})
