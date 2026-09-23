import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readHtml } from '../src/core/store.js'
import { newHub, html, cleanup } from '../test/helpers.js'
import { startServer } from '../src/server/index.js'

const { root, hub } = newHub()
hub.createProject({ name: '交互回归', code: 'interaction' })
hub.addVersion('interaction', { versionNo: 'v1', title: '交互验证', html: html('<h1>原始标题</h1><p>可编辑文字</p><a href="https://example.invalid">编辑链接文字</a><button onclick="document.body.dataset.clicked=\'yes\'">编辑按钮文字</button>'), changes: [{ type: 'MODIFY', content: '不应在版本列表出现的变更日志' }] })
hub.setSpec('interaction', 'v1', '# 技术规格\n\n中文下载内容 ✓\n')
hub.setBaseline('interaction', 'v1')
hub.createRequirement({ code: 'REQ-1', title: '回归需求' })
const server = await startServer(root, { port: 0, previewPort: 0 })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  const base = `http://127.0.0.1:${server.port}/#`
  await page.goto(`${base}/projects/interaction/versions/v1?tab=spec`, { waitUntil: 'networkidle' })
  const splitter = page.getByRole('separator', { name: /拖动调整/ })
  const preview = page.getByRole('region', { name: '原型预览区域' })
  const docs = page.getByRole('region', { name: '版本文档区域' })
  await splitter.waitFor()
  const initial = await preview.boundingBox()
  const handle = await splitter.boundingBox()
  await page.mouse.move(handle.x + 3, handle.y + 150)
  await page.mouse.down()
  await page.mouse.move(initial.x + 350, handle.y + 160, { steps: 12 })
  await page.mouse.up()
  assert.ok((await preview.boundingBox()).width < initial.width - 100)
  const finalWidth = (await preview.boundingBox()).width
  await page.mouse.move(initial.x + 600, handle.y + 160)
  assert.equal((await preview.boundingBox()).width, finalWidth, '拖动结束后尺寸应保持')
  await splitter.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok((await preview.boundingBox()).width > finalWidth)
  const handle2 = await splitter.boundingBox()
  await page.mouse.move(handle2.x + 3, handle2.y + 150)
  await page.mouse.down()
  await page.mouse.move(1435, handle2.y + 150, { steps: 12 })
  await page.mouse.up()
  const docBox = await docs.boundingBox()
  await page.screenshot({ path: '/tmp/flowlark-drag.png' })
  assert.ok(docBox.width >= 339 && docBox.x + docBox.width <= 1441)
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok((await docs.boundingBox()).x + (await docs.boundingBox()).width <= 1441)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载规格书' }).click()
  const file = await downloaded
  assert.equal(file.suggestedFilename(), 'interaction-v1.spec.md')
  assert.equal(fs.readFileSync(await file.path(), 'utf8'), '# 技术规格\n\n中文下载内容 ✓\n')
  await page.goto(`${base}/projects/interaction/versions/v1/edit`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /完\s*成/ }).waitFor().catch(async error => { console.log('EDITOR FAILURE', await page.locator('body').innerText(), errors); throw error })
  const frame = page.frameLocator('iframe[title="可编辑原型"]')
  await frame.locator('body[contenteditable=true]').waitFor()
  await frame.getByRole('heading', { name: '原始标题' }).click()
  await frame.locator('h1').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range) })
  await page.keyboard.type('Updated title')
  await frame.locator('h1').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range) })
  await page.getByRole('button', { name: '加粗', exact: true }).click()
  assert.match(await frame.locator('h1').innerHTML(), /font-weight:\s*normal/)
  await frame.locator('button').click()
  assert.equal(await frame.locator('body').getAttribute('data-clicked'), null)
  // Export twice without saving: bridge must not execute twice or accumulate markers.
  const exports = await page.evaluate(async () => {
    const target = document.querySelector('iframe').contentWindow
    const read = id => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Editor export timeout')), 3000)
      const listener = event => {
        if (event.source === target && event.data.type === 'flowlark:edit-html' && event.data.id === id) {
          window.removeEventListener('message', listener)
          clearTimeout(timer)
          resolve(event.data.html)
        }
      }
      window.addEventListener('message', listener)
      target.postMessage({ type: 'flowlark:get-edit-html', id }, '*')
    })
    return [await read('one'), await read('two')]
  })
  assert.equal(exports[0], exports[1])
  assert.match(exports[0], /^<!DOCTYPE html>\n<html/)
  assert.doesNotMatch(exports[0], /flowlark-edit-|data-flowlark-edit-target|contenteditable="true"/)
  assert.match(exports[0], /Updated title/)
  await page.getByRole('button', { name: /完\s*成/ }).click()
  await page.waitForURL('**/versions/v1')
  assert.match(readHtml(root, 'interaction', 'v1').toString('utf8'), /Updated title/)
  await page.goto(`${base}/projects/interaction`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByText('不应在版本列表出现的变更日志', { exact: true }).count(), 0)
  await page.goto(`${base}/requirements`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByText('本地原型进度', { exact: true }).count(), 0)
  await page.route('**/api/requirements/sync', route => route.fulfill({ json: { total: 103, updated: 100, imported: 10, failed: [{ code: 'REQ-A', message: '不得显示细节A' }, { code: 'REQ-B', message: '不得显示细节B' }, { code: 'REQ-C', message: '不得显示细节C' }], warnings: ['不得显示大段警告'], changes: Array(100).fill({ title: '不得显示大段数据' }) } }))
  await page.getByRole('button', { name: /同步需求池/ }).click().catch(async error => { console.log('SYNC FAILURE', page.url(), await page.locator('body').innerText()); throw error })
  await page.getByText('同步成功 100 条，失败 3 条。', { exact: true }).waitFor()
  assert.equal(await page.getByText(/不得显示/).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: iframe dragging, bounds, keyboard resize, persistence, spec download, baseline editing, export isolation, save, version list, sync counts, progress field')
} finally {
  await browser.close()
  await server.close()
  cleanup(root)
}
