import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { REPO_FILE, SCHEMA_VERSION } from './repo.js'
import { createRequirement, requirementExists } from './requirements.js'

function backupRoot(root, stamp) {
  return path.join(root, '.flowlark', 'backup', `schema-1-${stamp.replace(/[:.]/g, '-')}`)
}

function trackedDirty(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return []
  try {
    // 尚无首次提交时没有可混淆的历史基线；迁移备份本身就是回退点。
    // 已有 HEAD 的仓库仍严格要求 Flowlark 路径干净。
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root, stdio: ['ignore', 'ignore', 'ignore']
    })
    return execFileSync('git', ['status', '--porcelain', '--', REPO_FILE, 'projects', 'requirements'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).trim().split('\n').filter(Boolean)
  } catch { return [] }
}

export function preflightMigration(root) {
  const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
  const dirty = trackedDirty(root)
  return { from: Number(config.schemaVersion || 1), to: SCHEMA_VERSION, needed: Number(config.schemaVersion || 1) < SCHEMA_VERSION, dirty }
}

function copyMetadata(root, backup) {
  fs.mkdirSync(backup, { recursive: true })
  fs.copyFileSync(path.join(root, REPO_FILE), path.join(backup, REPO_FILE))
  for (const slug of store.listProjectSlugs(root)) {
    for (const no of store.listVersionNos(root, slug)) {
      const source = store.paths.versionJson(root, slug, no)
      const target = path.join(backup, 'projects', slug, 'versions', `${no}.json`)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
    }
  }
}

export function migrateToSchema2(root) {
  const check = preflightMigration(root)
  if (!check.needed) return { migrated: false, from: check.from, to: check.to, requirementCount: 0, conflicts: [] }
  if (check.dirty.length) throw err.conflict('MIGRATION_DIRTY', '迁移前 Git 工作区必须干净', '先提交或暂存 flowlark.json、projects、requirements 的改动')
  const now = new Date().toISOString()
  const backup = backupRoot(root, now)
  copyMetadata(root, backup)
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
          if (previous && previous.title !== item.title) conflicts.push({ code: item.code, previous: previous.title, selected: item.title, project: slug, versionNo: no })
          collected.set(item.code, { ...item, createdAt: version.createdAt })
          links.push(item.code)
        }
        version.requirements = [...new Set(links)]
        version.reviewStatus = version.reviewStatus || 'pending'
        store.writeVersion(root, slug, version)
      }
    }
    fs.rmSync(store.paths.requirements(root), { recursive: true, force: true })
    for (const item of collected.values()) {
      if (!requirementExists(root, item.code)) createRequirement(root, { code: item.code, title: item.title || item.code, url: item.url || '' }, item.createdAt || now)
    }
    const config = parse(fs.readFileSync(path.join(root, REPO_FILE), 'utf8'), REPO_FILE)
    config.schemaVersion = SCHEMA_VERSION
    fs.writeFileSync(path.join(root, REPO_FILE), stringify(config, 'repo'))
    return { migrated: true, from: check.from, to: SCHEMA_VERSION, requirementCount: collected.size, conflicts, backup }
  } catch (e) {
    rollbackMigration(root, backup)
    throw e
  }
}

export function rollbackMigration(root, backup) {
  const source = backup || fs.readdirSync(path.join(root, '.flowlark', 'backup'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('schema-1-')).map((entry) => path.join(root, '.flowlark', 'backup', entry.name)).sort().at(-1)
  if (!source || !fs.existsSync(path.join(source, REPO_FILE))) throw err.notFound('Schema 1 迁移备份')
  fs.copyFileSync(path.join(source, REPO_FILE), path.join(root, REPO_FILE))
  const projects = path.join(source, 'projects')
  if (fs.existsSync(projects)) {
    for (const slug of fs.readdirSync(projects)) {
      const versions = path.join(projects, slug, 'versions')
      for (const file of fs.readdirSync(versions)) fs.copyFileSync(path.join(versions, file), path.join(root, 'projects', slug, 'versions', file))
    }
  }
  fs.rmSync(store.paths.requirements(root), { recursive: true, force: true })
  return { rolledBack: true, backup: source }
}
