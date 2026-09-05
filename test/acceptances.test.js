import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { newHub, cleanup, html } from './helpers.js'
import * as milestones from '../src/core/milestones.js'
import { createDeliverySnapshot } from '../src/core/delivery-snapshots.js'
import { appendAcceptance, listAcceptances } from '../src/core/acceptances.js'
import { aggregateAcceptance } from '../src/core/acceptance-rules.js'
import { Hub } from '../src/core/service.js'
import { createDeliveryFeedback, listDeliveryFeedback, resolveDeliveryFeedback } from '../src/core/delivery-feedback.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

function fixture(t) {
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  hub.createProject({ name: 'Accept', code: 'accept' })
  hub.createRequirement({ code: 'REQ-1', title: 'Acceptance', owner: 'pm' })
  hub.writeRequirementSpec('REQ-1', '# Requirement criteria')
  hub.addVersion('accept', { versionNo: 'v1', title: 'Version', html: html(), requirements: ['REQ-1'] })
  hub.setSpec('accept', 'v1', '# Version criteria')
  hub.setBaseline('accept', 'v1')
  hub.createMilestone({ name: 'ACCEPT', items: [{ requirement: 'REQ-1', project: 'accept', version: 'v1' }] })
  milestones.updateMilestone(root, 'ACCEPT', { status: 'active' }, { system: true })
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  git('add', '.'); git('commit', '-m', 'Release')
  const snapshot = createDeliverySnapshot(root, { milestone: 'ACCEPT', project: 'accept', version: 'v1', releaseCommit: git('rev-parse', 'HEAD') })
  return { root, snapshot }
}

test('decisions append new immutable files and aggregate against frozen rules', (t) => {
  const { root, snapshot } = fixture(t)
  const initial = appendAcceptance(root, snapshot.name, { role: 'product', verdict: 'rejected', note: 'Fix first' })
  const firstFile = path.join(root, 'acceptances', snapshot.name, `${initial.id}.json`)
  const firstBytes = fs.readFileSync(firstFile, 'utf8')
  for (const role of ['product', 'development', 'qa']) {
    appendAcceptance(root, snapshot.name, { role, verdict: 'approved', expectedSnapshotHash: snapshot.contentHash })
  }
  const records = listAcceptances(root, snapshot.name)
  assert.equal(records.length, 4)
  assert.equal(fs.readFileSync(firstFile, 'utf8'), firstBytes)
  assert.equal(aggregateAcceptance(snapshot.acceptance, records).ready, true)
  assert.ok(records.every((record) => record.actor && record.snapshotHash === snapshot.contentHash))
})

test('caller cannot forge evidence, identities or unknown roles', (t) => {
  const { root, snapshot } = fixture(t)
  assert.throws(() => appendAcceptance(root, snapshot.name, { role: 'product', verdict: 'approved', actor: 'Forged' }), { code: 'ACCEPTANCE_INPUT_INVALID' })
  assert.throws(() => appendAcceptance(root, snapshot.name, { role: 'admin', verdict: 'approved' }), { code: 'ACCEPTANCE_ROLE_UNKNOWN' })
  assert.throws(() => appendAcceptance(root, snapshot.name, { role: 'product', verdict: 'approved', expectedSnapshotHash: 'changed' }), { code: 'ACCEPTANCE_EVIDENCE_MISMATCH' })
  assert.deepEqual(listAcceptances(root, snapshot.name), [])
})

test('conditional revisions preserve the earlier open conditions', (t) => {
  const { root, snapshot } = fixture(t)
  const input = { role: 'product', verdict: 'conditional', conditions: [{ id: 'fix-1', text: 'Fix issue', closed: false }] }
  appendAcceptance(root, snapshot.name, input)
  appendAcceptance(root, snapshot.name, { ...input, conditions: [{ ...input.conditions[0], closed: true }] })
  const records = listAcceptances(root, snapshot.name)
  assert.equal(records[0].conditions[0].closed, false)
  assert.equal(aggregateAcceptance(snapshot.acceptance, records).roles[0].status, 'approved')
})

test('acceptance storage rejects symlinked directories and foreign evidence', (t) => {
  const { root, snapshot } = fixture(t)
  const outside = `${root}-external`
  fs.mkdirSync(outside)
  t.after(() => cleanup(outside))
  const base = path.join(root, 'acceptances')
  if (fs.existsSync(base)) fs.rmdirSync(base)
  fs.symlinkSync(outside, base)
  assert.throws(() => appendAcceptance(root, snapshot.name, { role: 'product', verdict: 'approved' }), { code: 'ACCEPTANCE_PATH_INVALID' })
  assert.deepEqual(fs.readdirSync(outside), [])
  fs.unlinkSync(base)
  const record = appendAcceptance(root, snapshot.name, { role: 'product', verdict: 'approved' })
  const file = path.join(base, snapshot.name, `${record.id}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...record, snapshotHash: 'another snapshot' }))
  assert.throws(() => listAcceptances(root, snapshot.name), { code: 'ACCEPTANCE_EVIDENCE_MISMATCH' })
})

test('unresolved blockers prevent acceptance and resolving appends evidence without changing the snapshot', (t) => {
  const { root, snapshot } = fixture(t)
  const hub = new Hub(root)
  for (const role of ['product', 'development', 'qa']) hub.recordAcceptance(snapshot.name, { role, verdict: 'approved' })
  const blocker = createDeliveryFeedback(root, snapshot.name, { title: 'Broken path', description: 'Must fix', severity: 'blocker', requirement: 'REQ-1' })
  createDeliveryFeedback(root, snapshot.name, { title: 'Polish', description: 'Non-blocking', severity: 'important' })
  assert.equal(hub.deliveryAcceptance(snapshot.name).ready, false)
  const creationFile = path.join(root, 'acceptances', snapshot.name, 'feedback', `${blocker.id}.json`)
  const original = fs.readFileSync(creationFile, 'utf8')
  const resolved = resolveDeliveryFeedback(root, snapshot.name, blocker.id, { reason: 'Verified fix' })
  assert.equal(resolved.status, 'resolved')
  assert.equal(fs.readFileSync(creationFile, 'utf8'), original)
  assert.deepEqual(resolveDeliveryFeedback(root, snapshot.name, blocker.id, { reason: 'Retry' }), resolved)
  assert.equal(hub.deliveryAcceptance(snapshot.name).ready, true)
  assert.equal(hub.deliveryAcceptance(snapshot.name).snapshotHash, snapshot.contentHash)
  assert.equal(listDeliveryFeedback(root, snapshot.name).length, 2)
})

test('acceptance HTTP routes reject forged inputs and mirror writes, while history remains readable', async (t) => {
  const { root, snapshot } = fixture(t)
  const options = { port: 0, previewPort: 0, wecomMcp: unavailableWecomMcp('test') }
  const server = await startServer(root, options)
  const mirror = await startServer(root, { ...options, mirror: true })
  t.after(async () => { await server.close(); await mirror.close() })
  const call = (port, suffix, method = 'GET', body) => fetch(`http://127.0.0.1:${port}/api/snapshots/${snapshot.name}/${suffix}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  })
  const decision = { role: 'product', verdict: 'approved' }
  assert.equal((await call(server.port, 'acceptances', 'POST', { ...decision, actor: 'spoof' })).status, 400)
  assert.equal((await call(mirror.port, 'acceptances', 'POST', decision)).status, 403)
  assert.equal((await call(server.port, 'acceptances', 'POST', decision)).status, 201)
  assert.equal((await call(server.port, 'acceptances', 'DELETE')).status, 404)
  assert.equal((await (await call(mirror.port, 'acceptance')).json()).records.length, 1)
  const feedback = { title: 'A', description: 'B', severity: 'blocker' }
  assert.equal((await call(mirror.port, 'feedback', 'POST', feedback)).status, 403)
  const created = await (await call(server.port, 'feedback', 'POST', feedback)).json()
  assert.equal((await call(server.port, `feedback/${created.id}/resolve`, 'POST', { reason: 'Fixed' })).status, 200)
})
