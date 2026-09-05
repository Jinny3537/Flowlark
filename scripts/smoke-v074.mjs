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
import { createDeliverySnapshot } from '../src/core/delivery-snapshots.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v074-smoke-'))
initRepo(root)
const hub = new Hub(root)
hub.createProject({ name: 'Acceptance smoke', code: 'accept' })
hub.createRequirement({ code: 'REQ-1', title: 'Browser requirement', owner: 'pm' })
hub.writeRequirementSpec('REQ-1', '# Acceptance criteria')
hub.addVersion('accept', { versionNo: 'v1', title: 'Version', html: '<!doctype html><html><body>Frozen material</body></html>', requirements: ['REQ-1'] })
hub.setSpec('accept', 'v1', '# Frozen specification')
hub.setBaseline('accept', 'v1')
hub.createMilestone({ name: 'ACCEPT', items: [{ requirement: 'REQ-1', project: 'accept', version: 'v1' }] })
milestones.updateMilestone(root, 'ACCEPT', { status: 'active' }, { system: true })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git('init'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.invalid')
git('add', '.'); git('commit', '-m', 'Release evidence')
const snapshot = createDeliverySnapshot(root, { milestone: 'ACCEPT', project: 'accept', version: 'v1', releaseCommit: git('rev-parse', 'HEAD') })
let server, mirror, browser
const errors = []
try {
  const options = { port: 0, previewPort: 0, wecomMcp: unavailableWecomMcp('smoke') }
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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto(base + route)
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `delivery overflow ${width}`)
    await page.goto(base + '/#/projects/accept/sync')
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `project rules overflow ${width}`)
  }
  mirror = await startServer(root, { ...options, mirror: true })
  await page.goto(`http://127.0.0.1:${mirror.port}${route}`)
  await page.waitForLoadState('networkidle')
  assert.equal(await page.getByRole('button', { name: '提交验收记录', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /记录反馈$/ }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['three-role-decisions', 'blocking-feedback', 'resolution', 'readonly', 'desktop-mobile-layout'], viewportWidths: [1440, 390] }))
} finally {
  await browser?.close()
  await mirror?.close()
  await server?.close()
  fs.rmSync(root, { recursive: true, force: true })
}
