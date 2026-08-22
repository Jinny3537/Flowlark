import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function readonly(root) {
  fs.mkdirSync(path.join(root, '.git'))
  const dir = path.join(root, '.flowlark', 'cache')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify({
    canWrite: false, mode: 'readonly', reason: '测试只读', source: 'probe',
    checkedAt: '2026-08-22T00:00:00.000Z'
  }))
}

const sample = {
  title: '反馈标题', description: '反馈内容', project: 'orders', version: 'v1',
  requirements: ['REQ-1'], anchor: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
}

describe('反馈 API', () => {
  test('Git 只读模式仍可创建、导出和删除本机草稿', async (t) => {
    const { root } = newHub()
    dirs.push(root)
    readonly(root)
    const server = await startServer(root, { port: 0, previewPort: 0 })
    const base = `http://127.0.0.1:${server.port}`
    try {
      let res = await fetch(`${base}/api/feedback/drafts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample)
      })
      const draft = await res.json()
      t.assert.strictEqual(res.status, 201)
      t.assert.ok(draft.id)

      res = await fetch(`${base}/api/feedback/drafts/${draft.id}/markdown`)
      const exported = await res.json()
      t.assert.match(exported.markdown, /REQ-1/)

      res = await fetch(`${base}/api/feedback/drafts/${draft.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'markdown' })
      })
      const submitted = await res.json()
      t.assert.strictEqual(submitted.fallback, true)

      res = await fetch(`${base}/api/feedback/drafts/${draft.id}`, { method: 'DELETE' })
      t.assert.strictEqual(res.status, 200)
    } finally {
      await server.close()
    }
  })
})
