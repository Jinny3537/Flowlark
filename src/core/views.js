import fs from 'node:fs'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const SCOPES = new Set(['all', 'versions', 'requirements', 'milestones', 'snapshots'])

function readFile(root) {
  const file = store.paths.teamViews(root)
  if (!fs.existsSync(file)) return { views: [] }
  const value = parse(fs.readFileSync(file, 'utf8'), '团队已存视图')
  return { views: Array.isArray(value.views) ? value.views : [] }
}

function writeFile(root, value) {
  fs.mkdirSync(store.paths.views(root), { recursive: true })
  fs.writeFileSync(store.paths.teamViews(root), stringify(value))
}

export function listSavedViews(root) {
  return readFile(root).views
}

export function saveView(root, input) {
  const id = String(input.id || '').trim().toLowerCase()
  if (!ID_RE.test(id)) throw err.bad('VIEW_ID_INVALID', '视图标识只允许小写字母、数字和连字符')
  if (!String(input.name || '').trim()) throw err.bad('VIEW_NAME_REQUIRED', '请填写视图名称')
  const scope = input.scope || 'all'
  if (!SCOPES.has(scope)) throw err.bad('VIEW_SCOPE_INVALID', `不支持的视图范围：${scope}`)
  const data = readFile(root)
  const item = { id, name: String(input.name).trim(), scope, query: String(input.query || ''), filters: input.filters || {} }
  const index = data.views.findIndex((view) => view.id === id)
  if (index >= 0) data.views[index] = item
  else data.views.push(item)
  writeFile(root, data)
  return item
}

export function removeView(root, id) {
  const data = readFile(root)
  const before = data.views.length
  data.views = data.views.filter((view) => view.id !== id)
  if (before === data.views.length) throw err.notFound(`已存视图「${id}」`)
  writeFile(root, data)
  return { id }
}
