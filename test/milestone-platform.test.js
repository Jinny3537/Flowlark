import assert from 'node:assert/strict'
import test from 'node:test'
import { newHub, cleanup } from './helpers.js'
import { Hub } from '../src/core/service.js'
import * as milestones from '../src/core/milestones.js'
import { buildMilestoneSyncPlan, hashProjection } from '../src/core/milestone-sync-plan.js'

function fixture(t) {
  const { root } = newHub(); t.after(() => cleanup(root))
  const calls = []
  const adapter = {
    listProjects: async () => [{ id: 1, name: '项目甲' }, { id: 2, name: '项目乙' }],
    listVersions: async () => [{ id: 20, projectId: 2, name: 'V2' }],
    getVersion: async (id) => ({ id, projectId: id === 10 ? 1 : 2, name: 'V2' }),
    listMembers: async () => [{ id: 8, name: '负责人' }],
    listSprints: async () => [], getProjectCapabilities: async () => ({ readOnly: false }),
    getSprint: async (id) => ({ id, projectId: 2, name: '冲刺乙', revision: 3, ownerId: 8 }),
    listTasks: async () => { calls.push('tasks'); return [] }
  }
  const hub = new Hub(root, { assessAdapter: adapter, assessConfig: { server: { id: 'test' }, project: '1', capability: { options: { ownerId: 8, taskType: 2 } } } })
  return { root, hub, calls }
}

test('per-iteration platform selection persists and overrides the workspace project', async (t) => {
  const { root, hub } = fixture(t)
  const draft = await hub.prepareMilestonePlatform({ name: 'P2', platform: { projectId: 2, versionId: 20, ownerId: 8 } })
  hub.createMilestone(draft)
  const item = milestones.readMilestone(root, 'P2')
  assert.equal(item.platform.projectName, '项目乙')
  assert.equal(item.platform.versionName, 'V2')
  const plan = await hub.planMilestoneSync('P2')
  assert.equal(plan.projectId, 2)
  assert.equal(plan.operations[0].after.projectId, 2)
  assert.ok(!plan.blockers.some((p) => p.code === 'TASK_TYPE_REQUIRED'))
})

test('rejects cross-project versions, unknown owners and duplicate sprint bindings', async (t) => {
  const { hub } = fixture(t)
  await assert.rejects(hub.prepareMilestonePlatform({ platform: { projectId: 2, versionId: 10 } }), { code: 'MILESTONE_PLATFORM_MISMATCH' })
  await assert.rejects(hub.prepareMilestonePlatform({ platform: { projectId: 2, ownerId: 99 } }), { code: 'MILESTONE_OWNER_INVALID' })
  hub.createMilestone(await hub.prepareMilestonePlatform({ name: 'A', platform: { projectId: 2, sprintId: 30 } }))
  await assert.rejects(hub.prepareMilestonePlatform({ name: 'B', platform: { projectId: 2, sprintId: 30 } }), { code: 'MILESTONE_SPRINT_BOUND' })
})

test('locked and synced iterations cannot silently change their project or sprint', async (t) => {
  const { root, hub } = fixture(t)
  hub.createMilestone({ name: 'A', external: { projectId: 2, sprintId: 30, syncedAt: '2026-09-08' } })
  await assert.rejects(hub.prepareMilestonePlatform({ platform: { projectId: 1 } }, 'A'), { code: 'MILESTONE_PLATFORM_BOUND' })
  milestones.updateMilestone(root, 'A', { status: 'frozen' }, { system: true })
  assert.throws(() => hub.updateMilestone('A', { platform: { projectId: 1 } }), { code: 'MILESTONE_LOCKED' })
})

test('target release version reaches task creation and changes synchronization hashes', () => {
  const plan = buildMilestoneSyncPlan({ milestone: { name: 'S', title: 'S', items: [{ requirement: 'R' }] },
    requirements: [{ code: 'R', title: '需求' }], mapping: { projectId: 2, ownerId: 8, taskType: 2, versionId: 20 } })
  const task = plan.operations.find((item) => item.kind === 'task.create')
  assert.equal(task.after.targetVersionId, 20)
  assert.notEqual(hashProjection(task.after, 'task'), hashProjection({ ...task.after, targetVersionId: 21 }, 'task'))
})
