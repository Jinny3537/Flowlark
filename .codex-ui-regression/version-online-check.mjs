import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { newHub, html, cleanup } from '../test/helpers.js'
import { startServer } from '../src/server/index.js'
import fs from 'node:fs'

const { root, hub } = newHub()
hub.createProject({ name: '上线联动验证', code: 'online-check' })
hub.createRequirement({ code: 'REQ-1', title: '订单查询' })
hub.addVersion('online-check', { versionNo: 'v1', title: '订单首版', html: html('上线联动验证') })
hub.createMilestone({ name: 'S1', status: 'active', items: [{ requirement: 'REQ-1', project: 'online-check', version: 'v1' }], external: {
  provider: 'assess-task', server: 'platform', projectId: 1, sprintId: 10
} })
let sprintStatus = 'active', versionStatus = 'active', failOnce = true
const calls = [], errors = []
const server = await startServer(root, { port: 0, previewPort: 0,
  wecomMcp: { close: async () => {}, diagnostics: () => ({ available: false }) },
  assessConfig: { server: { id: 'platform' }, project: '1', capability: { options: { releaseClosure: {
    sprintEndedStatuses: ['ended'], versionClosedStatuses: ['closed'], taskCompletedStatuses: ['done']
  } } } },
  assessAdapter: {
    async getSprint() { return { id: 10, projectId: 1, revision: 1, status: sprintStatus } },
    async getVersion() { return { id: 20, projectId: 1, revision: 1, status: versionStatus } },
    async listTasks() { return [{ status: 'done' }] },
    async endSprint() { calls.push('end'); sprintStatus = 'ended' },
    async closeVersion() { if (failOnce) { failOnce = false; throw new Error('平台暂时不可用，请重试') }; calls.push('close'); versionStatus = 'closed' }
  }
})
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.port}/#/projects/online-check/versions/v1`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '配置上线联动', exact: true }).click()
  await page.getByRole('spinbutton', { name: '任务平台版本 ID' }).fill('20')
  await page.getByRole('button', { name: '保存关联', exact: true }).click()
  await page.getByText('任务平台版本已关联', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '标记已上线', exact: true }).click()
  await page.getByRole('button', { name: '重试上线同步', exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '重试上线同步', exact: true }).click()
  await page.getByText('已上线 · 同步完成', { exact: true }).waitFor()
  assert.deepEqual(calls, ['end', 'close'])
  await page.getByRole('button', { name: '已上线 · 同步完成' }).click()
  await page.getByText('结束冲刺 10 · 已完成', { exact: true }).waitFor()
  await page.getByText('关闭版本 20 · 已完成', { exact: true }).waitFor()
  fs.mkdirSync('.codex-ui-regression/screenshots', { recursive: true })
  await page.screenshot({ path: '.codex-ui-regression/screenshots/version-online-desktop.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, calls, errors, verified: ['save binding', 'mark online', 'partial failure', 'reload and retry', 'step results'] }))
} finally {
  await browser.close()
  await server.close()
  cleanup(root)
}
