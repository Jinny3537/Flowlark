import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { stringify } from './json.js'
import { currentUser } from './repo.js'
import { assertMilestoneName } from './milestones.js'
import { assertRequirementCode } from './requirements.js'
import { assertVersionNo, SLUG_RE } from './store.js'
import { normalizeAcceptanceRules } from './acceptance-rules.js'

const SNAPSHOT_NAME = /^delivery-[a-f0-9]{48}$/
const MAX_MATERIAL_BYTES = 50 * 1024 * 1024

// A release snapshot captures committed bytes, not mutable working-tree files.
export function createDeliverySnapshot(root, { milestone, project, version, releaseCommit } = {}) {
  assertMilestoneName(milestone)
  if (!SLUG_RE.test(String(project || ''))) throw err.bad('DELIVERY_PROJECT_INVALID', '交付项目标识不合法')
  assertVersionNo(version)
  if (!/^[a-f0-9]{40,64}$/.test(String(releaseCommit || ''))) {
    throw err.bad('DELIVERY_COMMIT_REQUIRED', '交付快照必须关联完整 Git 提交 ID')
  }
  const commit = git(root, ['rev-parse', '--verify', `${releaseCommit}^{commit}`]).toString().trim()
  const identity = { milestone, project, version, releaseCommit: commit }
  const name = `delivery-${digest(stringify(identity)).slice(0, 48)}`
  const file = snapshotFile(root, name, true)
  if (fs.existsSync(file)) return readDeliverySnapshot(root, name)

  const read = (relative) => committedFile(root, commit, relative)
  const json = (relative) => JSON.parse(read(relative).toString('utf8'))
  const iteration = json(`milestones/${milestone}.json`)
  if (iteration.status !== 'active') throw err.conflict('DELIVERY_MILESTONE_NOT_ACTIVE', '只有进行中的迭代可以正式交付')
  const items = (iteration.items || []).filter((item) => item.project === project && item.version === version)
  if (!items.length) throw err.conflict('DELIVERY_SCOPE_MISMATCH', '项目版本不在已提交的迭代范围中')
  const projectData = json(`projects/${project}/project.json`)
  const versionData = json(`projects/${project}/versions/${version}.json`)
  const baseline = read(`projects/${project}/BASELINE`).toString().trim()
  if (baseline !== version || versionData.status === 'VOID' || versionData.reviewStatus !== 'confirmed') {
    throw err.conflict('DELIVERY_VERSION_NOT_READY', '交付版本必须是已确认的当前基线')
  }
  const specification = read(`projects/${project}/versions/${version}.spec.md`).toString('utf8')
  if (!specification.trim()) throw err.conflict('DELIVERY_SPEC_REQUIRED', '正式交付必须包含版本规格书')
  const requirements = [...new Set(items.map((item) => item.requirement))].sort().map((code) => {
    assertRequirementCode(code)
    const item = json(`requirements/${code}/requirement.json`)
    const spec = read(`requirements/${code}/spec.md`).toString('utf8')
    if (!spec.trim()) throw err.conflict('DELIVERY_REQUIREMENT_SPEC_REQUIRED', `需求 ${code} 缺少验收规格`)
    return { ...item, spec }
  })
  const materialPaths = [`projects/${project}/versions/${version}.html`]
  const attachmentNames = new Set()
  for (const attachment of versionData.attachments || []) {
    const name = attachment.name
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name) || attachmentNames.has(name)) {
      throw err.bad('DELIVERY_ATTACHMENT_INVALID', '交付附件名称无效或重复')
    }
    attachmentNames.add(name)
    materialPaths.push(`projects/${project}/versions/${version}.files/${name}`)
  }
  const materials = materialPaths.sort().map((relative) => {
    const bytes = read(relative)
    return { path: relative, size: bytes.length, sha256: digest(bytes), encoding: 'base64', content: bytes.toString('base64') }
  })
  const payload = {
    kind: 'delivery', schemaVersion: 1, name, title: `${iteration.title || milestone} · ${projectData.name || project} / ${version}`,
    ...identity, items, specification, changes: versionData.changes || [], requirements,
    acceptance: normalizeAcceptanceRules(projectData.acceptance), materials,
    createdAt: new Date().toISOString(), createdBy: currentUser()
  }
  const snapshot = { ...payload, contentHash: `sha256:${digest(stringify(payload))}` }
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, stringify(snapshot), { flag: 'wx', mode: 0o600 })
    // Publish atomically without ever replacing an existing snapshot.
    try { fs.linkSync(temporary, file) } catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return readDeliverySnapshot(root, name)
}

export function readDeliverySnapshot(root, name) {
  const file = snapshotFile(root, name)
  if (!fs.existsSync(file)) throw err.notFound(`交付快照 ${name}`)
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
  assertSnapshotIntegrity(snapshot, name)
  return snapshot
}

export function verifyDeliverySnapshot(root, name) {
  const snapshot = readDeliverySnapshot(root, name)
  return { ready: true, name, contentHash: snapshot.contentHash, materialCount: snapshot.materials.length }
}

function assertSnapshotIntegrity(snapshot, name) {
  const { contentHash, ...payload } = snapshot
  const identity = { milestone: snapshot.milestone, project: snapshot.project, version: snapshot.version, releaseCommit: snapshot.releaseCommit }
  if (snapshot.kind !== 'delivery' || snapshot.schemaVersion !== 1 || snapshot.name !== name ||
      name !== `delivery-${digest(stringify(identity)).slice(0, 48)}` ||
      contentHash !== `sha256:${digest(stringify(payload))}` || !Array.isArray(snapshot.materials) || !snapshot.materials.length) {
    throw err.conflict('DELIVERY_INTEGRITY_FAILED', '交付快照内容或身份校验失败')
  }
  normalizeAcceptanceRules(snapshot.acceptance)
  if (!Array.isArray(snapshot.items) || !snapshot.items.length || !Array.isArray(snapshot.requirements) ||
      typeof snapshot.specification !== 'string' || !snapshot.specification.trim() || !Array.isArray(snapshot.changes) ||
      snapshot.items.some((item) => item.project !== snapshot.project || item.version !== snapshot.version ||
        !snapshot.requirements.some((requirement) => requirement.code === item.requirement && typeof requirement.spec === 'string' && requirement.spec.trim()))) {
    throw err.conflict('DELIVERY_INTEGRITY_FAILED', '交付快照缺少范围或验收规格')
  }
  const materialPaths = new Set()
  for (const material of snapshot.materials) {
    const bytes = Buffer.from(String(material.content || ''), 'base64')
    if (typeof material.path !== 'string' || materialPaths.has(material.path) ||
        material.encoding !== 'base64' || bytes.toString('base64') !== material.content || bytes.length !== material.size || digest(bytes) !== material.sha256) {
      throw err.conflict('DELIVERY_INTEGRITY_FAILED', '交付材料摘要校验失败')
    }
    materialPaths.add(material.path)
  }
  if (!materialPaths.has(`projects/${snapshot.project}/versions/${snapshot.version}.html`)) {
    throw err.conflict('DELIVERY_INTEGRITY_FAILED', '交付快照缺少原型材料')
  }
}

function snapshotFile(root, name, create = false) {
  if (!SNAPSHOT_NAME.test(String(name || ''))) throw err.bad('DELIVERY_NAME_INVALID', '正式交付快照标识不合法')
  const directory = path.join(root, 'snapshots')
  if (create && !fs.existsSync(directory)) fs.mkdirSync(directory)
  for (const target of [directory, path.join(directory, `${name}.json`)]) {
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (target === directory ? !stat.isDirectory() : !stat.isFile())) {
        throw err.conflict('DELIVERY_PATH_INVALID', '交付快照必须使用普通文件与目录')
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return path.join(directory, `${name}.json`)
}

function committedFile(root, commit, relative) {
  const entry = git(root, ['ls-tree', '-z', commit, '--', relative]).toString('utf8')
  if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(entry)) {
    throw err.conflict('DELIVERY_MATERIAL_MISSING', `提交中的交付材料缺失或不是普通文件：${relative}`)
  }
  const objectId = entry.split('\t')[0].split(' ')[2]
  return git(root, ['cat-file', 'blob', objectId])
}

function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, maxBuffer: MAX_MATERIAL_BYTES, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { throw err.conflict('DELIVERY_COMMIT_UNAVAILABLE', '无法读取正式发版 Git 提交或材料超过大小限制') }
}

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex') }
