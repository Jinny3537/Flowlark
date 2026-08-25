import { err } from './errors.js'
import * as store from './store.js'

export const PROJECT_CODE_RE = /^[A-Z0-9]{1,40}$/
export const PROJECT_PRIORITIES = new Set(['', 'P0', 'P1', 'P2', 'P3'])

export function assertEditableProjectCode(value) {
  const code = String(value || '').trim()
  if (!PROJECT_CODE_RE.test(code)) {
    throw err.bad('PROJECT_CODE_INVALID', `项目代码「${code}」不合法`, '只允许 1–40 位大写字母和数字')
  }
  return code
}

export function normalizeProjectPriority(value = '') {
  const priority = String(value || '').trim()
  if (!PROJECT_PRIORITIES.has(priority)) {
    throw err.bad('PROJECT_PRIORITY_INVALID', `项目优先级「${priority}」不合法`, '请选择 P0、P1、P2、P3 或不设置')
  }
  return priority
}

export function normalizeArchived(value = false) {
  if (typeof value !== 'boolean') {
    throw err.bad('PROJECT_ARCHIVED_INVALID', '项目归档状态必须是布尔值')
  }
  return value
}

export function assertUniqueProjectCode(root, code, exceptSlug = null) {
  const key = String(code).trim().toUpperCase()
  for (const slug of store.listProjectSlugs(root)) {
    if (slug === exceptSlug) continue
    const project = store.readProject(root, slug)
    if (String(project.code || '').trim().toUpperCase() === key) {
      throw err.conflict('PROJECT_CODE_EXISTS', `项目代码「${code}」已被项目「${project.name}」使用`)
    }
  }
  return code
}
