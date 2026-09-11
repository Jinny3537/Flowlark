import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { cleanup, html, newHub } from './helpers.js'
import * as store from '../src/core/store.js'
import * as git from '../src/core/git.js'
import { startServer } from '../src/server/index.js'
import { authorizeTeamRequest } from '../src/server/team.js'

const roots = []
after(() => roots.forEach(cleanup))
function fixture() {
  const result = newHub(); roots.push(result.root)
  const { root, hub } = result
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-1', title: '订单查询', description: '只查看有权限的订单' })
  hub.addVersion('orders', { versionNo: 'v1', title: '订单列表', html: html('冻结内容'), requirements: ['REQ-1'] })
  hub.setBaseline('orders', 'v1')
  fs.writeFileSync(store.paths.versionSpec(root, 'orders', 'v1'), '# 接口规格\nGET /orders')
  store.writeAttachment(root, 'orders', 'v1', '接口说明.txt', Buffer.from('接口原文'))
  const items = [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  return { ...result, items }
}

test('交付包冻结需求、原型、规格书和附件，源文件变更不影响 ZIP', t => {
  const { root, hub, items } = fixture()
  const snapshot = hub.createSnapshot({ name: 'S1', items, audience: '研发、测试', acceptance: '仅返回授权订单' })
  t.assert.equal(snapshot.schemaVersion, 2)
  t.assert.equal(snapshot.requirements[0].description, '只查看有权限的订单')
  fs.writeFileSync(store.paths.versionSpec(root, 'orders', 'v1'), '修改后的规格')
  fs.rmSync(store.paths.attachments(root, 'orders', 'v1'), { recursive: true })
  fs.rmSync(store.paths.versionHtml(root, 'orders', 'v1'))
  fs.rmSync(store.paths.requirementFile(root, 'REQ-1'))
  t.assert.equal(hub.getSnapshotFile('S1', 'versions/orders/v1/spec.md').toString(), '# 接口规格\nGET /orders')
  t.assert.equal(hub.getSnapshotFile('S1', 'versions/orders/v1/attachments/接口说明.txt').toString(), '接口原文')
  t.assert.match(hub.getSnapshotFile('S1', 'versions/orders/v1/prototype.html').toString(), /冻结内容/)
  const archive = path.join(root, 'delivery.zip')
  fs.writeFileSync(archive, hub.downloadSnapshot('S1'))
  // Python's independent ZIP reader validates central headers, UTF-8 names and CRCs.
  const output = execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("versions/orders/v1/attachments/接口说明.txt").decode()=="接口原文"; print(len(z.namelist()))', archive], { encoding: 'utf8' })
  t.assert.equal(Number(output.trim()), snapshot.files.length + 2)
})

test('空范围、丢失文件、非法路径、重复映射被拒绝，缺规格仅提示', t => {
  const { root, hub, items } = fixture()
  t.assert.throws(() => hub.createSnapshot({ name: 'empty', items: [] }), e => e.code === 'SNAPSHOT_BLOCKED')
  t.assert.equal(hub.inspectSnapshot({ items: [{ project: '../outside', version: 'v1' }] }).ready, false)
  t.assert.equal(hub.inspectSnapshot({ items: [...items, ...items] }).ready, false)
  fs.rmSync(store.paths.versionSpec(root, 'orders', 'v1'))
  const check = hub.inspectSnapshot({ items })
  t.assert.equal(check.ready, true)
  t.assert.equal(check.warnings[0].code, 'SPEC_MISSING')
  fs.rmSync(store.paths.versionHtml(root, 'orders', 'v1'))
  t.assert.throws(() => hub.createSnapshot({ name: 'missing', items }), e => e.code === 'SNAPSHOT_BLOCKED')
  t.assert.equal(fs.existsSync(store.paths.snapshotFile(root, 'missing')), false)
})

test('旧快照不可伪造下载；交付内容被改动和非清单路径不可下载', t => {
  const { root, hub, items } = fixture()
  hub.createSnapshot({ name: 'S1', items })
  fs.writeFileSync(store.paths.snapshotFile(root, 'legacy'), JSON.stringify({ name: 'legacy', createdAt: '2020-01-01', items }))
  t.assert.equal(hub.getSnapshot('legacy').items[0].version, 'v1')
  t.assert.throws(() => hub.downloadSnapshot('legacy'), e => e.code === 'SNAPSHOT_LEGACY')
  t.assert.throws(() => hub.getSnapshotFile('S1', '../S1.json'))
  fs.writeFileSync(path.join(root, 'snapshots/S1.files/versions/orders/v1/spec.md'), '被改动')
  t.assert.throws(() => hub.downloadSnapshot('S1'), e => e.code === 'SNAPSHOT_INTEGRITY_FAILED')
  t.assert.throws(() => hub.createSnapshot({ name: 'S1', items }), e => e.code === 'SNAPSHOT_EXISTS')
})

test('多需求共享版本只冻结一份原型，变更交付保留前次引用', t => {
  const { hub, items } = fixture()
  hub.createRequirement({ code: 'REQ-2', title: '分页' })
  const first = hub.createSnapshot({ name: 'S1', items: [...items, { ...items[0], requirement: 'REQ-2' }] })
  t.assert.equal(first.versions.length, 1)
  t.assert.equal(first.requirements.length, 2)
  t.assert.equal(first.files.filter(f => f.kind === 'prototype').length, 1)
  t.assert.equal(hub.createSnapshot({ name: 'S2', items, supersedes: 'S1', purpose: 'acceptance' }).supersedes, 'S1')
  t.assert.throws(() => hub.createSnapshot({ name: 'S3', items, supersedes: 'missing' }))
})

test('附件复制失败时不留下半份交付，可修复后重试', t => {
  const { root, hub, items } = fixture()
  const dir = store.paths.attachments(root, 'orders', 'v1')
  fs.symlinkSync(store.paths.versionSpec(root, 'orders', 'v1'), path.join(dir, '链接附件'))
  t.assert.throws(() => hub.createSnapshot({ name: 'S1', items }), e => e.code === 'SNAPSHOT_ATTACHMENT_INVALID')
  t.assert.equal(fs.existsSync(store.paths.snapshotFile(root, 'S1')), false)
  t.assert.deepEqual(fs.readdirSync(store.paths.snapshots(root)), [])
  fs.unlinkSync(path.join(dir, '链接附件'))
  t.assert.equal(hub.createSnapshot({ name: 'S1', items }).schemaVersion, 2)
})

test('下载接口保留附件下载隔离，团队角色只读访问，禁止远程写入', async t => {
  const { root, hub, items } = fixture()
  hub.createSnapshot({ name: 'S1', items })
  for (const role of ['guest', 'developer', 'tester']) {
    const context = { host: false, role }
    t.assert.doesNotThrow(() => authorizeTeamRequest(context, 'GET', '/api/snapshots/S1/download'))
    t.assert.doesNotThrow(() => authorizeTeamRequest(context, 'GET', '/api/snapshots/S1/file'))
    t.assert.throws(() => authorizeTeamRequest(context, 'POST', '/api/snapshots'))
  }
  const server = await startServer(root, { port: 0, previewPort: 0 })
  try {
    const base = `http://127.0.0.1:${server.port}`
    const zip = await fetch(`${base}/api/snapshots/S1/download`)
    t.assert.equal(zip.status, 200)
    t.assert.equal(zip.headers.get('content-type'), 'application/zip')
    t.assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(), 0x04034b50)
    const file = await fetch(`${base}/api/snapshots/S1/file?path=versions/orders/v1/prototype.html`)
    t.assert.match(file.headers.get('content-disposition'), /^attachment;/)
    t.assert.equal(file.headers.get('x-content-type-options'), 'nosniff')
    t.assert.equal((await fetch(`${base}/api/snapshots/S1/file?path=../S1.json`)).status, 404)
  } finally { await server.close() }
})


test('交付元数据和材料副本纳入内置 Git 管理，外部文件仍排除', t => {
  const { root, hub, items } = fixture()
  hub.createSnapshot({ name: 'S1', items })
  fs.writeFileSync(path.join(root, 'unrelated.txt'), '外部文件')
  git.initRepo(root, { name: 'Delivery Test', email: 'delivery@example.test' })
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  t.assert.match(tracked, /snapshots\/S1.json/)
  t.assert.match(tracked, /snapshots\/S1.files\/versions\/orders\/v1\/prototype.html/)
  t.assert.doesNotMatch(tracked, /unrelated.txt/)
})
