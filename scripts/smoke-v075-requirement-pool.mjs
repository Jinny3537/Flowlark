#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initRepo } from '../src/core/repo.js'
import * as gitx from '../src/core/git.js'
import * as milestones from '../src/core/milestones.js'
import { startServer } from '../src/server/index.js'
import { inspectRequirementPoolManifest } from '../src/core/mcp-config.js'

const args = parseArgs(process.argv.slice(2))
const manifestPath = args.manifest || process.env.FLOWLARK_V075_MANIFEST
const query = args.query ?? process.env.FLOWLARK_V075_QUERY ?? ''
const requestedCode = args.requirement || process.env.FLOWLARK_V075_REQUIREMENT || ''
const keepRepo = args.keep || process.env.FLOWLARK_V075_KEEP_REPO === '1'

if (!manifestPath || args.help) {
  usage()
  process.exit(args.help ? 0 : 2)
}

const rawManifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'))
let manifest = rawManifest

if (args.inspectOnly) {
  let preview = inspectRequirementPoolManifest(manifest)
  manifest = injectSmokeEnvSecrets(manifest, preview)
  if (manifest !== rawManifest) preview = inspectRequirementPoolManifest(manifest)
  assert.deepEqual(preview.blockers || [], [], `manifest blockers: ${formatProblems(preview.blockers)}`)
  emitResult({
    passed: true,
    mode: 'inspect-only',
    manifestVersion: preview.manifestVersion,
    platform: preview.platform,
    transport: preview.transport,
    server: { id: preview.server?.id, name: preview.server?.name, type: preview.server?.type },
    tools: preview.capability?.tools || {},
    warnings: preview.warnings || [],
    secrets: preview.secrets || []
  })
  process.exit(0)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-v075-requirement-pool-'))
const project = 'v075-live'
const versionNo = 'v0.7.5-live'
const milestoneName = 'V075-LIVE'
let server

try {
  initRepo(root, { name: 'v0.7.5 requirement-pool smoke' })
  git(root, 'init')
  git(root, 'config', 'user.name', 'v0.7.5 Smoke')
  git(root, 'config', 'user.email', 'v075-smoke@example.invalid')

  server = await startServer(root, {
    port: 0,
    previewPort: 0,
    gitSync: (options) => gitx.sync(root, { ...options, push: false }),
    wecomMcp: fakeWecomMcp()
  })
  const base = `http://127.0.0.1:${server.port}`

  let preview = await api(base, 'POST', '/api/mcp/requirement-pool/inspect', manifest)
  manifest = injectSmokeEnvSecrets(manifest, preview)
  if (manifest !== rawManifest) {
    preview = await api(base, 'POST', '/api/mcp/requirement-pool/inspect', manifest)
  }
  assert.deepEqual(preview.blockers || [], [], `manifest blockers: ${formatProblems(preview.blockers)}`)

  await api(base, 'POST', '/api/mcp/requirement-pool/import', manifest)
  const status = await api(base, 'POST', '/api/mcp/requirement-pool/status', { probe: true })
  assertRequirementPoolConnected(status)

  const list = await api(base, 'POST', '/api/requirements/sync', {
    provider: 'mcp',
    mode: 'list',
    query
  })
  const candidates = (list.items || []).filter((item) => item.external?.provider === 'mcp')
  assert.ok(candidates.length > 0, '需求池列表刷新没有返回可导入需求；请放宽 FLOWLARK_V075_QUERY 或检查平台项目范围')

  const selected = requestedCode
    ? candidates.find((item) => item.code === requestedCode || item.external?.key === requestedCode)
    : candidates[0]
  assert.ok(selected, `需求池列表未返回指定需求 ${requestedCode}`)

  const refreshed = await api(base, 'POST', `/api/requirements/${encodeURIComponent(selected.code)}/external/refresh`, {})
  assert.equal(refreshed.external?.provider, 'mcp')
  assert.ok(refreshed.external?.key || refreshed.code, '需求详情缺少稳定外部标识')

  await api(base, 'POST', '/api/projects', {
    name: 'v0.7.5 需求池验收项目',
    code: project,
    releaseMail: {
      enabled: true,
      to: ['验收员'],
      subjectTemplate: '【验收】{{project}} {{version}}',
      bodyTemplate: '# {{title}}\n\n{{changes}}\n\n{{requirements}}'
    }
  })
  await api(base, 'PUT', `/api/requirements/${encodeURIComponent(selected.code)}/spec`, {
    markdown: '# v0.7.5 需求池验收\n\n- 可以从真实需求池拉取并追溯来源。\n'
  })
  await api(base, 'POST', `/api/requirements/${encodeURIComponent(selected.code)}/transition`, { target: 'confirmed' })
  await api(base, 'POST', `/api/projects/${project}/versions`, {
    versionNo,
    title: '需求池集成验收版',
    html: '<!doctype html><html><body><main>v0.7.5 requirement-pool smoke</main></body></html>'
  })
  await api(base, 'PUT', `/api/versions/${project}/${encodeURIComponent(versionNo)}/spec`, {
    markdown: '# 版本验收\n\n- 版本范围包含需求池需求。\n'
  })
  const linkedVersion = await api(base, 'POST', `/api/requirements/${encodeURIComponent(selected.code)}/links`, {
    project,
    versionNo
  })
  assert.ok((linkedVersion.requirements || []).some((item) => (typeof item === 'string' ? item : item.code) === selected.code))

  await api(base, 'POST', '/api/milestones', {
    name: milestoneName,
    title: 'v0.7.5 需求池验收迭代',
    goal: '验证真实需求池最小读集成',
    owner: '验收员',
    startAt: '2026-09-05',
    endAt: '2026-09-06',
    items: [{ requirement: selected.code, project, version: versionNo }]
  })
  const requirementDetail = await api(base, 'GET', `/api/requirements/${encodeURIComponent(selected.code)}`)
  assertRequirementLinkedToVersion(requirementDetail, project, versionNo)
  const milestoneDetail = await api(base, 'GET', `/api/milestones/${encodeURIComponent(milestoneName)}`)
  assertMilestoneIncludesRequirement(milestoneDetail, selected.code, project, versionNo)
  milestones.updateMilestone(root, milestoneName, { status: 'active' }, { system: true })

  const release = await api(base, 'POST', `/api/milestones/${milestoneName}/versions/${project}/${encodeURIComponent(versionNo)}/formal-release`, {
    releasedAt: new Date().toISOString()
  })
  assert.ok(release.snapshot, '正式发版没有生成交付快照')

  const snapshot = await api(base, 'GET', `/api/snapshots/${encodeURIComponent(release.snapshot)}`)
  const source = (snapshot.requirementSources || []).find((item) => item.code === selected.code)
  assertRequirementSourceFrozen(source, refreshed)

  const result = {
    passed: true,
    repo: keepRepo ? root : null,
    platform: status.platform?.name || status.platform?.id || 'mcp',
    requirement: selected.code,
    externalKey: source.key,
    requirementSource: source,
    project,
    version: versionNo,
    milestone: milestoneName,
    snapshot: release.snapshot
  }
  emitResult(result)
} finally {
  await server?.close()
  if (!keepRepo) fs.rmSync(root, { recursive: true, force: true })
}

function parseArgs(values) {
  const out = {}
  for (let index = 0; index < values.length; index++) {
    const item = values[index]
    if (item === '--help' || item === '-h') out.help = true
    else if (item === '--keep') out.keep = true
    else if (item === '--manifest') out.manifest = values[++index]
    else if (item === '--query') out.query = values[++index]
    else if (item === '--requirement') out.requirement = values[++index]
    else if (item === '--inspect-only') out.inspectOnly = true
    else if (item === '--output') out.output = values[++index]
    else throw new Error(`未知参数：${item}`)
  }
  return out
}

function usage() {
  console.error(`Usage:
  FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \\
  FLOWLARK_V075_QUERY="keyword" \\
  FLOWLARK_V075_SECRET_DEMAND_POOL_MCP="token-if-manifest-uses-secret" \\
  npm run smoke:v075:requirement-pool

Direct:
  node scripts/smoke-v075-requirement-pool.mjs

Options:
  --manifest <file>       Requirement-pool MCP manifest JSON.
  --query <text>          Optional list-refresh query.
  --requirement <code>    Require a specific external requirement code/key.
  --inspect-only          Validate manifest shape and secret placeholders only.
  --output <file>         Write the JSON result to a file for release readiness evidence.
  --keep                  Keep the temporary Flowlark repository for inspection.

Secrets:
  Manifest placeholders like \${env:TOKEN_NAME} are read directly from the environment.
  Header placeholders like \${secret:demand-pool-mcp} can be supplied as
  FLOWLARK_V075_SECRET_DEMAND_POOL_MCP. The smoke script injects them as
  temporary env placeholders in its disposable repository and never writes the
  secret value to mcp.json.
`)
}

function emitResult(result) {
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (args.output) {
    const target = path.resolve(args.output)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text, 'utf8')
  }
  process.stdout.write(text)
}

function injectSmokeEnvSecrets(input, preview) {
  const headers = preview?.server?.headers
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return input
  const serverId = String(preview?.server?.id || '').trim()
  let changed = false
  const nextHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    nextHeaders[key] = String(value || '').replace(/\$\{([^}]+)\}/g, (raw, expr) => {
      const name = smokeSecretName(expr, serverId)
      if (!name) return raw
      const envKey = `FLOWLARK_V075_SECRET_${envSuffix(name)}`
      if (!process.env[envKey]) return raw
      changed = true
      return `\${env:${envKey}}`
    })
  }
  if (!changed) return input
  const next = JSON.parse(JSON.stringify(input || {}))
  const transport = next.transport && typeof next.transport === 'object' && !Array.isArray(next.transport)
    ? { ...next.transport }
    : {}
  transport.headers = nextHeaders
  next.transport = transport
  return next
}

function smokeSecretName(expr, serverId) {
  const value = String(expr || '').trim()
  if (value === 'secret') return serverId
  if (value.startsWith('secret:')) return value.slice(7).trim()
  return ''
}

function envSuffix(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function fakeWecomMcp() {
  return {
    async authStatus() {
      return { installed: true, versionOk: true, authorized: true, message: 'v0.7.5 smoke fake sidecar' }
    },
    async resolveContacts({ names = [] } = {}) {
      return {
        results: names.map((name, index) => ({
          query: name,
          status: 'unique',
          candidate: { key: `smoke-${index}`, userid: `smoke-${index}`, name, alias: '', departments: [], position: '' },
          candidates: []
        }))
      }
    },
    async sendReleaseMail() {
      return { ok: true, fake: true }
    },
    diagnostics() {
      return { available: true, fake: true }
    },
    async close() {}
  }
}

async function api(base, method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Connection: 'close'
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    const message = payload?.message || payload?.error || text || `HTTP ${response.status}`
    const hint = payload?.hint ? `；${payload.hint}` : ''
    throw new Error(`${method} ${pathname} failed: ${message}${hint}`)
  }
  return payload
}

function formatProblems(items = []) {
  return (items || []).map((item) => `${item.code || 'ERROR'}: ${item.message || item}`).join('; ')
}

function assertRequirementPoolConnected(status) {
  if (status?.connected === true) return
  throw new Error(`connection probe failed: ${formatRequirementPoolStatus(status)}`)
}

function formatRequirementPoolStatus(status = {}) {
  const parts = []
  if (status.status) parts.push(`status=${status.status}`)
  if (status.missingSecrets?.length) {
    parts.push(`missing secrets: ${status.missingSecrets.map(formatMissingSecret).join(', ')}`)
  }
  if (status.blockers?.length) parts.push(`blockers: ${formatProblems(status.blockers)}`)
  if (status.connection?.message) parts.push(`message: ${status.connection.message}`)
  if (status.connection?.hint) parts.push(`hint: ${status.connection.hint}`)
  return parts.filter(Boolean).join('; ') || 'unknown status'
}

function formatMissingSecret(item) {
  const name = String(item?.name || '').trim()
  if (item?.kind === 'env') return `${name || item.label || 'env'}`
  const envKey = `FLOWLARK_V075_SECRET_${envSuffix(name)}`
  return `${name || item?.label || 'keychain'} (set ${envKey})`
}

function assertRequirementSourceFrozen(source, requirement) {
  assert.ok(source, `交付快照缺少需求 ${requirement.code} 的需求池来源摘要`)
  assert.equal(source.code, requirement.code)
  assert.equal(source.title, requirement.title || requirement.code)
  assert.equal(source.source, 'requirement-pool')
  assert.equal(source.provider, requirement.external?.provider || 'mcp')
  assert.equal(source.key, requirement.external?.key || requirement.code)
  assert.equal(source.status, requirement.external?.status || '')
  assert.equal(source.syncedAt, requirement.external?.syncedAt || '')
  assert.match(source.syncedAt || '', /^\d{4}-\d{2}-\d{2}T/, '交付快照缺少需求池同步时间')
  if (requirement.external?.url) assert.equal(source.url, requirement.external.url)
}

function assertRequirementLinkedToVersion(requirement, project, versionNo) {
  assert.ok((requirement.versions || []).some((item) =>
    item.project === project && item.versionNo === versionNo),
  `需求 ${requirement.code} 未回读到关联版本 ${project}/${versionNo}`)
}

function assertMilestoneIncludesRequirement(milestone, code, project, versionNo) {
  assert.ok((milestone.items || []).some((item) =>
    item.requirement === code && item.project === project && item.version === versionNo),
  `迭代 ${milestone.name} 未回读到需求范围 ${code} ${project}/${versionNo}`)
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
