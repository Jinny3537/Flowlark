import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, html, cleanup } from '../test/helpers.js'
import { startServer } from '../src/server/index.js'
import * as store from '../src/core/store.js'

const { root, hub } = newHub()
const out = path.resolve('.codex-ui-regression/screenshots')
fs.mkdirSync(out, { recursive: true })
hub.createProject({ name: '订单中心', code: 'orders' })
hub.createRequirement({ code: 'REQ-101', title: '订单查询与权限控制', description: '业务人员只查看授权范围的订单；无数据时展示空状态。' })
hub.addVersion('orders', { versionNo: 'v1.0', title: '订单中心一期', html: html('订单中心'), requirements: ['REQ-101'] })
hub.setBaseline('orders', 'v1.0')
fs.writeFileSync(store.paths.versionSpec(root, 'orders', 'v1.0'), '# 接口说明\nGET /orders')
store.writeAttachment(root, 'orders', 'v1.0', '接口设计.txt', Buffer.from('字段及返回值'))
const items = [{ requirement: 'REQ-101', project: 'orders', version: 'v1.0' }]
hub.createMilestone({ name: 'S12', title: '订单中心第一期', items })
hub.createSnapshot({ name: 'orders-s12-01', title: '订单中心 · 研发交接', milestone: 'S12', audience: '订单研发组、测试组', summary: '交付订单列表及数据权限。', acceptance: '仅返回授权订单，无权限请求明确提示。', risks: '待确认分页最大条数。' })
const server = await startServer(root, { port: 0, previewPort: 0 })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => failures.push(error.message))
  const base = `http://127.0.0.1:${server.port}`
  await page.goto(`${base}/#/deliveries`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: '订单中心 · 研发交接', exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'delivery-center-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: /准备交付包/ }).click()
  await page.getByLabel('交付标题', { exact: true }).fill('订单中心 · 验收材料')
  await page.getByLabel('交付标识', { exact: true }).fill('orders-s12-02')
  await page.getByLabel('来源迭代', { exact: true }).click()
  await page.getByTitle('订单中心第一期 · S12', { exact: true }).click()
  await page.getByRole('button', { name: '检查交付材料', exact: true }).click()
  await page.getByText('范围可冻结，请核对材料内容', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'delivery-material-check.png'), fullPage: true })
  await page.getByRole('button', { name: '填写交接说明', exact: true }).click()
  await page.getByLabel('交付给谁', { exact: true }).fill('研发与测试')
  await page.getByLabel('验收口径', { exact: true }).fill('订单权限校验通过')
  await page.getByRole('button', { name: '冻结并创建交付包', exact: true }).click()
  await page.getByRole('heading', { name: '订单中心 · 验收材料', exact: true }).waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载完整交付包/ }).click()
  const download = await downloadEvent
  if (download.suggestedFilename() !== 'orders-s12-02.zip') throw new Error('Wrong download name')
  await page.getByRole('tab', { name: /原型版本/ }).click()
  await page.getByText('orders / v1.0', { exact: true }).waitFor()
  await page.getByRole('tab', { name: /交付文件/ }).click()
  await page.getByText('接口设计.txt', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'delivery-files-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/#/deliveries`, { waitUntil: 'networkidle' })
  await page.getByRole('link', { name: '订单中心 · 验收材料', exact: true }).waitFor()
  await page.screenshot({ path: path.join(out, 'delivery-center-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (overflow) throw new Error('Mobile horizontal overflow')
  if (failures.length) throw new Error(failures.join('\n'))
  console.log(JSON.stringify({ passed: true, flow: 'create, inspect, freeze, read frozen files, download ZIP, responsive', screenshots: out }))
} finally { await browser.close(); await server.close(); cleanup(root) }
