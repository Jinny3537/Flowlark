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

function releaseFixture(t, { gitSync, sendReleaseMail, resolveContacts } = {}) {
  const root = tmpRepo()
  t.after(() => cleanup(root))
  const calls = []
  const wecomMcp = {
    authStatus: async () => ({
      installed: true, version: '1.1.0', versionOk: true, authorized: true,
      message: '企业微信 CLI 已授权', instruction: null
    }),
    resolveContacts: resolveContacts || (async ({ names }) => ({
      results: names.map((name, index) => {
        const candidate = {
          key: `person-${index}`, query: name, name, alias: '', departments: ['产品部'], position: '', userid: `wo-${index}`
        }
        return { query: name, status: 'unique', candidate, candidates: [candidate] }
      })
    })),
    sendReleaseMail: sendReleaseMail || (async () => { calls.push('mail'); return { ok: true } })
  }
  const hub = new Hub(root, {
    wecomMcp,
    gitSync: gitSync || (() => { calls.push('git'); return { ok: true, pushed: true } })
  })
  const project = hub.createProject({
    name: '订单中心', code: 'ORDERS',
    releaseMail: {
      enabled: true, to: ['张三'], cc: ['李四'],
      subjectTemplate: '【发版】{{project}} {{version}}',
      bodyTemplate: '# {{title}}\n\n{{changes}}\n\n{{requirements}}'
    }
  })
  hub.addVersion(project.slug, { versionNo: 'v1', title: '首版', html: '<html>v1</html>' })
  hub.setBaseline(project.slug, 'v1')
  hub.addVersion(project.slug, {
    versionNo: 'v2', title: '筛选升级', html: '<html>v2</html>',
    changes: [{ type: 'MODIFY', location: '列表', content: '保留筛选条件' }],
    requirements: ['REQ-2']
  })
  const originalSetBaseline = hub.setBaseline.bind(hub)
  hub.setBaseline = (...args) => {
    calls.push('baseline')
    return originalSetBaseline(...args)
  }
  return { root, hub, project, calls, wecomMcp }
}

test('正式发版严格按基线、Git、邮件顺序且重复请求不重复发送', async (t) => {
  const { hub, project, calls, wecomMcp } = releaseFixture(t)
  const preflight = await hub.preflightFormalRelease(project.slug, 'v2', { releasedAt: '2026-08-28T10:00:00Z' })
  assert.equal(preflight.ready, true)
  assert.equal(preflight.previousBaseline, 'v1')
  assert.doesNotMatch(JSON.stringify(preflight), /wo-0|wo-1|userid|email/)
  assert.equal(hub.getBaseline(project.slug).versionNo, 'v1', '预检不能切换基线')
  assert.equal(hub.listReleaseMails().length, 0, '预检不能写邮件队列')

  const result = await hub.formalRelease(project.slug, 'v2', { releasedAt: preflight.releasedAt })
  assert.equal(result.status, 'complete')
  assert.deepEqual(calls, ['baseline', 'git', 'mail'])
  assert.equal(hub.getBaseline(project.slug).versionNo, 'v2')
  assert.equal(result.mail.status, 'sent')

  wecomMcp.authStatus = async () => { throw new Error('授权已过期') }
  const duplicate = await hub.formalRelease(project.slug, 'v2', { releasedAt: preflight.releasedAt })
  assert.equal(duplicate.duplicate, true)
  assert.deepEqual(calls, ['baseline', 'git', 'mail'])
})

test('Git 失败不发送邮件，续跑不重复设置基线', async (t) => {
  let shouldFail = true
  const { hub, project, calls } = releaseFixture(t, {
    gitSync: () => {
      calls.push('git')
      if (shouldFail) throw new Error('push failed')
      return { ok: true }
    }
  })
  const first = await hub.formalRelease(project.slug, 'v2')
  assert.equal(first.status, 'git_failed')
  assert.deepEqual(calls, ['baseline', 'git'])
  assert.equal(hub.listReleaseMails().length, 0)
  shouldFail = false
  const second = await hub.formalRelease(project.slug, 'v2')
  assert.equal(second.status, 'complete')
  assert.deepEqual(calls, ['baseline', 'git', 'git', 'mail'])
})

test('邮件失败保留 pending，重试只调用邮件', async (t) => {
  let attempts = 0
  const { hub, project, calls } = releaseFixture(t, {
    sendReleaseMail: async () => {
      calls.push('mail')
      attempts++
      if (attempts === 1) throw Object.assign(new Error('邮箱暂时不可用'), { hint: '稍后重试' })
      return { ok: true }
    }
  })
  const first = await hub.formalRelease(project.slug, 'v2')
  assert.equal(first.status, 'mail_pending')
  assert.equal(first.released, true)
  assert.equal(first.mail.lastInstruction, '稍后重试')
  const retried = await hub.retryReleaseMail(first.mail.id)
  assert.equal(retried.status, 'complete')
  assert.deepEqual(calls, ['baseline', 'git', 'mail', 'mail'])
})

test('同名收件人必须明确选择且公共预检不暴露 userid', async (t) => {
  const { hub, project } = releaseFixture(t, {
    resolveContacts: async ({ names }) => ({
      results: names.map((name) => {
        const candidates = name === '张三'
          ? [
            { key: 'p1', query: name, name, alias: '', departments: ['产品部'], position: '', userid: 'wo-secret-1' },
            { key: 'p2', query: name, name, alias: '', departments: ['研发部'], position: '', userid: 'wo-secret-2' }
          ]
          : [{ key: 'p3', query: name, name, alias: '', departments: ['产品部'], position: '', userid: 'wo-secret-3' }]
        return name === '张三'
          ? { query: name, status: 'ambiguous', candidates }
          : { query: name, status: 'unique', candidate: candidates[0], candidates }
      })
    })
  })
  const blocked = await hub.preflightFormalRelease(project.slug, 'v2')
  assert.equal(blocked.ready, false)
  assert.equal(blocked.blockers.find((item) => item.query === '张三').candidates.length, 2)
  assert.doesNotMatch(JSON.stringify(blocked), /wo-secret|userid/)
  const ready = await hub.preflightFormalRelease(project.slug, 'v2', { selections: { 张三: 'p2' } })
  assert.equal(ready.ready, true)
  assert.equal(ready.to[0].departments[0], '研发部')
})
