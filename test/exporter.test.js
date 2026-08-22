import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanup, html, newHub } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('静态交付包', () => {
  test('需求包包含索引、原型、规格和清单', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: [{ code: 'REQ-1', title: '需求一' }] })
    hub.setSpec('orders', 'v1', '# 规格\n')
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-export-'))
    dirs.push(out)
    const result = await hub.exportRequirement('REQ-1', out)
    t.assert.strictEqual(result.itemCount, 1)
    t.assert.ok(fs.existsSync(path.join(out, 'index.html')))
    t.assert.ok(fs.existsSync(path.join(out, 'orders-v1', 'prototype.html')))
    t.assert.ok(fs.existsSync(path.join(out, 'orders-v1', 'spec.md')))
    t.assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'))).code, 'REQ-1')
  })
})
