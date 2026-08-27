import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, test } from 'node:test'
import { cleanup, html, newHub } from './helpers.js'
import { freezePreflight, transitionMilestoneStatus } from '../src/core/milestone-lifecycle.js'
import * as milestones from '../src/core/milestones.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.createRequirement({ code: 'REQ-1', title: '需求一' })
  hub.addVersion('orders', { versionNo: 'v1', title: '一版', html: html(), requirements: ['REQ-1'] })
  return { root, hub }
}

test('old milestone files receive lifecycle defaults on read', () => {
  const { root, hub } = fixture()
  hub.createMilestone({ name: 'S1', title: '迭代一', items: [] })
  const file = store.paths.milestoneFile(root, 'S1')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete raw.goal
  delete raw.owner
  delete raw.status
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
  const item = milestones.readMilestone(root, 'S1')
  assert.equal(item.goal, '')
  assert.equal(item.owner, '')
  assert.equal(item.status, 'planning')
})

test('enforces the lifecycle graph and terminal states', () => {
  assert.deepEqual(transitionMilestoneStatus('planning', 'reviewing'), {
    from: 'planning', to: 'reviewing', changed: true, highRisk: false, requiresRemote: false
  })
  assert.equal(transitionMilestoneStatus('frozen', 'active', { remoteExists: true }).requiresRemote, true)
  assert.equal(transitionMilestoneStatus('active', 'canceled', { remoteExists: true }).highRisk, true)
  assert.throws(
    () => transitionMilestoneStatus('planning', 'active'),
    (error) => error.code === 'MILESTONE_TRANSITION_INVALID'
  )
  assert.throws(
    () => transitionMilestoneStatus('archived', 'planning'),
    (error) => error.code === 'MILESTONE_TERMINAL'
  )
})

test('locks business edits after freeze but permits system metadata updates', () => {
  const { root, hub } = fixture()
  hub.createMilestone({ name: 'S1', title: '迭代一', items: [] })
  milestones.updateMilestone(root, 'S1', { status: 'frozen' }, { system: true })
  assert.throws(
    () => milestones.updateMilestone(root, 'S1', { title: '被禁止' }),
    (error) => error.code === 'MILESTONE_LOCKED'
  )
  const updated = milestones.updateMilestone(root, 'S1', {
    external: { provider: 'assess-task', sprintId: 9, revision: 1 }
  }, { system: true })
  assert.equal(updated.external.sprintId, 9)
})

test('freeze preflight reports review and specification blockers with repair targets', () => {
  const { root, hub } = fixture()
  hub.setBaseline('orders', 'v1')
  hub.setReviewStatus('orders', 'v1', 'pending')
  const item = hub.createMilestone({
    name: 'S1', title: '迭代一', items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1' }]
  })
  const result = freezePreflight(root, item)
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((entry) => entry.code === 'REVIEW_NOT_CONFIRMED'))
  assert.ok(result.blockers.some((entry) => entry.code === 'SPEC_MISSING'))
  assert.ok(result.blockers.every((entry) => entry.repairTo))
})
