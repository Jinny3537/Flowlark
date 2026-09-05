// This smoke seeds a committed delivery snapshot; release-run integration is tested separately.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { initRepo } from '../src/core/repo.js'
import { Hub } from '../src/core/service.js'
import * as milestones from '../src/core/milestones.js'
import * as requirements from '../src/core/requirements.js'
import { createDeliverySnapshot } from '../src/core/delivery-snapshots.js'
import { hashProjection } from '../src/core/milestone-sync-plan.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v074-smoke-'))
initRepo(root)
const hub = new Hub(root)
const managedFields = ['title', 'description', 'acceptance', 'assignee', 'sprint', 'status']
let remoteSprint = {
  id: 10,
  projectId: 123,
  sprintName: 'Acceptance milestone',
  sprintGoal: 'Browser delivery completion',
  ownerId: 7,
  planStartDate: '2026-09-01T00:00:00+08:00',
  planEndDate: '2026-09-10T00:00:00+08:00',
  revision: 5,
  status: 'active'
}
let remoteTask = {
  id: 20,
  projectId: 123,
  taskType: 2,
  title: '[REQ-1] Browser requirement',
  descriptionDoc: 'Browser acceptance smoke\n\n关联原型：\n- accept/v1',
  acceptanceDoc: '# Acceptance criteria\n',
  priority: null,
  assigneeId: 8,
  status: 'testing',
  planStartDate: '2026-09-01T00:00:00+08:00',
  planEndDate: '2026-09-10T00:00:00+08:00',
  sprintId: 10,
  revision: 3
}
const remoteCalls = []
const assessAdapter = {
  async listTasks() {
    remoteCalls.push('listTasks')
    return [remoteTask]
  },
  async getSprint() {
    remoteCalls.push('getSprint')
    return remoteSprint
  },
  async getTask() {
    remoteCalls.push('getTask')
    return remoteTask
  },
  async saveSprint(body) {
    remoteCalls.push('saveSprint')
    remoteSprint = { ...remoteSprint, ...body, revision: Number(body.revision || remoteSprint.revision) + 1 }
    return remoteSprint
  },
  async updateTask(body) {
    remoteCalls.push('updateTask')
    remoteTask = { ...remoteTask, ...body, revision: Number(body.revision || remoteTask.revision) + 1 }
    return remoteTask
  },
  async endSprint(body) {
    remoteCalls.push('endSprint')
    remoteSprint = { ...remoteSprint, status: 'ended', revision: Number(body.revision || remoteSprint.revision) + 1 }
    return remoteSprint
  }
}
const currentRemoteHashes = () => ({
  sprint: hashProjection(remoteSprint, 'sprint', managedFields),
  task: hashProjection(remoteTask, 'task', managedFields)
})
hub.createProject({ name: 'Acceptance smoke', code: 'accept' })
hub.updateProject('accept', { sync: { mode: 'manual', server: 'assess', projectId: '123', managedFields } })
hub.saveMcpServer({ id: 'assess', name: 'Assess Task', type: 'stdio', adapter: 'assess-task', runtimeProfile: 'smoke-runtime' })
hub.saveMcpCapability('milestones', {
  enabled: true,
  server: 'assess',
  project: '123',
  options: {
    ownerId: 7,
    taskType: 2,
    members: { PM: 8 },
    statuses: { completed: 'closed' },
    timezoneOffset: '+08:00'
  }
})
hub.createRequirement({ code: 'REQ-1', title: 'Browser requirement', description: 'Browser acceptance smoke', owner: 'PM' })
hub.writeRequirementSpec('REQ-1', '# Acceptance criteria')
hub.transitionRequirement('REQ-1', { target: 'confirmed' })
hub.transitionRequirementSystem('REQ-1', 'developing', { reason: 'Sprint started in smoke' })
hub.addVersion('accept', { versionNo: 'v1', title: 'Version', html: '<!doctype html><html><body>Frozen material</body></html>', requirements: ['REQ-1'] })
hub.setSpec('accept', 'v1', '# Frozen specification')
hub.setBaseline('accept', 'v1')
hub.createMilestone({
  name: 'ACCEPT',
  title: 'Acceptance milestone',
  goal: 'Browser delivery completion',
  owner: 'PM',
  startAt: '2026-09-01',
  endAt: '2026-09-10',
  items: [{ requirement: 'REQ-1', project: 'accept', version: 'v1' }]
})
milestones.updateMilestone(root, 'ACCEPT', { status: 'active' }, { system: true })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git('init'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.invalid')
git('add', '.'); git('commit', '-m', 'Release evidence')
const snapshot = createDeliverySnapshot(root, { milestone: 'ACCEPT', project: 'accept', version: 'v1', releaseCommit: git('rev-parse', 'HEAD') })
milestones.recordMilestoneDelivery(root, 'ACCEPT', {
  project: 'accept',
  version: 'v1',
  snapshot: snapshot.name,
  releaseRunId: 'smoke-release-run'
})
hub.transitionRequirementSystem('REQ-1', 'pending-acceptance', { reason: 'Delivery snapshot seeded in smoke' })
const hashes = currentRemoteHashes()
milestones.updateMilestone(root, 'ACCEPT', {
  external: {
    provider: 'assess-task',
    server: 'assess',
    projectId: 123,
    sprintId: 10,
    revision: remoteSprint.revision,
    remoteStatus: remoteSprint.status,
    lastSyncHash: hashes.sprint
  }
}, { system: true })
requirements.upsertExternalTask(root, 'REQ-1', {
  provider: 'assess-task',
  server: 'assess',
  projectId: 123,
  taskId: 20,
  revision: remoteTask.revision,
  remoteStatus: remoteTask.status,
  lastSyncHash: hashes.task
})
let server, mirror, browser
const errors = []
try {
  const options = { port: 0, previewPort: 0, assessAdapter, wecomMcp: unavailableWecomMcp('smoke') }
  server = await startServer(root, options)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  const route = `/#/deliveries/${snapshot.name}`
  const base = `http://127.0.0.1:${server.port}`
  await page.goto(base + route)
  await page.waitForLoadState('networkidle')
  for (const role of ['产品', '研发', '测试']) {
    await page.getByLabel('验收角色', { exact: true }).click()
    await page.locator('.ant-select-dropdown:visible').getByText(`${role}（必选）`, { exact: true }).click()
    const response = page.waitForResponse((response) => response.url().endsWith('/acceptances') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '提交验收记录', exact: true }).click()
    assert.equal((await response).status(), 201)
    await page.waitForLoadState('networkidle')
  }
  assert.equal(hub.deliveryAcceptance(snapshot.name).ready, true)
  await page.getByRole('button', { name: /记录反馈$/ }).click()
  await page.getByLabel('反馈标题', { exact: true }).fill('Blocking smoke issue')
  await page.getByLabel('反馈说明', { exact: true }).fill('Verify blocking feedback gate')
  await page.getByLabel('严重度', { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('阻断', { exact: true }).click()
  await page.getByRole('button', { name: '保存反馈', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(hub.deliveryAcceptance(snapshot.name).ready, false)
  await page.getByRole('button', { name: '解决反馈', exact: true }).click()
  await page.getByLabel('解决原因', { exact: true }).fill('Verified fixed in smoke')
  await page.getByRole('button', { name: '确认解决', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(hub.deliveryAcceptance(snapshot.name).ready, true)
  assert.equal(hub.getRequirement('REQ-1').status, 'completed')
  await page.goto(base + '/#/requirements/REQ-1')
  await page.waitForLoadState('networkidle')
  await page.getByText('交付与验收', { exact: true }).waitFor()
  await page.getByText('验收通过', { exact: true }).waitFor()
  await page.goto(base + '/#/milestones/ACCEPT')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '结束交付', exact: true }).waitFor()
  const planResponse = page.waitForResponse((response) => response.url().endsWith('/delivery-completion/plan') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '结束交付', exact: true }).click()
  assert.equal((await planResponse).status(), 200)
  const modal = page.locator('.ant-modal:visible')
  await modal.getByText('交付验收门禁已通过', { exact: true }).waitFor()
  await modal.getByText('1 个正式交付快照已纳入本次外部完成计划。', { exact: true }).waitFor()
  await page.locator('#milestone-sync-reason').fill('Smoke closes accepted delivery')
  await modal.getByText('我已确认平台上的未完成任务处理方式', { exact: true }).click()
  const executeResponse = page.waitForResponse((response) => response.url().endsWith('/delivery-completion/execute') && response.request().method() === 'POST')
  await modal.getByRole('button', { name: '结束交付', exact: true }).click()
  assert.equal((await executeResponse).status(), 200)
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.ok(remoteCalls.includes('updateTask'))
  assert.ok(remoteCalls.includes('endSprint'))
  assert.equal(hub.getMilestone('ACCEPT').external.remoteStatus, 'ended')
  const completedBinding = hub.getRequirement('REQ-1').externalTasks.find((item) => item.taskId === 20)
  assert.equal(completedBinding.remoteStatus, 'closed')
  await page.goto(base + '/#/milestones/ACCEPT')
  await page.waitForLoadState('networkidle')
  try {
    await page.getByRole('button', { name: /归\s*档/ }).waitFor({ timeout: 5000 })
  } catch (error) {
    const [buttons, apiMilestone] = await Promise.all([
      page.getByRole('button').allTextContents(),
      page.evaluate(() => fetch('/api/milestones/ACCEPT').then((response) => response.json()))
    ])
    assert.fail(`archive action missing; buttons=${JSON.stringify(buttons)} milestone=${JSON.stringify(apiMilestone)}`)
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto(base + route)
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `delivery overflow ${width}`)
    await page.goto(base + '/#/projects/accept/sync')
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `project rules overflow ${width}`)
    await page.goto(base + '/#/requirements/REQ-1')
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `requirement overflow ${width}`)
    await page.goto(base + '/#/milestones/ACCEPT')
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `milestone overflow ${width}`)
  }
  mirror = await startServer(root, { ...options, mirror: true })
  await page.goto(`http://127.0.0.1:${mirror.port}${route}`)
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('button', { name: '提交验收记录', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /记录反馈$/ }).isDisabled(), true)
  await page.goto(`http://127.0.0.1:${mirror.port}/#/milestones/ACCEPT`)
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('button', { name: /归\s*档/ }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({
    passed: true,
    checks: ['three-role-decisions', 'blocking-feedback', 'resolution', 'requirement-delivery-summary', 'delivery-completion', 'readonly', 'desktop-mobile-layout'],
    viewportWidths: [1440, 390]
  }))
} finally {
  await browser?.close()
  await mirror?.close()
  await server?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
