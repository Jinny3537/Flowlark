import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { REPO_FILE, SCHEMA_VERSION } from './repo.js'
import {
  createRequirement,
  deriveRequirementStatus,
  listRequirementCodes,
  readRequirement,
  requirementExists
} from './requirements.js'
import {
  createMetadataBackup,
  restoreMetadataBackup,
  validateMetadataBackup
} from './metadata-backup.js'
import { normalizeSyncPolicy } from './sync-policy.js'
import { REQUIREMENT_STATUSES } from './requirement-lifecycle.js'
import { aggregateAcceptance, normalizeAcceptanceRules } from './acceptance-rules.js'
import { readDeliverySnapshot } from './delivery-snapshots.js'

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
const MIGRATION_TOP_LEVEL_FILES = [REPO_FILE, '.gitignore', '.gitattributes']

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
  assertMigrationTopLevelFilesAreNotSymlinks(root)
  assertRequirementPathsAreNotSymlinks(root)
  assertMigrationMetadataPaths(root)
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

function assertMigrationTopLevelFilesAreNotSymlinks(root) {
  for (const relative of MIGRATION_TOP_LEVEL_FILES) {
    try {
      if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) {
        throw err.conflict(
          'MIGRATION_TOP_LEVEL_SYMLINK',
          '迁移拒绝读取或写入符号链接：' + relative,
          '请将 ' + relative + ' 替换为普通文件后重试'
        )
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function requirementSymlinkError(relative) {
  return err.conflict(
    'MIGRATION_REQUIREMENT_SYMLINK',
    '迁移拒绝读取或写入符号链接：' + relative,
    '请将 ' + relative + ' 替换为普通目录后重试'
  )
}

function assertRequirementPathsAreNotSymlinks(root) {
  const requirements = store.paths.requirements(root)
  try {
    const stat = fs.lstatSync(requirements)
    if (stat.isSymbolicLink()) throw requirementSymlinkError('requirements/')
    if (!stat.isDirectory()) return
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of fs.readdirSync(requirements, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw requirementSymlinkError(`requirements/${entry.name}/`)
    }
    if (entry.isDirectory()) {
      const relative = `requirements/${entry.name}/requirement.json`
      try {
        if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) throw requirementSymlinkError(relative)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}

function migrationPathStat(root, relative) {
  try {
    const stat = fs.lstatSync(path.join(root, relative))
    if (stat.isSymbolicLink()) {
      throw err.conflict('MIGRATION_METADATA_SYMLINK', `迁移拒绝读取或写入符号链接：${relative}`)
    }
    return stat
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function migrationJsonFiles(root, relative, recursive = false) {
  const stat = migrationPathStat(root, relative)
  if (!stat) return []
  if (!stat.isDirectory()) throw err.bad('MIGRATION_METADATA_INVALID', `${relative} 必须是普通目录`)
  const files = []
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`
    if (entry.isSymbolicLink()) migrationPathStat(root, child)
    if (entry.isDirectory() && recursive) files.push(...migrationJsonFiles(root, child, true))
    if (entry.name.endsWith('.json')) {
      if (!entry.isFile()) throw err.bad('MIGRATION_METADATA_INVALID', `${child} 必须是普通文件`)
      files.push(child)
    }
  }
  return files.sort()
}

function assertMigrationMetadataPaths(root) {
  const projects = migrationPathStat(root, 'projects')
  if (projects && !projects.isDirectory()) throw err.bad('MIGRATION_METADATA_INVALID', 'projects 必须是普通目录')
  if (projects) {
    for (const entry of fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true })) {
      const relative = `projects/${entry.name}`
      if (entry.isSymbolicLink()) migrationPathStat(root, relative)
      if (!entry.isDirectory()) continue
      const file = migrationPathStat(root, `${relative}/project.json`)
      if (file && !file.isFile()) throw err.bad('MIGRATION_METADATA_INVALID', `${relative}/project.json 必须是普通文件`)
      migrationJsonFiles(root, `${relative}/versions`)
    }
  }
  migrationJsonFiles(root, 'milestones')
  migrationJsonFiles(root, 'snapshots')
  migrationJsonFiles(root, 'acceptances', true)
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

const LEGACY_REQUIREMENT_STATUS = new Map([
  ['not_started', 'draft'],
  ['designing', 'draft'],
  ['finalized', 'confirmed'],
  ['delivered', 'confirmed']
])

function schema4Requirement(root, code, now) {
  const file = store.paths.requirementFile(root, code)
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw err.conflict(
      'MIGRATION_REQUIREMENT_SYMLINK',
      `迁移拒绝读取或写入符号链接：requirements/${code}/requirement.json`
    )
  }
  const item = parse(fs.readFileSync(file, 'utf8'), `${code}/requirement.json`)
  if (item.statusOverride != null) {
    migrateLegacyRequirementStatus(item, code, item.statusOverride, now)
  } else if (Object.hasOwn(item, 'status')) {
    if (!REQUIREMENT_STATUSES.has(item.status)) {
      throw invalidRequirementStatus(code, item.status)
    }
  } else {
    migrateLegacyRequirementStatus(item, code, deriveRequirementStatus(root, code), now)
  }
  delete item.statusOverride
  return { file, item }
}

function invalidRequirementStatus(code, status) {
  return err.bad(
    'MIGRATION_REQUIREMENT_STATUS_INVALID',
    `需求 ${code} 的旧状态「${status}」无法迁移到 Schema 4`
  )
}

function migrateLegacyRequirementStatus(item, code, legacy, now) {
  const status = LEGACY_REQUIREMENT_STATUS.get(legacy)
  if (!status) {
    throw invalidRequirementStatus(code, legacy)
  }
  item.status = status
  item.statusChangedAt = now
  item.statusChangedBy = 'migration:schema4'
  item.statusReason = `legacy-derived:${legacy}`
}

function validateSchema4Requirements(root) {
  const bindings = new Map()
  for (const code of listRequirementCodes(root)) {
    const item = readRequirement(root, code)
    for (const binding of item.externalTasks) {
      const key = JSON.stringify([
        binding.provider,
        binding.server,
        binding.projectId,
        binding.taskId
      ])
      const previous = bindings.get(key)
      if (previous) {
        throw err.bad(
          'MIGRATION_EXTERNAL_TASK_DUPLICATE',
          `需求 ${previous} 与 ${code} 重复绑定同一个外部任务`
        )
      }
      bindings.set(key, code)
    }
  }
}

export function migrateToSchema4(root, options = {}) {
  const check = preflightMigration(root)
  if (check.from >= 4) return { migrated: false, from: check.from, to: 4 }
  if (check.from < 3) throw err.bad('MIGRATION_ORDER_INVALID', 'Schema 4 迁移必须先完成 Schema 3 迁移')
  if (!options[SKIP_DIRTY_CHECK]) assertClean(check)

  const now = new Date().toISOString()
  const backup = createMetadataBackup(root, { from: 3, to: 4, now: new Date(now) })
  try {
    const requirements = listRequirementCodes(root).map((code) => schema4Requirement(root, code, now))
    for (const { file, item } of requirements) {
      fs.writeFileSync(file, stringify(item, 'requirement'), 'utf8')
    }

    options.afterRequirementWrite?.()
    validateSchema4Requirements(root)

    const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
    config.schemaVersion = 4
    fs.writeFileSync(path.join(root, REPO_FILE), stringify(config, 'repo'))
    return { migrated: true, from: check.from, to: 4, requirementCount: requirements.length, backup }
  } catch (error) {
    restoreMetadataBackup(root, backup)
    throw error
  }
}

function migrationMetadata(root, relative) {
  const value = parse(fs.readFileSync(path.join(root, relative), 'utf8'), relative)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw err.bad('MIGRATION_METADATA_INVALID', `${relative} 必须包含元数据对象`)
  }
  return value
}

function schema5Metadata(root) {
  const writes = []
  const snapshots = new Map()
  for (const relative of migrationJsonFiles(root, 'snapshots')) {
    const snapshot = migrationMetadata(root, relative)
    const name = path.basename(relative, '.json')
    if (snapshot.kind === undefined) {
      snapshot.kind = 'legacy'
      writes.push({ relative, value: snapshot, schema: 'snapshot' })
    } else if (!['legacy', 'delivery'].includes(snapshot.kind)) {
      throw err.bad('MIGRATION_SNAPSHOT_KIND_INVALID', `${relative} 的快照类型不合法`)
    }
    if (snapshot.kind === 'delivery') {
      if (!Object.hasOwn(snapshot, 'acceptance')) {
        throw err.bad('MIGRATION_DELIVERY_RULES_MISSING', `${relative} 缺少冻结验收规则`)
      }
      readDeliverySnapshot(root, name)
    }
    snapshots.set(name, snapshot)
  }
  for (const slug of store.listProjectSlugs(root)) {
    const relative = `projects/${slug}/project.json`
    const project = migrationMetadata(root, relative)
    project.acceptance = normalizeAcceptanceRules(project.acceptance)
    writes.push({ relative, value: project, schema: 'project' })
  }
  for (const relative of migrationJsonFiles(root, 'milestones')) {
    const milestone = migrationMetadata(root, relative)
    const name = path.basename(relative, '.json')
    if (milestone.deliveries === undefined) milestone.deliveries = []
    if (!Array.isArray(milestone.deliveries)) {
      throw err.bad('MIGRATION_DELIVERIES_INVALID', `${relative} 的交付引用必须是数组`)
    }
    const scopes = new Set()
    for (const delivery of milestone.deliveries) {
      if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery) ||
          typeof delivery.project !== 'string' || !store.SLUG_RE.test(delivery.project) ||
          typeof delivery.version !== 'string' || !store.VERSION_NO_RE.test(delivery.version) ||
          typeof delivery.snapshot !== 'string' || !/^delivery-[a-f0-9]{48}$/.test(delivery.snapshot) ||
          (delivery.releaseRunId !== undefined && (typeof delivery.releaseRunId !== 'string' || !delivery.releaseRunId.trim()))) {
        throw err.bad('MIGRATION_DELIVERIES_INVALID', `${relative} 包含无效的交付引用`)
      }
      const snapshot = snapshots.get(delivery.snapshot)
      const scope = `${delivery.project}/${delivery.version}`
      if (scopes.has(scope) || snapshot?.kind !== 'delivery' || snapshot.milestone !== name ||
          snapshot.project !== delivery.project || snapshot.version !== delivery.version) {
        throw err.bad('MIGRATION_DELIVERY_REFERENCE_INVALID', `${relative} 的交付引用重复、缺失或与快照不一致`)
      }
      scopes.add(scope)
    }
    writes.push({ relative, value: milestone, schema: 'milestone' })
  }
  for (const relative of migrationJsonFiles(root, 'acceptances', true)) {
    const parts = relative.split('/')
    // Nested feedback metadata has a separate contract; only direct decisions belong here.
    if (parts.length !== 3) continue
    const record = migrationMetadata(root, relative)
    const snapshot = snapshots.get(parts[1])
    if (snapshot?.kind !== 'delivery' || record.snapshot !== parts[1] ||
        record.id !== path.basename(parts[2], '.json') || record.snapshotHash !== snapshot.contentHash) {
      throw err.bad('MIGRATION_ACCEPTANCE_REFERENCE_INVALID', `${relative} 的验收记录与交付快照不一致`)
    }
    aggregateAcceptance(snapshot.acceptance, [record])
  }
  return writes
}

export function migrateToSchema5(root, options = {}) {
  const check = preflightMigration(root)
  if (check.from >= 5) return { migrated: false, from: check.from, to: 5 }
  if (check.from < 4) throw err.bad('MIGRATION_ORDER_INVALID', 'Schema 5 迁移必须先完成 Schema 4 迁移')
  if (!options[SKIP_DIRTY_CHECK]) assertClean(check)
  const backup = createMetadataBackup(root, { from: 4, to: 5 })
  try {
    const writes = schema5Metadata(root)
    for (const { relative, value, schema } of writes) {
      fs.writeFileSync(path.join(root, relative), stringify(value, schema), 'utf8')
    }
    options.afterSchema5Write?.()
    assertMigrationTopLevelFilesAreNotSymlinks(root)
    assertRequirementPathsAreNotSymlinks(root)
    assertMigrationMetadataPaths(root)
    for (const { relative, value, schema } of schema5Metadata(root)) {
      if (fs.readFileSync(path.join(root, relative), 'utf8') !== stringify(value, schema)) {
        throw err.bad('MIGRATION_SCHEMA5_INCOMPLETE', `${relative} 的 Schema 5 字段未完整写入`)
      }
    }
    const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
    config.schemaVersion = 5
    fs.writeFileSync(path.join(root, REPO_FILE), stringify(config, 'repo'))
    return { migrated: true, from: check.from, to: 5, projectCount: store.listProjectSlugs(root).length, backup }
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
    if (from < 3) {
      const report = migrateToSchema3(root, { ...options, [SKIP_DIRTY_CHECK]: reports.length > 0 })
      reports.push(report)
      initialBackup ||= report.backup
      from = 3
    }
    if (from < 4) {
      const report = migrateToSchema4(root, { ...options, [SKIP_DIRTY_CHECK]: reports.length > 0 })
      reports.push(report)
      initialBackup ||= report.backup
      from = 4
    }
    if (from < 5) {
      const report = migrateToSchema5(root, { ...options, [SKIP_DIRTY_CHECK]: reports.length > 0 })
      reports.push(report)
      initialBackup ||= report.backup
      from = 5
    }
    return { migrated: reports.some((item) => item.migrated), from: reports[0]?.from ?? from, to: from, reports }
  } catch (error) {
    if (initialBackup) restoreMetadataBackup(root, initialBackup)
    throw error
  }
}

export function rollbackMigration(root, backup) {
  let source = backup
  if (!source) {
    const base = path.join(root, '.flowlark', 'backup')
    const candidates = []
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const candidate = path.join(base, entry.name)
        try {
          const manifest = validateMetadataBackup(root, candidate)
          const createdAt = Date.parse(manifest.createdAt)
          if (Number.isFinite(createdAt)) candidates.push({ source: candidate, createdAt })
        } catch {
          // Invalid or incomplete backups are not rollback candidates.
        }
      }
    }
    source = candidates
      .sort((a, b) => a.createdAt - b.createdAt || a.source.localeCompare(b.source))
      .at(-1)?.source
  }
  if (!source) throw err.notFound('有效的迁移备份')
  restoreMetadataBackup(root, source)
  return { rolledBack: true, backup: source }
}
