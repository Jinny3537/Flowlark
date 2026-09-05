import { after, before, describe, test } from 'node:test'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { cleanup, html, newHub } from './helpers.js'
import { fetchRequirement, postRequirementComment, searchRequirements, testRequirementConnection } from '../src/core/integrations/requirements/index.js'
import * as reqx from '../src/core/requirements.js'

const dirs = []
const execFileAsync = promisify(execFile)
let server
let baseUrl
const requests = []

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
    res.setHeader('Content-Type', 'application/json')

    if (req.url === '/mcp' && req.method === 'POST') {
      const params = JSON.parse(raw).params || {}
      if (params.name === 'requirements.test') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { name: 'MCP User' } } }))
      }
      if (params.name === 'requirements.search') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { items: [{ code: 'REQ-7', title: '外部需求', status: 'open', owner: 'PM' }] } } }))
      }
      if (params.name === 'requirements.get') {
        if (params.arguments?.key === 'REQ-GONE') {
          res.statusCode = 404
          return res.end(JSON.stringify({ message: 'requirement not found' }))
        }
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'REQ-7', title: '外部需求', description: '来自需求池的完整验收需求', owner: 'PM', status: 'open', url: 'https://mcp.example/REQ-7' }) }] } }))
      }
      if (params.name === 'requirements.comment') {
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(raw).id, result: { structuredContent: { url: 'https://mcp.example/REQ-7#comment' } } }))
      }
    }

    res.statusCode = 404
    res.end(JSON.stringify({ message: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  dirs.forEach(cleanup)
  return new Promise((resolve) => server.close(resolve))
})

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function v075RequirementPoolSmokeEvidence() {
  return {
    passed: true,
    generatedBy: 'smoke:v075:requirement-pool',
    mode: 'live',
    evidenceVersion: 'v075-requirement-pool-smoke/v1',
    generatedAt: '2026-09-05T08:00:00.000Z',
    manifest: {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: 'safe-prod',
      transport: { type: 'http', url: 'http://127.0.0.1:12345/mcp', timeoutMs: 5000 },
      server: { id: 'fixture-pool-mcp', name: 'Fixture Requirement Pool', type: 'http' }
    },
    connection: {
      connected: true,
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' }
    },
    requirement: 'REQ-7',
    externalKey: 'REQ-7',
    requirementSource: {
      source: 'requirement-pool',
      key: 'REQ-7',
      status: 'open',
      syncedAt: '2026-09-05T08:00:00.000Z'
    },
    project: 'v075-live',
    version: 'v0.7.5-live',
    milestone: 'V075-LIVE',
    snapshot: 'delivery-123',
    checks: [
      'manifest-inspect',
      'manifest-import',
      'connection-probe',
      'requirement-list-refresh',
      'requirement-detail-refresh',
      'version-link',
      'milestone-scope',
      'formal-release',
      'snapshot-source-freeze'
    ]
  }
}

describe('v0.7 升级能力', () => {
  test('从新旧 HTML 生成变更和规格草稿', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'orders' })
    hub.createRequirement({ code: 'REQ-7', title: '批量关闭' })
    hub.addVersion('orders', {
      versionNo: 'v1.0',
      title: '首版',
      html: html('<button>保存</button><div>订单列表</div>'),
      changes: [{ type: 'ADD', location: '页面', content: '首版', requirement: 'REQ-7' }],
      requirements: ['REQ-7']
    })
    hub.setBaseline('orders', 'v1.0')
    const draft = hub.draftVersionFromHtml('orders', 'v1.0', {
      title: '批量操作',
      html: html('<button>保存</button><button>批量关闭</button><div>订单列表</div>')
    })
    t.assert.ok(draft.changes.some((item) => /批量关闭/.test(item.content)))
    t.assert.match(draft.spec, /REQ-7/)
  })

  test('MCP Provider 支持连接、搜索、详情和评论', async (t) => {
    const config = { baseUrl: `${baseUrl}/mcp`, token: 'x' }
    const probe = await testRequirementConnection('mcp', config)
    t.assert.strictEqual(probe.ok, true)
    const found = await searchRequirements('mcp', config, 'REQ')
    t.assert.strictEqual(found[0].code, 'REQ-7')
    const detail = await fetchRequirement('mcp', config, 'REQ-7')
    t.assert.strictEqual(detail.title, '外部需求')
    const comment = await postRequirementComment('mcp', config, 'REQ-7', '新基线已确认')
    t.assert.strictEqual(comment.ok, true)
    t.assert.ok(requests.some((item) => item.url === '/mcp' && item.body.params.name === 'requirements.comment' && item.body.params.arguments.body === '新基线已确认'))
  })

  test('外部需求可单条刷新，失败时保留本地数据并记录不可访问状态', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.saveMcpServer({ id: 'requirements-mcp', name: '需求池 MCP', url: `${baseUrl}/mcp`, headers: { 'X-Test': 'yes' } })
    hub.saveMcpCapability('requirements', {
      enabled: true,
      server: 'requirements-mcp',
      project: 'safe-prod',
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      options: { fields: { title: 'title' }, statuses: { open: '待处理' } }
    })

    const imported = await hub.importExternalRequirement('mcp', 'REQ-7')
    t.assert.strictEqual(imported.external.syncStatus, 'synced')
    const refreshed = await hub.refreshExternalRequirement('REQ-7')
    t.assert.strictEqual(refreshed.external.syncStatus, 'synced')

    reqx.createRequirement(root, {
      code: 'REQ-GONE',
      title: '已删除的外部需求',
      external: { provider: 'mcp', key: 'REQ-GONE', status: 'open', syncedAt: '2026-09-05T08:00:00.000Z' }
    }, { trusted: true, now: '2026-09-05T08:00:00.000Z', actor: 'system:test' })
    const failed = await hub.refreshExternalRequirement('REQ-GONE')
    t.assert.strictEqual(failed.title, '已删除的外部需求')
    t.assert.strictEqual(failed.external.syncStatus, 'failed')
    t.assert.strictEqual(failed.external.failure.code, 'REQUIREMENT_POOL_TOOL_MISSING')
    t.assert.match(failed.external.failure.message, /404|not found/)
    const synced = await hub.syncExternalRequirements('mcp')
    t.assert.deepStrictEqual(synced.failed.map((item) => ({ code: item.code, errorCode: item.errorCode })), [
      { code: 'REQ-GONE', errorCode: 'REQUIREMENT_POOL_TOOL_MISSING' }
    ])
  })

  test('拉取的需求可加入原型版本范围且保留需求池来源', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单中心', code: 'orders' })
    hub.addVersion('orders', { versionNo: 'v1.0', title: '首版', html: html('<main>订单</main>') })
    hub.saveMcpServer({ id: 'requirements-mcp', name: '需求池 MCP', url: `${baseUrl}/mcp`, headers: { 'X-Test': 'yes' } })
    hub.saveMcpCapability('requirements', {
      enabled: true,
      server: 'requirements-mcp',
      project: 'safe-prod',
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      options: { fields: { title: 'title' }, statuses: { open: '待处理' } }
    })

    const imported = await hub.importExternalRequirement('mcp', 'REQ-7')
    t.assert.strictEqual(imported.external.provider, 'mcp')
    const version = hub.linkRequirement('REQ-7', 'orders', 'v1.0')
    t.assert.deepStrictEqual(version.requirements.map((item) => item.code), ['REQ-7'])

    const detail = hub.getRequirement('REQ-7')
    t.assert.strictEqual(detail.external.provider, 'mcp')
    t.assert.deepStrictEqual(detail.versions.map((item) => ({ project: item.project, versionNo: item.versionNo })), [
      { project: 'orders', versionNo: 'v1.0' }
    ])
  })

  test('需求池列表刷新会新增和更新外部需求引用', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    reqx.createRequirement(root, {
      code: 'REQ-GONE',
      title: '已移除外部需求',
      external: { provider: 'mcp', key: 'REQ-GONE', syncStatus: 'synced' }
    }, { trusted: true })
    hub.saveMcpServer({ id: 'requirements-mcp', name: '需求池 MCP', url: `${baseUrl}/mcp`, headers: { 'X-Test': 'yes' } })
    hub.saveMcpCapability('requirements', {
      enabled: true,
      server: 'requirements-mcp',
      project: 'safe-prod',
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      options: { fields: { title: 'title' }, statuses: { open: '待处理' } }
    })

    const first = await hub.refreshExternalRequirementList('mcp')
    t.assert.strictEqual(first.created, 1)
    t.assert.strictEqual(first.updated, 0)
    t.assert.strictEqual(first.missing, 1)
    t.assert.strictEqual(reqx.readRequirement(root, 'REQ-7').external.syncStatus, 'synced')
    const gone = reqx.readRequirement(root, 'REQ-GONE')
    t.assert.strictEqual(gone.external.syncStatus, 'failed')
    t.assert.strictEqual(gone.external.failure.code, 'REQUIREMENT_REMOTE_MISSING')

    const second = await hub.refreshExternalRequirementList('mcp')
    t.assert.strictEqual(second.created, 0)
    t.assert.strictEqual(second.updated, 1)
    t.assert.deepStrictEqual(second.failed, [])
  })

  test('v0.7.5 真实平台验收脚本可跑完产品路径', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-smoke-test-'))
    dirs.push(directory)
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { 'X-Smoke': 'v075' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    }
    const manifestFile = path.join(directory, 'requirement-pool.json')
    const smokeResultFile = path.join(directory, 'smoke-result.json')
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/smoke-v075-requirement-pool.mjs',
      '--manifest', manifestFile,
      '--query', 'REQ',
      '--requirement', 'REQ-7',
      '--output', smokeResultFile
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FLOWLARK_QUIET_MIGRATE: '1' }
    })
    const result = JSON.parse(stdout)
    t.assert.deepStrictEqual(JSON.parse(fs.readFileSync(smokeResultFile, 'utf8')), result)
    t.assert.strictEqual(result.passed, true)
    t.assert.strictEqual(result.generatedBy, 'smoke:v075:requirement-pool')
    t.assert.strictEqual(result.mode, 'live')
    t.assert.strictEqual(result.evidenceVersion, 'v075-requirement-pool-smoke/v1')
    t.assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
    t.assert.strictEqual(result.manifest.manifestVersion, '2026-09')
    t.assert.strictEqual(result.manifest.platform.id, 'fixture-pool')
    t.assert.strictEqual(result.manifest.project, 'safe-prod')
    t.assert.strictEqual(result.manifest.transport.type, 'http')
    t.assert.strictEqual(result.connection.connected, true)
    t.assert.ok(result.checks.includes('connection-probe'))
    t.assert.ok(result.checks.includes('snapshot-source-freeze'))
    t.assert.strictEqual(result.requirement, 'REQ-7')
    t.assert.deepStrictEqual(result.requirementSource, {
      code: 'REQ-7',
      title: '外部需求',
      source: 'requirement-pool',
      provider: 'mcp',
      key: 'REQ-7',
      url: 'https://mcp.example/REQ-7',
      status: 'open',
      syncedAt: result.requirementSource.syncedAt
    })
    t.assert.match(result.requirementSource.syncedAt, /^\d{4}-\d{2}-\d{2}T/)
    t.assert.ok(result.snapshot.startsWith('delivery-'))
  })

  test('v0.7.5 readiness gate reports missing final evidence without leaking secrets', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-readiness-test-'))
    dirs.push(directory)
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret:fixture-token}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    }
    const manifestFile = path.join(directory, 'requirement-pool.json')
    const smokeResultFile = path.join(directory, 'smoke-result.json')
    const legacySmokeResultFile = path.join(directory, 'legacy-smoke-result.json')
    const uiSmokeResultFile = path.join(directory, 'ui-smoke-result.json')
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
    writeJson(smokeResultFile, v075RequirementPoolSmokeEvidence())
    writeJson(legacySmokeResultFile, {
      passed: true,
      requirement: 'REQ-7',
      snapshot: 'delivery-123',
      requirementSource: {
        source: 'requirement-pool',
        key: 'REQ-7',
        status: 'open',
        syncedAt: '2026-09-05T08:00:00.000Z'
      }
    })
    fs.writeFileSync(uiSmokeResultFile, JSON.stringify({
      passed: true,
      checks: [
        'requirements-direct-config-import',
        'requirements-secret-ui',
        'requirements-env-secret-probe',
        'requirements-search-import',
        'settings-advanced-entrypoint',
        'desktop-mobile-layout',
        'page-errors'
      ]
    }), 'utf8')

    await t.assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/check-v075-readiness.mjs',
        '--manifest', manifestFile,
        '--smoke-result', smokeResultFile,
        '--ui-smoke-result', uiSmokeResultFile
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
        }
      }),
      (error) => {
        const result = JSON.parse(error.stdout)
        t.assert.strictEqual(result.passed, false)
        t.assert.strictEqual(result.checks.find((item) => item.key === 'manifest-inspect').status, 'pass')
        t.assert.strictEqual(result.checks.find((item) => item.key === 'manifest-credentials').status, 'pass')
        t.assert.strictEqual(result.checks.find((item) => item.key === 'real-smoke-result').status, 'pass')
        t.assert.strictEqual(result.checks.find((item) => item.key === 'ui-smoke-result').status, 'pass')
        t.assert.strictEqual(result.checks.find((item) => item.key === 'package-version').status, 'fail')
        t.assert.doesNotMatch(error.stdout, /fixture-secret-value/)
        return true
      }
    )

    await t.assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/check-v075-readiness.mjs',
        '--phase', 'pre-bump',
        '--manifest', manifestFile,
        '--smoke-result', legacySmokeResultFile,
        '--ui-smoke-result', uiSmokeResultFile
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PLAYWRIGHT_MODULE: process.execPath,
          FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
        }
      }),
      (error) => {
        const result = JSON.parse(error.stdout)
        const check = result.checks.find((item) => item.key === 'real-smoke-result')
        t.assert.strictEqual(result.passed, false)
        t.assert.strictEqual(check.status, 'fail')
        t.assert.match(check.message, /generatedBy\/mode\/evidenceVersion\/manifest\/connection audit evidence/)
        return true
      }
    )

    const preBump = await execFileAsync(process.execPath, [
      'scripts/check-v075-readiness.mjs',
      '--phase', 'pre-bump',
      '--manifest', manifestFile,
      '--smoke-result', smokeResultFile,
      '--ui-smoke-result', uiSmokeResultFile
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE: process.execPath,
        FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
      }
    })
    const preBumpResult = JSON.parse(preBump.stdout)
    t.assert.strictEqual(preBumpResult.passed, true)
    t.assert.strictEqual(preBumpResult.phase, 'pre-bump')
    t.assert.strictEqual(preBumpResult.checks.find((item) => item.key === 'package-version').status, 'pass')
    t.assert.match(preBumpResult.checks.find((item) => item.key === 'playwright-module').message, /PLAYWRIGHT_MODULE found:/)

    await t.assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/check-v075-readiness.mjs',
        '--phase', 'pre-bump',
        '--manifest', manifestFile,
        '--ui-smoke-result', uiSmokeResultFile
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PLAYWRIGHT_MODULE: process.execPath,
          FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
        }
      }),
      (error) => {
        const result = JSON.parse(error.stdout)
        t.assert.strictEqual(result.passed, false)
        t.assert.strictEqual(result.checks.find((item) => item.key === 'real-smoke-result').status, 'fail')
        t.assert.ok(result.next.some((item) => item.includes('real-platform smoke')))
        t.assert.ok(!result.next.some((item) => item.includes('browser MCP UI smoke')))
        return true
      }
    )
  })

  test('v0.7.5 finalize script bumps package versions only after readiness passes', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-finalize-test-'))
    dirs.push(directory)
    fs.mkdirSync(path.join(directory, 'web'), { recursive: true })
    const rootPackage = {
      name: 'flowlark',
      version: '0.7.0',
      type: 'module',
      scripts: {
        'check:v075:readiness': 'node scripts/check-v075-readiness.mjs',
        'release:v075:finalize': 'node scripts/finalize-v075-release.mjs',
        'smoke:v075:requirement-pool': 'node scripts/smoke-v075-requirement-pool.mjs',
        'smoke:v075:mcp-ui': 'node scripts/smoke-v075-mcp-ui.mjs'
      }
    }
    const webPackage = { name: 'flowlark-web', version: '0.7.0', type: 'module' }
    const rootLock = { name: 'flowlark', version: '0.7.0', lockfileVersion: 3, packages: { '': { name: 'flowlark', version: '0.7.0' } } }
    const webLock = { name: 'flowlark-web', version: '0.7.0', lockfileVersion: 3, packages: { '': { name: 'flowlark-web', version: '0.7.0' } } }
    writeJson(path.join(directory, 'package.json'), rootPackage)
    writeJson(path.join(directory, 'web/package.json'), webPackage)
    writeJson(path.join(directory, 'package-lock.json'), rootLock)
    writeJson(path.join(directory, 'web/package-lock.json'), webLock)

    const manifestFile = path.join(directory, 'requirement-pool.json')
    const smokeResultFile = path.join(directory, 'smoke-result.json')
    const uiSmokeResultFile = path.join(directory, 'ui-smoke-result.json')
    writeJson(manifestFile, {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret:fixture-token}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    })
    writeJson(smokeResultFile, v075RequirementPoolSmokeEvidence())
    writeJson(uiSmokeResultFile, {
      passed: true,
      checks: [
        'requirements-direct-config-import',
        'requirements-secret-ui',
        'requirements-env-secret-probe',
        'requirements-search-import',
        'settings-advanced-entrypoint',
        'desktop-mobile-layout',
        'page-errors'
      ]
    })

    const { stdout } = await execFileAsync(process.execPath, [
      path.resolve('scripts/finalize-v075-release.mjs'),
      '--manifest', manifestFile,
      '--smoke-result', smokeResultFile,
      '--ui-smoke-result', uiSmokeResultFile
    ], {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_MODULE: process.execPath,
        FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
      }
    })
    const result = JSON.parse(stdout)
    t.assert.strictEqual(result.passed, true)
    t.assert.strictEqual(result.finalReadiness.phase, 'final')
    for (const file of ['package.json', 'package-lock.json', 'web/package.json', 'web/package-lock.json']) {
      const json = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
      t.assert.strictEqual(json.version, '0.7.5')
      if (json.packages?.['']) t.assert.strictEqual(json.packages[''].version, '0.7.5')
    }
    t.assert.doesNotMatch(stdout, /fixture-secret-value/)
  })

  test('v0.7.5 验收脚本可从 Header 占位符推导本机密钥环境变量', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-smoke-secret-test-'))
    dirs.push(directory)
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret:fixture-token}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    }
    const manifestFile = path.join(directory, 'requirement-pool-secret.json')
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/smoke-v075-requirement-pool.mjs',
      '--manifest', manifestFile,
      '--query', 'REQ',
      '--requirement', 'REQ-7',
      '--keep'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        FLOWLARK_QUIET_MIGRATE: '1',
        FLOWLARK_V075_SECRET_FIXTURE_TOKEN: 'fixture-secret-value'
      }
    })
    const result = JSON.parse(stdout)
    dirs.push(result.repo)
    t.assert.strictEqual(result.passed, true)
    const saved = JSON.parse(fs.readFileSync(path.join(result.repo, 'mcp.json'), 'utf8'))
    t.assert.strictEqual(saved.servers[0].headers.Authorization, 'Bearer ${env:FLOWLARK_V075_SECRET_FIXTURE_TOKEN}')
    t.assert.doesNotMatch(JSON.stringify(saved), /fixture-secret-value/)
  })

  test('v0.7.5 验收脚本支持只检查配置合同', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-smoke-inspect-test-'))
    dirs.push(directory)
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { Authorization: 'Bearer ${secret:fixture-token}' } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    }
    const manifestFile = path.join(directory, 'requirement-pool-inspect.json')
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/smoke-v075-requirement-pool.mjs',
      '--manifest', manifestFile,
      '--inspect-only'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FLOWLARK_QUIET_MIGRATE: '1' }
    })
    const result = JSON.parse(stdout)
    t.assert.strictEqual(result.passed, true)
    t.assert.strictEqual(result.mode, 'inspect-only')
    t.assert.strictEqual(result.server.id, 'fixture-pool-mcp')
    t.assert.strictEqual(result.tools.search, 'requirements.search')
    t.assert.doesNotMatch(stdout, /fixture-secret-value/)
  })

  test('v0.7.5 验收脚本缺少 Header 密钥时给出可执行环境变量提示', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-smoke-missing-secret-test-'))
    dirs.push(directory)
    const secretName = `fixture-missing-${process.pid}`
    const envKey = `FLOWLARK_V075_SECRET_FIXTURE_MISSING_${process.pid}`
    const manifest = {
      manifestVersion: '2026-09',
      platform: { id: 'fixture-pool', name: 'Fixture Requirement Pool' },
      project: { id: 'safe-prod' },
      transport: { type: 'http', url: `${baseUrl}/mcp`, timeoutMs: 5000, headers: { Authorization: `Bearer \${secret:${secretName}}` } },
      tools: { test: 'requirements.test', search: 'requirements.search', get: 'requirements.get' },
      fields: { title: 'title', owner: 'owner', status: 'status', url: 'url' },
      statuses: { open: '待处理' },
      safety: { readOnly: true, writes: [], dangerous: [] }
    }
    const manifestFile = path.join(directory, 'requirement-pool-missing-secret.json')
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
    const childEnv = { ...process.env, FLOWLARK_QUIET_MIGRATE: '1' }
    delete childEnv[envKey]

    await t.assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/smoke-v075-requirement-pool.mjs',
        '--manifest', manifestFile,
        '--query', 'REQ',
        '--requirement', 'REQ-7'
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: childEnv
      }),
      (error) => {
        t.assert.match(String(error.stderr || error.message), new RegExp(envKey))
        t.assert.match(String(error.stderr || error.message), /missing secrets/)
        return true
      }
    )
  })
})
