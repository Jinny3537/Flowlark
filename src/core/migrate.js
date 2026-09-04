import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { REPO_FILE, SCHEMA_VERSION } from './repo.js'
import { createRequirement, requirementExists } from './requirements.js'
import {
  createMetadataBackup,
  restoreMetadataBackup
} from './metadata-backup.js'
import { normalizeSyncPolicy } from './sync-policy.js'

const MIGRATION_TRACKED_PATHS = [
  REPO_FILE,
  'mcp.json',
  '.gitignore',
  '.gitattributes',
  'projects',
  'requirements',
  'milestones',
  'snapshots',
  'acceptances',
  '.flowlark/sync-audit.ndjson'
]
const SKIP_DIRTY_CHECK = Symbol('skipDirtyCheck')

function trackedDirty(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return []
  try {
    // 尚无首次提交时没有可混淆的历史基线；迁移备份本身就是回退点。
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root, stdio: ['ignore', 'ignore', 'ignore']
    })
  } catch {
    return []
  }
  return execFileSync('git', ['status', '--porcelain', '--', ...MIGRATION_TRACKED_PATHS], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).trim().split('\n').filter(Boolean)
}

export function preflightMigration(root) {
  const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
  const from = Number(config.schemaVersion || 1)
  return { from, to: SCHEMA_VERSION, needed: from < SCHEMA_VERSION, dirty: trackedDirty(root) }
}

function assertClean(check) {
  if (check.dirty.length) {
    throw err.conflict('MIGRATION_DIRTY', '迁移前 Git 工作区必须干净', '先提交或暂存 Flowlark 元数据改动')
  }
}

function removeRequirementMetadata(root) {
  const requirements = store.paths.requirements(root)
  if (!fs.existsSync(requirements) || !fs.lstatSync(requirements).isDirectory()) return
  for (const entry of fs.readdirSync(requirements, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const file = path.join(requirements, entry.name, 'requirement.json')
    try {
      const stat = fs.lstatSync(file)
      if (stat.isFile() && !stat.isSymbolicLink()) fs.rmSync(file)
    } catch {
      // This requirement has no metadata file to replace.
    }
  }
}

function ensureLine(file, line) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (content.split(/\r?\n/).includes(line)) return
  if (content && !content.endsWith('\n')) content += '\n'
  fs.writeFileSync(file, `${content}${line}\n`, 'utf8')
}

export function migrateToSchema2(root) {
  const check = preflightMigration(root)
  if (check.from >= 2) {
    return { migrated: false, from: check.from, to: 2, requirementCount: 0, conflicts: [] }
  }
  assertClean(check)
  const now = new Date().toISOString()
  const backup = createMetadataBackup(root, { from: check.from, to: 2, now: new Date(now) })
  const collected = new Map()
  const conflicts = []
  try {
    for (const slug of store.listProjectSlugs(root)) {
      for (const no of store.listVersionNos(root, slug)) {
        const version = store.readVersion(root, slug, no)
        const links = []
        for (const raw of version.requirements || []) {
          const item = typeof raw === 'string' ? { code: raw, title: raw } : raw
          if (!item || !item.code) throw err.bad('MIGRATION_REQUIREMENT_INVALID', `${slug}/${no} 含无法识别的需求数据`)
          const previous = collected.get(item.code)
          if (previous && previous.title !== item.title) {
            conflicts.push({ code: item.code, previous: previous.title, selected: item.title, project: slug, versionNo: no })
          }
          collected.set(item.code, { ...item, createdAt: version.createdAt })
          links.push(item.code)
        }
        version.requirements = [...new Set(links)]
        version.reviewStatus = version.reviewStatus || 'pending'
        store.writeVersion(root, slug, version)
      }
    }
    removeRequirementMetadata(root)
    for (const item of collected.values()) {
      if (!requirementExists(root, item.code)) {
        createRequirement(root, { code: item.code, title: item.title || item.code, url: item.url || '' }, item.createdAt || now)
      }
    }
    const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
    config.schemaVersion = 2
    fs.writeFileSync(path.join(root, REPO_FILE), stringify(config, 'repo'))
    return { migrated: true, from: check.from, to: 2, requirementCount: collected.size, conflicts, backup }
  } catch (error) {
    restoreMetadataBackup(root, backup)
    throw error
  }
}

export function migrateToSchema3(root, options = {}) {
  const check = preflightMigration(root)
  if (check.from >= 3) return { migrated: false, from: check.from, to: 3 }
  if (check.from < 2) throw err.bad('MIGRATION_ORDER_INVALID', 'Schema 3 迁移必须先完成 Schema 2 迁移')
  if (!options[SKIP_DIRTY_CHECK]) assertClean(check)

  const backup = createMetadataBackup(root, { from: 2, to: 3 })
  try {
    for (const slug of store.listProjectSlugs(root)) {
      const project = store.readProject(root, slug)
      project.sync = normalizeSyncPolicy(project.sync)
      store.writeProject(root, slug, project)
    }
    ensureLine(path.join(root, '.gitignore'), '.flowlark/backup/')
    ensureLine(path.join(root, '.gitattributes'), '.flowlark/sync-audit.ndjson merge=union')
    fs.mkdirSync(path.join(root, 'acceptances'), { recursive: true })

    options.afterProjectWrite?.()
    for (const slug of store.listProjectSlugs(root)) {
      const project = store.readProject(root, slug)
      const normalized = normalizeSyncPolicy(project.sync)
      if (stringify(project.sync) !== stringify(normalized)) {
        throw err.bad('MIGRATION_PROJECT_SYNC_INVALID', `${slug}/project.json 的同步策略未规范化`)
      }
    }

    const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
    config.schemaVersion = 3
    fs.writeFileSync(path.join(root, REPO_FILE), stringify(config, 'repo'))
    return { migrated: true, from: check.from, to: 3, projectCount: store.listProjectSlugs(root).length, backup }
  } catch (error) {
    restoreMetadataBackup(root, backup)
    throw error
  }
}

export function migrateToLatest(root, options = {}) {
  let from = preflightMigration(root).from
  const reports = []
  let initialBackup = null
  try {
    if (from < 2) {
      const report = migrateToSchema2(root, options)
      reports.push(report)
      initialBackup = report.backup
      from = 2
    }
    if (from < 3) reports.push(migrateToSchema3(root, { ...options, [SKIP_DIRTY_CHECK]: reports.length > 0 }))
    return { migrated: reports.some((item) => item.migrated), from: reports[0]?.from ?? from, to: 3, reports }
  } catch (error) {
    if (initialBackup) restoreMetadataBackup(root, initialBackup)
    throw error
  }
}

export function rollbackMigration(root, backup) {
  let source = backup
  if (!source) {
    const base = path.join(root, '.flowlark', 'backup')
    source = fs.existsSync(base)
      ? fs.readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('schema-1-'))
          .map((entry) => path.join(base, entry.name)).sort().at(-1)
      : null
  }
  if (!source) throw err.notFound('Schema 1 迁移备份')
  restoreMetadataBackup(root, source)
  return { rolledBack: true, backup: source }
}
