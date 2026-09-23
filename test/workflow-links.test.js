import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { newHub, html, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

function fixture(t) {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  for (const code of ['REQ-A', 'REQ-B']) hub.createRequirement({ code, title: code })
  for (const project of ['orders', 'other']) {
    hub.createProject({ code: project, name: project })
    for (const versionNo of ['v1', 'v2']) hub.addVersion(project, { versionNo, title: versionNo, html: html(), requirements: ['REQ-A', 'REQ-B'], changes: [{ type: 'MODIFY', location: '页面', content: '变更' }] })
  }
  const entry = { requirement: 'REQ-A', project: 'orders', version: 'v1' }
  hub.createMilestone({ name: 'first', items: [entry] })
  return { root, hub, entry }
}

test('关联按项目版本及明确需求匹配，多个迭代和交付不推断统一采用版本', t => {
  const { hub, entry } = fixture(t)
  hub.createMilestone({ name: 'next', items: [{ ...entry, version: 'v2' }] })
  hub.createMilestone({ name: 'other', items: [{ ...entry, project: 'other' }] })
  hub.setBaseline('orders', 'v1')
  for (const name of ['d1', 'd2']) hub.createSnapshot({ name, milestone: 'first' })
  assert.deepEqual(hub.workflowLinks({ project: 'orders', version: 'v1' }).milestones.map(m => m.name), ['first'])
  assert.equal(hub.workflowLinks({ requirement: 'REQ-A' }).milestones.length, 3)
  assert.equal(hub.workflowLinks({ milestone: 'first' }).deliveries.length, 2)
  assert.equal(hub.workflowLinks({ requirement: 'REQ-B' }).deliveries.length, 0, '共同关联同一原型不等于包含在交付范围')
  assert.equal(hub.workflowLinks({ project: 'other', version: 'v1' }).deliveries.length, 0)
  hub.addVersion('orders', { versionNo: 'v3', title: 'v3', html: html(), requirements: ['REQ-A'] })
  assert.equal(hub.getMilestone('first').items[0].version, 'v1')
})

test('明确保留或替换，只修改选定需求项目，重复映射不新增', t => {
  const { hub, entry } = fixture(t)
  hub.updateMilestone('first', { items: [entry, { ...entry, requirement: 'REQ-B' }] })
  const next = { ...entry, version: 'v2' }
  let item = hub.assignMilestone('first', { items: [next], expectedRevision: hub.getMilestone('first').revision, mode: 'append' })
  assert.equal(item.items.length, 3)
  item = hub.assignMilestone('first', { items: [next], expectedRevision: item.revision, mode: 'append' })
  assert.equal(item.items.length, 3)
  item = hub.assignMilestone('first', { items: [next], expectedRevision: item.revision, mode: 'replace' })
  assert.equal(item.items.length, 2)
  assert.equal(item.items.find(x => x.requirement === 'REQ-B').version, 'v1')
})

test('过期、缺失关联、废弃、删除及锁定范围均拒绝；失败后锁释放', t => {
  const { hub, root, entry } = fixture(t)
  const old = hub.getMilestone('first').revision
  hub.updateMilestone('first', { title: '其他修改' })
  assert.throws(() => hub.assignMilestone('first', { items: [entry], expectedRevision: old, mode: 'append' }), { code: 'MILESTONE_STALE' })
  assert.throws(() => hub.updateMilestone('first', { items: [], expectedRevision: old }), { code: 'MILESTONE_STALE' })
  hub.addVersion('orders', { versionNo: 'unlinked', title: '未关联', html: html() })
  assert.throws(() => hub.assignMilestone('first', { items: [{ ...entry, version: 'unlinked' }], expectedRevision: hub.getMilestone('first').revision, mode: 'append' }), { code: 'MILESTONE_LINK_MISSING' })
  assert.throws(() => hub.createMilestone({ name: 'no-empty-left', contextual: true, items: [{ ...entry, version: 'unlinked' }] }), { code: 'MILESTONE_LINK_MISSING' })
  assert.ok(!fs.existsSync(`${root}/milestones/no-empty-left.json`))
  hub.voidVersion('orders', 'v2')
  assert.throws(() => hub.assignMilestone('first', { items: [{ ...entry, version: 'v2' }], expectedRevision: hub.getMilestone('first').revision, mode: 'append' }), { code: 'MILESTONE_VERSION_VOID' })
  hub.requirementLifecycle('REQ-B', 'delete')
  assert.throws(() => hub.assignMilestone('first', { items: [{ ...entry, requirement: 'REQ-B' }], expectedRevision: hub.getMilestone('first').revision, mode: 'append' }), { code: 'MILESTONE_REQUIREMENT_DELETED' })
  hub.createMilestone({ name: 'locked', status: 'active', items: [entry] })
  assert.throws(() => hub.assignMilestone('locked', { items: [entry], expectedRevision: hub.getMilestone('locked').revision, mode: 'append' }), { code: 'MILESTONE_LOCKED' })
  assert.equal(hub.getMilestone('locked').items[0].version, 'v1')
  assert.deepEqual(fs.readdirSync(`${root}/.flowlark/cache/milestone-locks`), [])
})

test('真实文件修订区别同毫秒写入，锁竞争不会覆盖', t => {
  const { hub, root } = fixture(t)
  const old = hub.getMilestone('first').revision
  const file = `${root}/milestones/first.json`
  const data = JSON.parse(fs.readFileSync(file)); data.title = 'same timestamp change'; fs.writeFileSync(file, JSON.stringify(data))
  assert.notEqual(hub.getMilestone('first').revision, old)
  fs.mkdirSync(`${root}/.flowlark/cache/milestone-locks`, { recursive: true })
  fs.writeFileSync(`${root}/.flowlark/cache/milestone-locks/first.lock`, '')
  assert.throws(() => hub.updateMilestone('first', { title: 'overwrite' }), { code: 'MILESTONE_BUSY' })
  assert.equal(hub.getMilestone('first').title, 'same timestamp change')
})

test('缺失归档保留历史关系，非法目标和损坏数据不会显示为无关联', t => {
  const { hub, root } = fixture(t)
  fs.unlinkSync(`${root}/projects/orders/versions/v1.json`)
  assert.ok(hub.workflowLinks({ milestone: 'first' }).milestones[0].items[0].missing)
  assert.throws(() => hub.workflowLinks({ milestone: 'missing' }), { code: 'NOT_FOUND' })
  fs.writeFileSync(`${root}/milestones/first.json`, '{broken')
  assert.throws(() => hub.workflowLinks({ requirement: 'REQ-A' }))
})

test('HTTP 新入口允许只读查询、拒绝远程写入，竞争提交仅一个成功', async t => {
  const { root, hub, entry } = fixture(t)
  const server = await startServer(root, { port: 0, previewPort: 0 }); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  const remote = { 'x-forwarded-for': '192.0.2.12' }
  assert.equal((await fetch(`${base}/api/workflow-links?milestone=first`, { headers: remote })).status, 200)
  assert.equal((await fetch(`${base}/api/milestones/first/assign`, { method: 'POST', headers: { ...remote, 'content-type': 'application/json' }, body: '{}' })).status, 403)
  const body = JSON.stringify({ items: [{ ...entry, version: 'v2' }], mode: 'append', expectedRevision: hub.getMilestone('first').revision })
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body }
  const responses = await Promise.all([fetch(`${base}/api/milestones/first/assign`, options), fetch(`${base}/api/milestones/first/assign`, options)])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  assert.equal(hub.getMilestone('first').items.length, 2)
})
