import { test, describe, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CLI, html, newHub, throwsCode, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function sh(root, ...args) {
  const r = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed: ${r.stderr || r.stdout}`)
}

function makeGitReadonly(root) {
  sh(root, 'git', 'init', '-b', 'main')
  sh(root, 'git', 'remote', 'add', 'origin', 'https://example.com/team/flowlark.git')

  const cacheDir = path.join(root, '.flowlark', 'cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, 'permissions.json'), JSON.stringify({
    canWrite: false,
    mode: 'readonly',
    reason: '远端拒绝写入，当前身份按只读处理',
    source: 'probe',
    checkedAt: '2026-08-22T00:00:00.000Z',
    remoteName: 'origin',
    remoteUrl: 'https://example.com/team/flowlark.git',
    branch: 'main'
  }, null, 2), 'utf8')
}

function ph(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FLOWLARK_USER: '测试用户', FLOWLARK_REPO: '' }
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

describe('v0.2.0 Git 只读权限', () => {
  test('核心写操作在 Git 只读缓存下提前拒绝', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'ord' })
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    makeGitReadonly(root)

    const p = hub.writePermission()
    t.assert.strictEqual(p.mode, 'readonly')
    t.assert.strictEqual(p.canWrite, false)
    throwsCode(t, 'GIT_READONLY', () => hub.addVersion('ord', {
      versionNo: 'v1.1',
      title: '二版',
      html: html('二版')
    }))
    throwsCode(t, 'GIT_READONLY', () => hub.setBaseline('ord', 'v1.0'))
  })

  test('只读用户仍可执行本地阅读状态', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'ord' })
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    makeGitReadonly(root)

    const r = hub.markRead('ord', 'v1.0')
    t.assert.strictEqual(r.versionNo, 'v1.0')
    t.assert.strictEqual(hub.getRead('ord').versionNo, 'v1.0')
  })

  test('离线产物写入在 Git 只读缓存下提前拒绝', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'ord' })
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    makeGitReadonly(root)

    await t.assert.rejects(
      () => hub.buildOffline('ord', 'v1.0'),
      (e) => e.code === 'GIT_READONLY'
    )
    throwsCode(t, 'GIT_READONLY', () => hub.clearOffline('ord', 'v1.0'))
  })

  test('HTTP health 暴露 Git 只读原因，写接口返回 403', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'ord' })
    makeGitReadonly(root)

    const server = await startServer(root, { port: 0, previewPort: 0 })
    try {
      const base = `http://127.0.0.1:${server.port}`
      let r = await fetch(base + '/api/health')
      let body = await r.json()
      t.assert.strictEqual(body.canWrite, false)
      t.assert.strictEqual(body.readonlyReason, 'git')
      t.assert.strictEqual(body.gitPermission.mode, 'readonly')

      r = await fetch(base + '/api/projects/ord/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionNo: 'v1.0', title: '首版', html: html() })
      })
      body = await r.json()
      t.assert.strictEqual(r.status, 403)
      t.assert.strictEqual(body.code, 'GIT_READONLY')
    } finally {
      await server.close()
    }
  })

  test('CLI 能查看权限，写命令在只读模式下失败', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'ord' })
    makeGitReadonly(root)

    let r = ph(root, 'git', 'permission', '--json')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.strictEqual(JSON.parse(r.out).mode, 'readonly')

    r = ph(root, 'new', '营销活动', '--code', 'mkt')
    t.assert.strictEqual(r.code, 1)
    t.assert.match(r.err, /Git 只读/)
  })
})
