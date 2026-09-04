import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, html, newHub } from './helpers.js'
import { migrateToLatest, migrateToSchema2, rollbackMigration } from '../src/core/migrate.js'
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
    const beforeVersion = fs.readFileSync(store.paths.versionJson(root, 'orders', 'v1'))

    const report = migrateToSchema2(root)
    t.assert.strictEqual(report.migrated, true)
    t.assert.strictEqual(report.requirementCount, 1)
    t.assert.strictEqual(report.conflicts.length, 1)
    t.assert.deepStrictEqual(store.readVersion(root, 'orders', 'v1').requirements, ['REQ-1'])
    t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 2)

    rollbackMigration(root, report.backup)
    t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 1)
    t.assert.strictEqual(typeof store.readVersion(root, 'orders', 'v1').requirements[0], 'object')
    t.assert.deepStrictEqual(fs.readFileSync(store.paths.versionJson(root, 'orders', 'v1')), beforeVersion)
  })
})

test('schema 2 projects gain normalized manual sync policy', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  const configFile = path.join(root, 'flowlark.json')
  const projectFile = path.join(root, 'projects', 'orders', 'project.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  config.schemaVersion = 2
  delete project.sync
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n')

  const report = migrateToLatest(root)
  t.assert.strictEqual(report.migrated, true)
  t.assert.strictEqual(report.to, 3)
  t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 3)
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 1 migrates through schema 2 and schema 3', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', {
    versionNo: 'v1', title: '一版', html: html(),
    requirements: [{ code: 'REQ-1', title: '批量关闭' }]
  })
  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 1
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const version = store.readVersion(root, 'orders', 'v1')
  version.requirements = [{ code: 'REQ-1', title: '批量关闭', url: '' }]
  delete version.reviewStatus
  store.writeVersion(root, 'orders', version)

  const report = migrateToLatest(root)
  t.assert.strictEqual(report.to, 3)
  t.assert.deepStrictEqual(store.readVersion(root, 'orders', 'v1').requirements, ['REQ-1'])
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 3 failure during schema 1 to latest restores the complete schema 1 state', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', {
    versionNo: 'v1', title: '一版', html: html(),
    requirements: [{ code: 'REQ-INLINE', title: '内联需求' }]
  })

  const configFile = path.join(root, 'flowlark.json')
  const versionFile = store.paths.versionJson(root, 'orders', 'v1')
  const existingRequirementFile = store.paths.requirementFile(root, 'REQ-EXISTING')
  const inlineRequirementFile = store.paths.requirementFile(root, 'REQ-INLINE')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 1
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const version = store.readVersion(root, 'orders', 'v1')
  version.requirements = [{ code: 'REQ-INLINE', title: '内联需求', url: '' }]
  delete version.reviewStatus
  store.writeVersion(root, 'orders', version)
  fs.rmSync(inlineRequirementFile, { force: true })
  fs.mkdirSync(path.dirname(existingRequirementFile), { recursive: true })
  fs.writeFileSync(existingRequirementFile, '{"legacy":"existing"}\n')

  const beforeConfig = fs.readFileSync(configFile)
  const beforeVersion = fs.readFileSync(versionFile)
  const beforeExistingRequirement = fs.readFileSync(existingRequirementFile)
  t.assert.strictEqual(fs.existsSync(inlineRequirementFile), false)

  t.assert.throws(() => migrateToLatest(root, {
    afterProjectWrite() { throw new Error('injected schema 3 failure') }
  }), /injected schema 3 failure/)
  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(versionFile), beforeVersion)
  t.assert.deepStrictEqual(fs.readFileSync(existingRequirementFile), beforeExistingRequirement)
  t.assert.strictEqual(fs.existsSync(inlineRequirementFile), false)
})

test('schema 3 validation failure restores every touched metadata file byte-for-byte', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  const configFile = path.join(root, 'flowlark.json')
  const projectFile = path.join(root, 'projects', 'orders', 'project.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  config.schemaVersion = 2
  delete project.sync
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n')
  const beforeConfig = fs.readFileSync(configFile)
  const beforeProject = fs.readFileSync(projectFile)

  t.assert.throws(() => migrateToLatest(root, {
    afterProjectWrite() { throw new Error('injected schema 3 failure') }
  }), /injected schema 3 failure/)
  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(projectFile), beforeProject)
})
