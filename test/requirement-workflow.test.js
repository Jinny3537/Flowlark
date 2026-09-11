import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { newHub, html, cleanup } from './helpers.js'
import * as team from '../src/core/team.js'
import { startServer } from '../src/server/index.js'

function fixture(t) {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-8', title: '批量关闭', acceptanceCriteria: '部分失败保留成功项' })
  for (const n of [3, 4]) hub.addVersion('orders', { versionNo: `v1.${n}`, title: `归档 ${n}`, html: html(),
    requirements: [{ code: 'REQ-8', location: '订单列表', scope: '批量操作' }], changes: [{ type: 'MODIFY', location: '订单列表', content: '更新交互', requirement: 'REQ-8' }] })
  return { root, hub }
}

test('归档范围双向保留；采用版本不随新版或基线漂移；软删除不破坏历史', t => {
  const { root, hub } = fixture(t)
  hub.linkRequirement('REQ-8', 'orders', 'v1.4')
  assert.equal(hub.getVersion('orders', 'v1.4').requirements[0].location, '订单列表')
  hub.getRequirement('REQ-8')
  const cachePath = `${root}/.flowlark/cache/requirements-index.json`
  const oldCache = JSON.parse(fs.readFileSync(cachePath)); delete oldCache.schemaVersion
  oldCache.byCode = {}; fs.writeFileSync(cachePath, JSON.stringify(oldCache))
  assert.equal(hub.getRequirement('REQ-8').versions.length, 2, '升级后自动重建旧需求索引')
  assert.equal(hub.getRequirement('REQ-8').versions[0].changes[0].content, '更新交互')
  hub.createMilestone({ name: 'sprint-8', title: '本次迭代', status: 'active', items: [{ requirement: 'REQ-8', project: 'orders', version: 'v1.4' }] })
  hub.addVersion('orders', { versionNo: 'v1.5', title: '后续归档', html: html(), requirements: ['REQ-8'] })
  const item = hub.getRequirement('REQ-8')
  assert.equal(item.adopted[0].version, 'v1.4')
  assert.equal(item.latest[0].versionNo, 'v1.5')
  assert.throws(() => hub.requirementLifecycle('REQ-8', 'delete'), { code: 'REQUIREMENT_IN_ACTIVE_MILESTONE' })
  assert.throws(() => hub.setRequirements('orders', 'v1.4', []), { code: 'REQUIREMENT_LINK_IN_USE' })
  hub.requirementLifecycle('REQ-8', 'archive')
  assert.ok(hub.getRequirement('REQ-8').archivedAt)
  const milestoneFile = `${root}/milestones/sprint-8.json`
  const milestone = JSON.parse(fs.readFileSync(milestoneFile)); milestone.status = 'delivered'; fs.writeFileSync(milestoneFile, JSON.stringify(milestone))
  const before = fs.readFileSync(`${root}/projects/orders/versions/v1.4.html`, 'utf8')
  hub.requirementLifecycle('REQ-8', 'delete')
  assert.equal(hub.listRequirements().length, 0)
  assert.equal(hub.listRequirements({ includeDeleted: true }).length, 1)
  assert.equal(hub.getVersion('orders', 'v1.4').requirements[0].deletedAt !== null, true)
  assert.equal(fs.readFileSync(`${root}/projects/orders/versions/v1.4.html`, 'utf8'), before)
  assert.throws(() => hub.createRequirement({ code: 'REQ-8', title: '同号覆盖' }), { code: 'REQUIREMENT_EXISTS' })
  assert.throws(() => hub.updateRequirement('REQ-8', { title: '绕过回收站' }), { code: 'REQUIREMENT_DELETED' })
  hub.requirementLifecycle('REQ-8', 'restore')
  assert.equal(hub.listRequirements().length, 1)
  assert.equal(hub.getRequirement('REQ-8').adopted[0].version, 'v1.4')
  assert.deepEqual(hub.getRequirement('REQ-8').history.map(x => x.action), ['archive', 'delete', 'restore'])
})

test('需求问题在归档版本上处理；确认必须指向处理版本且角色不能越权', t => {
  const { root, hub } = fixture(t)
  const dev = { role: 'developer', id: 'dev' }, product = { role: 'product', id: 'host' }, tester = { role: 'tester', id: 'test' }
  const question = team.addRecord(root, dev, 'orders', 'v1.3', { kind: 'comment', content: '部分失败怎么办', requirement: 'REQ-8', outcome: 'open' })
  assert.throws(() => team.addRecord(root, dev, 'orders', 'v1.4', { kind: 'acceptance', content: '通过', requirement: 'REQ-8' }), { code: 'TEAM_ACTION_FORBIDDEN' })
  assert.throws(() => team.addRecord(root, product, 'orders', 'v1.3', { kind: 'comment', content: '处理了', requirement: 'REQ-8', replyTo: question.id, outcome: 'resolved' }), { code: 'TEAM_RESOLUTION_REQUIRED' })
  team.addRecord(root, product, 'orders', 'v1.3', { kind: 'comment', content: '外部修改后已归档', requirement: 'REQ-8', replyTo: question.id, outcome: 'resolved', resolutionVersion: 'v1.4' })
  team.addRecord(root, dev, 'orders', 'v1.3', { kind: 'comment', content: '收到', requirement: 'REQ-8', replyTo: question.id })
  assert.equal(hub.getRequirement('REQ-8').questions[0].state, 'resolved')
  assert.throws(() => team.addRecord(root, tester, 'orders', 'v1.3', { kind: 'comment', content: '确认', requirement: 'REQ-8', replyTo: question.id, outcome: 'confirmed' }), { code: 'TEAM_CONFIRM_VERSION' })
  team.addRecord(root, tester, 'orders', 'v1.4', { kind: 'comment', content: '核对新版已解决', requirement: 'REQ-8', replyTo: question.id, outcome: 'confirmed' })
  assert.equal(hub.getRequirement('REQ-8').pending.unresolved, 0)
  team.addRecord(root, tester, 'orders', 'v1.4', { kind: 'acceptance', content: '异常路径通过', requirement: 'REQ-8', outcome: 'passed' })
  assert.equal(hub.getRequirement('REQ-8').derivedStatus, 'designing', '验收记录不会自动切换基线或声称上线')
  assert.throws(() => team.addRecord(root, tester, 'orders', 'v1.4', { kind: 'comment', content: '伪造回复', requirement: 'REQ-8', replyTo: 'missing' }), { code: 'TEAM_REPLY_INVALID' })
})

test('需求同步预览不落库、本地分析不覆盖、过期预览被阻止、回收站排除并可恢复', async t => {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  let title = '源需求'
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const rpc = JSON.parse(raw), name = rpc.params.name
    const value = name === 'list_requirements' ? [{ id: 'REQ-S', name: title }] : { id: 'REQ-S', name: title, businessDescription: '源内容' }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  hub.saveMcpServer({ id: 'pool', type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` })
  hub.saveMcpCapability('requirements', { enabled: true, server: 'pool', options: { protocol: 'hubpool' }, tools: { search: 'list_requirements', get: 'get_requirement_detail' } })
  const preview = await hub.syncExternalRequirements('mcp', {}, { preview: true })
  assert.equal(hub.listRequirements().length, 0)
  await hub.syncExternalRequirements('mcp', {}, { expected: Object.fromEntries(preview.changes.map(x => [x.code, x.token])) })
  hub.updateRequirement('REQ-S', { localNotes: '待确认异常路径', dueDate: '2026-10-01' })
  title = '更新源标题'
  const secondPreview = await hub.syncExternalRequirements('mcp', {}, { preview: true })
  title = '预览后的变化'
  const stale = await hub.syncExternalRequirements('mcp', {}, { expected: Object.fromEntries(secondPreview.changes.map(x => [x.code, x.token])) })
  assert.equal(stale.failed.length, 1)
  assert.equal(hub.getRequirement('REQ-S').title, '源需求')
  await hub.syncExternalRequirements('mcp')
  assert.equal(hub.getRequirement('REQ-S').localNotes, '待确认异常路径')
  assert.equal(hub.getRequirement('REQ-S').dueDate, '2026-10-01')
  hub.requirementLifecycle('REQ-S', 'delete')
  assert.equal((await hub.syncExternalRequirements('mcp')).total, 0)
  await assert.rejects(hub.importExternalRequirement('mcp', 'REQ-S'), { code: 'REQUIREMENT_DELETED' })
  hub.requirementLifecycle('REQ-S', 'restore')
  assert.equal((await hub.syncExternalRequirements('mcp')).updated, 1)
})

test('需求管理 API 只允许主机写入，远程角色只能按权限提交版本协作记录', async t => {
  const { root, hub } = fixture(t)
  const server = await startServer(root, { port: 0, previewPort: 0 }); t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  const remote = await fetch(`${base}/api/requirements/REQ-8/lifecycle`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.15' }, body: JSON.stringify({ action: 'delete' }) })
  assert.equal(remote.status, 403)
  const local = await fetch(`${base}/api/requirements/REQ-8/lifecycle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete' }) })
  assert.equal(local.status, 200)
  assert.equal((await (await fetch(`${base}/api/requirements`)).json()).length, 0)
  assert.equal((await (await fetch(`${base}/api/requirements?includeDeleted=true`)).json()).length, 1)
})

test('Git 同步包含需求、迭代与团队记录，跳过旁边的用户文件', async t => {
  const { root, hub } = fixture(t)
  const { spawnSync } = await import('node:child_process')
  const git = await import('../src/core/git.js')
  const run = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(run('init').status, 0)
  run('config', 'user.name', 'Workflow test'); run('config', 'user.email', 'workflow@example.invalid')
  hub.createMilestone({ name: 'plan', items: [{ requirement: 'REQ-8', project: 'orders', version: 'v1.4' }] })
  team.addRecord(root, { role: 'product', id: 'host' }, 'orders', 'v1.4', { kind: 'comment', content: '协作记录', requirement: 'REQ-8' })
  fs.writeFileSync(`${root}/personal-notes.txt`, '不应提交')
  const result = git.sync(root)
  assert.ok(result.steps.every(step => step.ok))
  const files = run('ls-files').stdout
  assert.match(files, /requirements\/REQ-8\/requirement.json/)
  assert.match(files, /milestones\/plan.json/)
  assert.match(files, /\.flowlark\/collaboration\//)
  assert.doesNotMatch(files, /personal-notes.txt/)
})
