import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wechatConfig, beginWechat, consumeWechatState, exchangeWechat, loginReturnPath } from '../src/server/wechat.js'
import * as team from '../src/core/team.js'
import { newHub, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

const config = { appid: 'app', secret: 'secret', callback: 'https://work.example/api/team/wechat/callback' }
test('wechat requires complete HTTPS configuration and browser-bound, expiring, single-use state', () => {
  assert.equal(wechatConfig({}), null)
  assert.deepEqual(wechatConfig({ FLOWLARK_WECHAT_APP_ID: 'app', FLOWLARK_WECHAT_APP_SECRET: 'secret', FLOWLARK_WECHAT_CALLBACK_URL: config.callback }), config)
  const login = beginWechat('/repo', config, 100)
  assert.equal(new URL(login.url).searchParams.get('scope'), 'snsapi_login')
  assert.ok(!login.url.includes('secret'))
  assert.throws(() => consumeWechatState('/other', login.state, login.state, 101))
  assert.throws(() => consumeWechatState('/repo', login.state, 'wrong', 101))
  consumeWechatState('/repo', login.state, login.state, 101)
  assert.throws(() => consumeWechatState('/repo', login.state, login.state, 102))
  const expired = beginWechat('/repo', config, 100)
  assert.throws(() => consumeWechatState('/repo', expired.state, expired.state, 300101))
})
test('wechat exchange validates provider identity and never returns tokens', async () => {
  const result = await exchangeWechat(config, 'code', async url => ({ ok: true, json: async () => url.includes('/access_token?') ? { openid: 'wx-id', access_token: 'private' } : { openid: 'wx-id', nickname: '张三' } }))
  assert.equal(result.name, '张三')
  assert.equal(result.key.length, 64)
  assert.ok(!JSON.stringify(result).includes('private'))
  await assert.rejects(exchangeWechat(config, 'code', async () => ({ ok: true, json: async () => ({ errcode: 40029 }) })), /微信登录失败/)
  await assert.rejects(exchangeWechat(config, '', async () => { throw Error('must not call') }), /授权未完成/)
})
test('authenticated visitors keep host-assigned roles, rotate credentials, and revoke on logout', () => {
  const { root } = newHub()
  try {
    const identity = { provider: 'wechat', key: 'abc', name: '张三' }
    const first = team.loginVisitor(root, identity, 'ip')
    assert.equal(first.item.role, null)
    team.assignRole(root, first.item.id, 'tester', { first: true })
    const next = team.loginVisitor(root, identity, 'ip')
    assert.equal(next.item.id, first.item.id)
    assert.equal(next.item.role, 'tester')
    assert.equal(team.visitor(root, first.token), null)
    assert.throws(() => team.assignRole(root, next.item.id, 'developer', { first: true }))
    assert.ok(!JSON.stringify(team.listVisitors(root)).includes('tokenHash'))
    assert.ok(!JSON.stringify(team.listVisitors(root)).includes('abc'))
    team.revokeVisitor(root, next.token)
    assert.equal(team.visitor(root, next.token), null)
  } finally { cleanup(root) }
})
test('HTTP entry exposes availability, rejects invalid callbacks and logout invalidates the guest credential', async () => {
  const { root } = newHub()
  let server
  try {
    team.setTeamEnabled(root, true)
    server = await startServer(root, { port: 0, previewPort: 0 })
    const base = `http://127.0.0.1:${server.port}`
    const headers = { 'x-forwarded-for': '192.0.2.10', 'content-type': 'application/json' }
    const session = await fetch(base + '/api/team/session', { headers })
    const cookie = session.headers.get('set-cookie').split(';')[0]
    assert.equal(typeof (await session.json()).wechatAvailable, 'boolean')
    const role = await fetch(base + '/api/team/role', { method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ role: 'guest' }) })
    assert.equal(role.status, 200)
    const callback = await fetch(base + '/api/team/wechat/callback?state=invalid&code=fake', { headers, redirect: 'manual' })
    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), '/?login_error=wechat#/actions')
    const forbidden = await fetch(base + '/api/team/logout', { method: 'POST', headers: { ...headers, cookie, origin: 'https://evil.example' }, body: '{}' })
    assert.equal(forbidden.status, 403)
    const logout = await fetch(base + '/api/team/logout', { method: 'POST', headers: { ...headers, cookie }, body: '{}' })
    assert.equal(logout.status, 200)
    const after = await fetch(base + '/api/team/session', { headers: { ...headers, cookie } })
    assert.equal((await after.json()).role, null)
  } finally { await server?.close(); cleanup(root) }
})

test('full HTTP OAuth flow restores deep links, persists identity and roles, rejects replay, and allows logout in read-only mode', async t => {
  const { root } = newHub()
  let server
  const keys = ['FLOWLARK_WECHAT_APP_ID', 'FLOWLARK_WECHAT_APP_SECRET', 'FLOWLARK_WECHAT_CALLBACK_URL']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const actualFetch = globalThis.fetch
  const calls = []
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input)
    if (url.hostname !== 'api.weixin.qq.com') return actualFetch(input, options)
    calls.push(url.pathname)
    assert.equal(options.signal instanceof AbortSignal, true)
    if (url.pathname === '/sns/oauth2/access_token') {
      assert.equal(url.searchParams.get('secret'), 'test-secret')
      return new Response(JSON.stringify({ openid: 'account-one', access_token: 'private-provider-token' }))
    }
    return new Response(JSON.stringify({ openid: 'account-one', nickname: '微信测试账号' }))
  })
  try {
    team.setTeamEnabled(root, true)
    server = await startServer(root, { port: 0, previewPort: 0 })
    const host = `127.0.0.1:${server.port}`
    const base = `http://${host}`
    process.env.FLOWLARK_WECHAT_APP_ID = 'test-app'
    process.env.FLOWLARK_WECHAT_APP_SECRET = 'test-secret'
    process.env.FLOWLARK_WECHAT_CALLBACK_URL = `https://${host}/api/team/wechat/callback`
    const headers = { 'x-forwarded-for': '192.0.2.10', 'x-forwarded-proto': 'https', 'content-type': 'application/json' }
    const request = (path, options = {}) => actualFetch(base + path, { redirect: 'manual', ...options, headers: { ...headers, ...options.headers } })
    const proxyOnly = await request('/api/team/session', { headers: { 'x-forwarded-for': '' } })
    assert.equal((await proxyOnly.json()).host, false, 'HTTPS proxy requests never inherit host privileges')
    const session = await request('/api/team/session')
    assert.equal((await session.json()).wechatAvailable, true)
    assert.match(session.headers.get('set-cookie'), /Secure/)
    const insecure = await request('/api/team/wechat/start', { method: 'POST', body: '{}', headers: { 'x-forwarded-proto': 'http' } })
    assert.equal(insecure.status, 400)
    const startLogin = async (returnTo = '/projects/demo?view=versions') => {
      const start = await request('/api/team/wechat/start', { method: 'POST', body: JSON.stringify({ returnTo }) })
      assert.equal(start.status, 200)
      const { url } = await start.json()
      assert.ok(!url.includes('test-secret'))
      const state = new URL(url).searchParams.get('state')
      const cookie = start.headers.get('set-cookie').split(';')[0]
      return { state, cookie }
    }
    const first = await startLogin()
    const wrongBrowser = await request(`/api/team/wechat/callback?state=${first.state}&code=valid`)
    assert.equal(wrongBrowser.status, 302)
    assert.match(wrongBrowser.headers.get('location'), /login_error/)
    assert.equal(calls.length, 0)
    const complete = login => request(`/api/team/wechat/callback?state=${login.state}&code=valid`, { headers: { cookie: login.cookie, 'sec-fetch-site': 'cross-site' } })
    const callback = await complete(first)
    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), '/#/projects/demo?view=versions')
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer')
    const cookie = callback.headers.getSetCookie().find(value => value.startsWith('flowlark_visitor=')).split(';')[0]
    assert.deepEqual(calls, ['/sns/oauth2/access_token', '/sns/userinfo'])
    const signedIn = await request('/api/team/session', { headers: { cookie } })
    const data = await signedIn.json()
    assert.equal(data.user.name, '微信测试账号')
    assert.equal(data.role, null)
    assert.equal(data.host, false)
    assert.ok(!JSON.stringify(data).includes('account-one'))
    assert.ok(!JSON.stringify(data).includes('private-provider-token'))
    const role = await request('/api/team/role', { method: 'POST', body: '{"role":"tester"}', headers: { cookie } })
    assert.equal(role.status, 200)
    const replay = await complete(first)
    assert.match(replay.headers.get('location'), /login_error/)
    assert.equal(calls.length, 2)
    const second = await startLogin('//evil.example')
    const relogin = await complete(second)
    assert.equal(relogin.headers.get('location'), '/#/actions')
    const newCookie = relogin.headers.getSetCookie().find(value => value.startsWith('flowlark_visitor=')).split(';')[0]
    assert.notEqual(cookie, newCookie)
    const restored = await request('/api/team/session', { headers: { cookie: newCookie } })
    const restoredData = await restored.json()
    assert.equal(restoredData.id, data.id)
    assert.equal(restoredData.role, 'tester')
    assert.equal(team.visitor(root, cookie.split('=')[1]), null)
    team.setTeamEnabled(root, false)
    const readonly = await request('/api/team/session', { headers: { cookie: newCookie } })
    const readonlyData = await readonly.json()
    assert.equal(readonlyData.user.name, '微信测试账号')
    assert.equal(readonlyData.role, 'guest')
    const logout = await request('/api/team/logout', { method: 'POST', body: '{}', headers: { cookie: newCookie } })
    assert.equal(logout.status, 200)
    assert.ok(logout.headers.getSetCookie().every(value => value.includes('Max-Age=0')))
    assert.equal(team.visitor(root, newCookie.split('=')[1]), null)
    const off = await request('/api/team/wechat/start', { method: 'POST', body: '{}' })
    assert.equal(off.status, 403)
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
    await server?.close()
    cleanup(root)
  }
})

test('server rejects expired credentials even when the browser still sends them', () => {
  const { root } = newHub()
  try {
    const guest = team.createVisitor(root, 'ip')
    const account = team.loginVisitor(root, { provider: 'wechat', key: 'account', name: '用户' }, 'ip')
    for (const login of [guest, account]) {
      const expiry = Date.parse(login.item.expiresAt)
      assert.ok(team.visitor(root, login.token, expiry - 1))
      assert.equal(team.visitor(root, login.token, expiry), null)
    }
  } finally { cleanup(root) }
})


test('return paths stay inside the app and support Chinese project names', () => {
  assert.equal(loginReturnPath('/projects/项目'), '/projects/%E9%A1%B9%E7%9B%AE')
  for (const value of ['//evil.example', 'https://evil.example', '/bad\r\nheader', '/bad\\path', null]) assert.equal(loginReturnPath(value), '/actions')
})
