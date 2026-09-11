import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { newHub, html, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'
import * as team from '../src/core/team.js'

test('team roles persist per browser; remote writes are restricted and host reassignment takes effect', async () => {
  const { root, hub } = newHub()
  let server
  try {
    hub.createProject({ name: '团队', code: 'team' })
    hub.addVersion('team', { versionNo: 'v1.0', title: '首版', html: html() })
    server = await startServer(root, { port: 0, previewPort: 0 })
    const base = `http://127.0.0.1:${server.port}`
    const request = async (pathname, { method = 'GET', body, cookie = '', remote = true, origin } = {}) => {
      const response = await fetch(base + pathname, {
        method,
        headers: {
          ...(remote ? { 'x-forwarded-for': '192.0.2.10' } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {})
        }, body: body === undefined ? undefined : JSON.stringify(body)
      })
      const text = await response.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
    }
    const send = (pathname, body, options = {}) => request(pathname, { method: 'POST', body, ...options })
    const initial = await request('/api/team/session')
    assert.equal(initial.data.enabled, false)
    assert.equal(initial.data.role, 'guest')
    assert.deepEqual(initial.data.kinds, [])
    assert.equal(initial.cookie, undefined, 'read-only sharing does not register a visitor')
    assert.equal((await request('/api/projects')).status, 200)
    assert.equal((await send('/api/projects', { name: '只读不能创建' })).status, 403)
    const network = await request('/api/lan', { remote: false })
    assert.equal(network.data.port, server.port)
    assert.equal(network.data.previewPort, server.previewPort)
    assert.equal((await request('/api/team/config', { method: 'PUT', body: { enabled: true }, remote: false })).status, 200)
    assert.equal((await request('/api/team/config', { method: 'PUT', body: { enabled: false } })).status, 403)
    assert.equal((await request('/api/projects')).status, 403)
    const first = await request('/api/team/session')
    const second = await request('/api/team/session')
    assert.ok(first.cookie)
    assert.notEqual(first.cookie, second.cookie, 'same IP gets distinct browser credentials')
    const cookie = first.cookie
    assert.equal((await send('/api/team/role', { role: 'product' }, { cookie })).status, 400)
    assert.equal((await send('/api/team/role', null, { cookie })).status, 400)
    assert.equal((await send('/api/team/role', { role: 'guest' }, { cookie, origin: 'http://evil.example' })).status, 403)
    assert.equal((await send('/api/team/role', { role: 'guest' }, { cookie })).status, 200)
    assert.equal((await send('/api/team/role', { role: 'tester' }, { cookie })).status, 409)
    assert.equal((await request('/api/team/session', { cookie })).data.role, 'guest')
    assert.equal((await request('/api/team/session', { cookie: second.cookie })).data.role, null)
    assert.equal((await request('/api/health', { cookie })).data.canWrite, false)
    for (const route of ['/api/projects', '/api/projects/team/versions', '/api/versions/team/v1.0', '/api/versions/team/v1.0/download']) {
      assert.equal((await request(route, { cookie })).status, 200, route)
    }
    for (const route of ['/api/config', '/api/mcp', '/api/git/remote', '/api/team/visitors', '/api/workspace-index']) {
      assert.equal((await request(route, { cookie })).status, 403, route)
    }
    for (const route of ['/api/projects', '/api/versions/team/v1.0/baseline', '/api/git/sync', '/api/notifications/flush']) {
      assert.equal((await send(route, {}, { cookie })).status, 403, route)
    }
    const recordPath = '/api/team/records/team/v1.0'
    assert.equal((await send(recordPath, { kind: 'comment', content: '游客评论', role: 'product', visitorId: 'fake' }, { cookie })).status, 201)
    assert.equal((await send(recordPath, { kind: 'acceptance', content: '伪造验收' }, { cookie })).status, 403)
    assert.equal((await send('/api/team/records/%2e%2e%2foutside/v1', { kind: 'comment', content: '路径越界' }, { cookie })).status, 400)
    const visitors = await request('/api/team/visitors', { remote: false })
    assert.equal(visitors.data.length, 2)
    assert.ok(visitors.data.every((item) => !item.tokenHash))
    const id = (await request('/api/team/session', { cookie })).data.id
    assert.equal((await request(`/api/team/visitors/${id}`, { method: 'PUT', body: { role: 'tester' }, cookie })).status, 403)
    assert.equal((await request(`/api/team/visitors/${id}`, { method: 'PUT', body: { role: 'tester' }, remote: false })).status, 200)
    assert.equal((await request('/api/team/session', { cookie })).data.role, 'tester')
    assert.equal((await send(recordPath, { kind: 'acceptance', content: '已核对当前原型' }, { cookie })).status, 201)
    assert.equal((await send(recordPath, { kind: 'issue', content: '按钮无响应' }, { cookie })).status, 201)
    assert.equal((await send(recordPath, { kind: 'progress', content: '开发完成' }, { cookie })).status, 403)
    await request(`/api/team/visitors/${id}`, { method: 'PUT', body: { role: 'developer' }, remote: false })
    assert.equal((await send(recordPath, { kind: 'acceptance', content: '旧测试页面' }, { cookie })).status, 403)
    assert.equal((await send(recordPath, { kind: 'progress', content: '接口联调中' }, { cookie })).status, 201)
    assert.equal((await send(recordPath, { kind: 'progress', content: ' ' }, { cookie })).status, 400)
    assert.equal((await send('/api/team/records/team/missing', { kind: 'progress', content: '不存在' }, { cookie })).status, 404)
    const records = (await request(recordPath, { cookie })).data
    assert.equal(records.length, 4)
    assert.equal(records[0].role, 'guest')
    assert.equal(records[0].visitorId, id)
    assert.ok(records.every((item) => !item.ip && !item.tokenHash))
    const bytes = fs.readdirSync(path.join(root, '.flowlark/collaboration')).map((file) => fs.readFileSync(path.join(root, '.flowlark/collaboration', file), 'utf8')).join('')
    assert.ok(!bytes.includes(cookie.split('=')[1]))
    // Switching to read-only must revoke even an already selected developer immediately.
    await request('/api/team/config', { method: 'PUT', body: { enabled: false }, remote: false })
    await request('/api/config/server.readonlyFromLan', { method: 'PUT', body: { value: false }, remote: false })
    assert.deepEqual((await request('/api/team/session', { cookie })).data.kinds, [])
    assert.equal((await request('/api/health', { cookie })).data.canWrite, false)
    assert.equal((await request(recordPath, { cookie })).status, 200)
    assert.equal((await send(recordPath, { kind: 'comment', content: '旧页面请求' }, { cookie })).status, 403)
    assert.equal((await send('/api/projects', { name: '旧配置不能放开写入' }, { cookie })).status, 403)
    await request('/api/team/config', { method: 'PUT', body: { enabled: true }, remote: false })
    assert.equal((await request('/api/team/session', { cookie })).data.role, 'developer')
    await server.close()
    server = await startServer(root, { port: 0, previewPort: 0 })
    const restored = team.visitor(root, cookie.split('=')[1])
    assert.equal(restored.role, 'developer', 'role survives server restart')
    assert.equal(team.listRecords(root, 'team', 'v1.0').length, 4)
    team.setTeamEnabled(root, false)
    const localRead = await fetch(`http://127.0.0.1:${server.port}/api/team/records/team/v1.0`)
    assert.equal(localRead.status, 200, 'standalone product can read synced collaboration without enabling team mode')
    assert.equal((await localRead.json()).length, 4)
  } finally { if (server) await server.close(); cleanup(root) }
})

test('corrupted role storage fails closed, and unknown credentials cannot choose an identity', () => {
  const { root } = newHub()
  try {
    team.setTeamEnabled(root, true)
    assert.equal(team.visitor(root, '../../etc/passwd'), null)
    assert.equal(team.visitor(root, 'a'.repeat(64)), null)
    fs.writeFileSync(path.join(root, '.flowlark/cache/team.json'), '{broken')
    assert.throws(() => team.teamEnabled(root))
    fs.writeFileSync(path.join(root, '.flowlark/cache/team.json'), '{}')
    assert.throws(() => team.teamEnabled(root), { code: 'TEAM_STORAGE_INVALID' })
  } finally { cleanup(root) }
})

test('independent collaboration records merge through Git without sharing browser credentials', () => {
  const { root } = newHub()
  const copy = `${root}-copy`
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  const commit = (cwd) => { git(cwd, 'add', '.'); git(cwd, '-c', 'user.name=Team Test', '-c', 'user.email=team@example.invalid', 'commit', '-m', 'team records') }
  try {
    git(root, 'init')
    team.setTeamEnabled(root, true)
    team.createVisitor(root, '192.0.2.1')
    commit(root)
    git(root, 'clone', root, copy)
    const first = team.addRecord(root, { id: 'host', role: 'product' }, 'team', 'v1', { kind: 'comment', content: '产品意见' })
    const second = team.addRecord(copy, { id: 'visitor', role: 'tester' }, 'team', 'v1', { kind: 'issue', content: '测试反馈' })
    commit(root); commit(copy)
    git(root, 'fetch', copy, 'HEAD')
    git(root, '-c', 'user.name=Team Test', '-c', 'user.email=team@example.invalid', 'merge', '--no-edit', 'FETCH_HEAD')
    assert.deepEqual(new Set(team.listRecords(root, 'team', 'v1').map((item) => item.id)), new Set([first.id, second.id]))
    assert.ok(!git(root, 'ls-files').includes('.flowlark/cache/team.json'))
    assert.equal(fs.existsSync(path.join(copy, '.flowlark/cache/team.json')), false)
  } finally { cleanup(root); cleanup(copy) }
})
