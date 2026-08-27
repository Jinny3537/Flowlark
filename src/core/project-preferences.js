import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify } from './json.js'
import { INTERNAL_DIR } from './repo.js'

const TASKS = new Set(['all', 'pending', 'questions', 'baseline-history', 'void'])

function preferenceFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'project-preferences.json')
}

function readAll(root) {
  const file = preferenceFile(root)
  if (!fs.existsSync(file)) return { projects: {} }
  try {
    const value = parse(fs.readFileSync(file, 'utf8'), '项目筛选偏好')
    return { projects: value.projects && typeof value.projects === 'object' ? value.projects : {} }
  } catch {
    return { projects: {} }
  }
}

function writeAll(root, value) {
  const file = preferenceFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, stringify(value))
  fs.renameSync(tmp, file)
}

export function normalizePreference(input = {}) {
  const task = String(input.task || 'all')
  return {
    query: String(input.query || '').slice(0, 200),
    task: TASKS.has(task) ? task : 'all',
    order: input.order === 'oldest' ? 'oldest' : 'newest',
    author: String(input.author || '').slice(0, 120),
    requirement: String(input.requirement || '').slice(0, 120),
    external: input.external === true
  }
}

export function getProjectPreference(root, slug) {
  return normalizePreference(readAll(root).projects[String(slug)] || {})
}

export function setProjectPreference(root, slug, input) {
  const data = readAll(root)
  const item = normalizePreference(input)
  data.projects[String(slug)] = item
  writeAll(root, data)
  return item
}
