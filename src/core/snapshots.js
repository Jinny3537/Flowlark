import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { currentUser } from './repo.js'
import { readMilestone } from './milestones.js'
import { readRequirement } from './requirements.js'
import { zipFiles } from './snapshot-zip.js'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PURPOSES = new Set(['review', 'development', 'acceptance'])
function safeName(name) {
  const value = String(name || '').trim()
  if (!NAME_RE.test(value)) throw err.bad('SNAPSHOT_NAME_INVALID', `快照标识「${value}」不合法`)
  return value
}
const digest = data => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`
const assetsDir = (root, name) => path.join(store.paths.snapshots(root), `${safeName(name)}.files`)
export function snapshotExists(root, name) { return fs.existsSync(store.paths.snapshotFile(root, safeName(name))) }
export function readSnapshot(root, name) {
  const safe = safeName(name), file = store.paths.snapshotFile(root, safe)
  if (!fs.existsSync(file)) throw err.notFound(`交付快照「${safe}」`)
  return parse(fs.readFileSync(file, 'utf8'), `${safe}.json`)
}
export function listSnapshots(root) {
  const dir = store.paths.snapshots(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readSnapshot(root, f.slice(0, -5)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function inspectSnapshotInput(root, input = {}) {
  const source = input.milestone ? readMilestone(root, input.milestone).items : (input.items || [])
  if (!Array.isArray(source)) throw err.bad('SNAPSHOT_ITEMS_INVALID', '交付范围必须是版本清单')
  const blockers = [], warnings = [], seen = new Set()
  if (!source.length) blockers.push({ code: 'EMPTY_SCOPE', message: '请先在来源迭代中添加交付版本' })
  const items = source.map(raw => {
    const item = { requirement: String(raw?.requirement || ''), project: String(raw?.project || ''), version: String(raw?.version || raw?.versionNo || '') }
    const add = (list, code, message) => list.push({ ...item, code, message })
    let version
    try {
      if (!store.SLUG_RE.test(item.project)) throw new Error('project')
      store.assertVersionNo(item.version)
      version = store.readVersion(root, item.project, item.version)
    } catch {
      add(blockers, 'VERSION_MISSING', `${item.project}/${item.version} 不存在或标识不合法`)
      return item
    }
    const key = JSON.stringify(item)
    if (seen.has(key)) add(blockers, 'DUPLICATE_ITEM', `${item.project}/${item.version} 的需求映射重复`)
    seen.add(key)
    if (version.status === 'VOID') add(blockers, 'VERSION_VOID', `${item.project}/${item.version} 已废弃`)
    if (version.reviewStatus !== 'confirmed') add(blockers, 'REVIEW_NOT_CONFIRMED', `${item.project}/${item.version} 尚未确认`)
    if (!store.readHtml(root, item.project, item.version)?.length) add(blockers, 'HTML_MISSING', `${item.project}/${item.version} 原型文件缺失`)
    const spec = store.readSpec(root, item.project, item.version)
    if (!spec?.trim()) add(warnings, 'SPEC_MISSING', `${item.project}/${item.version} 未填写技术规格书，可到版本工作台补充`)
    const attachmentCount = store.listAttachmentFiles(root, item.project, item.version).length
    for (const attachment of version.attachments) {
      if (!store.readAttachment(root, item.project, item.version, attachment.name)) add(blockers, 'ATTACHMENT_MISSING', `${attachment.name} 文件缺失`)
    }
    let requirementTitle = ''
    if (item.requirement) {
      try { requirementTitle = readRequirement(root, item.requirement).title }
      catch { add(blockers, 'REQUIREMENT_MISSING', `需求 ${item.requirement} 不存在或标识不合法`) }
    } else add(warnings, 'REQUIREMENT_UNLINKED', `${item.project}/${item.version} 尚未关联需求`)
    return { ...item, title: version.title, requirementTitle, hasSpec: Boolean(spec?.trim()), attachmentCount, reviewStatus: version.reviewStatus }
  })
  return { items, blockers, warnings, ready: blockers.length === 0 }
}

// Freeze the bytes, not references to live files. JSON is published last.
export function createSnapshot(root, input = {}) {
  const name = safeName(input.name)
  if (snapshotExists(root, name)) throw err.conflict('SNAPSHOT_EXISTS', `交付快照「${name}」已存在`)
  const purpose = input.purpose || 'development'
  if (!PURPOSES.has(purpose)) throw err.bad('SNAPSHOT_PURPOSE_INVALID', '请选择评审、研发交接或验收归档')
  if (input.supersedes) readSnapshot(root, input.supersedes)
  const check = inspectSnapshotInput(root, input)
  if (!check.ready) throw err.conflict('SNAPSHOT_BLOCKED', `快照存在 ${check.blockers.length} 个阻塞项`, check.blockers.map(x => x.message).join('；'))
  const parent = store.paths.snapshots(root)
  fs.mkdirSync(parent, { recursive: true })
  const temp = fs.mkdtempSync(path.join(parent, '.freeze-'))
  const files = [], versions = [], requirements = [], seenVersions = new Set(), seenRequirements = new Set()
  let installed = false
  const write = (relative, data, kind, context = {}) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const file = path.join(temp, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
    files.push({ path: relative, kind, size: bytes.length, sha256: digest(bytes), ...context })
  }
  const copyAttachments = (dir, prefix, context) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) throw err.bad('SNAPSHOT_ATTACHMENT_INVALID', `附件 ${entry.name} 不是普通文件，请检查后重试`)
      write(`${prefix}/${entry.name}`, fs.readFileSync(path.join(dir, entry.name)), 'attachment', context)
    }
  }
  try {
    for (const item of check.items) {
      const key = `${item.project}/${item.version}`
      if (!seenVersions.has(key)) {
        seenVersions.add(key)
        const version = store.readVersion(root, item.project, item.version)
        const context = { project: item.project, version: item.version }
        const prefix = `versions/${key}`
        versions.push({ ...context, title: version.title, changes: version.changes, reviewStatus: version.reviewStatus })
        write(`${prefix}/prototype.html`, store.readHtml(root, item.project, item.version), 'prototype', context)
        const spec = store.readSpec(root, item.project, item.version)
        if (spec) write(`${prefix}/spec.md`, spec, 'spec', context)
        write(`${prefix}/version.json`, stringify(version, 'version'), 'metadata', context)
        copyAttachments(store.paths.attachments(root, item.project, item.version), `${prefix}/attachments`, context)
      }
      if (item.requirement && !seenRequirements.has(item.requirement)) {
        seenRequirements.add(item.requirement)
        const requirement = readRequirement(root, item.requirement)
        requirements.push(requirement)
        const prefix = `requirements/${item.requirement}`, context = { requirement: item.requirement }
        write(`${prefix}/requirement.json`, stringify(requirement, 'requirement'), 'requirement', context)
        const specPath = store.paths.requirementSpec(root, item.requirement)
        if (fs.existsSync(specPath)) write(`${prefix}/spec.md`, fs.readFileSync(specPath), 'requirement', context)
        copyAttachments(store.paths.requirementFiles(root, item.requirement), `${prefix}/attachments`, context)
      }
    }
    const snapshot = {
      schemaVersion: 2, name, title: String(input.title || name), milestone: input.milestone || null,
      purpose, audience: String(input.audience || ''), summary: String(input.summary || ''),
      acceptance: String(input.acceptance || ''), risks: String(input.risks || ''), supersedes: input.supersedes || null,
      items: check.items, requirements, versions, warnings: check.warnings, files,
      changesDigest: digest(JSON.stringify(versions.map(v => ({ project: v.project, version: v.version, changes: v.changes })))),
      contentDigest: digest(JSON.stringify(files)), createdAt: new Date().toISOString(), createdBy: currentUser(),
    }
    // Reserve the final asset directory exclusively; never replace another delivery.
    fs.mkdirSync(assetsDir(root, name))
    installed = true
    for (const entry of fs.readdirSync(temp)) fs.renameSync(path.join(temp, entry), path.join(assetsDir(root, name), entry))
    const metadata = path.join(temp, 'snapshot.json')
    fs.writeFileSync(metadata, stringify(snapshot, 'snapshot'))
    fs.linkSync(metadata, store.paths.snapshotFile(root, name))
    return snapshot
  } catch (error) {
    if (installed && !snapshotExists(root, name)) fs.rmSync(assetsDir(root, name), { recursive: true, force: true })
    throw error
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}

export function readSnapshotFile(root, name, relative) {
  const snapshot = readSnapshot(root, name)
  const entry = snapshot.files?.find(item => item.path === relative)
  const base = assetsDir(root, name), file = path.resolve(base, relative)
  if (!entry || !file.startsWith(path.resolve(base) + path.sep)) throw err.notFound('交付材料')
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep)) throw err.notFound('交付材料文件')
  const bytes = fs.readFileSync(file)
  if (digest(bytes) !== entry.sha256) throw err.conflict('SNAPSHOT_INTEGRITY_FAILED', '交付材料校验失败，请从 Git 恢复原始文件')
  return bytes
}

export function downloadSnapshot(root, name) {
  const snapshot = readSnapshot(root, name)
  if (snapshot.schemaVersion !== 2) throw err.conflict('SNAPSHOT_LEGACY', '旧快照只有版本引用，无法还原当时材料；请新建交付包')
  const files = snapshot.files.map(file => ({ name: file.path, bytes: readSnapshotFile(root, name, file.path) }))
  const guide = `# ${snapshot.title}\n\n交付标识：${name}\n创建时间：${snapshot.createdAt}\n交付对象：${snapshot.audience || '未填写'}\n\n## 交付说明\n${snapshot.summary || '未填写'}\n\n## 阅读顺序\n1. requirements：需求信息及需求附件\n2. versions：原型、技术规格书、版本信息和附件\n3. manifest.json：完整范围及文件 SHA-256\n\n## 验收口径\n${snapshot.acceptance || '未填写，请与产品确认'}\n\n## 风险与待确认\n${snapshot.risks || '未填写'}\n\n## 材料提示\n${snapshot.warnings.map(w => `- ${w.message}`).join('\n') || '无'}\n\n原型保留原始 HTML，外部 CDN、接口及链接未被离线化，使用时可能需要网络。外部在线文档仅保留原有链接，不代表正文已冻结。技术文件由原作者维护，文件存在不代表内容已通过验收。\n`
  files.push({ name: 'README.md', bytes: Buffer.from(guide) }, { name: 'manifest.json', bytes: Buffer.from(stringify(snapshot, 'snapshot')) })
  return zipFiles(files)
}
