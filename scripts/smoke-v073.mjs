// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { initRepo } from '../src/core/repo.js'
import { Hub } from '../src/core/service.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v073-smoke-'))
initRepo(root)
const hub = new Hub(root)
const tasks = new Map([[99, { id: 99, projectId: 123, revision: 1, status: 0 }]])
const sprints = new Map()
const adapter = {
  async getTask(id) { return tasks.get(Number(id)) || null },
  async getSprint(id) { return sprints.get(Number(id)) || null },
  async listTasks() { return [...tasks.values()] },
  async saveSprint(body) {
    const item = { ...body, id: body.id || 10, status: 0, revision: (body.revision || 0) + 1 }
    sprints.set(item.id, item)
    return item
  },
  async createTask(body) {
    const item = { ...body, id: 20, sprintId: body.currentSprintId, status: 0, revision: 1 }
    tasks.set(item.id, item)
    return item
  },
  async updateTask(body) { const item = { ...tasks.get(body.id), ...body, revision: body.revision + 1 }; tasks.set(item.id, item); return item },
  async moveTasks(body) { for (const item of body.tasks) tasks.get(item.taskId).sprintId = body.toSprintId; return { ok: true } },
  async startSprint(body) { const item = sprints.get(body.sprintId); item.status = 'active'; item.revision++; return item }
}
hub.createProject({ name: 'Smoke Project', code: 'smoke' })
hub.updateProject('smoke', { sync: { mode: 'manual', server: 'test-task', projectId: '123', managedFields: ['title', 'description', 'acceptance', 'sprint'] } })
hub.saveMcpServer({ id: 'test-task', name: 'Smoke MCP', type: 'stdio', adapter: 'assess-task', runtimeProfile: 'smoke-runtime' })
hub.saveMcpCapability('milestones', { enabled: true, options: { ownerId: 7, taskType: 2 } })
hub.createRequirement({ code: 'REQ-SMOKE', title: 'Smoke requirement', description: 'Smoke description', owner: 'pm' })
hub.createRequirement({ code: 'REQ-BIND', title: 'Binding smoke', description: 'Binding', owner: 'pm' })
hub.addVersion('smoke', { versionNo: 'v1', title: 'Smoke version', html: '<!doctype html><html><body>Smoke</body></html>', requirements: ['REQ-SMOKE'] })
hub.setSpec('smoke', 'v1', '# Version acceptance')
hub.setBaseline('smoke', 'v1')
hub.createMilestone({ name: 'SMOKE', title: 'Smoke milestone', goal: 'Smoke goal', owner: 'pm', startAt: '2026-09-01', endAt: '2026-09-10', items: [{ requirement: 'REQ-SMOKE', project: 'smoke', version: 'v1' }] })
const options = { port: 0, previewPort: 0, assessAdapter: adapter, wecomMcp: unavailableWecomMcp('smoke') }
let server, readonly, browser
const errors = []
try {
  server = await startServer(root, options)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  const base = `http://127.0.0.1:${server.port}/#`
  await page.goto(`${base}/requirements/REQ-SMOKE`)
  await page.waitForLoadState('networkidle')
  await page.locator('#requirement-spec-editor').fill('# Acceptance\n\n- Pass smoke')
  await page.getByRole('button', { name: /保存规格书$/ }).click()
  await page.getByRole('button', { name: /确认需求$/ }).click()
  await page.getByRole('button', { name: /加入迭代$/ }).waitFor()
  assert.equal(hub.getRequirement('REQ-SMOKE').status, 'confirmed')
  const runner = new Hub(root, { assessAdapter: adapter })
  const initial = await runner.planMilestoneSync('SMOKE')
  await runner.executeSyncRecord(initial.syncId, { planHash: initial.hash })
  hub.transitionMilestone('SMOKE', { target: 'reviewing' })
  await page.goto(`${base}/milestones/SMOKE`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '预览并冻结', exact: true }).click()
  await page.locator('#milestone-sync-reason').fill('Verified browser smoke')
  await page.getByRole('button', { name: '确认同步并冻结', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(hub.getMilestone('SMOKE').status, 'frozen')
  const binding = await runner.planRequirementTaskBinding('REQ-BIND', { project: 'smoke', remoteId: 99, reason: 'Browser binding smoke' })
  await page.goto(`${base}/sync`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('row').filter({ hasText: 'REQ-BIND' }).getByRole('button', { name: /执行$/ }).click()
  await page.locator('#sync-action-reason').fill('Confirm verified binding')
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(runner.getSyncRecord(binding.syncId).status, 'completed')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    for (const route of ['/requirements', '/requirements/REQ-SMOKE', '/projects/smoke/sync', '/milestones/SMOKE', '/sync']) {
      await page.goto(base + route)
      await page.waitForLoadState('networkidle')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow: ${width} ${route}`)
    }
  }
  readonly = await startServer(root, { ...options, mirror: true })
  await page.goto(`http://127.0.0.1:${readonly.port}/#/requirements/REQ-SMOKE`)
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('button', { name: /编\s*辑$/ }).isDisabled(), true)
  assert.equal(await page.locator('#requirement-spec-editor').isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, viewportWidths: [1440, 390], checks: ['spec-save', 'confirm', 'freeze', 'binding-execute', 'readonly', 'overflow', 'page-errors'] }))
} finally {
  await browser?.close()
  await readonly?.close()
  await server?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
