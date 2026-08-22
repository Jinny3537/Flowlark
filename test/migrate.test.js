import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import { cleanup, html, newHub } from './helpers.js'
import { migrateToSchema2, rollbackMigration } from '../src/core/migrate.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('Schema 2 迁移', () => {
  test('需求对象去重并保留全部版本关联，可从备份回滚', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: [{ code: 'REQ-1', title: '旧标题' }] })
    hub.addVersion('orders', { versionNo: 'v2', title: '二版', html: html(), requirements: [{ code: 'REQ-1', title: '新标题' }] })

    const configFile = `${root}/flowlark.json`
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    config.schemaVersion = 1
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
    for (const no of ['v1', 'v2']) {
      const version = store.readVersion(root, 'orders', no)
      version.requirements = [{ code: 'REQ-1', title: no === 'v1' ? '旧标题' : '新标题', url: '' }]
      delete version.reviewStatus
      store.writeVersion(root, 'orders', version)
    }

    const report = migrateToSchema2(root)
    t.assert.strictEqual(report.migrated, true)
    t.assert.strictEqual(report.requirementCount, 1)
    t.assert.strictEqual(report.conflicts.length, 1)
    t.assert.deepStrictEqual(store.readVersion(root, 'orders', 'v1').requirements, ['REQ-1'])
    t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 2)

    rollbackMigration(root, report.backup)
    t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 1)
    t.assert.strictEqual(typeof store.readVersion(root, 'orders', 'v1').requirements[0], 'object')
  })
})
