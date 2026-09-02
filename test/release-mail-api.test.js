import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanup, html, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'

test('正式发版 API 完成预检、发布和队列查询且不暴露内部 ID', async (t) => {
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  const project = hub.createProject({
    name: '订单中心', code: 'ORDERS',
    releaseMail: {
      enabled: true, to: ['张三'], cc: [],
      subjectTemplate: '【发版】{{project}} {{version}}',
      bodyTemplate: '# {{title}}\n\n{{changes}}'
    }
  })
  hub.addVersion(project.slug, { versionNo: 'v1', title: '首版', html: html('v1') })
  hub.setBaseline(project.slug, 'v1')
  hub.addVersion(project.slug, {
    versionNo: 'v2', title: '筛选升级', html: html('v2'),
    changes: [{ type: 'MODIFY', location: '列表', content: '保留筛选条件' }]
  })
  hub.createRequirement({ code: 'REQ-2', title: '筛选优化' })
  const milestone = hub.createMilestone({
    name: 'S1',
    title: '迭代一',
    status: 'active',
    items: [{ requirement: 'REQ-2', project: project.slug, version: 'v2' }]
  })

  let sendCount = 0
  const fakeWecom = {
    authStatus: async () => ({ installed: true, version: '1.1.0', versionOk: true, authorized: true, message: 'ok', instruction: null }),
    resolveContacts: async ({ names }) => ({
      results: names.map((name) => {
        const candidate = { key: 'person-1', query: name, name, alias: '', departments: ['产品部'], position: '', userid: 'wo-secret' }
        return { query: name, status: 'unique', candidate, candidates: [candidate] }
      })
    }),
    sendReleaseMail: async () => { sendCount++; return { ok: true } },
    diagnostics: () => ({ available: true, pid: null, stderr: '' }),
    close: async () => {}
  }
  const server = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: fakeWecom,
    gitSync: () => ({ ok: true, pushed: true })
  })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`

  async function request(pathname, body) {
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    })
    return { status: response.status, body: await response.json() }
  }

  const milestonePath = `/api/milestones/${encodeURIComponent(milestone.name)}`
    + `/versions/${encodeURIComponent(project.slug)}/${encodeURIComponent('v2')}`

  const preflight = await request(`${milestonePath}/formal-release/preflight`)
  assert.equal(preflight.status, 200)
  assert.equal(preflight.body.ready, true)
  assert.doesNotMatch(JSON.stringify(preflight.body), /wo-secret|userid|email/)

  const released = await request(`${milestonePath}/formal-release`, {
    releasedAt: preflight.body.releasedAt
  })
  assert.equal(released.status, 200)
  assert.equal(released.body.status, 'complete')
  assert.equal(sendCount, 1)
  assert.doesNotMatch(JSON.stringify(released.body), /wo-secret|userid|email/)

  const queueResponse = await fetch(`${base}/api/release-mails`)
  const queue = await queueResponse.json()
  assert.equal(queue.length, 1)
  assert.equal(queue[0].status, 'sent')
  assert.doesNotMatch(JSON.stringify(queue), /wo-secret|userid|email/)

  const legacy = await request(`/api/versions/${project.slug}/v2/formal-release/preflight`)
  assert.equal(legacy.status, 404)
})
