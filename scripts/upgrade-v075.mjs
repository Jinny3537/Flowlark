#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET_VERSION = '0.7.5'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))

if (args.help) {
  usage()
  process.exit(0)
}

try {
  const manifest = args.manifest || process.env.FLOWLARK_V075_MANIFEST || ''
  const smokeResult = args.smokeResult || process.env.FLOWLARK_V075_SMOKE_RESULT || '.flowlark/cache/v075-requirement-pool-smoke.json'
  const uiSmokeResult = args.uiSmokeResult || process.env.FLOWLARK_V075_UI_SMOKE_RESULT || '.flowlark/cache/v075-mcp-ui-smoke.json'
  const preflight = checkPreflight({ manifest, uiSmokeResult })
  if (!preflight.passed) finish(preflight, 2)

  const steps = []
  if (args.reuseUiSmokeResult) {
    steps.push({ key: 'ui-smoke', status: 'reused', output: path.resolve(uiSmokeResult) })
  } else {
    runExec('build-web', 'npm', ['run', 'build:web'])
    steps.push({ key: 'build-web', status: 'pass' })
    runNodeJson('ui-smoke', path.join(scriptDir, 'smoke-v075-mcp-ui.mjs'), ['--output', uiSmokeResult])
    steps.push({ key: 'ui-smoke', status: 'pass', output: path.resolve(uiSmokeResult) })
  }

  if (args.reuseRealSmokeResult) {
    steps.push({ key: 'real-smoke', status: 'reused', output: path.resolve(smokeResult) })
  } else {
    const smokeArgs = ['--manifest', manifest, '--output', smokeResult]
    if (args.query) smokeArgs.push('--query', args.query)
    if (args.requirement) smokeArgs.push('--requirement', args.requirement)
    if (args.keep) smokeArgs.push('--keep')
    runNodeJson('real-smoke', path.join(scriptDir, 'smoke-v075-requirement-pool.mjs'), smokeArgs)
    steps.push({ key: 'real-smoke', status: 'pass', output: path.resolve(smokeResult) })
  }

  const forwarded = ['--manifest', manifest, '--smoke-result', smokeResult, '--ui-smoke-result', uiSmokeResult]
  const preBump = runNodeJson('pre-bump-readiness', path.join(scriptDir, 'check-v075-readiness.mjs'), ['--phase', 'pre-bump', ...forwarded])
  steps.push({ key: 'pre-bump-readiness', status: 'pass' })
  const finalizer = runNodeJson('finalize', path.join(scriptDir, 'finalize-v075-release.mjs'), forwarded)
  steps.push({ key: 'finalize', status: 'pass', updatedFiles: finalizer.updatedFiles || [] })

  finish({
    passed: true,
    targetVersion: TARGET_VERSION,
    manifest: path.resolve(manifest),
    smokeResult: path.resolve(smokeResult),
    uiSmokeResult: path.resolve(uiSmokeResult),
    steps,
    preBumpReadiness: preBump,
    finalReadiness: finalizer.finalReadiness || null
  }, 0)
} catch (error) {
  finish({
    passed: false,
    targetVersion: TARGET_VERSION,
    failedStep: error?.step || 'upgrade:v075',
    message: String(error?.message || error),
    next: ['Inspect the failed step, provide the missing v0.7.5 release evidence, then rerun upgrade:v075.']
  }, 1)
}

function checkPreflight({ manifest, uiSmokeResult }) {
  const missing = []
  if (!manifest) missing.push('FLOWLARK_V075_MANIFEST or --manifest')
  else if (!fs.existsSync(path.resolve(manifest))) missing.push(`manifest file: ${path.resolve(manifest)}`)
  if (!process.env.PLAYWRIGHT_MODULE) missing.push('PLAYWRIGHT_MODULE')
  else if (!fs.existsSync(path.resolve(process.env.PLAYWRIGHT_MODULE))) missing.push(`PLAYWRIGHT_MODULE file: ${path.resolve(process.env.PLAYWRIGHT_MODULE)}`)
  if (args.reuseUiSmokeResult && !fs.existsSync(path.resolve(uiSmokeResult))) {
    missing.push(`UI smoke result file: ${path.resolve(uiSmokeResult)}`)
  }
  return {
    passed: missing.length === 0,
    targetVersion: TARGET_VERSION,
    phase: 'preflight',
    missing,
    next: missing.length
      ? ['Provide the missing manifest, Playwright module or reusable UI smoke result, then rerun upgrade:v075.']
      : []
  }
}

function runNodeJson(step, script, values) {
  const output = runExec(step, process.execPath, [script, ...values])
  try {
    return JSON.parse(output)
  } catch (error) {
    const wrapped = new Error(`${step} did not return JSON`)
    wrapped.step = step
    throw wrapped
  }
}

function runExec(step, command, values) {
  try {
    return execFileSync(command, values, {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    const wrapped = new Error(`${step} failed with exit ${error.status ?? 'unknown'}`)
    wrapped.step = step
    throw wrapped
  }
}

function finish(result, code) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(code)
}

function parseArgs(values) {
  const out = {}
  for (let index = 0; index < values.length; index++) {
    const item = values[index]
    if (item === '--help' || item === '-h') out.help = true
    else if (item === '--manifest') out.manifest = readValue(values, ++index, item)
    else if (item === '--query') out.query = readValue(values, ++index, item)
    else if (item === '--requirement') out.requirement = readValue(values, ++index, item)
    else if (item === '--smoke-result') out.smokeResult = readValue(values, ++index, item)
    else if (item === '--ui-smoke-result') out.uiSmokeResult = readValue(values, ++index, item)
    else if (item === '--reuse-real-smoke-result') out.reuseRealSmokeResult = true
    else if (item === '--reuse-ui-smoke-result') out.reuseUiSmokeResult = true
    else if (item === '--keep') out.keep = true
    else throw new Error(`未知参数：${item}`)
  }
  return out
}

function readValue(values, index, flag) {
  const value = values[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function usage() {
  console.error(`Usage:
  FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \\
  FLOWLARK_V075_QUERY="safe test requirement" \\
  FLOWLARK_V075_SECRET_DEMAND_POOL_MCP="token-if-manifest-uses-secret" \\
  PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \\
  npm run upgrade:v075

Direct:
  node scripts/upgrade-v075.mjs

Options:
  --manifest <file>              Requirement-pool MCP manifest JSON.
  --query <text>                 Optional real-platform list-refresh query.
  --requirement <code>           Require a specific external requirement code/key.
  --smoke-result <file>          Real-platform smoke JSON output. Defaults to .flowlark/cache/v075-requirement-pool-smoke.json.
  --ui-smoke-result <file>       Browser smoke JSON output. Defaults to .flowlark/cache/v075-mcp-ui-smoke.json.
  --reuse-real-smoke-result      Reuse an existing real-platform smoke result instead of rerunning it.
  --reuse-ui-smoke-result        Reuse an existing browser smoke result instead of rebuilding Web and rerunning browser smoke.
  --keep                         Keep the temporary repository created by the real-platform smoke.

Flow:
  build Web -> browser smoke -> real-platform smoke -> pre-bump readiness -> guarded finalizer -> final readiness.
`)
}
