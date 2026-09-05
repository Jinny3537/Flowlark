import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import { INTERNAL_DIR, currentUser } from './repo.js'

const RUN_ID_RE = /^[a-f0-9]{24}$/

export function formalReleaseRunId({ milestone, project, version, baselineAt }) {
  const raw = [
    'formal-release',
    String(milestone || '').trim(),
    String(project || '').trim(),
    String(version || '').trim(),
    String(baselineAt || '').trim()
  ].join(':')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)
}

export function readFormalReleaseRun(root, id) {
  const file = runFile(root, id)
  if (!fs.existsSync(file)) throw err.notFound('正式发版记录')
  return normalizeRun(parse(fs.readFileSync(file, 'utf8'), `formal-release-run/${id}`))
}

export function findFormalReleaseRun(root, identity) {
  const baselineAt = String(identity?.baselineAt || '').trim()
  if (!baselineAt) return null
  const id = formalReleaseRunId(identity)
  return fs.existsSync(runFile(root, id)) ? readFormalReleaseRun(root, id) : null
}

export function findFormalReleaseRunByMail(root, { project, version, baselineAt } = {}) {
  const directory = runsDirectory(root)
  if (!fs.existsSync(directory)) return null
  const items = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return readFormalReleaseRun(root, name.slice(0, -5)) } catch { return null }
    })
    .filter(Boolean)
    .filter((run) => run.project === project && run.version === version && run.baselineAt === baselineAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return items[0] || null
}

export function ensureFormalReleaseRun(root, identity) {
  const id = formalReleaseRunId(identity)
  const file = runFile(root, id, true)
  if (fs.existsSync(file)) return readFormalReleaseRun(root, id)
  const now = new Date().toISOString()
  const run = normalizeRun({
    id,
    schemaVersion: 1,
    milestone: String(identity.milestone || '').trim(),
    project: String(identity.project || '').trim(),
    version: String(identity.version || '').trim(),
    baselineAt: String(identity.baselineAt || '').trim(),
    status: 'running',
    steps: {},
    createdAt: now,
    createdBy: currentUser(),
    updatedAt: now
  })
  writeRun(root, run)
  return run
}

export function markFormalReleaseStep(root, id, step, value = {}) {
  const key = String(step || '').trim()
  if (!key) throw err.bad('FORMAL_RELEASE_STEP_INVALID', '正式发版步骤无效')
  const run = readFormalReleaseRun(root, id)
  run.steps[key] = { ...value, updatedAt: new Date().toISOString() }
  run.status = deriveStatus(run)
  run.updatedAt = new Date().toISOString()
  writeRun(root, run)
  return run
}

export function publicFormalReleaseRun(input) {
  const run = normalizeRun(input)
  return {
    id: run.id,
    milestone: run.milestone,
    project: run.project,
    version: run.version,
    baselineAt: run.baselineAt,
    status: run.status,
    steps: run.steps,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  }
}

function deriveStatus(run) {
  if (run.steps.mail?.status === 'sent' && run.steps.lifecycle?.status === 'complete') return 'complete'
  if (run.steps.git?.status === 'failed') return 'git_failed'
  if (run.steps.snapshot?.status === 'failed') return 'snapshot_failed'
  if (run.steps.mail?.status === 'pending') return 'mail_pending'
  return 'running'
}

function normalizeRun(input = {}) {
  const id = String(input.id || '').trim()
  if (!RUN_ID_RE.test(id)) throw err.bad('FORMAL_RELEASE_RUN_INVALID', '正式发版记录标识无效')
  const steps = input.steps && typeof input.steps === 'object' && !Array.isArray(input.steps) ? input.steps : {}
  return {
    id,
    schemaVersion: 1,
    milestone: String(input.milestone || '').trim(),
    project: String(input.project || '').trim(),
    version: String(input.version || '').trim(),
    baselineAt: String(input.baselineAt || '').trim(),
    status: String(input.status || deriveStatus({ steps })).trim() || 'running',
    steps,
    createdAt: String(input.createdAt || ''),
    createdBy: String(input.createdBy || ''),
    updatedAt: String(input.updatedAt || '')
  }
}

function runFile(root, id, create = false) {
  const safe = String(id || '').trim()
  if (!RUN_ID_RE.test(safe)) throw err.bad('FORMAL_RELEASE_RUN_INVALID', '正式发版记录标识无效')
  const directory = runsDirectory(root)
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  return path.join(directory, `${safe}.json`)
}

function runsDirectory(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'formal-release-runs')
}

function writeRun(root, run) {
  const file = runFile(root, run.id, true)
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(run), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true })
  }
}
