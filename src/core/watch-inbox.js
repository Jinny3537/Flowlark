import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { stringify, parse } from './json.js'
import { INTERNAL_DIR } from './repo.js'
import { extractTitle, inspectHtml } from './importer.js'

const ITEM_ID_RE = /^[a-f0-9-]{36}$/i

function inboxFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'watch', 'inbox.json')
}

function readItems(root) {
  const file = inboxFile(root)
  if (!fs.existsSync(file)) return []
  const value = parse(fs.readFileSync(file, 'utf8'), 'watch 草稿箱')
  return Array.isArray(value.items) ? value.items : []
}

function writeItems(root, items) {
  const file = inboxFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, stringify({ items }))
  fs.renameSync(tmp, file)
}

function assertItemId(id) {
  if (!ITEM_ID_RE.test(String(id || ''))) throw err.bad('WATCH_ITEM_ID_INVALID', 'watch 草稿编号不合法')
  return String(id)
}

export function inferWatchVersionNo(filename, now = new Date()) {
  const name = path.basename(String(filename || ''))
  const match = /(?:^|[^a-z0-9])v?(\d+(?:\.\d+){0,3})(?=[^a-z0-9]|$)/i.exec(name)
  if (match) return `v${match[1]}`
  const p = (n) => String(n).padStart(2, '0')
  return `d${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

export function listWatchInbox(root) {
  return readItems(root).sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)))
}

export function getWatchItem(root, id) {
  const item = readItems(root).find((candidate) => candidate.id === assertItemId(id))
  if (!item) throw err.notFound(`watch 草稿「${id}」`)
  return item
}

export function collectWatchFile(root, slug, sourcePath) {
  const absolute = path.resolve(sourcePath)
  if (!fs.existsSync(absolute)) throw err.notFound(`文件 ${sourcePath}`)
  if (!/\.html?$/i.test(absolute)) throw err.bad('FILE_TYPE', `${path.basename(absolute)} 不是 HTML 文件`)
  const buffer = fs.readFileSync(absolute)
  inspectHtml(buffer.toString('utf8'))
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const items = readItems(root)
  const duplicate = items.find((item) => item.project === slug && item.hash === hash)
  if (duplicate) return { ...duplicate, duplicate: true }

  const item = {
    id: crypto.randomUUID(),
    project: slug,
    sourcePath: absolute,
    filename: path.basename(absolute),
    hash,
    title: extractTitle(buffer.toString('utf8')) || path.basename(absolute).replace(/\.html?$/i, ''),
    suggestedVersionNo: inferWatchVersionNo(absolute),
    size: buffer.length,
    status: 'pending',
    versionNo: null,
    error: null,
    collectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  items.push(item)
  writeItems(root, items)
  return item
}

export function updateWatchItem(root, id, patch) {
  const safeId = assertItemId(id)
  const items = readItems(root)
  const index = items.findIndex((item) => item.id === safeId)
  if (index < 0) throw err.notFound(`watch 草稿「${id}」`)
  items[index] = { ...items[index], ...patch, id: safeId, updatedAt: new Date().toISOString() }
  writeItems(root, items)
  return items[index]
}

export async function waitForStableFile(file, { delayMs = 250, checks = 2 } = {}) {
  let previous = null
  for (let i = 0; i < checks; i++) {
    if (!fs.existsSync(file)) throw err.notFound(`文件 ${file}`)
    const stat = fs.statSync(file)
    const current = `${stat.size}:${stat.mtimeMs}`
    if (previous !== null && previous !== current) i = 0
    previous = current
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return fs.statSync(file)
}
