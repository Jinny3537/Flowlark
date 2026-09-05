import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, html, newHub, throwsCode } from './helpers.js'
import { migrateToLatest, migrateToSchema2, migrateToSchema4, rollbackMigration } from '../src/core/migrate.js'
import { createMetadataBackup } from '../src/core/metadata-backup.js'
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
  t.assert.strictEqual(report.to, 5)
  t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 5)
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 3 preserves regular Git config and creates missing Git config', (t) => {
  const { root } = newHub()
  dirs.push(root)
  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 2
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'custom-cache/\n')
  fs.rmSync(path.join(root, '.gitattributes'))

  migrateToLatest(root)

  t.assert.strictEqual(
    fs.readFileSync(path.join(root, '.gitignore'), 'utf8'),
    'custom-cache/\n.flowlark/backup/\n'
  )
  t.assert.strictEqual(
    fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'),
    '.flowlark/sync-audit.ndjson merge=union\n'
  )
})

for (const relative of ['flowlark.json', '.gitignore', '.gitattributes']) {
  test('migration rejects ' + relative + ' symlink without changing repository or external target', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'orders' })
    const configFile = path.join(root, 'flowlark.json')
    const projectFile = path.join(root, 'projects', 'orders', 'project.json')
    const linkedFile = path.join(root, relative)
    const otherGitConfig = path.join(root, relative === '.gitignore' ? '.gitattributes' : '.gitignore')
    const outside = path.join(path.dirname(root), path.basename(root) + '-' + relative.slice(1) + '-outside')
    t.after(() => fs.rmSync(outside, { force: true }))

    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    config.schemaVersion = relative === 'flowlark.json' ? 1 : 2
    delete project.sync
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n')
    const externalBytes = relative === 'flowlark.json'
      ? fs.readFileSync(configFile)
      : Buffer.from([0, 255, 10, 46, 102, 108, 111, 119, 108, 97, 114, 107])
    fs.writeFileSync(outside, externalBytes)
    fs.rmSync(linkedFile)
    fs.symlinkSync(outside, linkedFile)

    const beforeConfig = fs.readFileSync(configFile)
    const beforeProject = fs.readFileSync(projectFile)
    const beforeOtherGitConfig = fs.readFileSync(otherGitConfig)
    const error = throwsCode(t, 'MIGRATION_TOP_LEVEL_SYMLINK', () => migrateToLatest(root))

    t.assert.strictEqual(error.status, 409)
    t.assert.match(error.message, new RegExp(relative.replace('.', '\\.')))
    t.assert.match(error.message, /符号链接/)
    t.assert.deepStrictEqual(fs.readFileSync(outside), externalBytes)
    t.assert.strictEqual(fs.lstatSync(linkedFile).isSymbolicLink(), true)
    t.assert.strictEqual(fs.readlinkSync(linkedFile), outside)
    t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
    t.assert.deepStrictEqual(fs.readFileSync(projectFile), beforeProject)
    t.assert.deepStrictEqual(fs.readFileSync(otherGitConfig), beforeOtherGitConfig)
  })
}

test('schema 4 rejects a symlinked requirements root without touching its external target', (t) => {
  const { root } = newHub()
  dirs.push(root)
  const configFile = path.join(root, 'flowlark.json')
  const requirements = path.join(root, 'requirements')
  const outside = path.join(path.dirname(root), `${path.basename(root)}-requirements-outside`)
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  const externalRequirement = path.join(outside, 'REQ-OUTSIDE', 'requirement.json')
  fs.mkdirSync(path.dirname(externalRequirement), { recursive: true })
  fs.writeFileSync(externalRequirement, '{"code":"REQ-OUTSIDE","title":"outside","statusOverride":"not_started"}\n')
  const externalBytes = fs.readFileSync(externalRequirement)
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 3
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const beforeConfig = fs.readFileSync(configFile)
  fs.rmSync(requirements, { recursive: true })
  fs.symlinkSync(outside, requirements)

  throwsCode(t, 'MIGRATION_REQUIREMENT_SYMLINK', () => migrateToLatest(root))

  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(externalRequirement), externalBytes)
  t.assert.strictEqual(fs.lstatSync(requirements).isSymbolicLink(), true)
  t.assert.strictEqual(fs.readlinkSync(requirements), outside)
})

test('schema 1 migrates through schema 2, schema 3, schema 4, and schema 5', (t) => {
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
  t.assert.strictEqual(report.to, 5)
  t.assert.deepStrictEqual(store.readVersion(root, 'orders', 'v1').requirements, ['REQ-1'])
  t.assert.strictEqual(store.readProject(root, 'orders').sync.mode, 'manual')
})

test('schema 3 legacy requirement states migrate to schema 4 lifecycle metadata', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '设计中项目', code: 'designing' })
  hub.createProject({ name: '已交付项目', code: 'delivered' })
  for (const code of ['REQ-NOT-STARTED', 'REQ-DESIGNING', 'REQ-FINALIZED', 'REQ-DELIVERED']) {
    hub.createRequirement({ code, title: code })
  }
  hub.addVersion('designing', {
    versionNo: 'v1', title: '设计稿', html: html(), requirements: ['REQ-DESIGNING']
  })
  hub.addVersion('delivered', {
    versionNo: 'v1', title: '交付稿', html: html(), requirements: ['REQ-DELIVERED']
  })
  hub.setReviewStatus('delivered', 'v1', 'confirmed')
  store.writeBaseline(root, 'delivered', 'v1')

  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 3
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  for (const code of ['REQ-NOT-STARTED', 'REQ-DESIGNING', 'REQ-FINALIZED', 'REQ-DELIVERED']) {
    const file = store.paths.requirementFile(root, code)
    const item = JSON.parse(fs.readFileSync(file, 'utf8'))
    delete item.status
    delete item.statusChangedAt
    delete item.statusChangedBy
    delete item.statusReason
    if (code === 'REQ-FINALIZED') item.statusOverride = 'finalized'
    fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n')
  }

  const report = migrateToSchema4(root)

  t.assert.strictEqual(report.migrated, true)
  t.assert.strictEqual(report.requirementCount, 4)
  t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 4)
  const expected = {
    'REQ-NOT-STARTED': ['draft', 'not_started'],
    'REQ-DESIGNING': ['draft', 'designing'],
    'REQ-FINALIZED': ['confirmed', 'finalized'],
    'REQ-DELIVERED': ['confirmed', 'delivered']
  }
  for (const [code, [status, legacy]] of Object.entries(expected)) {
    const item = JSON.parse(fs.readFileSync(store.paths.requirementFile(root, code), 'utf8'))
    t.assert.strictEqual(item.status, status)
    t.assert.strictEqual(item.statusChangedBy, 'migration:schema4')
    t.assert.strictEqual(item.statusReason, `legacy-derived:${legacy}`)
    t.assert.ok(Number.isFinite(Date.parse(item.statusChangedAt)))
    t.assert.strictEqual(Object.hasOwn(item, 'statusOverride'), false)
  }
})

test('schema 4 preserves explicit lifecycle status and metadata from schema 3', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-DRAFT', title: '保持草稿' })
  hub.createRequirement({ code: 'REQ-CONFIRMED', title: '保持已确认' })
  hub.addVersion('orders', {
    versionNo: 'v1', title: '已确认基线', html: html(), requirements: ['REQ-DRAFT']
  })
  hub.setReviewStatus('orders', 'v1', 'confirmed')
  store.writeBaseline(root, 'orders', 'v1')

  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 3
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const expected = {
    'REQ-DRAFT': {
      status: 'draft',
      statusChangedAt: '2026-09-01T01:02:03.000Z',
      statusChangedBy: 'alice',
      statusReason: 'still-scoping'
    },
    'REQ-CONFIRMED': {
      status: 'confirmed',
      statusChangedAt: '2026-09-02T02:03:04.000Z',
      statusChangedBy: 'bob',
      statusReason: 'approved'
    }
  }
  for (const [code, lifecycle] of Object.entries(expected)) {
    const file = store.paths.requirementFile(root, code)
    const item = JSON.parse(fs.readFileSync(file, 'utf8'))
    Object.assign(item, lifecycle, { statusOverride: null })
    fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n')
  }

  migrateToSchema4(root)

  for (const [code, lifecycle] of Object.entries(expected)) {
    const item = JSON.parse(fs.readFileSync(store.paths.requirementFile(root, code), 'utf8'))
    for (const [field, value] of Object.entries(lifecycle)) t.assert.strictEqual(item[field], value)
    t.assert.strictEqual(Object.hasOwn(item, 'statusOverride'), false)
  }
})

test('schema 4 rejects invalid explicit lifecycle status and restores bytes', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createRequirement({ code: 'REQ-INVALID', title: '非法生命周期' })
  const configFile = path.join(root, 'flowlark.json')
  const requirementFile = store.paths.requirementFile(root, 'REQ-INVALID')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const requirement = JSON.parse(fs.readFileSync(requirementFile, 'utf8'))
  config.schemaVersion = 3
  requirement.status = 'paused'
  requirement.statusChangedAt = '2026-09-01T01:02:03.000Z'
  requirement.statusChangedBy = 'legacy-user'
  requirement.statusReason = 'unsupported'
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(requirementFile, JSON.stringify(requirement, null, 2) + '\n')
  const beforeConfig = fs.readFileSync(configFile)
  const beforeRequirement = fs.readFileSync(requirementFile)

  throwsCode(t, 'MIGRATION_REQUIREMENT_STATUS_INVALID', () => migrateToSchema4(root))

  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(requirementFile), beforeRequirement)
})

test('schema 4 rejects unknown legacy requirement status and restores bytes', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createRequirement({ code: 'REQ-UNKNOWN', title: '未知状态' })
  const configFile = path.join(root, 'flowlark.json')
  const requirementFile = store.paths.requirementFile(root, 'REQ-UNKNOWN')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const requirement = JSON.parse(fs.readFileSync(requirementFile, 'utf8'))
  config.schemaVersion = 3
  requirement.statusOverride = 'paused'
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  fs.writeFileSync(requirementFile, JSON.stringify(requirement, null, 2) + '\n')
  const beforeConfig = fs.readFileSync(configFile)
  const beforeRequirement = fs.readFileSync(requirementFile)

  throwsCode(t, 'MIGRATION_REQUIREMENT_STATUS_INVALID', () => migrateToSchema4(root))

  t.assert.deepStrictEqual(fs.readFileSync(configFile), beforeConfig)
  t.assert.deepStrictEqual(fs.readFileSync(requirementFile), beforeRequirement)
})

test('schema 4 rejects duplicate external task bindings across requirements', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  for (const code of ['REQ-A', 'REQ-B']) hub.createRequirement({ code, title: code })
  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 3
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  for (const code of ['REQ-A', 'REQ-B']) {
    const file = store.paths.requirementFile(root, code)
    const item = JSON.parse(fs.readFileSync(file, 'utf8'))
    delete item.status
    item.externalTasks = [{
      provider: 'assess-task', server: 'team', projectId: 12, taskId: 34
    }]
    fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n')
  }

  throwsCode(t, 'MIGRATION_EXTERNAL_TASK_DUPLICATE', () => migrateToSchema4(root))
})

test('schema 4 failure during schema 1 to latest restores the complete schema 1 state', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', {
    versionNo: 'v1', title: '一版', html: html(),
    requirements: [{ code: 'REQ-INLINE', title: '内联需求' }]
  })
  const configFile = path.join(root, 'flowlark.json')
  const projectFile = store.paths.projectFile(root, 'orders')
  const versionFile = store.paths.versionJson(root, 'orders', 'v1')
  const requirementFile = store.paths.requirementFile(root, 'REQ-INLINE')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  const version = store.readVersion(root, 'orders', 'v1')
  config.schemaVersion = 1
  version.requirements = [{ code: 'REQ-INLINE', title: '内联需求', url: '' }]
  delete version.reviewStatus
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  store.writeVersion(root, 'orders', version)
  fs.rmSync(requirementFile, { force: true })
  const before = new Map([
    [configFile, fs.readFileSync(configFile)],
    [projectFile, fs.readFileSync(projectFile)],
    [versionFile, fs.readFileSync(versionFile)],
    [path.join(root, '.gitignore'), fs.readFileSync(path.join(root, '.gitignore'))],
    [path.join(root, '.gitattributes'), fs.readFileSync(path.join(root, '.gitattributes'))]
  ])

  t.assert.throws(() => migrateToLatest(root, {
    afterRequirementWrite() { throw new Error('injected schema 4 failure') }
  }), /injected schema 4 failure/)

  for (const [file, bytes] of before) t.assert.deepStrictEqual(fs.readFileSync(file), bytes)
  t.assert.strictEqual(fs.existsSync(requirementFile), false)
})

test('parameterless rollback selects the latest valid backup by manifest timestamp', (t) => {
  const { root } = newHub()
  dirs.push(root)
  const configFile = path.join(root, 'flowlark.json')
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  config.schemaVersion = 1
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const earlier = createMetadataBackup(root, {
    from: 1, to: 2, now: new Date('2026-09-04T01:00:00.000Z')
  })
  config.schemaVersion = 3
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
  const later = createMetadataBackup(root, {
    from: 3, to: 4, now: new Date('2026-09-04T02:00:00.000Z')
  })
  const backupBase = path.join(root, '.flowlark', 'backup')
  fs.renameSync(earlier, path.join(backupBase, 'zzzz-earlier'))
  fs.renameSync(later, path.join(backupBase, 'aaaa-later'))
  fs.mkdirSync(path.join(backupBase, 'zzzz-invalid'))
  fs.writeFileSync(path.join(backupBase, 'zzzz-invalid', 'manifest.json'), '{broken')
  config.schemaVersion = 4
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')

  const report = rollbackMigration(root)

  t.assert.strictEqual(path.basename(report.backup), 'aaaa-later')
  t.assert.strictEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')).schemaVersion, 3)
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
