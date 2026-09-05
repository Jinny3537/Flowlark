#!/usr/bin/env node
// Run after `npm run build:web` with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { initRepo } from '../src/core/repo.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  usage()
  process.exit(0)
}

if (!process.env.PLAYWRIGHT_MODULE) {
  usage()
  process.exit(2)
}

process.env.FLOWLARK_V075_UI_TOKEN = 'v075-ui-smoke-token'

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-mcp-ui-smoke-'))
initRepo(root, { name: 'v0.7.5 MCP UI smoke' })

let mcpServer, appServer, browser
const errors = []
const calls = []

try {
  mcpServer = await startFakeRequirementPool()
  const mcpUrl = `http://127.0.0.1:${mcpServer.address().port}/mcp`
  appServer = await startServer(root, {
    port: 0,
    previewPort: 0,
    wecomMcp: unavailableWecomMcp('v075-mcp-ui-smoke')
  })

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const base = `http://127.0.0.1:${appServer.port}/#`
  await page.goto(`${base}/requirements`)
  await page.waitForLoadState('networkidle')
  await button(page, '从需求池导入').click()
  const main = page.locator('#main-content')
  const importDialog = page.getByRole('dialog', { name: /从需求池导入/ })
  await importDialog.getByText('先导入平台提供的需求池配置 JSON，再搜索和导入需求。', { exact: true }).waitFor()

  await button(importDialog, '加载示例配置').click()
  await importDialog.getByText('需求池平台').waitFor()

  const requirementManifestEditor = importDialog.locator('.fl-requirement-pool-config textarea').first()
  await requirementManifestEditor.fill(JSON.stringify(manifestWithKeychainSecret(mcpUrl), null, 2))
  await expectResponse(page, '/api/mcp/requirement-pool/inspect', () =>
    button(importDialog, '预览配置').click())
  await importDialog.getByText('配置可导入', { exact: true }).waitFor()
  await importDialog.getByText('需本机补录密钥：UI Smoke Token').waitFor()

  await expectResponse(page, '/api/mcp/requirement-pool/import', () =>
    button(importDialog, '导入配置').click())
  await importDialog.getByText('配置可导入', { exact: true }).waitFor()
  await expectResponse(page, '/api/mcp/requirement-pool/status', () =>
    button(importDialog, '检查接入状态').click())
  await importDialog.getByText('需求池配置缺少本机密钥', { exact: true }).waitFor()
  const dialogMissingSecretRow = importDialog.locator('li').filter({ hasText: 'ui-smoke-token' })
  await dialogMissingSecretRow.getByPlaceholder('输入后只保存到本机').fill('not-written-by-smoke')
  await assertEnabled(button(dialogMissingSecretRow, '保存密钥'))

  await requirementManifestEditor.fill(JSON.stringify(manifestWithEnvSecret(mcpUrl), null, 2))
  await expectResponse(page, '/api/mcp/requirement-pool/inspect', () =>
    button(importDialog, '预览配置').click())
  await expectResponse(page, '/api/mcp/requirement-pool/import', () =>
    button(importDialog, '导入配置').click())
  await expectResponse(page, '/api/mcp/requirement-pool/status', () =>
    button(importDialog, '执行连接测试').click())
  await importDialog.getByText('需求池连接测试通过', { exact: true }).waitFor()
  await importDialog.getByText('身份：MCP UI Smoke').waitFor()
  await importDialog.getByLabel('搜索需求池').fill('ui smoke')
  await expectResponse(page, '/api/integrations/requirements/mcp/search', () =>
    importDialog.locator('.ant-input-search button').click())
  await importDialog.getByText('REQ-UI-1').waitFor()
  await importDialog.getByText('UI smoke requirement').waitFor()
  const importRequirementButton = importDialog.locator('.fl-external-list button').filter({ hasText: /导\s*入/ }).first()
  await assertEnabled(importRequirementButton)
  await expectResponse(page, '/api/integrations/requirements/mcp/import', () =>
    importRequirementButton.click())
  await main.getByText('REQ-UI-1').waitFor()
  assert.ok(page.url().endsWith('#/requirements/REQ-UI-1'))

  await page.goto(`${base}/requirements`)
  await page.waitForLoadState('networkidle')
  await button(page, '从需求池导入').click()
  await button(importDialog, '高级 MCP 设置').click()
  await main.getByText('导入需求池 MCP 配置 JSON', { exact: true }).waitFor()
  assert.ok(page.url().endsWith('#/settings/mcp'))

  await page.goto(`${base}/settings/mcp`)
  await page.waitForLoadState('networkidle')
  await main.getByText('导入需求池 MCP 配置 JSON', { exact: true }).waitFor()

  await button(page, '加载示例').click()
  await main.getByText('需求池平台').waitFor()

  const manifestEditor = page.locator('.fl-mcp-editor textarea').first()
  await manifestEditor.fill(JSON.stringify(manifestWithKeychainSecret(mcpUrl), null, 2))
  await expectResponse(page, '/api/mcp/requirement-pool/inspect', () =>
    button(page, '预览配置').click())
  await main.getByText('配置可导入', { exact: true }).waitFor()
  await main.getByText('需本机补录密钥：UI Smoke Token').waitFor()

  await expectResponse(page, '/api/mcp/requirement-pool/import', () =>
    button(page, '导入到 MCP 配置').click())
  await expectResponse(page, '/api/mcp/requirement-pool/status', () =>
    button(page, '检查接入状态').click())
  await main.getByText('需求池配置缺少本机密钥', { exact: true }).waitFor()
  const missingSecretRow = page.locator('li').filter({ hasText: 'ui-smoke-token' })
  await missingSecretRow.getByPlaceholder('输入后只保存到本机').fill('not-written-by-smoke')
  await assertEnabled(button(missingSecretRow, '保存密钥'))

  await manifestEditor.fill(JSON.stringify(manifestWithEnvSecret(mcpUrl), null, 2))
  await expectResponse(page, '/api/mcp/requirement-pool/inspect', () =>
    button(page, '预览配置').click())
  await expectResponse(page, '/api/mcp/requirement-pool/import', () =>
    button(page, '导入到 MCP 配置').click())
  await expectResponse(page, '/api/mcp/requirement-pool/status', () =>
    button(page, '执行连接测试').click())
  await main.getByText('需求池连接测试通过', { exact: true }).waitFor()
  await main.getByText('身份：MCP UI Smoke').waitFor()
  assert.ok(calls.some((item) => item.name === 'requirements.test' && item.authorization === 'Bearer v075-ui-smoke-token'))
  assert.ok(calls.some((item) => item.name === 'requirements.search' && item.authorization === 'Bearer v075-ui-smoke-token'))
  assert.ok(calls.some((item) => item.name === 'requirements.get' && item.authorization === 'Bearer v075-ui-smoke-token'))

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto(`${base}/settings/mcp`)
    await page.waitForLoadState('networkidle')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `settings MCP overflow ${width}`)
  }

  assert.deepEqual(errors, [])
  console.log(JSON.stringify({
    passed: true,
    checks: ['requirements-direct-config-import', 'requirements-secret-ui', 'requirements-env-secret-probe', 'requirements-search-import', 'settings-advanced-entrypoint', 'template-load', 'manifest-preview', 'import', 'missing-secret-ui', 'env-secret-probe', 'desktop-mobile-layout', 'page-errors'],
    viewportWidths: [1440, 390]
  }))
} finally {
  await browser?.close()
  await appServer?.close()
  await closeServer(mcpServer)
  fs.rmSync(root, { recursive: true, force: true })
}

function manifestWithKeychainSecret(url) {
  return {
    manifestVersion: '2026-09',
    platform: { id: 'ui-pool', name: 'UI Requirement Pool' },
    project: { id: 'safe-prod' },
    transport: {
      type: 'http',
      url,
      timeoutMs: 5000,
      headers: { Authorization: 'Bearer ${secret:ui-smoke-token}' }
    },
    tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
    fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
    statuses: { open: '待处理' },
    secrets: [{ name: 'ui-smoke-token', label: 'UI Smoke Token' }],
    safety: { readOnly: true, writes: [], dangerous: [] }
  }
}

function manifestWithEnvSecret(url) {
  return {
    ...manifestWithKeychainSecret(url),
    transport: {
      type: 'http',
      url,
      timeoutMs: 5000,
      headers: { Authorization: 'Bearer ${env:FLOWLARK_V075_UI_TOKEN}' }
    },
    secrets: []
  }
}

function startFakeRequirementPool() {
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    res.setHeader('Content-Type', 'application/json')
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.statusCode = 404
      res.end(JSON.stringify({ message: 'not found' }))
      return
    }
    const body = JSON.parse(raw)
    const name = body.params?.name
    const authorization = req.headers.authorization || ''
    calls.push({ name, authorization })
    if (authorization !== 'Bearer v075-ui-smoke-token') {
      res.statusCode = 401
      res.end(JSON.stringify({ message: 'missing or invalid token' }))
      return
    }
    if (name === 'requirements.test') {
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { name: 'MCP UI Smoke' } } }))
      return
    }
    if (name === 'requirements.search') {
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { items: [{
        code: 'REQ-UI-1',
        title: 'UI smoke requirement',
        description: 'Imported through the Requirements dialog',
        project: 'safe-prod',
        module: 'integration',
        type: 'feature',
        priority: 'P1',
        owner: 'PM',
        status: 'open',
        url: 'https://pool.example/REQ-UI-1'
      }] } } }))
      return
    }
    if (name === 'requirements.get') {
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: {
        code: 'REQ-UI-1',
        title: 'UI smoke requirement',
        description: 'Imported through the Requirements dialog',
        project: 'safe-prod',
        module: 'integration',
        type: 'feature',
        priority: 'P1',
        owner: 'PM',
        status: 'open',
        url: 'https://pool.example/REQ-UI-1'
      } } }))
      return
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: {} } }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function expectResponse(page, suffix, action) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith(suffix) && response.request().method() !== 'GET')
  await action()
  const response = await responsePromise
  assert.ok(response.ok(), `${suffix} returned ${response.status()}`)
  await page.waitForLoadState('networkidle')
  return response
}

function button(scope, name) {
  return scope.getByRole('button', { name: new RegExp(escapeRegExp(name)) })
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function assertEnabled(locator) {
  await locator.waitFor()
  assert.equal(await locator.isDisabled(), false)
}

function closeServer(server) {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => server.close(resolve))
}

function usage() {
  console.error(`Usage:
  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs npm run smoke:v075:mcp-ui

Direct:
  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/smoke-v075-mcp-ui.mjs

Checks:
  - Requirements import dialog can load, preview and import a requirement-pool manifest.
  - Requirements import dialog shows missing local secrets and can run an env-based connection probe.
  - Requirements import dialog can search the configured pool and import a requirement.
  - Requirements import dialog can route to advanced MCP Settings.
  - Requirement-pool manifest template, preview and import work in MCP Settings.
  - Missing keychain secret placeholders show an inline local secret entry.
  - Env-based header credentials can pass a read-only connection probe.
  - Settings MCP has no page errors or desktop/mobile horizontal overflow.
`)
}
