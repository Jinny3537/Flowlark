import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { INTERNAL_DIR } from './repo.js'

export const REQUIREMENT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function assertRequirementCode(code) {
  const value = String(code || '').trim()
  if (!REQUIREMENT_CODE_RE.test(value)) {
    throw err.bad('REQUIREMENT_CODE_INVALID', `需求编号「${value}」不合法`, '只允许字母、数字、. _ -，长度不超过 64')
  }
  return value
}

export function requirementExists(root, code) {
  return fs.existsSync(store.paths.requirementFile(root, assertRequirementCode(code)))
}

export function readRequirement(root, code) {
  const safe = assertRequirementCode(code)
  const file = store.paths.requirementFile(root, safe)
  if (!fs.existsSync(file)) throw err.notFound(`需求「${safe}」`)
  return parse(fs.readFileSync(file, 'utf8'), `${safe}/requirement.json`)
}

export function listRequirementCodes(root) {
  const dir = store.paths.requirements(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(store.paths.requirementFile(root, entry.name)))
    .map((entry) => entry.name).sort()
}

export function createRequirement(root, input, now = new Date().toISOString()) {
  const code = assertRequirementCode(input.code)
  if (requirementExists(root, code)) throw err.conflict('REQUIREMENT_EXISTS', `需求「${code}」已存在`)
  const title = String(input.title || '').trim()
  if (!title) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  const item = {
    code,
    title,
    description: String(input.description || ''),
    project: String(input.project || ''),
    module: String(input.module || ''),
    type: String(input.type || ''),
    priority: String(input.priority || ''),
    owner: String(input.owner || ''),
    statusOverride: input.statusOverride || null,
    external: input.external || null,
    url: String(input.url || ''),
    createdAt: now,
    updatedAt: now
  }
  const file = store.paths.requirementFile(root, code)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(item, 'requirement'))
  return item
}

export function updateRequirement(root, code, patch) {
  const item = readRequirement(root, code)
  for (const key of ['title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'statusOverride', 'external', 'url']) {
    if (patch[key] !== undefined) item[key] = patch[key]
  }
  if (!String(item.title || '').trim()) throw err.bad('REQUIREMENT_TITLE_REQUIRED', '请填写需求标题')
  item.title = String(item.title).trim()
  item.updatedAt = new Date().toISOString()
  fs.writeFileSync(store.paths.requirementFile(root, item.code), stringify(item, 'requirement'))
  return item
}

export function ensureRequirement(root, raw) {
  const input = typeof raw === 'string' ? { code: raw, title: raw } : raw
  const code = assertRequirementCode(input && input.code)
  if (!requirementExists(root, code)) createRequirement(root, { ...input, title: input.title || code })
  return code
}

export function resolveRequirementLinks(root, links) {
  return (links || []).map((raw) => {
    const code = typeof raw === 'string' ? raw : raw.code
    if (requirementExists(root, code)) return readRequirement(root, code)
    return typeof raw === 'object' ? raw : { code, title: code, url: '' }
  })
}

function indexFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'requirements-index.json')
}

function sourceFingerprint(root) {
  const rows = []
  for (const slug of store.listProjectSlugs(root)) {
    for (const no of store.listVersionNos(root, slug)) {
      const stat = fs.statSync(store.paths.versionJson(root, slug, no))
      rows.push(`${slug}/${no}:${stat.size}:${stat.mtimeMs}`)
    }
    const baseline = store.readBaseline(root, slug)
    rows.push(`${slug}/BASELINE:${baseline || ''}`)
  }
  return crypto.createHash('sha256').update(rows.sort().join('\n')).digest('hex')
}

export function buildRequirementIndex(root) {
  const byCode = {}
  for (const slug of store.listProjectSlugs(root)) {
    const baseline = store.readBaseline(root, slug)
    for (const no of store.listVersionNos(root, slug)) {
      const version = store.readVersion(root, slug, no)
      for (const raw of version.requirements || []) {
        const code = typeof raw === 'string' ? raw : raw.code
        if (!code) continue
        if (!byCode[code]) byCode[code] = []
        byCode[code].push({ project: slug, versionNo: no, title: version.title, isBaseline: no === baseline, status: version.status, reviewStatus: version.reviewStatus, createdAt: version.createdAt })
      }
    }
  }
  const result = { fingerprint: sourceFingerprint(root), byCode }
  const file = indexFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringify(result))
  return result
}

export function readRequirementIndex(root) {
  const file = indexFile(root)
  if (fs.existsSync(file)) {
    const cached = parse(fs.readFileSync(file, 'utf8'), '需求索引')
    if (cached.fingerprint === sourceFingerprint(root)) return cached
  }
  return buildRequirementIndex(root)
}

export function linkedVersions(root, code) {
  return (readRequirementIndex(root).byCode[assertRequirementCode(code)] || [])
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export function deriveRequirementStatus(root, code) {
  const versions = linkedVersions(root, code)
  if (!versions.length) return 'not_started'
  if (versions.every((item) => !item.isBaseline)) return 'designing'
  const projects = [...new Set(versions.map((item) => item.project))]
  const delivered = projects.every((project) => versions.some((item) => item.project === project && item.isBaseline && item.reviewStatus === 'confirmed'))
  return delivered ? 'delivered' : 'finalized'
}

export function requirementDetail(root, code) {
  const item = readRequirement(root, code)
  const versions = linkedVersions(root, code)
  return { ...item, derivedStatus: item.statusOverride || deriveRequirementStatus(root, code), manualStatus: !!item.statusOverride, versions }
}

export function listRequirements(root) {
  return listRequirementCodes(root).map((code) => requirementDetail(root, code))
}
