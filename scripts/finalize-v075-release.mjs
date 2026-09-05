#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET_VERSION = '0.7.5'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const readinessScript = path.join(scriptDir, 'check-v075-readiness.mjs')
const args = parseArgs(process.argv.slice(2))

if (args.help) {
  usage()
  process.exit(0)
}

runReadiness('pre-bump')
const root = process.cwd()
const before = snapshotVersionFiles(root)
const updatedFiles = bumpVersions(root)
let finalReadiness
try {
  finalReadiness = runReadiness('final')
} catch (error) {
  restoreVersionFiles(root, before)
  throw error
}

process.stdout.write(`${JSON.stringify({
  passed: true,
  version: TARGET_VERSION,
  updatedFiles,
  finalReadiness
}, null, 2)}\n`)

function runReadiness(phase) {
  const output = execFileSync(process.execPath, [
    readinessScript,
    '--phase', phase,
    ...forwardedArgs()
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const result = JSON.parse(output)
  if (result.passed !== true) {
    throw new Error(`v0.7.5 ${phase} readiness failed`)
  }
  return result
}

function bumpVersions(root) {
  const files = [
    'package.json',
    'package-lock.json',
    'web/package.json',
    'web/package-lock.json'
  ]
  for (const file of files) {
    const target = path.join(root, file)
    const data = JSON.parse(fs.readFileSync(target, 'utf8'))
    data.version = TARGET_VERSION
    if (data.packages?.['']) data.packages[''].version = TARGET_VERSION
    fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }
  return files
}

function snapshotVersionFiles(root) {
  const files = [
    'package.json',
    'package-lock.json',
    'web/package.json',
    'web/package-lock.json'
  ]
  return Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]))
}

function restoreVersionFiles(root, snapshot) {
  for (const [file, content] of Object.entries(snapshot)) {
    fs.writeFileSync(path.join(root, file), content, 'utf8')
  }
}

function parseArgs(values) {
  const out = {}
  for (let index = 0; index < values.length; index++) {
    const item = values[index]
    if (item === '--help' || item === '-h') out.help = true
    else if (item === '--manifest') out.manifest = values[++index]
    else if (item === '--smoke-result') out.smokeResult = values[++index]
    else if (item === '--ui-smoke-result') out.uiSmokeResult = values[++index]
    else throw new Error(`未知参数：${item}`)
  }
  return out
}

function forwardedArgs() {
  const out = []
  if (args.manifest) out.push('--manifest', args.manifest)
  if (args.smokeResult) out.push('--smoke-result', args.smokeResult)
  if (args.uiSmokeResult) out.push('--ui-smoke-result', args.uiSmokeResult)
  return out
}

function usage() {
  console.error(`Usage:
  FLOWLARK_V075_MANIFEST=/path/to/requirement-pool.json \\
  FLOWLARK_V075_SMOKE_RESULT=.flowlark/cache/v075-requirement-pool-smoke.json \\
  FLOWLARK_V075_UI_SMOKE_RESULT=.flowlark/cache/v075-mcp-ui-smoke.json \\
  PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \\
  npm run release:v075:finalize

Options:
  --manifest <file>       Requirement-pool MCP manifest JSON.
  --smoke-result <file>   JSON output saved from smoke:v075:requirement-pool -- --output.
  --ui-smoke-result <file> JSON output saved from smoke:v075:mcp-ui -- --output.
`)
}
