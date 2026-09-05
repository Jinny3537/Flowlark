import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import { migrateToLatest, migrateToSchema5 } from '../src/core/migrate.js'
import { normalizeAcceptanceRules } from '../src/core/acceptance-rules.js'
import { stringify } from '../src/core/json.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value) + '\n')
}
function fixture(schema = 4) {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: [] })
  hub.createMilestone({ name: 'S1', title: '迭代一', items: [] })
  const configFile = path.join(root, 'flowlark.json')
  write(configFile, { ...read(configFile), schemaVersion: schema })
  const projectFile = store.paths.projectFile(root, 'orders')
  const project = read(projectFile)
  delete project.acceptance
  write(projectFile, project)
  const milestoneFile = store.paths.milestoneFile(root, 'S1')
  const milestone = read(milestoneFile)
  delete milestone.deliveries
  write(milestoneFile, milestone)
  const snapshotFile = store.paths.snapshotFile(root, 'old')
  write(snapshotFile, { name: 'old', milestone: 'S1', items: [], createdAt: '2025-01-01T00:00:00Z' })
  return { root, hub, configFile, projectFile, milestoneFile, snapshotFile }
}

function frozenSnapshot(root, overrides = {}) {
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
  const identity = { milestone: 'S1', project: 'orders', version: 'v1', releaseCommit: 'a'.repeat(40), ...overrides }
  const name = `delivery-${hash(stringify(identity)).slice(0, 48)}`
  const content = Buffer.from(html())
  const payload = {
    kind: 'delivery', schemaVersion: 1, name, ...identity,
    items: [{ requirement: 'REQ-1', project: identity.project, version: identity.version }],
    specification: '# Released version', changes: [], requirements: [{ code: 'REQ-1', spec: '# Acceptance' }],
    acceptance: normalizeAcceptanceRules(),
    materials: [{ path: 'projects/orders/versions/v1.html', size: content.length, sha256: hash(content), encoding: 'base64', content: content.toString('base64') }]
  }
  const value = { ...payload, contentHash: `sha256:${hash(stringify(payload))}` }
  const file = store.paths.snapshotFile(root, name)
  write(file, value)
  return { file, value }
}

test('schema 4 gains defaults, legacy classification, and latest migration reports schema 5', () => {
  const { root, configFile, projectFile, milestoneFile, snapshotFile } = fixture()
  const report = migrateToLatest(root)
  assert.equal(report.from, 4)
  assert.equal(report.to, 5)
  assert.equal(read(configFile).schemaVersion, 5)
  assert.deepEqual(read(projectFile).acceptance, normalizeAcceptanceRules())
  assert.deepEqual(read(milestoneFile).deliveries, [])
  assert.equal(read(snapshotFile).kind, 'legacy')
  assert.deepEqual(migrateToLatest(root), { migrated: false, from: 5, to: 5, reports: [] })
})

test('custom rules, existing delivery references and immutable snapshots are preserved', () => {
  const { root, projectFile, milestoneFile } = fixture()
  const acceptance = { roles: [{ id: 'owner', name: '负责人', required: true }], rule: { type: 'all-required' } }
  write(projectFile, { ...read(projectFile), acceptance })
  const { file, value } = frozenSnapshot(root)
  const deliveries = [{ project: 'orders', version: 'v1', snapshot: value.name, releaseRunId: 'run-1' }]
  write(milestoneFile, { ...read(milestoneFile), deliveries })
  const before = fs.readFileSync(file)
  migrateToSchema5(root)
  assert.deepEqual(read(projectFile).acceptance, acceptance)
  assert.deepEqual(read(milestoneFile).deliveries, deliveries)
  assert.deepEqual(fs.readFileSync(file), before)
})

test('successful migration never changes prototype, specification, attachment or acceptance bytes', () => {
  const { root } = fixture()
  const { value } = frozenSnapshot(root)
  const recordFile = path.join(root, 'acceptances', value.name, 'decision-1.json')
  write(recordFile, {
    id: 'decision-1', snapshot: value.name, snapshotHash: value.contentHash,
    role: 'product', verdict: 'approved', note: '', conditions: [], actor: 'tester', at: '2026-09-05T00:00:00Z'
  })
  const files = [
    store.paths.versionHtml(root, 'orders', 'v1'), store.paths.versionSpec(root, 'orders', 'v1'),
    path.join(store.paths.attachments(root, 'orders', 'v1'), 'proof.bin'),
    store.paths.requirementSpec(root, 'REQ-1'), path.join(store.paths.requirementFiles(root, 'REQ-1'), 'brief.bin')
  ]
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from([0, 255, 10, 13, 32, 65]))
  }
  const feedbackFile = path.join(root, 'acceptances', value.name, 'feedback', 'feedback-1.json')
  write(feedbackFile, { severity: 'blocker', status: 'open' })
  const before = new Map([...files, recordFile, feedbackFile, store.paths.versionJson(root, 'orders', 'v1')].map((file) => [file, fs.readFileSync(file)]))
  migrateToSchema5(root)
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes)
})

for (const acceptance of [null, [], {}, { roles: [], rule: { type: 'all-required' } }, { ...normalizeAcceptanceRules(), autoExecute: true }]) {
  test(`invalid rules restore schema 4 metadata: ${JSON.stringify(acceptance)}`, () => {
    const { root, configFile, projectFile, milestoneFile, snapshotFile } = fixture()
    write(projectFile, { ...read(projectFile), acceptance })
    const before = new Map([configFile, projectFile, milestoneFile, snapshotFile].map((file) => [file, fs.readFileSync(file)]))
    assert.throws(() => migrateToSchema5(root))
    for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes)
  })
}

test('unknown snapshot kind is rejected without metadata changes', () => {
  const { root, configFile, snapshotFile } = fixture()
  write(snapshotFile, { ...read(snapshotFile), kind: 'approved' })
  const before = fs.readFileSync(snapshotFile)
  assert.throws(() => migrateToSchema5(root), { code: 'MIGRATION_SNAPSHOT_KIND_INVALID' })
  assert.equal(read(configFile).schemaVersion, 4)
  assert.deepEqual(fs.readFileSync(snapshotFile), before)
})

for (const deliveries of [null, {}, ['old'], [null], [{ project: 'orders', version: 'v1', snapshot: '../outside' }]]) {
  test(`invalid deliveries are rejected: ${JSON.stringify(deliveries)}`, () => {
    const { root, milestoneFile } = fixture()
    write(milestoneFile, { ...read(milestoneFile), deliveries })
    const before = fs.readFileSync(milestoneFile)
    assert.throws(() => migrateToSchema5(root), { code: 'MIGRATION_DELIVERIES_INVALID' })
    assert.deepEqual(fs.readFileSync(milestoneFile), before)
  })
}

test('delivery references reject missing snapshots, duplicate scopes and scope mismatch', () => {
  for (const mode of ['missing', 'duplicate', 'mismatch']) {
    const { root, milestoneFile } = fixture()
    const { value } = frozenSnapshot(root, mode === 'mismatch' ? { milestone: 'S2' } : {})
    const delivery = { project: 'orders', version: 'v1', snapshot: mode === 'missing' ? `delivery-${'f'.repeat(48)}` : value.name }
    write(milestoneFile, { ...read(milestoneFile), deliveries: mode === 'duplicate' ? [delivery, delivery] : [delivery] })
    assert.throws(() => migrateToSchema5(root), { code: 'MIGRATION_DELIVERY_REFERENCE_INVALID' })
  }
})

test('invalid acceptance snapshot references are rejected without modifying decision bytes', () => {
  const { root } = fixture()
  const { value } = frozenSnapshot(root)
  const file = path.join(root, 'acceptances', value.name, 'decision-1.json')
  write(file, { id: 'decision-1', snapshot: value.name, snapshotHash: 'wrong', role: 'product', verdict: 'approved', at: '2026-09-05T00:00:00Z' })
  const before = fs.readFileSync(file)
  assert.throws(() => migrateToSchema5(root), { code: 'MIGRATION_ACCEPTANCE_REFERENCE_INVALID' })
  assert.deepEqual(fs.readFileSync(file), before)
})

test('schema 5 post-write failure restores the entire schema 1 chain byte-for-byte', () => {
  const { root, configFile, projectFile, milestoneFile, snapshotFile } = fixture(1)
  const versionFile = store.paths.versionJson(root, 'orders', 'v1')
  const version = read(versionFile)
  version.requirements = [{ code: 'REQ-INLINE', title: '内联需求' }]
  delete version.reviewStatus
  write(versionFile, version)
  const requirementFile = store.paths.requirementFile(root, 'REQ-INLINE')
  const files = [configFile, projectFile, milestoneFile, snapshotFile, versionFile,
    store.paths.versionHtml(root, 'orders', 'v1'), path.join(root, '.gitignore'), path.join(root, '.gitattributes')]
  const before = new Map(files.map((file) => [file, fs.readFileSync(file)]))
  assert.throws(() => migrateToLatest(root, {
    afterSchema5Write() { throw new Error('injected schema 5 failure') }
  }), /injected schema 5 failure/)
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes)
  assert.equal(fs.existsSync(requirementFile), false)
})

test('post-write schema 5 validation failure restores the original metadata', () => {
  const { root, projectFile, milestoneFile, snapshotFile, configFile } = fixture()
  const before = new Map([projectFile, milestoneFile, snapshotFile, configFile].map((file) => [file, fs.readFileSync(file)]))
  assert.throws(() => migrateToSchema5(root, {
    afterSchema5Write() { write(projectFile, { ...read(projectFile), acceptance: null }) }
  }), { code: 'ACCEPTANCE_RULES_INVALID' })
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes)
})

test('post-write validation rejects a missing default field and restores original bytes', () => {
  const { root, projectFile, configFile } = fixture()
  const before = fs.readFileSync(projectFile)
  assert.throws(() => migrateToSchema5(root, {
    afterSchema5Write() {
      const project = read(projectFile)
      delete project.acceptance
      write(projectFile, project)
    }
  }), { code: 'MIGRATION_SCHEMA5_INCOMPLETE' })
  assert.deepEqual(fs.readFileSync(projectFile), before)
  assert.equal(read(configFile).schemaVersion, 4)
})

for (const relative of ['projects', 'projects/orders', 'projects/orders/project.json', 'projects/orders/versions',
  'projects/orders/versions/v1.json', 'milestones', 'milestones/S1.json', 'snapshots', 'snapshots/old.json',
  'acceptances', 'acceptances/delivery-test', 'acceptances/delivery-test/decision.json', 'acceptances/delivery-test/feedback']) {
  test(`schema 5 rejects metadata symlink at ${relative} without touching outside bytes`, () => {
    const { root, configFile } = fixture()
    const outside = fs.mkdtempSync(path.join(path.dirname(root), 'flowlark-migration-outside-'))
    dirs.push(outside)
    const linked = path.join(root, relative)
    const fileLink = relative.endsWith('.json')
    const outsideFile = path.join(outside, fileLink ? 'outside.json' : 'keep.bin')
    const bytes = Buffer.from([0, 255, 10, 46, 99])
    fs.writeFileSync(outsideFile, bytes)
    if (fs.existsSync(linked)) fs.rmSync(linked, { recursive: true })
    fs.mkdirSync(path.dirname(linked), { recursive: true })
    fs.symlinkSync(fileLink ? outsideFile : outside, linked)
    const before = fs.readFileSync(configFile)
    assert.throws(() => migrateToLatest(root), { code: 'MIGRATION_METADATA_SYMLINK' })
    assert.deepEqual(fs.readFileSync(configFile), before)
    assert.deepEqual(fs.readFileSync(outsideFile), bytes)
    assert.equal(fs.lstatSync(linked).isSymbolicLink(), true)
  })
}
