import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import { cleanup, html, newHub, throwsCode } from './helpers.js'
import * as reqx from '../src/core/requirements.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createProject({ name: '营销', code: 'marketing' })
  return { root, hub }
}

describe('需求实体与反向索引', () => {
  test('版本落盘只保存编号，Hub 返回完整需求对象', (t) => {
    const { root, hub } = fixture()
    hub.addVersion('orders', {
      versionNo: 'v1', title: '首版', html: html(),
      requirements: [{ code: 'REQ-27', title: '批量关闭', url: 'https://example.com/REQ-27' }]
    })
    const raw = store.readVersion(root, 'orders', 'v1')
    t.assert.deepStrictEqual(raw.requirements, ['REQ-27'])
    t.assert.strictEqual(hub.getVersion('orders', 'v1').requirements[0].title, '批量关闭')
  })

  test('需求详情聚合跨项目版本并派生状态', (t) => {
    const { hub } = fixture()
    hub.createRequirement({ code: 'REQ-27', title: '批量关闭' })
    hub.addVersion('orders', { versionNo: 'v1', title: '订单', html: html(), requirements: ['REQ-27'] })
    hub.addVersion('marketing', { versionNo: 'v1', title: '营销', html: html(), requirements: ['REQ-27'] })
    t.assert.strictEqual(hub.getRequirement('REQ-27').versions.length, 2)
    t.assert.strictEqual(hub.getRequirement('REQ-27').derivedStatus, 'designing')
    hub.setBaseline('orders', 'v1')
    t.assert.strictEqual(hub.getRequirement('REQ-27').derivedStatus, 'finalized')
  })

  test('删除索引缓存后重建结果一致', (t) => {
    const { root, hub } = fixture()
    hub.addVersion('orders', { versionNo: 'v1', title: '订单', html: html(), requirements: [{ code: 'REQ-1', title: '需求一' }] })
    const before = reqx.linkedVersions(root, 'REQ-1')
    fs.rmSync(`${root}/.flowlark/cache/requirements-index.json`, { force: true })
    t.assert.deepStrictEqual(reqx.linkedVersions(root, 'REQ-1'), before)
  })

  test('改一次需求标题，所有版本返回一致', (t) => {
    const { hub } = fixture()
    hub.addVersion('orders', { versionNo: 'v1', title: '订单', html: html(), requirements: [{ code: 'REQ-1', title: '旧标题' }] })
    hub.updateRequirement('REQ-1', { title: '新标题' })
    t.assert.strictEqual(hub.getVersion('orders', 'v1').requirements[0].title, '新标题')
  })

  test('需求保存项目、模块、类型和优先级', (t) => {
    const { hub } = fixture()
    const item = hub.createRequirement({
      code: 'REQ-BIZ',
      title: '危险作业审批',
      project: '安全生产',
      module: '作业票',
      type: '功能',
      priority: 'P1'
    })
    t.assert.strictEqual(item.project, '安全生产')
    t.assert.strictEqual(item.module, '作业票')
    t.assert.strictEqual(item.type, '功能')
    t.assert.strictEqual(item.priority, 'P1')
  })
})

describe('需求截止日期', () => {
  test('创建、更新和清空合法截止日期', (t) => {
    const { hub } = fixture()
    let item = hub.createRequirement({ code: 'REQ-DATE', title: '日期需求', dueDate: '2026-08-31' })
    t.assert.strictEqual(item.dueDate, '2026-08-31')
    item = hub.updateRequirement('REQ-DATE', { dueDate: '2026-09-01' })
    t.assert.strictEqual(item.dueDate, '2026-09-01')
    item = hub.updateRequirement('REQ-DATE', { dueDate: '' })
    t.assert.strictEqual(item.dueDate, '')
  })

  test('拒绝格式错误和不存在的日期', (t) => {
    const { hub } = fixture()
    throwsCode(t, 'REQUIREMENT_DUE_DATE_INVALID', () => {
      hub.createRequirement({ code: 'REQ-BAD-1', title: '错误格式', dueDate: '2026/08/31' })
    })
    throwsCode(t, 'REQUIREMENT_DUE_DATE_INVALID', () => {
      hub.createRequirement({ code: 'REQ-BAD-2', title: '不存在日期', dueDate: '2026-02-30' })
    })
  })

  test('逾期边界排除今天、未来和已交付需求', (t) => {
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-24', derivedStatus: 'designing' }, '2026-08-25'), true)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-25', derivedStatus: 'designing' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-26', derivedStatus: 'designing' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '2026-08-24', derivedStatus: 'delivered' }, '2026-08-25'), false)
    t.assert.strictEqual(reqx.isRequirementOverdue({ dueDate: '', derivedStatus: 'designing' }, '2026-08-25'), false)
  })

  test('未提供截止日期的更新和旧文件保持兼容', (t) => {
    const { root, hub } = fixture()
    hub.createRequirement({ code: 'REQ-LEGACY', title: '兼容需求', dueDate: '2026-08-31' })
    let item = hub.updateRequirement('REQ-LEGACY', { title: '只改标题' })
    t.assert.strictEqual(item.dueDate, '2026-08-31')

    const file = store.paths.requirementFile(root, 'REQ-LEGACY')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    delete raw.dueDate
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
    item = hub.getRequirement('REQ-LEGACY')
    t.assert.strictEqual(item.dueDate, '')
    t.assert.strictEqual(item.overdue, false)
  })
})
