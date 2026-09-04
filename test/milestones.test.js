import { after, describe, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import * as milestones from '../src/core/milestones.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('迭代', () => {
  test('新迭代保存目标、负责人和计划中状态', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const item = hub.createMilestone({ name: 'S0', title: '启动', goal: '完成联调', owner: 'zhangsan' })
    t.assert.strictEqual(item.goal, '完成联调')
    t.assert.strictEqual(item.owner, 'zhangsan')
    t.assert.strictEqual(item.status, 'planning')
  })

  test('显式固定需求、项目和版本，并报告草稿与基线漂移', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    hub.createRequirement({ code: 'REQ-1', title: '需求一' })
    hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-1'] })
    const item = hub.createMilestone({
      name: '2026-S12', title: 'S12', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
    })
    t.assert.strictEqual(item.items[0].version, 'v1')
    t.assert.ok(item.warnings.some((warning) => warning.code === 'VERSION_DRAFT'))
    t.assert.ok(item.warnings.some((warning) => warning.code === 'BASELINE_DRIFT'))
    hub.setBaseline('orders', 'v1')
    t.assert.strictEqual(hub.getMilestone('2026-S12').ready, true)
  })

  test('引用不存在的需求或版本时提前拒绝', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    t.assert.throws(() => hub.createMilestone({ name: 'S1', items: [{ requirement: 'REQ-X', project: 'orders', version: 'v1' }] }),
      (e) => e.code === 'MILESTONE_REQUIREMENT_MISSING')
  })

  test('普通创建和更新不能注入 Sprint 绑定', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    t.assert.throws(() => hub.createMilestone({
      name: 'S-EXTERNAL',
      external: { provider: 'assess-task', server: 'team', projectId: 123, sprintId: 7 },
      trusted: true
    }), (error) => error.code === 'MILESTONE_MANAGED_FIELD')
    hub.createMilestone({ name: 'S-EXTERNAL', title: '绑定保护' })
    t.assert.throws(() => hub.updateMilestone('S-EXTERNAL', {
      external: { provider: 'assess-task', server: 'team', projectId: 123, sprintId: 7 },
      trusted: true
    }), (error) => error.code === 'MILESTONE_MANAGED_FIELD')
  })

  test('受控 Sprint 绑定执行 CAS 并清空同步哈希', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createMilestone({ name: 'S-CAS', title: 'CAS' })
    let item = milestones.replaceExternalSprint(root, 'S-CAS', {
      provider: 'assess-task', server: 'team', projectId: 123, sprintId: 7,
      lastSyncHash: 'must-be-cleared'
    }, { expectedSprintId: null })
    t.assert.strictEqual(item.external.sprintId, 7)
    t.assert.strictEqual(item.external.lastSyncHash, '')
    t.assert.throws(() => milestones.replaceExternalSprint(root, 'S-CAS', {
      provider: 'assess-task', server: 'team', projectId: 123, sprintId: 8
    }, { expectedSprintId: null }), (error) => error.code === 'EXTERNAL_SPRINT_CAS_MISMATCH')
    item = milestones.replaceExternalSprint(root, 'S-CAS', {
      provider: 'assess-task', server: 'team', projectId: 123, sprintId: 8
    }, { expectedSprintId: 7 })
    t.assert.strictEqual(item.external.sprintId, 8)

    hub.createMilestone({ name: 'S-CAS-OTHER', title: '另一个迭代' })
    t.assert.throws(() => milestones.replaceExternalSprint(root, 'S-CAS-OTHER', {
      provider: 'assess-task', server: 'team', projectId: 123, sprintId: 8
    }, { expectedSprintId: null }), (error) => error.code === 'EXTERNAL_SPRINT_ALREADY_BOUND')

    t.assert.throws(() => milestones.createMilestone(root, {
      name: 'S-CAS-CREATE', title: '内部创建冲突', items: [],
      external: { provider: 'assess-task', server: 'team', projectId: 123, sprintId: 8 }
    }, { system: true }), (error) => error.code === 'EXTERNAL_SPRINT_ALREADY_BOUND')
    hub.createMilestone({ name: 'S-CAS-UPDATE', title: '内部更新冲突' })
    t.assert.throws(() => milestones.updateMilestone(root, 'S-CAS-UPDATE', {
      external: { provider: 'assess-task', server: 'team', projectId: 123, sprintId: 8 }
    }, { system: true }), (error) => error.code === 'EXTERNAL_SPRINT_ALREADY_BOUND')
  })
})
