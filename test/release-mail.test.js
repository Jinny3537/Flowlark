import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, tmpRepo } from './helpers.js'
import { Hub } from '../src/core/service.js'
import {
  assertReleaseMailConfig,
  enqueueReleaseMail,
  listReleaseMails,
  markReleaseMailFailed,
  markReleaseMailSent,
  normalizeReleaseMail,
  publicReleaseMail,
  readReleaseMail,
  releaseTemplateContext,
  renderReleaseMail
} from '../src/core/release-mail.js'

test('规范化项目发版邮件配置并保留姓名顺序', (t) => {
  assert.deepEqual(normalizeReleaseMail({
    enabled: true,
    to: [' 张三 ', '李四', '张三'],
    cc: [' 王五 '],
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '# {{project}}\n\n{{changes}}'
  }), {
    enabled: true,
    to: ['张三', '李四'],
    cc: ['王五'],
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '# {{project}}\n\n{{changes}}'
  })
  assert.throws(() => assertReleaseMailConfig({ enabled: true, to: [] }), /至少配置一位/)
})

test('渲染受支持变量并拒绝未知或未闭合变量', (t) => {
  const rendered = renderReleaseMail({
    subjectTemplate: '【发版】{{project}} {{version}}',
    bodyTemplate: '{{changes}}\n\n{{requirements}}'
  }, {
    project: '订单中心', version: 'v2', changes: '- 修改筛选', requirements: '- REQ-2'
  })
  assert.equal(rendered.subject, '【发版】订单中心 v2')
  assert.equal(rendered.markdown, '- 修改筛选\n\n- REQ-2')
  assert.throws(() => renderReleaseMail({ subjectTemplate: '{{secret}}', bodyTemplate: 'x' }, {}), /未知变量/)
  assert.throws(() => renderReleaseMail({ subjectTemplate: '{{project', bodyTemplate: 'x' }, {}), /未闭合/)
})

test('生成稳定的 Markdown 发版上下文', (t) => {
  const context = releaseTemplateContext({
    project: { name: '订单中心', code: 'ORDERS' },
    version: {
      versionNo: 'v2', title: '筛选升级',
      changes: [{ type: 'MODIFY', location: '列表', content: '保留筛选条件' }],
      requirements: [{ code: 'REQ-2', title: '筛选优化' }]
    },
    previousBaseline: 'v1', releasedAt: '2026-08-28T10:00:00.000Z', releasedBy: '张三'
  })
  assert.match(context.changes, /修改 · 列表：保留筛选条件/)
  assert.match(context.requirements, /REQ-2：筛选优化/)
  assert.equal(context.previousBaseline, 'v1')
})

test('邮件任务幂等入队、失败重试并隐藏内部身份', (t) => {
  const root = tmpRepo()
  t.after(() => cleanup(root))
  const input = {
    project: 'orders', version: 'v2', baselineAt: '2026-08-28T10:00:00.000Z',
    subject: '发版 v2', markdown: '正文',
    to: [{ key: 'person-1', name: '张三', userid: 'wo1', email: 'z@example.com' }], cc: []
  }
  const first = enqueueReleaseMail(root, input)
  const second = enqueueReleaseMail(root, input)
  assert.equal(first.id, second.id)
  assert.equal(listReleaseMails(root).length, 1)
  const file = path.join(root, '.flowlark', 'cache', 'release-mails.json')
  assert.equal(fs.existsSync(file), true)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)

  const failed = markReleaseMailFailed(root, first.id, Object.assign(new Error('暂时不可用'), { hint: '稍后重试' }))
  assert.equal(failed.status, 'pending')
  assert.equal(failed.attempts, 1)
  assert.equal(failed.lastInstruction, '稍后重试')
  const sent = markReleaseMailSent(root, first.id)
  assert.equal(sent.status, 'sent')
  assert.equal(sent.attempts, 2)

  const publicItem = publicReleaseMail(readReleaseMail(root, first.id))
  assert.equal(publicItem.to[0].name, '张三')
  assert.equal('userid' in publicItem.to[0], false)
  assert.equal('email' in publicItem.to[0], false)
  assert.equal('idempotencyKey' in publicItem, false)
})

test('项目创建和更新会持久化规范化的发版邮件配置', (t) => {
  const root = tmpRepo()
  t.after(() => cleanup(root))
  const hub = new Hub(root)
  const project = hub.createProject({
    name: '订单中心', code: 'ORDERS',
    releaseMail: {
      enabled: true, to: [' 张三 ', '张三'], cc: ['李四'],
      subjectTemplate: '【发版】{{version}}', bodyTemplate: '{{changes}}'
    }
  })
  assert.deepEqual(project.releaseMail.to, ['张三'])
  const updated = hub.updateProject(project.slug, {
    releaseMail: { ...project.releaseMail, cc: [' 王五 '] }
  })
  assert.deepEqual(updated.releaseMail.cc, ['王五'])
})
