#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { inspectRequirementPoolManifest } from '../src/core/mcp-config.js'

const TARGET_VERSION = '0.7.5'
const args = parseArgs(process.argv.slice(2))
const phase = args.phase || process.env.FLOWLARK_V075_READINESS_PHASE || 'final'

if (args.help) {
  usage()
  process.exit(0)
}
if (!['pre-bump', 'final'].includes(phase)) {
  throw new Error(`未知 readiness 阶段：${phase}`)
}

const checks = []
const root = process.cwd()
const manifestPath = args.manifest || process.env.FLOWLARK_V075_MANIFEST || ''
const smokeResultPath = args.smokeResult || process.env.FLOWLARK_V075_SMOKE_RESULT || ''
const uiSmokeResultPath = args.uiSmokeResult || process.env.FLOWLARK_V075_UI_SMOKE_RESULT || ''

checkPackageVersions()
checkNpmScripts()
checkManifest()
checkPlaywright()
checkSmokeResult()
checkUiSmokeResult()

const failed = checks.filter((item) => item.status === 'fail')
const result = {
  passed: failed.length === 0,
  targetVersion: TARGET_VERSION,
  phase,
  checks,
  next: failed.length
    ? nextActions(failed)
    : []
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exit(result.passed ? 0 : 1)

function checkPackageVersions() {
  const rootPackage = readJsonFile(path.join(root, 'package.json'))
  const webPackage = readJsonFile(path.join(root, 'web/package.json'))
  const rootLock = readOptionalJsonFile(path.join(root, 'package-lock.json'))
  const webLock = readOptionalJsonFile(path.join(root, 'web/package-lock.json'))
  if (phase === 'pre-bump') {
    addCheck('package-version', true,
      `package.json version is ${rootPackage?.version || 'missing'}; ${TARGET_VERSION} is required in final phase`)
    addCheck('web-package-version', true,
      `web/package.json version is ${webPackage?.version || 'missing'}; ${TARGET_VERSION} is required in final phase`)
    addCheck('package-lock-version', Boolean(rootLock),
      `package-lock.json version is ${rootLock?.version || 'missing'}; ${TARGET_VERSION} is required in final phase`)
    addCheck('web-package-lock-version', Boolean(webLock),
      `web/package-lock.json version is ${webLock?.version || 'missing'}; ${TARGET_VERSION} is required in final phase`)
    return
  }
  addCheck('package-version', rootPackage?.version === TARGET_VERSION,
    `package.json version is ${rootPackage?.version || 'missing'}, expected ${TARGET_VERSION}`)
  addCheck('web-package-version', webPackage?.version === TARGET_VERSION,
    `web/package.json version is ${webPackage?.version || 'missing'}, expected ${TARGET_VERSION}`)
  addCheck('package-lock-version', packageLockVersionMatches(rootLock),
    `package-lock.json version is ${rootLock?.version || 'missing'}, expected ${TARGET_VERSION}`)
  addCheck('web-package-lock-version', packageLockVersionMatches(webLock),
    `web/package-lock.json version is ${webLock?.version || 'missing'}, expected ${TARGET_VERSION}`)
}

function checkNpmScripts() {
  const rootPackage = readJsonFile(path.join(root, 'package.json'))
  const scripts = rootPackage?.scripts || {}
  addCheck('smoke-requirement-pool-script', scripts['smoke:v075:requirement-pool'] === 'node scripts/smoke-v075-requirement-pool.mjs',
    'package.json must expose smoke:v075:requirement-pool')
  addCheck('smoke-mcp-ui-script', scripts['smoke:v075:mcp-ui'] === 'node scripts/smoke-v075-mcp-ui.mjs',
    'package.json must expose smoke:v075:mcp-ui')
  addCheck('finalize-v075-script', scripts['release:v075:finalize'] === 'node scripts/finalize-v075-release.mjs',
    'package.json must expose release:v075:finalize')
}

function checkManifest() {
  if (!manifestPath) {
    addCheck('manifest-present', false, 'FLOWLARK_V075_MANIFEST or --manifest is required')
    addCheck('manifest-inspect', false, 'manifest cannot be inspected until a file is provided')
    return
  }
  const resolved = path.resolve(manifestPath)
  if (!fs.existsSync(resolved)) {
    addCheck('manifest-present', false, `manifest file does not exist: ${resolved}`)
    addCheck('manifest-inspect', false, 'manifest cannot be inspected until the file exists')
    return
  }
  addCheck('manifest-present', true, `manifest file found: ${resolved}`)
  try {
    const preview = inspectRequirementPoolManifest(readJsonFile(resolved))
    addCheck('manifest-inspect', (preview.blockers || []).length === 0,
      (preview.blockers || []).length
        ? `manifest blockers: ${(preview.blockers || []).map((item) => item.code).join(', ')}`
        : `manifest accepted for ${preview.platform?.id || 'requirement-pool'}`)
    checkHeaderCredentialEnvironment(preview)
  } catch (error) {
    addCheck('manifest-inspect', false, `manifest inspect failed: ${error?.message || error}`)
  }
}

function checkHeaderCredentialEnvironment(preview) {
  const headers = preview?.server?.headers || {}
  const names = new Set()
  for (const value of Object.values(headers)) {
    for (const reference of headerSecretReferences(value, preview?.server?.id || '')) {
      names.add(reference.kind === 'env' ? reference.name : `FLOWLARK_V075_SECRET_${envSuffix(reference.name)}`)
    }
  }
  if (!names.size) {
    addCheck('manifest-credentials', true, 'manifest does not declare header credentials')
    return
  }
  const missing = [...names].filter((name) => !process.env[name])
  addCheck('manifest-credentials', missing.length === 0,
    missing.length ? `missing credential environment variables: ${missing.join(', ')}` : 'credential environment variables are present',
    { requiredEnv: [...names] })
}

function checkPlaywright() {
  const modulePath = process.env.PLAYWRIGHT_MODULE || ''
  const found = Boolean(modulePath && fs.existsSync(path.resolve(modulePath)))
  addCheck('playwright-module', found,
    found ? `PLAYWRIGHT_MODULE found: ${path.resolve(modulePath)}` : modulePath ? `PLAYWRIGHT_MODULE not found: ${modulePath}` : 'PLAYWRIGHT_MODULE is required for smoke:v075:mcp-ui')
}

function checkSmokeResult() {
  if (!smokeResultPath) {
    addCheck('real-smoke-result', false, 'FLOWLARK_V075_SMOKE_RESULT or --smoke-result is required')
    return
  }
  const resolved = path.resolve(smokeResultPath)
  if (!fs.existsSync(resolved)) {
    addCheck('real-smoke-result', false, `smoke result file does not exist: ${resolved}`)
    return
  }
  try {
    const result = readJsonFile(resolved)
    const source = result?.requirementSource || {}
    const sourceReady = result?.passed === true &&
      Boolean(result.requirement && result.snapshot && source.source === 'requirement-pool' && source.key && source.status && source.syncedAt)
    addCheck('real-smoke-result', sourceReady,
      sourceReady ? `real smoke evidence accepted for ${result.requirement}` : 'real smoke result is missing passed requirement/snapshot/source evidence')
  } catch (error) {
    addCheck('real-smoke-result', false, `smoke result parse failed: ${error?.message || error}`)
  }
}

function checkUiSmokeResult() {
  if (!uiSmokeResultPath) {
    addCheck('ui-smoke-result', false, 'FLOWLARK_V075_UI_SMOKE_RESULT or --ui-smoke-result is required')
    return
  }
  const resolved = path.resolve(uiSmokeResultPath)
  if (!fs.existsSync(resolved)) {
    addCheck('ui-smoke-result', false, `UI smoke result file does not exist: ${resolved}`)
    return
  }
  try {
    const result = readJsonFile(resolved)
    const checks = new Set(Array.isArray(result?.checks) ? result.checks : [])
    const required = [
      'requirements-direct-config-import',
      'requirements-secret-ui',
      'requirements-env-secret-probe',
      'requirements-search-import',
      'settings-advanced-entrypoint',
      'desktop-mobile-layout',
      'page-errors'
    ]
    const missing = required.filter((item) => !checks.has(item))
    addCheck('ui-smoke-result', result?.passed === true && missing.length === 0,
      missing.length ? `UI smoke result is missing checks: ${missing.join(', ')}` : 'UI smoke evidence accepted')
  } catch (error) {
    addCheck('ui-smoke-result', false, `UI smoke result parse failed: ${error?.message || error}`)
  }
}

function addCheck(key, passed, message, extra = {}) {
  checks.push({ key, status: passed ? 'pass' : 'fail', message, ...extra })
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readOptionalJsonFile(file) {
  return fs.existsSync(file) ? readJsonFile(file) : null
}

function packageLockVersionMatches(lock) {
  return lock?.version === TARGET_VERSION && lock?.packages?.['']?.version === TARGET_VERSION
}

function parseArgs(values) {
  const out = {}
  for (let index = 0; index < values.length; index++) {
    const item = values[index]
    if (item === '--help' || item === '-h') out.help = true
    else if (item === '--phase') out.phase = values[++index]
    else if (item === '--manifest') out.manifest = values[++index]
    else if (item === '--smoke-result') out.smokeResult = values[++index]
    else if (item === '--ui-smoke-result') out.uiSmokeResult = values[++index]
    else throw new Error(`未知参数：${item}`)
  }
  return out
}

function headerSecretReferences(input, serverId) {
  const refs = []
  String(input || '').replace(/\$\{([^}]+)\}/g, (_raw, expr) => {
    const text = String(expr || '').trim()
    if (text === 'secret') refs.push({ kind: 'keychain', name: serverId })
    else if (text.startsWith('secret:')) refs.push({ kind: 'keychain', name: text.slice(7).trim() })
    else if (text.startsWith('env:')) refs.push({ kind: 'env', name: text.slice(4).trim() })
    return ''
  })
  return refs.filter((item) => item.name)
}

function envSuffix(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function nextActions(failedChecks) {
  const failedKeys = new Set(failedChecks.map((item) => item.key))
  const actions = []
  if (['manifest-present', 'manifest-inspect', 'manifest-credentials'].some((key) => failedKeys.has(key))) {
    actions.push('Provide an accepted requirement-pool manifest and required local credential environment variables.')
  }
  if (failedKeys.has('real-smoke-result')) {
    actions.push('Run the real-platform smoke against a disposable requirement-pool project and save its JSON output.')
  }
  if (failedKeys.has('playwright-module') || failedKeys.has('ui-smoke-result')) {
    actions.push('Run the browser MCP UI smoke with PLAYWRIGHT_MODULE set and save its JSON output.')
  }
  if (['smoke-requirement-pool-script', 'smoke-mcp-ui-script', 'finalize-v075-script'].some((key) => failedKeys.has(key))) {
    actions.push('Restore the v0.7.5 readiness, finalize and smoke npm script entries in package.json.')
  }
  if (['package-version', 'web-package-version', 'package-lock-version', 'web-package-lock-version'].some((key) => failedKeys.has(key))) {
    if (phase === 'pre-bump') actions.push('Restore package-lock.json and web/package-lock.json before rerunning pre-bump readiness.')
    else actions.push('After pre-bump readiness passes, run release:v075:finalize to bump package and lockfile versions to 0.7.5.')
  }
  if (!actions.length) actions.push('Inspect failed readiness checks and provide the missing release evidence before rerunning.')
  return actions
}

function usage() {
  console.error(`Usage:
  FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \\
  FLOWLARK_V075_QUERY="safe test requirement" \\
  FLOWLARK_V075_SECRET_DEMAND_POOL_MCP="token-if-manifest-uses-secret" \\
  FLOWLARK_V075_SMOKE_RESULT=.flowlark/cache/v075-requirement-pool-smoke.json \\
  FLOWLARK_V075_UI_SMOKE_RESULT=.flowlark/cache/v075-mcp-ui-smoke.json \\
  PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \\
  npm run check:v075:readiness -- --phase pre-bump

  npm run check:v075:readiness -- --phase final

Options:
  --phase <pre-bump|final> Final phase also requires package versions to be ${TARGET_VERSION}.
  --manifest <file>       Requirement-pool MCP manifest JSON.
  --smoke-result <file>   JSON output saved from smoke:v075:requirement-pool -- --output.
  --ui-smoke-result <file> JSON output saved from smoke:v075:mcp-ui -- --output.
`)
}
