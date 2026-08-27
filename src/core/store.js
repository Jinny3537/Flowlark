import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { stringify, parse } from './json.js'

/**
 * 文件即数据库。这一层只管「怎么读写磁盘」，不含任何业务规则。
 */

/**
 * 版本号既是标识也是文件名，所以必须约束字符集。
 * 这是文件存储换来的代价：早先 SQLite 版本允许任意版本号，
 * 现在不行了 —— 但换来的是 diff 可读、冲突可解，值得。
 */
export const VERSION_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export function assertVersionNo(no) {
  if (!no || !VERSION_NO_RE.test(no)) {
    throw err.bad(
      'VERSION_NO_INVALID',
      `版本号「${no}」不合法`,
      '只允许字母、数字、. _ + -，首字符须为字母或数字，长度 ≤ 32'
    )
  }
}

export function slugify(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || null
}

// ---------- 路径 ----------

export const paths = {
  projects: (root) => path.join(root, 'projects'),
  project: (root, slug) => path.join(root, 'projects', slug),
  projectFile: (root, slug) => path.join(root, 'projects', slug, 'project.json'),
  baselineFile: (root, slug) => path.join(root, 'projects', slug, 'BASELINE'),
  versions: (root, slug) => path.join(root, 'projects', slug, 'versions'),
  versionJson: (root, slug, no) => path.join(root, 'projects', slug, 'versions', `${no}.json`),
  versionHtml: (root, slug, no) => path.join(root, 'projects', slug, 'versions', `${no}.html`),
  versionSpec: (root, slug, no) => path.join(root, 'projects', slug, 'versions', `${no}.spec.md`),
  attachments: (root, slug, no) => path.join(root, 'projects', slug, 'versions', `${no}.files`),
  requirements: (root) => path.join(root, 'requirements'),
  requirement: (root, code) => path.join(root, 'requirements', code),
  requirementFile: (root, code) => path.join(root, 'requirements', code, 'requirement.json'),
  requirementSpec: (root, code) => path.join(root, 'requirements', code, 'spec.md'),
  requirementFiles: (root, code) => path.join(root, 'requirements', code, 'files'),
  milestones: (root) => path.join(root, 'milestones'),
  milestoneFile: (root, name) => path.join(root, 'milestones', `${name}.json`),
  snapshots: (root) => path.join(root, 'snapshots'),
  snapshotFile: (root, name) => path.join(root, 'snapshots', `${name}.json`),
  views: (root) => path.join(root, 'views'),
  teamViews: (root) => path.join(root, 'views', 'team.json'),
  trash: (root) => path.join(root, '.flowlark', 'trash'),
  oplog: (root) => path.join(root, '.flowlark', 'oplog.ndjson')
}

// ---------- 附件 ----------

// 控制字符 + Windows 非法文件名字符 + 路径分隔符。
// 用 \u 转义书写，避免源码里出现不可见字节（那会让 grep 把文件当二进制）。
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\/]/g

/**
 * 附件文件名清洗。
 *
 * 附件名来自用户上传，直接拿来拼路径就是一个路径穿越漏洞 ——
 * 局域网开放后这一点尤其要紧。这里只保留基名并剔除分隔符与控制字符。
 */
export function safeAttachmentName(raw) {
  const base = path.basename(String(raw || '').trim())
  const cleaned = base
    .replace(UNSAFE_NAME_CHARS, '_')
    .replace(/^\.+/, '')   // 前导点：避免生成 .. 或隐藏文件
    .trim()
    .slice(0, 120)
  if (!cleaned) {
    throw err.bad('ATTACHMENT_NAME_INVALID', '附件名不合法', '换一个不含特殊字符的文件名')
  }
  return cleaned
}

export function attachmentPath(root, slug, no, name) {
  const dir = paths.attachments(root, slug, no)
  const p = path.join(dir, safeAttachmentName(name))
  // 纵深防御：清洗过一次了，这里再确认结果确实落在附件目录内
  if (!path.resolve(p).startsWith(path.resolve(dir) + path.sep)) {
    throw err.bad('ATTACHMENT_NAME_INVALID', '非法的附件路径')
  }
  return p
}

export function writeAttachment(root, slug, no, name, content) {
  const p = attachmentPath(root, slug, no, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

export function readAttachment(root, slug, no, name) {
  const p = attachmentPath(root, slug, no, name)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

export function deleteAttachment(root, slug, no, name) {
  const p = attachmentPath(root, slug, no, name)
  if (fs.existsSync(p)) fs.rmSync(p)
  const dir = paths.attachments(root, slug, no)
  // 目录空了就删掉，免得仓库里留一堆空目录（Git 也不跟踪空目录）
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/** 磁盘上实际存在的附件文件名，用于和 version.json 的记录对账 */
export function listAttachmentFiles(root, slug, no) {
  const dir = paths.attachments(root, slug, no)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort()
}

// ---------- 项目 ----------

export function listProjectSlugs(root) {
  const dir = paths.projects(root)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(paths.projectFile(root, d.name)))
    .map((d) => d.name)
    .sort()
}

export function readProject(root, slug) {
  const f = paths.projectFile(root, slug)
  if (!fs.existsSync(f)) throw err.notFound(`项目「${slug}」`, '用 `flowlark ls` 看看有哪些项目')
  const p = parse(fs.readFileSync(f, 'utf8'), `${slug}/project.json`)
  p.slug = slug
  return p
}

export function writeProject(root, slug, project) {
  fs.mkdirSync(paths.versions(root, slug), { recursive: true })
  fs.writeFileSync(paths.projectFile(root, slug), stringify(project, 'project'), 'utf8')
}

export function projectExists(root, slug) {
  return fs.existsSync(paths.projectFile(root, slug))
}

// ---------- 基线指针 ----------

/**
 * 读当前基线。R2「同时只有一个基线」在这里是结构性成立的：
 * 文件只有一行，物理上不可能有第二个。
 */
export function readBaseline(root, slug) {
  const f = paths.baselineFile(root, slug)
  if (!fs.existsSync(f)) return null
  const raw = fs.readFileSync(f, 'utf8').trim()
  return raw || null
}

/** 切换基线 = 一次原子的文件写入，不需要事务，也不存在中间脏状态 */
export function writeBaseline(root, slug, versionNo) {
  const f = paths.baselineFile(root, slug)
  if (versionNo == null) {
    if (fs.existsSync(f)) fs.rmSync(f)
    return
  }
  fs.writeFileSync(f, versionNo + '\n', 'utf8')
}

// ---------- 版本 ----------

export function listVersionNos(root, slug) {
  const dir = paths.versions(root, slug)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
}

export function versionExists(root, slug, no) {
  return fs.existsSync(paths.versionJson(root, slug, no))
}

export function readVersion(root, slug, no) {
  const f = paths.versionJson(root, slug, no)
  if (!fs.existsSync(f)) {
    throw err.notFound(`版本「${no}」`, `用 \`flowlark ls ${slug}\` 看看有哪些版本`)
  }
  const v = parse(fs.readFileSync(f, 'utf8'), `${slug}/versions/${no}.json`)
  v.versionNo = no
  // 缺省值兜底：老仓库里没有的新字段在这里补上，不需要写迁移脚本
  v.changes = v.changes || []
  v.requirements = v.requirements || []
  v.externalRefs = v.externalRefs || []
  v.tags = v.tags || []
  v.attachments = v.attachments || []
  v.reviewStatus = v.reviewStatus || 'pending'
  return v
}

export function writeVersion(root, slug, version) {
  fs.mkdirSync(paths.versions(root, slug), { recursive: true })
  fs.writeFileSync(paths.versionJson(root, slug, version.versionNo), stringify(version, 'version'), 'utf8')
}

export function readHtml(root, slug, no) {
  const f = paths.versionHtml(root, slug, no)
  if (!fs.existsSync(f)) return null
  return fs.readFileSync(f)
}

export function writeHtml(root, slug, no, content) {
  fs.mkdirSync(paths.versions(root, slug), { recursive: true })
  fs.writeFileSync(paths.versionHtml(root, slug, no), content)
}

export function readSpec(root, slug, no) {
  const f = paths.versionSpec(root, slug, no)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}

export function writeSpec(root, slug, no, markdown) {
  const f = paths.versionSpec(root, slug, no)
  if (!markdown || !markdown.trim()) {
    if (fs.existsSync(f)) fs.rmSync(f)
    return
  }
  fs.mkdirSync(paths.versions(root, slug), { recursive: true })
  fs.writeFileSync(f, markdown.endsWith('\n') ? markdown : markdown + '\n', 'utf8')
}

// ---------- 回收站 ----------

/**
 * R7 逻辑删除 = 把版本的三个文件移进 .flowlark/trash。
 *
 * 比字段标记好在：主目录里看到的就是真实存在的版本，
 * 不需要每个查询都记得带 `WHERE deleted_at IS NULL` —— 那个条件漏写一次就是一个 bug。
 */
const TRASH_META = '_trash.json'
const TRASH_ID_RE = /^[A-Za-z0-9_-]{8,512}$/

function trashId(slug, entry) {
  return Buffer.from(JSON.stringify([slug, entry]), 'utf8').toString('base64url')
}

function decodeTrashId(id) {
  const value = String(id || '')
  if (!TRASH_ID_RE.test(value)) throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('shape')
    const [slug, entry] = parsed.map(String)
    if (!SLUG_RE.test(slug) || !entry || path.basename(entry) !== entry) throw new Error('path')
    return { slug, entry }
  } catch {
    throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  }
}

export function readTrashEntry(root, id) {
  const { slug, entry } = decodeTrashId(id)
  const base = path.resolve(paths.trash(root))
  const dir = path.resolve(base, slug, entry)
  if (!dir.startsWith(`${base}${path.sep}`)) throw err.bad('TRASH_ID_INVALID', '回收站记录编号不合法')
  const metaFile = path.join(dir, TRASH_META)
  if (!fs.existsSync(metaFile)) throw err.notFound('回收站记录')
  const meta = parse(fs.readFileSync(metaFile, 'utf8'), TRASH_META)
  if (meta.project !== slug) throw err.bad('TRASH_ENTRY_INVALID', '回收站记录的项目元数据不一致')
  return { ...meta, id: trashId(slug, entry), dir }
}

export function trashVersion(root, slug, no, deletedBy) {
  const deletedAt = new Date().toISOString()
  // 目录名只用于排序与去重，真正的元信息写在 _trash.json 里，不从目录名反解
  const dest = path.join(paths.trash(root), slug, `${deletedAt.replace(/[:.]/g, '-')}__${no}`)
  fs.mkdirSync(dest, { recursive: true })
  // 附件目录一起搬 —— 否则恢复出来的版本会丢掉挂在上面的 PRD 和截图
  for (const p of [
    paths.versionJson(root, slug, no),
    paths.versionHtml(root, slug, no),
    paths.versionSpec(root, slug, no),
    paths.attachments(root, slug, no)
  ]) {
    if (fs.existsSync(p)) fs.renameSync(p, path.join(dest, path.basename(p)))
  }
  fs.writeFileSync(
    path.join(dest, TRASH_META),
    JSON.stringify({ project: slug, versionNo: no, deletedAt, deletedBy }, null, 2) + '\n',
    'utf8'
  )
  return dest
}

export function listTrash(root, slug = null) {
  const base = paths.trash(root)
  if (!fs.existsSync(base)) return []
  const out = []
  for (const s of fs.readdirSync(base, { withFileTypes: true })) {
    if (!s.isDirectory()) continue
    if (slug && s.name !== slug) continue
    const dir = path.join(base, s.name)
    for (const entry of fs.readdirSync(dir)) {
      const entryDir = path.join(dir, entry)
      const metaFile = path.join(entryDir, TRASH_META)
      if (!fs.existsSync(metaFile)) continue
      const meta = parse(fs.readFileSync(metaFile, 'utf8'), TRASH_META)
      out.push({ ...meta, id: trashId(s.name, entry), dir: entryDir })
    }
  }
  return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

export function restoreFromTrash(root, entryDir, slug) {
  fs.mkdirSync(paths.versions(root, slug), { recursive: true })
  for (const f of fs.readdirSync(entryDir)) {
    if (f === TRASH_META) continue
    fs.renameSync(path.join(entryDir, f), path.join(paths.versions(root, slug), f))
  }
  fs.rmSync(entryDir, { recursive: true, force: true })
}

// ---------- 操作日志 ----------

/**
 * append-only ndjson。选它是因为 Git 合并时冲突面最小：
 * 两个人各自追加几行，冲突时保留双方即可，语义不会错。
 */
export function appendOplog(root, entry) {
  const f = paths.oplog(root)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.appendFileSync(f, JSON.stringify(entry) + '\n', 'utf8')
}

export function readOplog(root, { project = null, limit = 100 } = {}) {
  const f = paths.oplog(root)
  if (!fs.existsSync(f)) return []
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  const out = []
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i])
      if (!project || e.project === project) out.push(e)
    } catch {
      /* 单行损坏不影响其余日志，跳过 */
    }
  }
  return out
}
