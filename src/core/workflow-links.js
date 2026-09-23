import * as store from './store.js'
import { requirementDetail, readRequirement } from './requirements.js'
import { listMilestones } from './milestones.js'
import { listSnapshots } from './snapshots.js'
import { err } from './errors.js'

export function workflowLinks(root, { requirement, project, version, milestone } = {}) {
  const type = requirement ? 'requirement' : project && version ? 'version' : milestone ? 'milestone' : ''
  if (!type) throw err.bad('WORKFLOW_TARGET_REQUIRED', '请选择需求、原型版本或迭代')
  let requirements = [], versions = [], newerArchive = null
  if (type === 'requirement') {
    const item = requirementDetail(root, requirement)
    requirements = [{ code: item.code, title: item.title, deletedAt: item.deletedAt }]
    versions = item.versions.map(v => ({ project: v.project, version: v.versionNo, title: v.title, status: v.status }))
  } else if (type === 'version') {
    const item = store.readVersion(root, project, version)
    const newer = store.listVersionNos(root, project).map(no => store.readVersion(root, project, no))
      .filter(v => v.status !== 'VOID' && v.createdAt > item.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (newer) newerArchive = { project, version: newer.versionNo, title: newer.title }
    versions = [{ project, version, title: item.title, status: item.status }]
    requirements = (item.requirements || []).map(r => {
      const code = typeof r === 'string' ? r : r.code
      try { const req = readRequirement(root, code); return { code, title: req.title, deletedAt: req.deletedAt } }
      catch (error) { if (error.code !== 'NOT_FOUND') throw error; return { code, missing: true } }
    })
  }
  const matches = entry => type === 'requirement' ? entry.requirement === requirement : entry.project === project && (entry.version || entry.versionNo) === version
  const all = listMilestones(root)
  if (type === 'milestone' && !all.some(m => m.name === milestone)) throw err.notFound('来源迭代')
  const milestones = all.filter(m => type === 'milestone' ? m.name === milestone : m.items.some(matches))
    .map(m => ({ ...m, items: type === 'milestone' ? m.items : m.items.filter(matches) }))
  const deliveries = listSnapshots(root).filter(s => type === 'milestone' ? s.milestone === milestone : (s.items || []).some(matches))
    .map(s => ({ name: s.name, title: s.title, milestone: s.milestone, createdAt: s.createdAt, schemaVersion: s.schemaVersion,
      items: type === 'milestone' ? s.items || [] : (s.items || []).filter(matches) }))
  return { requirements, versions, milestones, deliveries, newerArchive }
}
