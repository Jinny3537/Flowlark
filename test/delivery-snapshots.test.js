import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { newHub, cleanup, html } from './helpers.js'
import * as milestones from '../src/core/milestones.js'
import * as requirements from '../src/core/requirements.js'
import { createDeliverySnapshot, readDeliverySnapshot, verifyDeliverySnapshot } from '../src/core/delivery-snapshots.js'

function fixture(t) {
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  hub.createProject({ name: 'Release', code: 'release' })
  hub.createRequirement({ code: 'REQ-1', title: 'Release requirement', description: 'Scope', owner: 'pm' })
  hub.writeRequirementSpec('REQ-1', '# Requirement acceptance')
  hub.addVersion('release', { versionNo: 'v1', title: 'Release v1', html: html('original bytes'), requirements: ['REQ-1'] })
  hub.setSpec('release', 'v1', '# Version acceptance')
  hub.setBaseline('release', 'v1')
  hub.createMilestone({ name: 'RELEASE', items: [{ requirement: 'REQ-1', project: 'release', version: 'v1' }] })
  milestones.updateMilestone(root, 'RELEASE', { status: 'active' }, { system: true })
  git('init')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'test@example.invalid')
  const commit = () => { git('add', '.'); git('commit', '-m', 'Release evidence'); return git('rev-parse', 'HEAD') }
  const input = { milestone: 'RELEASE', project: 'release', version: 'v1', releaseCommit: commit() }
  return { root, hub, git, commit, input }
}

test('delivery freezes committed material bytes, rules and requirement evidence', (t) => {
  const { root, hub, input } = fixture(t)
  hub.writeRequirementSpec('REQ-1', '# Uncommitted change')
  fs.writeFileSync(path.join(root, 'projects/release/versions/v1.html'), html('uncommitted bytes'))
  const snapshot = createDeliverySnapshot(root, input)
  assert.equal(snapshot.kind, 'delivery')
  assert.equal(snapshot.requirements[0].spec, '# Requirement acceptance\n')
  assert.equal(snapshot.specification, '# Version acceptance\n')
  assert.equal(Buffer.from(snapshot.materials[0].content, 'base64').toString(), html('original bytes'))
  assert.deepEqual(snapshot.acceptance.roles.map((role) => role.id), ['product', 'development', 'qa'])
  assert.equal(verifyDeliverySnapshot(root, snapshot.name).ready, true)
  const file = path.join(root, 'snapshots', `${snapshot.name}.json`)
  const bytes = fs.readFileSync(file, 'utf8')
  assert.deepEqual(createDeliverySnapshot(root, input), snapshot)
  assert.equal(fs.readFileSync(file, 'utf8'), bytes)
})

test('later project rule edits cannot change the frozen acceptance contract', (t) => {
  const { root, input } = fixture(t)
  const snapshot = createDeliverySnapshot(root, input)
  const projectFile = path.join(root, 'projects/release/project.json')
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  project.acceptance = { roles: [{ id: 'owner', name: 'Owner', required: true }], rule: { type: 'all-required' } }
  fs.writeFileSync(projectFile, JSON.stringify(project))
  assert.deepEqual(readDeliverySnapshot(root, snapshot.name).acceptance, snapshot.acceptance)
})

test('binary attachments remain retrievable after working-tree deletion', (t) => {
  const { root, hub, input, commit } = fixture(t)
  const original = Buffer.from([0, 255, 128, 1, 10])
  hub.addAttachment('release', 'v1', { name: 'evidence.bin', content: original, contentType: 'application/octet-stream' })
  input.releaseCommit = commit()
  fs.unlinkSync(path.join(root, 'projects/release/versions/v1.files/evidence.bin'))
  const snapshot = createDeliverySnapshot(root, input)
  const material = snapshot.materials.find((item) => item.path.endsWith('/evidence.bin'))
  assert.deepEqual(Buffer.from(material.content, 'base64'), original)
  assert.equal(verifyDeliverySnapshot(root, snapshot.name).materialCount, 2)
})

test('delivery freezes requirement pool source summaries', (t) => {
  const { root, input, commit } = fixture(t)
  requirements.updateRequirement(root, 'REQ-1', {
    external: {
      provider: 'mcp',
      key: 'POOL-1',
      url: 'https://pool.example/requirements/POOL-1',
      status: 'ready-for-delivery',
      syncedAt: '2026-09-05T08:00:00.000Z'
    }
  }, { trusted: true, now: '2026-09-05T08:01:00.000Z' })
  input.releaseCommit = commit()

  const snapshot = createDeliverySnapshot(root, input)
  assert.deepEqual(snapshot.requirementSources, [{
    code: 'REQ-1',
    title: 'Release requirement',
    source: 'requirement-pool',
    provider: 'mcp',
    key: 'POOL-1',
    url: 'https://pool.example/requirements/POOL-1',
    status: 'ready-for-delivery',
    syncedAt: '2026-09-05T08:00:00.000Z'
  }])
  assert.equal(snapshot.requirements[0].external.key, 'POOL-1')
})

test('delivery rejects tampered payload and legacy snapshot identities', (t) => {
  const { root, input } = fixture(t)
  const snapshot = createDeliverySnapshot(root, input)
  const file = path.join(root, 'snapshots', `${snapshot.name}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...snapshot, specification: '# Changed after release' }))
  assert.throws(() => readDeliverySnapshot(root, snapshot.name), { code: 'DELIVERY_INTEGRITY_FAILED' })
  assert.throws(() => createDeliverySnapshot(root, input), { code: 'DELIVERY_INTEGRITY_FAILED' })
  assert.throws(() => readDeliverySnapshot(root, 'legacy'), { code: 'DELIVERY_NAME_INVALID' })
})

test('delivery rejects missing materials and committed symlink blobs', (t) => {
  const { root, input, commit } = fixture(t)
  const htmlFile = path.join(root, 'projects/release/versions/v1.html')
  fs.unlinkSync(htmlFile)
  fs.symlinkSync('/etc/passwd', htmlFile)
  input.releaseCommit = commit()
  assert.throws(() => createDeliverySnapshot(root, input), { code: 'DELIVERY_MATERIAL_MISSING' })
  assert.deepEqual(fs.readdirSync(path.join(root, 'snapshots')), [])
})

test('delivery refuses scope outside the committed active milestone', (t) => {
  const { root, input, commit } = fixture(t)
  milestones.updateMilestone(root, 'RELEASE', { status: 'planning' }, { system: true })
  input.releaseCommit = commit()
  assert.throws(() => createDeliverySnapshot(root, input), { code: 'DELIVERY_MILESTONE_NOT_ACTIVE' })
  assert.throws(() => createDeliverySnapshot(root, { ...input, project: '../private' }), { code: 'DELIVERY_PROJECT_INVALID' })
})
