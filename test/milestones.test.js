import { after, describe, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('迭代', () => {
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
})
