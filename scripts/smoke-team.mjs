import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { initRepo } from '../src/core/repo.js'
import { Hub } from '../src/core/service.js'
import { startServer } from '../src/server/index.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-team-smoke-'))
const output = process.env.TEAM_SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-team-evidence-'))
fs.mkdirSync(output, { recursive: true })
let server, browser
const errors = []
try {
  initRepo(root)
  const hub = new Hub(root)
  hub.createProject({ name: '团队演示', code: 'demo' })
  hub.addVersion('demo', { versionNo: 'v1', title: '团队原型', html: '<!doctype html><html><body><h1>团队原型</h1></body></html>' })
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Team Smoke', '-c', 'user.email=team@example.invalid', 'commit', '-m', 'fixture']]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  server = await startServer(root, { port: 0, previewPort: 0 })
  const base = `http://127.0.0.1:${server.port}`
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const host = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const hp = await host.newPage()
  hp.on('pageerror', (e) => errors.push(e.message))
  await hp.goto(`${base}/#/settings/lan`)
  await hp.waitForURL('**/#/settings/team')
  assert.equal(await hp.locator('.fl-app-menu').getByRole('menuitem', { name: '团队协作' }).count(), 0)
  assert.equal(await hp.getByRole('menuitem', { name: '局域网分享', exact: true }).count(), 0)
  await hp.getByRole('switch', { name: '开放局域网访问' }).click()
  await hp.getByText('配置已保存，重启后开放局域网访问', { exact: true }).waitFor()
  await hp.getByRole('radio', { name: '角色协作 · 按角色评论、反馈进度和提交测试结果' }).click()
  await hp.getByText('访问者角色', { exact: true }).waitFor()

  // A forwarded request is deliberately treated as a remote visitor, never host.
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.20' } })
  const gp = await guest.newPage()
  gp.on('pageerror', (e) => errors.push(e.message))
  await gp.goto(`${base}/#/projects/demo/versions/v1`)
  await gp.getByRole('radio', { name: '游客 · 浏览、评论、下载' }).check()
  await gp.screenshot({ path: path.join(output, 'choose-role.png'), fullPage: true })
  await gp.getByRole('button', { name: '确认角色并进入' }).click()
  await gp.getByRole('tab', { name: '团队协作', exact: true }).click()
  await gp.getByLabel('内容', { exact: true }).fill('游客确认原型可浏览，补充评论。')
  await gp.getByRole('button', { name: '提交评论', exact: true }).click()
  await gp.getByText('记录已保存到主机', { exact: true }).waitFor()
  await gp.reload()
  await gp.getByRole('tab', { name: '团队协作', exact: true }).click()
  await gp.getByText('游客确认原型可浏览，补充评论。', { exact: true }).waitFor()
  assert.equal(await gp.getByRole('radio').count(), 0)
  const forbidden = await guest.request.post(`${base}/api/projects`, { data: { name: '不得创建' } })
  assert.equal(forbidden.status(), 403)
  const download = await guest.request.get(`${base}/api/versions/demo/v1/download`)
  assert.equal(download.status(), 200)

  await hp.getByRole('button', { name: '刷新访客', exact: true }).click()
  await hp.getByRole('combobox').click()
  await hp.getByText('测试', { exact: true }).last().click()
  await gp.reload()
  await gp.getByRole('tab', { name: '团队协作', exact: true }).click()
  await gp.getByLabel('记录类型', { exact: true }).click()
  await gp.getByText('验收结果', { exact: true }).last().click()
  await gp.getByLabel('内容', { exact: true }).fill('已核对该版本页面，记录测试结论。')
  await gp.getByRole('button', { name: '提交验收结果', exact: true }).click()
  await gp.getByText('记录已保存到主机', { exact: true }).waitFor()
  await gp.screenshot({ path: path.join(output, 'tester-records.png'), fullPage: true })
  await hp.screenshot({ path: path.join(output, 'host-roles.png'), fullPage: true })
  await hp.getByRole('radio', { name: '只读分享 · 浏览、下载' }).click()
  await hp.getByText('访问者角色', { exact: true }).waitFor({ state: 'hidden' })
  await gp.reload()
  await gp.getByRole('tab', { name: '团队协作', exact: true }).click()
  await gp.getByText('游客确认原型可浏览，补充评论。', { exact: true }).waitFor()
  assert.equal(await gp.getByLabel('内容', { exact: true }).count(), 0)
  assert.equal(await gp.getByRole('radio').count(), 0)
  assert.equal((await guest.request.post(`${base}/api/team/records/demo/v1`, { data: { kind: 'comment', content: '禁止' } })).status(), 403)
  await hp.getByRole('radio', { name: '角色协作 · 按角色评论、反馈进度和提交测试结果' }).click()
  await hp.getByText('访问者角色', { exact: true }).waitFor()
  await gp.reload()
  await gp.getByRole('tab', { name: '团队协作', exact: true }).click()
  await gp.getByLabel('记录类型', { exact: true }).click()
  await gp.getByText('验收结果', { exact: true }).last().waitFor()
  await gp.goto(`${base}/#/settings/team`)
  await gp.waitForURL('**/#/projects')
  await hp.setViewportSize({ width: 390, height: 844 })
  await hp.getByRole('switch', { name: '开放局域网访问' }).waitFor()
  assert.equal(await hp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await hp.screenshot({ path: path.join(output, 'team-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const report = { passed: true, checks: ['legacy-redirect', 'network-restart-notice', 'host-enable', 'guest-select', 'guest-comment', 'download', 'role-restore', 'api-denial', 'host-reassign', 'tester-result', 'readonly-revocation', 'role-preservation', 'mobile-overflow', 'page-errors'], output }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  if (browser) {
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0]
      if (page) {
        fs.writeFileSync(path.join(output, `failure-${index}.txt`), await page.locator('body').innerText())
        await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true })
      }
    }
  }
  console.error('Browser evidence:', output, errors)
  throw error
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  fs.rmSync(root, { recursive: true, force: true })
}
