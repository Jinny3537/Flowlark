import fs from 'node:fs'
import path from 'node:path'
import { test, describe, before, after } from 'node:test'
import { newHub, html, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

let root, hub, server, base

before(async () => {
  const ctx = newHub()
  root = ctx.root
  hub = ctx.hub
  hub.createProject({ name: '订单中心', code: 'ord' })
  server = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: {
      diagnostics: () => ({ available: false, pid: null, stderr: '' }),
      close: async () => {}
    }
  })
  base = `http://127.0.0.1:${server.port}`
})

after(async () => {
  if (server) await server.close()
  cleanup(root)
})

const api = {
  async get(p) {
    const response = await fetch(base + p)
    return { status: response.status, body: await response.json() }
  },
  async send(method, p) {
    const response = await fetch(base + p, { method })
    return { status: response.status, body: await response.json() }
  }
}

describe('draft/trash HTTP API', () => {
  test('清理已归档 watch 记录', async (t) => {
    const source = path.join(root, 'watch_v9.1.html')
    fs.writeFileSync(source, html('watch cleanup'))
    const item = hub.collectWatchFile('ord', source)

    const removed = await api.send('DELETE', `/api/watch/inbox/${item.id}`)
    t.assert.strictEqual(removed.status, 200)
    t.assert.strictEqual(removed.body.id, item.id)
    t.assert.ok(!hub.listWatchInbox().some((candidate) => candidate.id === item.id))
    t.assert.ok(hub.oplog({ project: 'ord' }).some((entry) => entry.action === 'WATCH_RECORD_REMOVE'))
  })

  test('按回收站 ID 恢复准确的版本记录', async (t) => {
    hub.addVersion('ord', { versionNo: 'v9.2', title: '待恢复', html: html('trash restore') })
    hub.removeVersion('ord', 'v9.2')
    const listed = await api.get('/api/trash?project=ord')
    const entry = listed.body.find((item) => item.versionNo === 'v9.2')
    t.assert.strictEqual(entry.canRestore, true)

    const restored = await api.send('POST', `/api/trash/${encodeURIComponent(entry.id)}/restore`)
    t.assert.strictEqual(restored.status, 200)
    t.assert.strictEqual(restored.body.versionNo, 'v9.2')
  })
})
