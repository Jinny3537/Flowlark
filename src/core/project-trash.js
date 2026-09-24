import fs from 'node:fs'
import path from 'node:path'
import * as store from './store.js'
import { err } from './errors.js'

function directory(root, slug) {
  if (!store.SLUG_RE.test(String(slug || ''))) throw err.bad('PROJECT_SLUG_INVALID', '项目标识不合法')
  return path.join(root, '.flowlark', 'project-trash', slug)
}

export function listDeletedProjects(root) {
  const parent = path.join(root, '.flowlark', 'project-trash')
  if (!fs.existsSync(parent)) return []
  return fs.readdirSync(parent, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => {
    const dir = directory(root, item.name)
    const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
    const deleted = JSON.parse(fs.readFileSync(path.join(dir, '.deleted.json'), 'utf8'))
    return { slug: item.name, name: project.name, code: project.code, ...deleted }
  }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

export function isDeletedProject(root, project) {
  return listDeletedProjects(root).some(item => item.slug === project.slug ||
    (project.code && String(item.code).toLowerCase() === String(project.code).toLowerCase()) || item.name === project.name)
}

export function deleteProject(root, slug, who) {
  const target = directory(root, slug)
  const project = store.readProject(root, slug)
  if (fs.existsSync(target)) throw err.conflict('PROJECT_TRASH_CONFLICT', '回收站已有同路径项目，请先处理回收站记录')
  const metadata = { deletedAt: new Date().toISOString(), deletedBy: who, versionCount: store.listVersionNos(root, slug).length }
  const marker = path.join(store.paths.project(root, slug), '.deleted.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(marker, JSON.stringify(metadata, null, 2))
  try { fs.renameSync(store.paths.project(root, slug), target) }
  catch (error) { fs.unlinkSync(marker); throw error }
  return { slug, name: project.name, ...metadata }
}

export function restoreProject(root, slug) {
  const source = directory(root, slug)
  if (!fs.existsSync(source)) throw err.notFound(`已删除项目「${slug}」`)
  const project = JSON.parse(fs.readFileSync(path.join(source, 'project.json'), 'utf8'))
  if (fs.existsSync(store.paths.project(root, slug)) || store.listProjectSlugs(root).some(key => String(store.readProject(root, key).code).toLowerCase() === String(project.code).toLowerCase())) {
    throw err.conflict('PROJECT_EXISTS', '项目路径或代码已被占用，无法恢复')
  }
  fs.renameSync(source, store.paths.project(root, slug))
  fs.unlinkSync(path.join(store.paths.project(root, slug), '.deleted.json'))
  return project
}
